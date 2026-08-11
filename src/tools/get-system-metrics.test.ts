import {test, expect} from 'bun:test';
import tool from './get-system-metrics';
import type {BeszelClient} from '../client';

function statsAt(minute: number, cpu: number, sentBytesPerSec = 524_288) {
  return {
    created: `2026-08-05 11:${String(minute).padStart(2, '0')}:00.000Z`,
    stats: {
      cpu,
      m: 16,
      mu: 8,
      mp: 50,
      mb: 2,
      s: 4,
      su: 1,
      d: 500,
      du: 250,
      dp: 50,
      dr: 1,
      dw: 2,
      b: [sentBytesPerSec, 1_572_864]
    },
  };
}

function fakeClient(records: Array<unknown>, capture?: (options: unknown) => void): BeszelClient {
  return {
    resolveSystem: async () => ({
      id: 's1',
      name: 'nas'
    }),
    list: async (_collection: string, options: unknown) => {
      capture?.(options);
      return records;
    },
    filter: (expression: string, params: Record<string, unknown>) => `${expression}|${JSON.stringify(params)}`,
  } as unknown as BeszelClient;
}

test('returns the bucket it selected for the requested range', async () => {
  const result = (await tool.handler({
    system: 'nas',
    range: '7d'
  }, {client: fakeClient([statsAt(1, 10)])})) as Record<string, unknown>;
  expect(result.bucket).toBe('120m');
  expect(result.range).toBe('7d');
});

test('defaults to the 1h range and the 1m bucket', async () => {
  const result = (await tool.handler({system: 'nas'}, {client: fakeClient([statsAt(1, 10)])})) as Record<string, unknown>;
  expect(result.range).toBe('1h');
  expect(result.bucket).toBe('1m');
});

test('queries the bucket matching the range', async () => {
  let captured: Record<string, unknown> | undefined;
  await tool.handler({
    system: 'nas',
    range: '30d'
  }, {client: fakeClient([], (options) => (captured = options as Record<string, unknown>))});
  expect(captured?.filter).toContain('480m');
});

test('summary is computed over the full series, not the downsampled one', async () => {
  const records = [statsAt(1, 0), statsAt(2, 100), statsAt(3, 50), statsAt(4, 50)];
  const result = (await tool.handler({
    system: 'nas',
    maxPoints: 2
  }, {client: fakeClient(records)})) as Record<string, unknown>;
  const points = result.points as Array<unknown>;
  const summary = result.summary as Record<string, Record<string, unknown>>;
  const cpuSummary = summary.cpuPercent as Record<string, unknown>;
  expect(points.length).toBeLessThanOrEqual(2);
  expect(cpuSummary.max).toBe(100);
  expect(cpuSummary.min).toBe(0);
});

test('restricts output to the requested metric groups', async () => {
  const result = (await tool.handler({
    system: 'nas',
    metrics: ['cpu']
  }, {client: fakeClient([statsAt(1, 10)])})) as Record<string, unknown>;
  const points = result.points as Array<Record<string, unknown>>;
  const point = points[0] as Record<string, unknown>;
  expect(point.cpuPercent).toBe(10);
  expect(point.memoryPercent).toBeUndefined();
  expect(point.networkSentMbPerSec).toBeUndefined();
});

test('the default network group actually returns data', async () => {
  // Regression guard for the silent failure: `network` is in the DEFAULT metric set, and
  // decoding the dead `ns`/`nr` fields made every point and the whole summary come back empty
  // while the response still looked structurally fine.
  const result = (await tool.handler({system: 'nas'}, {client: fakeClient([statsAt(1, 10)])})) as Record<string, unknown>;
  const point = (result.points as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  expect(point.networkSentMbPerSec).toBe(0.5);
  expect(point.networkReceivedMbPerSec).toBe(1.5);
  const summary = result.summary as Record<string, unknown>;
  expect(summary.networkSentMbPerSec).toEqual({
    min: 0.5,
    avg: 0.5,
    max: 0.5
  });
});

test('downsampling keeps the peak of each merged group rather than discarding it', async () => {
  // 4 samples into 2 points: plain decimation would drop the 100% spike at minute 2 entirely.
  const records = [statsAt(1, 0), statsAt(2, 100), statsAt(3, 50), statsAt(4, 50)];
  const result = (await tool.handler({
    system: 'nas',
    maxPoints: 2
  }, {client: fakeClient(records)})) as Record<string, unknown>;
  const points = result.points as Array<Record<string, unknown>>;
  expect(points.length).toBe(2);
  expect(points[0]?.cpuPercent).toBe(100);
  expect(points[1]?.cpuPercent).toBe(50);
  // The merged point is still labelled with the START of its window.
  expect(points[0]?.recordedAt).toBe('2026-08-05 11:01:00.000Z');
});

test('reports an empty series without failing', async () => {
  const result = (await tool.handler({system: 'nas'}, {client: fakeClient([])})) as Record<string, unknown>;
  expect(result.points).toEqual([]);
  expect(result.summary).toEqual({});
});
