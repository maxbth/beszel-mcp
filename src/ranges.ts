/**
 * Beszel aggregates stats into five buckets and prunes each on its own schedule: 1m for an
 * hour, 10m for 12 hours, 20m for a day, 120m for a week, 480m for a month. Asking for a
 * 30-day window at the 1m bucket returns nothing at all, because those records are long
 * gone — so this mapping is a correctness requirement, not a convenience.
 */

export type Range = '1h' | '12h' | '24h' | '7d' | '30d';
export type Bucket = '1m' | '10m' | '20m' | '120m' | '480m';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const RANGE_TABLE: Record<Range, {
  bucket: Bucket;
  windowMs: number;
}> = {
  '1h': {
    bucket: '1m',
    windowMs: HOUR_MS
  },
  '12h': {
    bucket: '10m',
    windowMs: 12 * HOUR_MS
  },
  '24h': {
    bucket: '20m',
    windowMs: DAY_MS
  },
  '7d': {
    bucket: '120m',
    windowMs: 7 * DAY_MS
  },
  '30d': {
    bucket: '480m',
    windowMs: 30 * DAY_MS
  },
};

export const RANGE_VALUES = ['1h', '12h', '24h', '7d', '30d'] as const satisfies ReadonlyArray<Range>;

export function resolveRange(range: Range, now: Date = new Date()): {
  bucket: Bucket;
  since: Date;
} {
  const entry = RANGE_TABLE[range];
  return {
    bucket: entry.bucket,
    since: new Date(now.getTime() - entry.windowMs)
  };
}

/**
 * Reduces `points` to at most `maxPoints` by merging consecutive groups with `merge`. Order
 * is preserved. Callers compute their summary statistics over the FULL series before calling
 * this, so peaks are not smoothed away by the reduction.
 */
export function downsample<T>(points: Array<T>, maxPoints: number, merge: (group: Array<T>) => T): Array<T> {
  if (points.length <= maxPoints || maxPoints < 1) {
    return points;
  }
  const groupSize = Math.ceil(points.length / maxPoints);
  const result: Array<T> = [];
  for (let index = 0; index < points.length; index += groupSize) {
    result.push(merge(points.slice(index, index + groupSize)));
  }
  return result;
}

/**
 * The `merge` for both metric tools: each returned point is the PEAK of its group, so a spike
 * that occupies a single bucket survives the reduction instead of having a 1-in-groupSize
 * chance of being the sample that got kept. Taking the first sample of each group — plain
 * decimation — silently drops excursions, which is the opposite of what a tool built to find
 * them should do.
 *
 * Only numbers are reduced. Arrays and maps (`loadAverage`, `cpuPerCorePercent`, `gpus`,
 * `diskIo`, `temperaturesC`, `battery`) have no meaningful element-wise max here, so the
 * group's first value is kept; `recordedAt` likewise marks the START of the merged window.
 */
export function mergePeak<T extends Record<string, unknown>>(group: Array<T>): T {
  const first = group[0] ?? ({} as T);
  const result: Record<string, unknown> = {...first};
  for (const point of group.slice(1)) {
    for (const [key, value] of Object.entries(point)) {
      const current = result[key];
      if (typeof value === 'number' && typeof current === 'number') {
        result[key] = Math.max(current, value);
      } else if (current === undefined) {
        result[key] = value;
      }
    }
  }
  return result as T;
}

export function summarize(values: Array<number>): {
  min: number;
  avg: number;
  max: number;
} | undefined {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length === 0) {
    return undefined;
  }
  const sum = usable.reduce((total, value) => total + value, 0);
  return {
    min: Math.min(...usable),
    avg: Math.round((sum / usable.length) * 100) / 100,
    max: Math.max(...usable),
  };
}
