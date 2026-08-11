import {createMcpHandler, localhostAllowedOrigins} from '@modelcontextprotocol/server';
import {createMcpHonoApp} from '@modelcontextprotocol/hono';
import {Hono} from 'hono';
import {createServer} from '../server';
import type {Config} from '../config';
import type {ToolDeps} from '../tools/types';

/**
 * Compares the token bytes in constant time, so a partially-correct guess cannot be walked
 * one byte at a time. The early return on a length mismatch does leak the expected token's
 * length, which is not a useful secret on its own.
 */
function tokensMatch(provided: string, expected: string): boolean {
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

/** The binds `createMcpHonoApp` treats as localhost-class (`@modelcontextprotocol/hono` `hono.ts`). */
const LOCALHOST_BINDS = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * The Origin allow-list actually handed to the SDK.
 *
 * Passing `allowedOrigins` at all suppresses the SDK's own `localhostOriginValidation()`, which it
 * would otherwise install for a localhost-class bind. On such a bind that would silently lock out
 * every browser-hosted client (MCP Inspector on `http://localhost:6274`, a Vite dev server on
 * `http://127.0.0.1:5173`) with a 403, so the SDK's own localhost hostnames are seeded back in and
 * any configured origins are added on top.
 *
 * For every other bind — notably the `0.0.0.0` Docker default — the configured list is passed
 * through as-is, so an unconfigured deployment still rejects every browser Origin rather than
 * losing Origin validation entirely.
 */
function effectiveAllowedOrigins(config: Config): Array<string> {
  if (!LOCALHOST_BINDS.has(config.mcp.host)) {
    return config.mcp.allowedOrigins;
  }
  return [...new Set([...localhostAllowedOrigins(), ...config.mcp.allowedOrigins])];
}

/**
 * Builds the Hono app serving MCP over Streamable HTTP.
 *
 * `createMcpHonoApp` installs Host and Origin validation itself, automatically for
 * localhost-class binds, so DNS rebinding protection is in place before any handler runs.
 * The bearer check is layered on top and deliberately does not cover `/health`, which
 * container runtimes probe unauthenticated.
 *
 * `allowedOrigins` is passed but `allowedHosts` is NOT: they validate different headers.
 * Origin is the browser's claim about who opened the page; Host is the address the client
 * dialled. Feeding one allowlist to both would reject every request whose Host is the
 * server's own hostname unless that hostname also happened to be a permitted page origin —
 * which is exactly the common deployment (reached at mcp.example.com, embedded in a page on
 * app.example.com).
 *
 * A bind of `0.0.0.0` or `::` gets no automatic Host check (there is no single "localhost
 * identity" to validate against), so callers who bind that broadly are warned on stderr and
 * expected to compensate with `MCP_AUTH_TOKEN` — this is exactly the Docker default path,
 * where it matters most.
 *
 * `allowedOrigins` is passed UNCONDITIONALLY, including as an empty array — see
 * `effectiveAllowedOrigins` for what goes into it. An empty array is the documented "allow no
 * browser origin": `validateOriginHeader` rejects every request that carries an `Origin` header
 * while letting header-less non-browser clients through. Passing `undefined` instead would
 * switch Origin validation OFF entirely, which on a `0.0.0.0` bind leaves the server with no
 * DNS-rebinding protection at all.
 */
export function buildHttpApp(
  config: Config,
  deps: ToolDeps,
): {
  app: Hono;
  close: () => Promise<void>;
} {
  const handler = createMcpHandler(() => createServer(deps));

  if ((config.mcp.host === '0.0.0.0' || config.mcp.host === '::') && config.mcp.authToken === undefined) {
    console.error(
      `Warning: beszel-mcp is bound to ${config.mcp.host} with no MCP_AUTH_TOKEN. Anything that can reach this port can read every monitored machine, container and disk, and fetch container logs. Host-header validation is not available on a wildcard bind, so set MCP_AUTH_TOKEN.`,
    );
  }

  const mcpApp = createMcpHonoApp({
    host: config.mcp.host,
    allowedOrigins: effectiveAllowedOrigins(config),
  });

  const expected = config.mcp.authToken;
  if (expected !== undefined) {
    mcpApp.use('/mcp', async (c, next) => {
      const header = c.req.header('Authorization') ?? '';
      const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
      if (provided === '' || !tokensMatch(provided, expected)) {
        return c.json({error: 'unauthorized'}, 401);
      }
      await next();
    });
  }

  mcpApp.all('/mcp', (c) => handler.fetch(c.req.raw));

  /*
   * `/health` is answered by an outer app mounted in front of the MCP one, so it sits outside
   * BOTH the bearer check and the Host/Origin validation `createMcpHonoApp` installs. Every
   * other route falls through to the MCP app and keeps the full protection.
   *
   * The probe is the reason. An uptime checker or reverse proxy — Pangolin, Traefik, a Docker
   * HEALTHCHECK, a Kubernetes liveness probe — is not a browser and holds no token, yet the
   * middleware it would otherwise hit rejects it two different ways: a proxy that forwards the
   * public `Host` (`mcp.example.com`) fails Host validation on a localhost bind, and a prober
   * that happens to send an `Origin` fails Origin validation on any bind. Both produced a 403
   * on a route whose entire body is `{"status":"ok"}`.
   *
   * Exempting it costs nothing, because those two checks defend against a threat this route
   * does not carry. DNS-rebinding protection exists so a malicious page cannot use a victim's
   * browser to read data from a server on their network; `/health` exposes no monitoring data,
   * no configuration, no credential, and mutates nothing. An attacker who reaches it learns
   * only that something is listening — which the TCP handshake already told them.
   */
  const app = new Hono();
  app.get('/health', (c) => c.json({status: 'ok'}));
  app.route('/', mcpApp);

  return {
    app,
    close: () => handler.close(),
  };
}

export function startHttp(config: Config, deps: ToolDeps): {stop: () => void} {
  const {app, close} = buildHttpApp(config, deps);
  const server = Bun.serve({
    fetch: app.fetch,
    hostname: config.mcp.host,
    port: config.mcp.port,
  });
  console.error(`beszel-mcp listening on http://${config.mcp.host}:${config.mcp.port}/mcp`);
  return {
    stop: () => {
      void close();
      server.stop(true);
    },
  };
}
