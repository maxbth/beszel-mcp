// src/tools/list-systems.test.ts
import {test, expect} from 'bun:test';
import tool from './list-systems';
import {BeszelError} from '../client';
import type {BeszelClient} from '../client';

const record = {
  id: 's1',
  name: 'nas',
  host: '10.0.0.5',
  port: '45876',
  status: 'up',
  updated: '2026-08-05 11:59:00.000Z',
  // What a >= 0.19 agent actually puts in `systems.info`: no h/k/c/m/p/os — those moved to
  // `system_details` (`entities/system/system.go:131-147`, `agent/system.go:253-261`).
  info: {
    cpu: 12.5,
    u: 90_061,
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

/**
 * `details` is either the rows the `system_details` join returns or an error it rejects with —
 * a hub older than 0.19.0 has no such collection at all and answers 404.
 */
function fakeClient(
  records: Array<unknown>,
  capture?: (options: unknown) => void,
  details: Array<unknown> | Error = [detailsRecord],
): BeszelClient {
  return {
    list: async (collection: string, options: unknown) => {
      if (collection === 'system_details') {
        if (details instanceof Error) {
          throw details;
        }
        return details;
      }
      capture?.(options);
      return records;
    },
    filter: (expression: string) => expression,
  } as unknown as BeszelClient;
}

test('returns decoded systems', async () => {
  const result = (await tool.handler({}, {client: fakeClient([record])})) as {systems: Array<Record<string, unknown>>};
  expect(result.systems.length).toBe(1);
  const system = result.systems[0] as Record<string, unknown>;
  expect(system.name).toBe('nas');
  expect(system.address).toBe('10.0.0.5:45876');
  expect(system.status).toBe('up');
  expect(system.cpuPercent).toBe(12.5);
  expect(system.memoryPercent).toBe(61.2);
  expect(system.os).toBe('Linux');
  expect(system.connectionType).toBe('WebSocket');
  expect(system.bandwidthMbPerSec).toBe(1.5);
});

test('recovers hostname, kernel, cores, cpu model, os and podman from system_details', async () => {
  // Regression guard: these six fields are no longer in `systems.info` on any current hub, so
  // reading them only from there returned nothing at all.
  const result = (await tool.handler({}, {client: fakeClient([record])})) as {systems: Array<Record<string, unknown>>};
  const system = result.systems[0] as Record<string, unknown>;
  expect(system.hostname).toBe('nas');
  expect(system.kernel).toBe('6.1.0');
  expect(system.cores).toBe(4);
  expect(system.threads).toBe(8);
  expect(system.cpuModel).toBe('Intel N100');
  expect(system.os).toBe('Linux');
  expect(system.podman).toBe(false);
});

test('still decodes a pre-0.19 info blob when the hub has no system_details collection at all', async () => {
  // A hub older than 0.19.0 does not have the collection, so PocketBase answers 404 and
  // `client.list` rejects — the join must not take the whole tool call down with it.
  const legacy = {
    ...record,
    info: {
      h: 'oldbox',
      k: '5.10.0',
      c: 2,
      m: 'Xeon E3',
      cpu: 4,
      u: 60,
      mp: 10,
      dp: 20,
      b: 0.5,
      v: '0.18.0',
      os: 0,
    },
  };
  const result = (await tool.handler(
    {},
    {client: fakeClient([legacy], undefined, new BeszelError('Beszel returned 404 for this request.', 404))},
  )) as {
    systems: Array<Record<string, unknown>>;
  };
  const system = result.systems[0] as Record<string, unknown>;
  expect(system.hostname).toBe('oldbox');
  expect(system.cpuModel).toBe('Xeon E3');
  expect(system.os).toBe('Linux');
  expect(system.bandwidthMbPerSec).toBe(0.5);
});

test('a system with no system_details row on a 0.19 hub still lists', async () => {
  // Distinct from the case above: the collection exists and answers, it just has no row yet.
  const result = (await tool.handler({}, {client: fakeClient([record], undefined, [])})) as {
    systems: Array<Record<string, unknown>>;
  };
  const system = result.systems[0] as Record<string, unknown>;
  expect(system.name).toBe('nas');
  expect(system.hostname).toBeUndefined();
  expect(system.cpuPercent).toBe(12.5);
});

test('reports the total count', async () => {
  const records = [
    record,
    {
      ...record,
      id: 's2',
      name: 'web',
    },
  ];
  const result = (await tool.handler({}, {client: fakeClient(records)})) as {count: number};
  expect(result.count).toBe(2);
});

test('passes a status filter through to the query', async () => {
  let captured: unknown;
  await tool.handler({status: 'down'}, {client: fakeClient([], (options) => (captured = options))});
  expect(JSON.stringify(captured)).toContain('status');
});

test('filters by name substring case-insensitively in memory', async () => {
  const records = [
    record,
    {
      ...record,
      id: 's2',
      name: 'WebServer',
    },
  ];
  const result = (await tool.handler({nameContains: 'web'}, {client: fakeClient(records)})) as {systems: Array<{name: string}>};
  expect(result.systems.map((system) => system.name)).toEqual(['WebServer']);
});

test('tolerates a system whose info blob is missing', async () => {
  const result = (await tool.handler(
    {},
    {
      client: fakeClient([
        {
          ...record,
          info: undefined,
        },
      ]),
    },
  )) as {
    systems: Array<Record<string, unknown>>;
  };
  const system = result.systems[0] as Record<string, unknown>;
  expect(system.name).toBe('nas');
  expect(system.cpuPercent).toBeUndefined();
});
