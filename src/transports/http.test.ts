import {test, expect} from 'bun:test';
import {buildHttpApp} from './http';
import type {Config} from '../config';
import type {BeszelClient} from '../client';

const client = {
  list: async () => [],
  filter: (e: string) => e,
} as unknown as BeszelClient;

function config(overrides: Partial<Config['mcp']> = {}): Config {
  return {
    beszel: {
      url: 'https://hub.example.com',
      token: 'x',
      superuser: false,
      timeoutMs: 5_000,
    },
    mcp: {
      transport: 'http',
      host: '127.0.0.1',
      port: 3_000,
      allowedOrigins: [],
      ...overrides,
    },
    logLevel: 'info',
  };
}

// `app.request()` is Hono's documented in-process test helper: it builds a bare `Request`
// without going through a real socket, so — unlike a real HTTP/1.1 connection — no `Host`
// header is attached unless one is supplied explicitly. `createMcpHonoApp` validates Host
// for DNS rebinding protection on every request, so every call below carries one that
// matches the `127.0.0.1` bind used by `config()`. The last test in this file exercises the
// real (non-test-helper) path, over an actual `Bun.serve` socket, where the header always
// arrives on its own.

test('health endpoint responds without auth even when a token is configured', async () => {
  const {app, close} = buildHttpApp(config({authToken: 'sekret'}), {client});
  const response = await app.request('http://127.0.0.1/health', {headers: {Host: '127.0.0.1'}});
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({status: 'ok'});
  await close();
});

test('mcp endpoint rejects a request with no bearer token when one is required', async () => {
  const {app, close} = buildHttpApp(config({authToken: 'sekret'}), {client});
  const response = await app.request('http://127.0.0.1/mcp', {
    method: 'POST',
    headers: {Host: '127.0.0.1'},
  });
  expect(response.status).toBe(401);
  await close();
});

test('mcp endpoint rejects a wrong bearer token', async () => {
  const {app, close} = buildHttpApp(config({authToken: 'sekret'}), {client});
  const response = await app.request('http://127.0.0.1/mcp', {
    method: 'POST',
    headers: {
      Host: '127.0.0.1',
      Authorization: 'Bearer wrong',
    },
  });
  expect(response.status).toBe(401);
  await close();
});

test('the 401 body does not echo the expected token', async () => {
  const {app, close} = buildHttpApp(config({authToken: 'sekret'}), {client});
  const response = await app.request('http://127.0.0.1/mcp', {
    method: 'POST',
    headers: {Host: '127.0.0.1'},
  });
  expect(await response.text()).not.toContain('sekret');
  await close();
});

test('mcp endpoint is reachable without a token when none is configured', async () => {
  const {app, close} = buildHttpApp(config(), {client});
  const response = await app.request('http://127.0.0.1/mcp', {
    method: 'POST',
    headers: {
      Host: '127.0.0.1',
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'ping',
    }),
  });
  expect(response.status).toBe(200);
  await close();
});

test('a browser Origin is rejected on a wildcard bind when no origins are allow-listed', async () => {
  // `0.0.0.0` gets no automatic localhost Origin check, so this depends entirely on the empty
  // allow-list being passed through rather than collapsed to `undefined` — which would switch
  // Origin validation off and leave the shipped Docker default with no rebinding protection.
  const {app, close} = buildHttpApp(config({host: '0.0.0.0'}), {client});
  const response = await app.request('http://x/mcp', {
    method: 'POST',
    headers: {
      Host: 'x',
      Origin: 'http://evil.example.com'
    },
  });
  expect(response.status).toBe(403);
  await close();
});

test('an allow-listed Origin is accepted', async () => {
  // The SDK matches the Origin's HOSTNAME, which is why MCP_ALLOWED_ORIGINS is documented as
  // a list of hostnames rather than full origins.
  const {app, close} = buildHttpApp(config({
    host: '0.0.0.0',
    allowedOrigins: ['app.example.com']
  }), {client});
  const response = await app.request('http://x/mcp', {
    method: 'POST',
    headers: {
      Host: 'x',
      Origin: 'https://app.example.com',
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'ping'
    }),
  });
  expect(response.status).toBe(200);
  await close();
});

test('a localhost bind still accepts a localhost browser Origin with no origins configured', async () => {
  // The default `bun run dev` setup: `MCP_HOST=127.0.0.1`, `MCP_ALLOWED_ORIGINS` unset. Passing an
  // empty list straight through would suppress the SDK's `localhostOriginValidation()` and 403 the
  // MCP Inspector, which serves itself from `http://localhost:6274`.
  const {app, close} = buildHttpApp(config(), {client});
  for (const origin of ['http://localhost:6274', 'http://127.0.0.1:5173', 'http://[::1]:8080']) {
    const response = await app.request('http://127.0.0.1/mcp', {
      method: 'POST',
      headers: {
        Host: '127.0.0.1',
        Origin: origin,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'ping',
      }),
    });
    expect(response.status).toBe(200);
  }
  await close();
});

