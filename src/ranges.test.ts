import {test, expect} from 'bun:test';
import {resolveRange, downsample, mergePeak, summarize, RANGE_VALUES} from './ranges';

const now = new Date('2026-08-05T12:00:00.000Z');

test('every range maps to the bucket that still retains data', () => {
  expect(resolveRange('1h', now).bucket).toBe('1m');
  expect(resolveRange('12h', now).bucket).toBe('10m');
  expect(resolveRange('24h', now).bucket).toBe('20m');
  expect(resolveRange('7d', now).bucket).toBe('120m');
  expect(resolveRange('30d', now).bucket).toBe('480m');
});

test('resolveRange computes the correct window start', () => {
  expect(resolveRange('1h', now).since.toISOString()).toBe('2026-08-05T11:00:00.000Z');
  expect(resolveRange('24h', now).since.toISOString()).toBe('2026-08-04T12:00:00.000Z');
  expect(resolveRange('30d', now).since.toISOString()).toBe('2026-07-06T12:00:00.000Z');
});

test('RANGE_VALUES lists every supported range', () => {
  expect([...RANGE_VALUES]).toEqual(['1h', '12h', '24h', '7d', '30d']);
});

test('downsample returns the input untouched when it already fits', () => {
  const points = [1, 2, 3];
  expect(downsample(points, 10, (group) => group[0] as number)).toEqual([1, 2, 3]);
});

test('downsample reduces to at most maxPoints', () => {
  const points = Array.from({length: 100}, (_, index) => index);
  const result = downsample(points, 10, (group) => group[0] as number);
  expect(result.length).toBeLessThanOrEqual(10);
});

test('downsample preserves chronological order and covers the whole input', () => {
  const points = Array.from({length: 50}, (_, index) => index);
  const result = downsample(points, 5, (group) => group[0] as number);
  expect(result[0]).toBe(0);
  expect(result).toEqual([...result].sort((a, b) => a - b));
  expect(result.at(-1)).toBeGreaterThan(39);
});

test('downsample handles an empty input', () => {
  const points: Array<number> = [];
  expect(downsample(points, 10, (group) => group[0] as number)).toEqual([]);
});

test('summarize computes min, avg and max', () => {
  expect(summarize([1, 2, 3, 4])).toEqual({
    min: 1,
    avg: 2.5,
    max: 4
  });
});

test('summarize returns undefined for no values', () => {
  expect(summarize([])).toBeUndefined();
});

test('mergePeak takes the max of every numeric field in a group', () => {
  const merged = mergePeak([
    {
      recordedAt: 't0',
      cpuPercent: 5,
      memoryUsedGb: 9
    },
    {
      recordedAt: 't1',
      cpuPercent: 97,
      memoryUsedGb: 8
    },
    {
      recordedAt: 't2',
      cpuPercent: 6,
      memoryUsedGb: 8.5
    },
  ]);
  expect(merged.cpuPercent).toBe(97);
  expect(merged.memoryUsedGb).toBe(9);
  // Non-numeric fields, including the timestamp, come from the start of the window.
  expect(merged.recordedAt).toBe('t0');
});

test('mergePeak keeps the first value for arrays and maps, which have no scalar max', () => {
  const merged = mergePeak([
    {
      loadAverage: [1, 2, 3],
      temperaturesC: {cpu: 40}
    },
    {
      loadAverage: [9, 9, 9],
      temperaturesC: {cpu: 90}
    },
  ]);
  expect(merged.loadAverage).toEqual([1, 2, 3]);
  expect(merged.temperaturesC).toEqual({cpu: 40});
});

test('mergePeak picks up a field that only later points in the group carry', () => {
  const merged = mergePeak([
    {cpuPercent: 1}, {
      cpuPercent: 2,
      gpuPercent: 40
    }
  ]);
  expect(merged.cpuPercent).toBe(2);
  expect(merged.gpuPercent).toBe(40);
});
