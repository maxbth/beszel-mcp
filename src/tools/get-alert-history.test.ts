import {test, expect} from 'bun:test';
import tool from './get-alert-history';
import type {BeszelClient} from '../client';

const entry = {
  id: 'h1',
  system: 's1',
  name: 'CPU',
  value: 95,
  created: '2026-08-05 10:00:00.000Z',
  resolved: '2026-08-05 10:30:00.000Z',
};

function fakeClient(entries: Array<unknown>): BeszelClient {
  return {
    resolveSystem: async () => ({
      id: 's1',
      name: 'nas'
    }),
    list: async (collection: string) => (collection === 'alerts_history' ? entries : [
      {
        id: 's1',
        name: 'nas'
      }
    ]),
    filter: (expression: string) => expression,
  } as unknown as BeszelClient;
}

test('computes the duration of a resolved alert', async () => {
  const result = (await tool.handler({}, {client: fakeClient([entry])})) as Record<string, unknown>;
  const first = (result.history as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  expect(first.durationMinutes).toBe(30);
  expect(first.system).toBe('nas');
  expect(first.metric).toBe('CPU');
  // ISO, matching the `since` echoed in the same response — PocketBase stores a
  // space-separated datetime, which is not what the rest of the payload speaks.
  expect(first.firedAt).toBe('2026-08-05T10:00:00.000Z');
  expect(first.resolvedAt).toBe('2026-08-05T10:30:00.000Z');
  expect(result.since).toMatch(/T.*Z$/);
});

test('marks an unresolved alert as still firing', async () => {
  const result = (await tool.handler({}, {
    client: fakeClient([
      {
        ...entry,
        resolved: null
      }
    ])
  })) as Record<string, unknown>;
  const first = (result.history as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  expect(first.resolvedAt).toBeUndefined();
  expect(first.stillFiring).toBe(true);
  expect(first.durationMinutes).toBeUndefined();
});

test('rejects a since value that is not a timestamp instead of failing opaquely', async () => {
  await expect(tool.handler({since: '7 days ago'}, {client: fakeClient([entry])})).rejects.toThrow(/ISO 8601/);
});
