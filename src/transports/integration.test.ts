import {test, expect, afterAll} from 'bun:test';
import {buildHttpApp} from './http';
import {Client, StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import type {Config} from '../config';
import type {BeszelClient} from '../client';

const systemRecord = {
  id: 's1',
  name: 'nas',
  host: '10.0.0.5',
  port: '45876',
  status: 'up',
  updated: '2026-08-05 11:59:00.000Z',
  // The shape a >= 0.19 agent actually sends: no h/c/m/os in `info` — those live in
  // `system_details` now (`entities/system/system.go:131-147`).
  info: {
    cpu: 12.5,
    u: 3_600,
    mp: 61.2,
    dp: 44.4,
    bb: 1_572_864,
    v: '0.9.1',
    ct: 2,
  },
};

const detailsRecord = {
  system: 's1',
  hostname: 'nas',
  kernel: '6.1.0',
  cpu: 'Intel N100',
  cores: 4,
  threads: 8,
  os: 0,
  podman: false,
};

const stubClient = {
  list: async (collection: string) => (collection === 'system_details' ? [detailsRecord] : [systemRecord]),
  filter: (expression: string) => expression,
} as unknown as BeszelClient;

const config: Config = {
  beszel: {
    url: 'https://hub.example.com',
    token: 'x',
    superuser: false,
    timeoutMs: 5_000
  },
  mcp: {
    transport: 'http',
    host: '127.0.0.1',
    port: 0,
    allowedOrigins: []
  },
  logLevel: 'info',
};

const {app, close} = buildHttpApp(config, {client: stubClient});
// Port 0 lets the OS pick a free one, so parallel CI runs cannot collide on a fixed port.
const server = Bun.serve({
  fetch: app.fetch,
  hostname: '127.0.0.1',
  port: 0
});
const baseUrl = `http://127.0.0.1:${server.port}/mcp`;

afterAll(async () => {
  await close();
  server.stop(true);
});

test('a real MCP client can list every tool over Streamable HTTP', async () => {
  const client = new Client({
    name: 'integration',
    version: '0.0.0'
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(baseUrl)));
  const {tools} = await client.listTools();
  expect(tools.map((tool) => tool.name)).toContain('list_systems');
  expect(tools.length).toBe(12);
  await client.close();
});

test('a real MCP client gets decoded output from a tool call over Streamable HTTP', async () => {
  const client = new Client({
    name: 'integration',
    version: '0.0.0'
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(baseUrl)));
  const result = await client.callTool({
    name: 'list_systems',
    arguments: {}
  });
  const content = (result.content as Array<{text: string}>)[0] as {text: string};
  const payload = JSON.parse(content.text);
  expect(payload.count).toBe(1);
  expect(payload.systems[0].name).toBe('nas');
  expect(payload.systems[0].os).toBe('Linux');
  expect(payload.systems[0].cpuModel).toBe('Intel N100');
  expect(payload.systems[0].hostname).toBe('nas');
  await client.close();
});

test('every tool advertises a JSON Schema for its input', async () => {
  const client = new Client({
    name: 'integration',
    version: '0.0.0'
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(baseUrl)));
  const {tools} = await client.listTools();
  for (const tool of tools) {
    expect(tool.inputSchema.type).toBe('object');
    expect(tool.description?.length ?? 0).toBeGreaterThan(20);
  }
  await client.close();
});
