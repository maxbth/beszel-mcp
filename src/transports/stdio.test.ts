import {test, expect} from 'bun:test';
import {resolve} from 'node:path';

const entry = resolve(import.meta.dir, '../index.ts');

/** Reads from a stream until the first newline and returns the line without it. */
async function readLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (!buffer.includes('\n')) {
    const {value, done} = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, {stream: true});
  }
  reader.releaseLock();
  const newlineIndex = buffer.indexOf('\n');
  return newlineIndex === -1 ? buffer : buffer.slice(0, newlineIndex);
}

/**
 * Regression test for the stdio lifecycle leak: `startStdio()` used to return a promise that
 * never resolved, so the process never exited when its MCP client disconnected (stdin closed).
 * This spawns the real entry point exactly as a client would invoke it over stdio, sends one
 * `initialize` request, closes stdin, and asserts the process exits on its own.
 *
 * The pass/fail assertion is driven by the process's own exit event (`proc.exited`), not a
 * fixed sleep — the 10s bound only stops CI from hanging forever if the leak regresses.
 */
test('the stdio server exits when stdin closes instead of leaking the process', async () => {
  const proc = Bun.spawn({
    cmd: ['bun', 'run', entry],
    env: {
      ...Bun.env,
      MCP_TRANSPORT: 'stdio',
      BESZEL_URL: 'https://hub.invalid',
      BESZEL_TOKEN: 'x',
    },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const initializeRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: {
        name: 'stdio-lifecycle-test',
        version: '0.0.0'
      },
    },
  };
  await proc.stdin.write(`${JSON.stringify(initializeRequest)}\n`);
  await proc.stdin.flush();

  // Read the initialize response before closing stdin, exactly as a real client would: it
  // waits for the reply, then disconnects. Closing stdin before the response arrives would
  // race the server's in-flight write and is not the scenario this test is targeting.
  const responseLine = await readLine(proc.stdout);
  const response = JSON.parse(responseLine);
  expect(response.result.serverInfo.name).toBe('beszel-mcp');

  await proc.stdin.end();

  const timedOut = Symbol('timed-out');
  const outcome = await Promise.race([
    proc.exited,
    new Promise((res) => setTimeout(() => res(timedOut), 10_000)),
  ]);

  if (outcome === timedOut) {
    proc.kill();
    throw new Error('stdio process did not exit within 10s of stdin closing — the lifecycle leak may have regressed');
  }

  expect(outcome).toBe(0);

  const stderr = await new Response(proc.stderr).text();
  expect(stderr).toBe('');
});