test('a localhost bind still rejects a non-localhost Origin', async () => {
  const {app, close} = buildHttpApp(config(), {client});
  const response = await app.request('http://127.0.0.1/mcp', {
    method: 'POST',
    headers: {
      Host: '127.0.0.1',
      Origin: 'http://evil.example.com',
    },
  });
  expect(response.status).toBe(403);
  await close();
});

test('configured origins are added to the localhost defaults rather than replacing them', async () => {
  const {app, close} = buildHttpApp(config({allowedOrigins: ['app.example.com']}), {client});
  for (const origin of ['https://app.example.com', 'http://localhost:6274']) {
    const response = await app.request('http://127.0.0.1/mcp', {
      method: 'POST',
      headers: {
        Host: '127.0.0.1',
        Origin: origin,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'ping',
      }),
    });
    expect(response.status).toBe(200);
  }
  await close();
});

test('a non-browser client that sends no Origin still works on a localhost bind', async () => {
  const {app, close} = buildHttpApp(config(), {client});
  const response = await app.request('http://127.0.0.1/mcp', {
    method: 'POST',
    headers: {
      Host: '127.0.0.1',
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'ping',
    }),
  });
  expect(response.status).toBe(200);
  await close();
});

test('a non-browser client that sends no Origin still works on a wildcard bind', async () => {
  const {app, close} = buildHttpApp(config({host: '0.0.0.0'}), {client});
  const response = await app.request('http://x/mcp', {
    method: 'POST',
    headers: {
      Host: 'x',
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'ping'
    }),
  });
  expect(response.status).toBe(200);
  await close();
});

test('a real connection enforces Host validation on /mcp: a forged Host is rejected, a real one is not', async () => {
  const {app, close} = buildHttpApp(config(), {client});
  const server = Bun.serve({
    fetch: app.fetch,
    hostname: '127.0.0.1',
    port: 0,
  });
  try {
    const forged = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: {Host: 'evil.example.com'},
    });
    expect(forged.status).toBe(403);

    // A legitimate Host gets past validation; 415 is the MCP handler objecting to the
    // absent Content-Type, which is proof the request reached it rather than being blocked.
    const real = await fetch(`http://127.0.0.1:${server.port}/mcp`, {method: 'POST'});
    expect(real.status).not.toBe(403);
  } finally {
    server.stop(true);
    await close();
  }
});

/*
 * The probe suite. An uptime checker or reverse proxy holds no token, is not a browser, and
 * often forwards the public Host — each of which the MCP route's protections reject. /health
 * must answer all of them, while /mcp keeps every one of those protections.
 */
test('/health answers a proxied public Host on a localhost bind', async () => {
  const {app, close} = buildHttpApp(config(), {client});
  const response = await app.request('http://x/health', {headers: {Host: 'mcp.example.com'}});
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({status: 'ok'});
  await close();
});

test('/health answers a prober that sends an Origin, even one not on the allowlist', async () => {
  const {app, close} = buildHttpApp(config({allowedOrigins: ['app.example.com']}), {client});
  const response = await app.request('http://x/health', {
    headers: {
      Host: 'mcp.example.com',
      Origin: 'https://uptime-robot.example.net'
    },
  });
  expect(response.status).toBe(200);
  await close();
});

test('/health answers unauthenticated on a wildcard bind with a token configured', async () => {
  const {app, close} = buildHttpApp(config({
    host: '0.0.0.0',
    authToken: 'sekret'
  }), {client});
  const response = await app.request('http://x/health', {headers: {Host: 'mcp.example.com'}});
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain('sekret');
  await close();
});

test('exempting /health does not leak the exemption to /mcp', async () => {
  const {app, close} = buildHttpApp(config({
    host: '0.0.0.0',
    authToken: 'sekret'
  }), {client});

  const noToken = await app.request('http://x/mcp', {
    method: 'POST',
    headers: {Host: 'mcp.example.com'}
  });
  expect(noToken.status).toBe(401);

  // A valid token must still not buy past Origin validation.
  const forgedOrigin = await app.request('http://x/mcp', {
    method: 'POST',
    headers: {
      Host: 'mcp.example.com',
      Origin: 'https://evil.example.com',
      Authorization: 'Bearer sekret'
    },
  });
  expect(forgedOrigin.status).toBe(403);

  await close();
});

test('an unknown route is not swallowed by the health app', async () => {
  const {app, close} = buildHttpApp(config(), {client});
  const response = await app.request('http://x/nope', {headers: {Host: '127.0.0.1'}});
  expect(response.status).toBe(404);
  await close();
});
