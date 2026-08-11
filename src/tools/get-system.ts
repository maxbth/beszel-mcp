import {z} from 'zod';
import {defineTool} from './types';
import {BeszelError} from '../client';
import {decodeSystemInfo, decodeSystemStats, decodeEnum, round, OS_LABELS} from '../decode';
import type {RawSystemInfo, RawSystemStats} from '../decode';

interface SystemRecord {
  id: string;
  name: string;
  host: string;
  port: string;
  status: string;
  updated: string;
  info?: RawSystemInfo;
}

interface DetailsRecord {
  hostname: string;
  kernel: string;
  cores: number;
  threads: number;
  cpu: string;
  os: number;
  os_name: string;
  arch: string;
  /** BYTES: `agent/system.go:95` sets `MemoryTotal = hostInfo.MemTotal`, gopsutil's raw byte
   * count. (Cross-check: the hub's back-compat path at `hub/systems/system.go:774` builds it
   * as `uint64(cd.Stats.Mem * 1024 * 1024 * 1024)`.) */
  memory: number;
  podman: boolean;
}

const BYTES_PER_GB = 1_073_741_824;

interface StatsRecord {
  created: string;
  stats: RawSystemStats;
}

const inputSchema = z.object({
  system: z.string().describe('System name or record id.'),
});

export default defineTool({
  name: 'get_system',
  config: {
    title: 'Get system detail',
    description:
      'Full detail for one system: hardware (CPU model, cores, threads, memory, OS, kernel, architecture), current status, and its most recent metrics sample. Use this after list_systems to dig into a specific machine.',
    inputSchema,
    annotations: {readOnlyHint: true},
  },
  handler: async (input, {client}) => {
    const {id, name} = await client.resolveSystem(input.system);

    // `first` is one bounded request per collection; the newest `1m` sample is all this needs,
    // and the 1m bucket holds an hour of them.
    const [record, details, latest] = await Promise.all([
      client.first<SystemRecord>('systems', {filter: client.filter('id = {:id}', {id})}),
      client.first<DetailsRecord>('system_details', {filter: client.filter('system = {:id}', {id})}),
      client.first<StatsRecord>('system_stats', {
        filter: client.filter('system = {:id} && type = "1m"', {id}),
        sort: '-created',
      }),
    ]);

    if (!record) {
      throw new BeszelError(`System "${name}" disappeared between lookup and read.`, 404);
    }

    return {
      id: record.id,
      name: record.name,
      address: `${record.host}:${record.port}`,
      status: record.status,
      lastSeen: record.updated,
      ...(record.info ? decodeSystemInfo(record.info) : {}),
      hardware: details
        ? {
          hostname: details.hostname,
          kernel: details.kernel,
          cpuModel: details.cpu,
          cores: details.cores,
          threads: details.threads,
          arch: details.arch,
          memoryGb: round(details.memory / BYTES_PER_GB, 2),
          os: decodeEnum(OS_LABELS, details.os),
          osName: details.os_name,
          podman: details.podman,
        }
        : undefined,
      latestStats: latest ? {
        recordedAt: latest.created,
        ...decodeSystemStats(latest.stats)
      } : undefined,
    };
  },
});
