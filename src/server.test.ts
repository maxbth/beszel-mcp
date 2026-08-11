// src/server.test.ts
import {test, expect} from 'bun:test';
import {createServer} from './server';
import {BeszelError} from './client';
import type {BeszelClient} from './client';
import {Client, InMemoryTransport} from '@modelcontextprotocol/client';

function connect(client: BeszelClient) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({client});
  const mcpClient = new Client({
    name: 'test',
    version: '0.0.0',
  });
  return Promise.all([mcpClient.connect(clientTransport), server.connect(serverTransport)]).then(() => mcpClient);
}

test('every registered tool is advertised and marked read-only', async () => {
  const mcpClient = await connect({
    list: async () => [],
    filter: (e: string) => e,
  } as unknown as BeszelClient);
  const {tools} = await mcpClient.listTools();
  expect(tools.length).toBeGreaterThan(0);
  expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  await mcpClient.close();
});

test('a tool call returns JSON text content', async () => {
  const mcpClient = await connect({
    list: async () => [],
    filter: (e: string) => e,
  } as unknown as BeszelClient);
  const result = await mcpClient.callTool({
    name: 'list_systems',
    arguments: {},
  });
  const content = (
    result.content as Array<{
      type: string;
      text: string;
    }>
  )[0] as {
    type: string;
    text: string;
  };
  expect(JSON.parse(content.text)).toEqual({
    count: 0,
    systems: [],
  });
  await mcpClient.close();
});

test('a BeszelError surfaces as an MCP error with its message intact', async () => {
  const failing = {
    list: async () => {
      throw new BeszelError('Cannot reach the Beszel hub at https://hub.example.com.');
    },
    filter: (e: string) => e,
  } as unknown as BeszelClient;
  const mcpClient = await connect(failing);
  const result = await mcpClient.callTool({
    name: 'list_systems',
    arguments: {},
  });
  expect(result.isError).toBe(true);
  const content = (result.content as Array<{text: string}>)[0] as {text: string};
  expect(content.text).toContain('Cannot reach the Beszel hub');
  await mcpClient.close();
});

test('an unexpected error does not leak its message to the caller', async () => {
  const failing = {
    list: async () => {
      throw new Error('postgres://user:hunter2@internal');
    },
    filter: (e: string) => e,
  } as unknown as BeszelClient;
  const mcpClient = await connect(failing);
  const result = await mcpClient.callTool({
    name: 'list_systems',
    arguments: {},
  });
  expect(result.isError).toBe(true);
  const content = (result.content as Array<{text: string}>)[0] as {text: string};
  expect(content.text).not.toContain('hunter2');
  await mcpClient.close();
});
