import {z} from 'zod';
import {defineTool} from './types';
import {decodeSystemInfo, decodeEnum, compact, OS_LABELS} from '../decode';
import type {RawSystemInfo} from '../decode';

interface SystemRecord {
  id: string;
  name: string;
  host: string;
  port: string;
  status: string;
  updated: string;
  info?: RawSystemInfo;
}

/**
 * `systems.info` no longer carries hostname, kernel, cores, cpu model, podman or os — all six
 * moved to this collection in 0.19.0 (`entities/system/system.go:131-147`, and
 * `hub/systems/system.go:764-770` blanks them on the way in). Without this join `list_systems`
 * silently drops every one of them, including the `os` the tool promises.
 */
interface DetailsRecord {
  system: string;
  hostname: string;
  kernel: string;
  cpu: string;
  cores: number;
  threads: number;
  os: number;
  podman: boolean;
}

const inputSchema = z.object({
  status: z.enum(['up', 'down', 'paused', 'pending']).optional().describe('Only return systems in this state.'),
  nameContains: z.string().optional().describe('Case-insensitive substring match on the system name.'),
});

export default defineTool({
  name: 'list_systems',
  config: {
    title: 'List systems',
    description:
      'List every system monitored by the Beszel hub with its current status and a summary of CPU, memory, disk, uptime and load. Start here when you do not know which systems exist.',
    inputSchema,
    annotations: {readOnlyHint: true},
  },
  handler: async (input, {client}) => {
    const [records, allDetails] = await Promise.all([
      client.list<SystemRecord>('systems', {
        filter: input.status ? client.filter('status = {:status}', {status: input.status}) : undefined,
        sort: 'name',
      }),
      // The collection itself only exists from 0.19.0 (`internal/migrations/0_collections_snapshot_0_19_0_dev_1.go`);
      // an older hub answers with 404, which `client.list` turns into a rejected promise. This is the
      // entry-point tool, so the join must never be able to fail the whole call: a hub that cannot serve
      // it degrades to whatever the legacy `info` blob still carries.
      client.list<DetailsRecord>('system_details', {fields: 'system,hostname,kernel,cpu,cores,threads,os,podman'}).catch(() => []),
    ]);
    const detailsBySystem = new Map(allDetails.map((details) => [details.system, details]));

    const needle = input.nameContains?.toLowerCase();
    const matched = needle ? records.filter((record) => record.name.toLowerCase().includes(needle)) : records;

    const systems = matched.map((record) => {
      const details = detailsBySystem.get(record.id);
      const decoded = record.info ? decodeSystemInfo(record.info) : undefined;
      return compact({
        id: record.id,
        name: record.name,
        address: `${record.host}:${record.port}`,
        status: record.status,
        lastSeen: record.updated,
        ...decoded,
        // The details row wins where both exist: `info` only still holds these on a pre-0.19 hub.
        hostname: details?.hostname ?? decoded?.hostname,
        kernel: details?.kernel ?? decoded?.kernel,
        cpuModel: details?.cpu ?? decoded?.cpuModel,
        cores: details?.cores ?? decoded?.cores,
        threads: details?.threads ?? decoded?.threads,
        os: (details ? decodeEnum(OS_LABELS, details.os) : undefined) ?? decoded?.os,
        podman: details?.podman ?? decoded?.podman,
      });
    });

    return {
      count: systems.length,
      systems,
    };
  },
});
