import {serveStdio} from '@modelcontextprotocol/server/stdio';
import {createServer} from '../server';
import type {ToolDeps} from '../tools/types';

/**
 * Serves MCP over stdio. Nothing may be written to stdout here — that channel carries the
 * protocol, and a stray log line corrupts the stream. All diagnostics go to stderr.
 *
 * The SDK's `StdioServerTransport` only listens for `data`/`error` on `process.stdin` — it
 * never treats EOF as a close signal, so a disconnecting client (stdin closed, pipe gone)
 * would otherwise leave this process running forever. We watch `process.stdin` ourselves and
 * tear the connection down on `end`/`close`, then let the process exit normally.
 */
export function startStdio(deps: ToolDeps): Promise<void> {
  const handle = serveStdio(() => createServer(deps), {
    onerror: (error) => {
      console.error(`beszel-mcp stdio error: ${error.message}`);
    },
  });

  return new Promise<void>((resolve) => {
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      handle.close().catch((error: unknown) => {
        console.error(`beszel-mcp stdio shutdown error: ${error instanceof Error ? error.message : String(error)}`);
      }).finally(() => {
        resolve();
      });
    };
    process.stdin.once('end', shutdown);
    process.stdin.once('close', shutdown);
  });
}
