import {test, expect} from 'bun:test';
import tool from './list-containers';
import type {BeszelClient} from '../client';

const container = {
  id: 'a1b2c3d4e5f60718',
  system: 's1',
  name: 'caddy',
  image: 'caddy:2',
  ports: '80,443',
  status: 'running',
  health: 2,
  cpu: 1.5,
  // Real wire values: `memory` is MEGABYTES (`agent/docker.go:362` -> `hub/systems/system.go:330`)
  // and `net` is sent+recv BYTES PER SECOND (`hub/systems/system.go:331-335`).
  memory: 120,
  net: 419_430,
  updated: 1_754_400_000,
};

function fakeClient(records: Array<unknown>): BeszelClient {
  return {
    resolveSystem: async () => ({
      id: 's1',
      name: 'nas'
    }),
    list: async () => records,
    filter: (expression: string) => expression,
  } as unknown as BeszelClient;
}

test('decodes container health from its numeric enum', async () => {
  const result = (await tool.handler({system: 'nas'}, {client: fakeClient([container])})) as Record<string, unknown>;
  const containers = result.containers as Array<unknown>;
  const first = containers[0] as Record<string, unknown>;
  expect(first.health).toBe('Healthy');
  expect(first.name).toBe('caddy');
  expect(first.image).toBe('caddy:2');
  expect(result.count).toBe(1);
});

test('reports memory in megabytes and network as a per-second megabyte rate', async () => {
  const result = (await tool.handler({system: 'nas'}, {client: fakeClient([container])})) as Record<string, unknown>;
  const first = (result.containers as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  // 120 MB of RSS is 120 MB, not 120 GB.
  expect(first.memoryMb).toBe(120);
  // 419430 B/s is 0.4 MB/s, not 419430 MB.
  expect(first.networkMbPerSec).toBe(0.4);
  expect(first.memoryGb).toBeUndefined();
  expect(first.networkMb).toBeUndefined();
});

test('filters by name substring case-insensitively', async () => {
  const records = [
    container, {
      ...container,
      id: 'ff'.repeat(8),
      name: 'postgres'
    }
  ];
  const result = (await tool.handler({
    system: 'nas',
    nameContains: 'POST'
  }, {client: fakeClient(records)})) as Record<string, unknown>;
  const containers = result.containers as Array<Record<string, unknown>>;
  expect(containers.map((c) => c.name)).toEqual(['postgres']);
});

test('filters by status', async () => {
  const records = [
    container, {
      ...container,
      id: 'ee'.repeat(8),
      name: 'old',
      status: 'exited'
    }
  ];
  const result = (await tool.handler({
    system: 'nas',
    status: 'exited'
  }, {client: fakeClient(records)})) as Record<string, unknown>;
  const containers = result.containers as Array<Record<string, unknown>>;
  expect(containers.map((c) => c.name)).toEqual(['old']);
});
