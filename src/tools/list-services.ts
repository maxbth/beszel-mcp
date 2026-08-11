import {z} from 'zod';
import {defineTool} from './types';
import {decodeEnum, round, SERVICE_STATUS_LABELS, SERVICE_SUB_STATE_LABELS} from '../decode';

interface ServiceRecord {
  id: string;
  name: string;
  state: number;
  sub: number;
  cpu: number;
  cpuPeak: number;
  /** BYTES: the raw D-Bus `MemoryCurrent` / `MemoryPeak` properties, unconverted by both the
   * agent (`agent/systemd.go:204-228`) and the hub (`hub/systems/system.go:298-299`). */
  memory: number;
  memPeak: number;
  updated: number;
}

const BYTES_PER_MB = 1_048_576;

const inputSchema = z.object({
  system: z.string().describe('System name or record id.'),
  state: z
    .enum(['Active', 'Inactive', 'Failed', 'Activating', 'Deactivating', 'Reloading'])
    .optional()
    .describe('Only return services in this state. Use "Failed" to find what is broken.'),
  nameContains: z.string().optional().describe('Case-insensitive substring match on the unit name.'),
});

export default defineTool({
  name: 'list_services',
  config: {
    title: 'List systemd services',
    description:
      'List systemd units on one system with their state, sub-state, and current and peak CPU and memory. Filter by state "Failed" to find broken units quickly.',
    inputSchema,
    annotations: {readOnlyHint: true},
  },
  handler: async (input, {client}) => {
    const {id, name} = await client.resolveSystem(input.system);

    const records = await client.list<ServiceRecord>('systemd_services', {
      filter: client.filter('system = {:id}', {id}),
      sort: 'name',
    });

    const needle = input.nameContains?.toLowerCase();
    const services = records
      .map((record) => ({
        name: record.name,
        state: decodeEnum(SERVICE_STATUS_LABELS, record.state),
        subState: decodeEnum(SERVICE_SUB_STATE_LABELS, record.sub),
        cpuPercent: round(record.cpu, 2),
        cpuPeakPercent: round(record.cpuPeak, 2),
        memoryMb: round(record.memory / BYTES_PER_MB, 2),
        memoryPeakMb: round(record.memPeak / BYTES_PER_MB, 2),
      }))
      .filter((service) => {
        const nameOk = needle === undefined || service.name.toLowerCase().includes(needle);
        const stateOk = input.state === undefined || service.state === input.state;
        return nameOk && stateOk;
      });

    return {
      system: name,
      count: services.length,
      services
    };
  },
});
