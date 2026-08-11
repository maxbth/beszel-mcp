import {test, expect} from 'bun:test';
import tool from './get-container-metrics';
import type {BeszelClient} from '../client';

/**
 * `m` is MEGABYTES (`agent/docker.go:362`) and `b` is `[sent, recv]` BYTES PER SECOND
 * (`agent/docker.go:363`). caddy holds ~100 MB, pg ~1 GB.
 */
function statsAt(minute: number, caddyCpu: number, pgCpu: number, pgMemMb: number) {
  return {
    created: `2026-08-05 11:${String(minute).padStart(2, '0')}:00.000Z`,
    stats: [
      {
        n: 'caddy',
        c: caddyCpu,
        m: 102.4,
        b: [104_857, 209_715]
      }, {
        n: 'pg',
        c: pgCpu,
        m: pgMemMb,
        b: [1_048_576, 524_288]
      }
    ],
  };
}

const records = [statsAt(0, 1, 5, 1_024), statsAt(10, 3, 7, 1_126.4)];

function fakeClient(rows: Array<unknown> = records): BeszelClient {
  return {
    resolveSystem: async () => ({
      id: 's1',
      name: 'nas'
    }),
    list: async () => rows,
    filter: (expression: string, params: Record<string, unknown>) => `${expression}|${JSON.stringify(params)}`,
  } as unknown as BeszelClient;
}

test('groups the series by container name', async () => {
  const result = (await tool.handler({system: 'nas'}, {client: fakeClient()})) as Record<string, unknown>;
  const containers = result.containers as Record<string, unknown>;
  expect(Object.keys(containers).sort()).toEqual(['caddy', 'pg']);
  const caddy = containers.caddy as Record<string, unknown>;
  expect((caddy.points as Array<unknown>).length).toBe(2);
});

test('restricts output to the requested containers', async () => {
  const result = (await tool.handler({
    system: 'nas',
    containers: ['caddy']
  }, {client: fakeClient()})) as Record<string, unknown>;
  const containers = result.containers as Record<string, unknown>;
  expect(Object.keys(containers)).toEqual(['caddy']);
});

test('summarizes cpu per container over the full series', async () => {
  const result = (await tool.handler({system: 'nas'}, {client: fakeClient()})) as Record<string, unknown>;
  const containers = result.containers as Record<string, unknown>;
  const pg = containers.pg as Record<string, unknown>;
  const summary = pg.summary as Record<string, unknown>;
  expect(summary.cpuPercent).toEqual({
    min: 5,
    avg: 6,
    max: 7
  });
});

test('reports container memory in megabytes and network as a per-second rate', async () => {
  const result = (await tool.handler({system: 'nas'}, {client: fakeClient()})) as Record<string, unknown>;
  const pg = (result.containers as Record<string, unknown>).pg as Record<string, unknown>;
  const point = (pg.points as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  // A 1 GiB Postgres container reports 1024 MB, not 1024 GB.
  expect(point.memoryMb).toBe(1_024);
  expect(point.memoryGb).toBeUndefined();
  expect(point.networkSentMbPerSec).toBe(1);
  expect(point.networkReceivedMbPerSec).toBe(0.5);
  const summary = pg.summary as Record<string, unknown>;
  expect(summary.memoryMb).toEqual({
    min: 1_024,
    avg: 1_075.2,
    max: 1_126.4
  });
});

test('summary covers the full series and downsampling keeps each group peak', async () => {
  const spiky = [statsAt(0, 1, 5, 1_024), statsAt(10, 1, 90, 1_024), statsAt(20, 1, 6, 1_024), statsAt(30, 1, 6, 1_024)];
  const result = (await tool.handler({
    system: 'nas',
    maxPoints: 2
  }, {client: fakeClient(spiky)})) as Record<string, unknown>;
  const pg = (result.containers as Record<string, unknown>).pg as Record<string, unknown>;
  expect((pg.summary as Record<string, unknown>).cpuPercent).toMatchObject({max: 90});
  const points = pg.points as Array<Record<string, unknown>>;
  expect(points.length).toBe(2);
  // The 90% spike is in the first merged group and must survive the reduction.
  expect(points[0]?.cpuPercent).toBe(90);
});
