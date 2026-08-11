import {z} from 'zod';
import {defineTool} from './types';
import {decodeSystemStats} from '../decode';
import type {RawSystemStats} from '../decode';
import {resolveRange, downsample, mergePeak, summarize, RANGE_VALUES} from '../ranges';

interface StatsRecord {
  created: string;
  stats: RawSystemStats;
}

/** Which decoded fields each metric group contributes. */
const METRIC_FIELDS = {
  cpu: ['cpuPercent', 'cpuPerCorePercent'],
  memory: ['memoryTotalGb', 'memoryUsedGb', 'memoryPercent', 'memoryCacheGb', 'swapTotalGb', 'swapUsedGb', 'zfsArcGb'],
  disk: ['diskTotalGb', 'diskUsedGb', 'diskPercent', 'diskReadMbPerSec', 'diskWriteMbPerSec', 'diskIo'],
  network: ['networkSentMbPerSec', 'networkReceivedMbPerSec'],
  load: ['loadAverage'],
  temperature: ['temperaturesC'],
  gpu: ['gpus'],
  battery: ['battery'],
} as const;

type MetricGroup = keyof typeof METRIC_FIELDS;

const DEFAULT_METRICS: Array<MetricGroup> = ['cpu', 'memory', 'disk', 'network'];

/** Fields worth a min/avg/max roll-up — scalars only, so maps and tuples are excluded. */
const SUMMARY_FIELDS = [
  'cpuPercent',
  'memoryPercent',
  'memoryUsedGb',
  'diskPercent',
  'diskReadMbPerSec',
  'diskWriteMbPerSec',
  'networkSentMbPerSec',
  'networkReceivedMbPerSec',
] as const;

const inputSchema = z.object({
  system: z.string().describe('System name or record id.'),
  range: z.enum(RANGE_VALUES).default('1h').describe('Time window. Each maps to the stat resolution Beszel still retains for it.'),
  metrics: z
    .array(z.enum(['cpu', 'memory', 'disk', 'network', 'load', 'temperature', 'gpu', 'battery']))
    .optional()
    .describe('Metric groups to include. Defaults to cpu, memory, disk and network.'),
  maxPoints: z.number().int().min(1).max(500).default(60).describe('Maximum time-series points to return.'),
});

export default defineTool({
  name: 'get_system_metrics',
  config: {
    title: 'Get system metrics over time',
    description:
      'Time-series metrics for one system over a chosen window, plus a min/avg/max summary per metric. Use this to answer questions about trends, spikes and sustained load rather than the current instant.',
    inputSchema,
    annotations: {readOnlyHint: true},
  },
  handler: async (input, {client}) => {
    const {id, name} = await client.resolveSystem(input.system);
    const range = input.range ?? '1h';
    const maxPoints = input.maxPoints ?? 60;
    const {bucket, since} = resolveRange(range);
    const groups: Array<MetricGroup> = input.metrics ?? DEFAULT_METRICS;
    const allowed = new Set<string>(groups.flatMap((group) => [...METRIC_FIELDS[group]]));

    const records = await client.list<StatsRecord>('system_stats', {
      filter: client.filter('system = {:id} && type = {:type} && created >= {:since}', {
        id,
        type: bucket,
        since: since.toISOString().replace('T', ' ').replace('Z', ''),
      }),
      sort: 'created',
    });

    const decoded: Array<Record<string, unknown>> = records.map((record) => ({
      recordedAt: record.created,
      ...decodeSystemStats(record.stats),
    }));

    // Summaries come from the FULL series so a downsampled peak is not lost.
    const summary: Record<string, {
      min: number;
      avg: number;
      max: number;
    }> = {};
    for (const field of SUMMARY_FIELDS) {
      if (!allowed.has(field)) {
        continue;
      }
      const values = decoded.map((point) => point[field]).filter((value): value is number => typeof value === 'number');
      const stats = summarize(values);
      if (stats) {
        summary[field] = stats;
      }
    }

    const projected = decoded.map((point) => {
      const result: Record<string, unknown> = {recordedAt: point.recordedAt};
      for (const [key, value] of Object.entries(point)) {
        if (key !== 'recordedAt' && allowed.has(key)) {
          result[key] = value;
        }
      }
      return result;
    });

    const points = downsample(projected, maxPoints, mergePeak);

    return {
      system: name,
      range,
      bucket,
      from: since.toISOString(),
      to: new Date().toISOString(),
      sampleCount: decoded.length,
      returnedCount: points.length,
      summary,
      points,
    };
  },
});
