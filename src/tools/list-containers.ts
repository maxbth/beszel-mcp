import {z} from 'zod';
import {defineTool} from './types';
import {decodeEnum, round, CONTAINER_HEALTH_LABELS} from '../decode';

interface ContainerRecord {
  id: string;
  system: string;
  name: string;
  image: string;
  ports: string;
  status: string;
  health: number;
  cpu: number;
  /** Megabytes — written verbatim from `container.Mem` (`hub/systems/system.go:330`), which
   * `agent/docker.go:362` sets with `utils.BytesToMegabytes`. */
  memory: number;
  /** BYTES per second, sent+recv summed (`hub/systems/system.go:331-335`). */
  net: number;
  updated: number;
}

const BYTES_PER_MB = 1_048_576;

const inputSchema = z.object({
  system: z.string().optional().describe('System name or record id. Omit to list containers across every system.'),
  status: z.string().optional().describe('Case-insensitive exact match on container status, e.g. "running" or "exited".'),
  nameContains: z.string().optional().describe('Case-insensitive substring match on the container name.'),
});

export default defineTool({
  name: 'list_containers',
  config: {
    title: 'List containers',
    description:
      'List Docker or Podman containers known to the hub, with image, status, health, CPU, memory, network and published ports. Omit "system" to sweep every monitored machine.',
    inputSchema,
    annotations: {readOnlyHint: true},
  },
  handler: async (input, {client}) => {
    let systemName: string | undefined;
    let filter: string | undefined;
    if (input.system) {
      const resolved = await client.resolveSystem(input.system);
      systemName = resolved.name;
      filter = client.filter('system = {:id}', {id: resolved.id});
    }

    const records = await client.list<ContainerRecord>('containers', {
      filter,
      sort: 'name'
    });

    const needle = input.nameContains?.toLowerCase();
    const wantedStatus = input.status?.toLowerCase();
    const matched = records.filter((record) => {
      const nameOk = needle === undefined || record.name.toLowerCase().includes(needle);
      const statusOk = wantedStatus === undefined || record.status.toLowerCase() === wantedStatus;
      return nameOk && statusOk;
    });

    return {
      system: systemName,
      count: matched.length,
      containers: matched.map((record) => ({
        id: record.id,
        name: record.name,
        image: record.image,
        status: record.status,
        health: decodeEnum(CONTAINER_HEALTH_LABELS, record.health),
        cpuPercent: round(record.cpu, 2),
        memoryMb: round(record.memory, 2),
        networkMbPerSec: round(record.net / BYTES_PER_MB, 3),
        ports: record.ports,
      })),
    };
  },
});
