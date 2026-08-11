import {test, expect} from 'bun:test';
import tool from './get-hub-info';
import type {BeszelClient} from '../client';

function fakeClient(): BeszelClient {
  return {
    send: async () => ({
      v: '0.19.0',
      cu: true,
      key: 'ssh-ed25519 AAAA'
    }),
    list: async () => [
      {
        id: 's1',
        name: 'a',
        status: 'up'
      },
      {
        id: 's2',
        name: 'b',
        status: 'down'
      },
      {
        id: 's3',
        name: 'c',
        status: 'up'
      },
    ],
    filter: (expression: string) => expression,
  } as unknown as BeszelClient;
}

test('reports the hub version and per-status system counts', async () => {
  const result = (await tool.handler({}, {client: fakeClient()})) as Record<string, unknown>;
  expect(result.hubVersion).toBe('0.19.0');
  expect(result.updateCheckEnabled).toBe(true);
  expect(result.systemCount).toBe(3);
  expect(result.systemsByStatus).toEqual({
    up: 2,
    down: 1
  });
});

test('never returns the hub public key', async () => {
  const result = await tool.handler({}, {client: fakeClient()});
  expect(JSON.stringify(result)).not.toContain('ssh-ed25519');
});
