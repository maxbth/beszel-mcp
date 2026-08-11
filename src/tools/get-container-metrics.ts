import {z} from 'zod';
import {defineTool} from './types';
import {decodeContainerStat} from '../decode';
import type {RawContainerStat} from '../decode';
import {resolveRange, downsample, mergePeak, summarize, RANGE_VALUES} from '../ranges';

interface ContainerStatsRecord {
  created: string;
  stats: Array<RawContainerStat>;
}

const inputSchema = z.object({
  system: z.string().describe('System name or record id.'),
  containers: z.array(z.string()).optional().describe('Container names to include. Omit for all of them.'),
  range: z.enum(RANGE_VALUES).default('1h').describe('Time window.'),
  maxPoints: z.number().int().min(1).max(500).default(60).describe('Maximum points per container.'),
});

export default defineTool({
  name: 'get_container_metrics',
  config: {
    title: 'Get container metrics over time',
    description:
      'Per-container CPU, memory and network time series for one system, with a min/avg/max summary per container. Use this to find which container is responsible for a spike.',
    inputSchema,
    annotations: {readOnlyHint: true},
  },
  handler: async (input, {client}) => {
    const {id, name} = await client.resolveSystem(input.system);
    const range = input.range ?? '1h';
    const maxPoints = input.maxPoints ?? 60;
    const {bucket, since} = resolveRange(range);

    const records = await client.list<ContainerStatsRecord>('container_stats', {
      filter: client.filter('system = {:id} && type = {:type} && created >= {:since}', {
        id,
        type: bucket,
        since: since.toISOString().replace('T', ' ').replace('Z', ''),
      }),
      sort: 'created',
    });

    const wanted = input.containers ? new Set(input.containers) : undefined;
    const series = new Map<string, Array<Record<string, unknown>>>();

    for (const record of records) {
      for (const stat of record.stats) {
        if (wanted && !wanted.has(stat.n)) {
          continue;
        }
        const decoded = decodeContainerStat(stat);
        const {name: containerName, ...rest} = decoded;
        const key = typeof containerName === 'string' ? containerName : stat.n;
        const points = series.get(key) ?? [];
        points.push({
          recordedAt: record.created,
          ...rest
        });
        series.set(key, points);
      }
    }

    const containers: Record<string, unknown> = {};
    for (const [containerName, points] of series) {
      const summary: Record<string, {
        min: number;
        avg: number;
        max: number;
      }> = {};
      for (const field of ['cpuPercent', 'memoryMb', 'networkSentMbPerSec', 'networkReceivedMbPerSec']) {
        const values = points.map((point) => point[field]).filter((value): value is number => typeof value === 'number');
        const stats = summarize(values);
        if (stats) {
          summary[field] = stats;
        }
      }
      containers[containerName] = {
        sampleCount: points.length,
        summary,
        points: downsample(points, maxPoints, mergePeak),
      };
    }

    return {
      system: name,
      range,
      bucket,
      from: since.toISOString(),
      containers
    };
  },
});
