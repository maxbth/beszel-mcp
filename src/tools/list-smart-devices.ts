import {z} from 'zod';
import {defineTool} from './types';
import {round} from '../decode';

interface SmartAttribute {
  id?: number;
  n: string;
  v: number;
  w?: number;
  t?: number;
  rv?: number;
  rs?: string;
  wf?: string;
}

interface SmartDeviceRecord {
  id: string;
  system: string;
  name: string;
  model: string;
  state: string;
  /**
   * BYTES: `agent/smart.go:875` sets `smartData.Capacity = data.UserCapacity.Bytes`. Optional
   * because a row written before the field existed, or by a device that reports no capacity, has
   * nothing here — dividing `undefined` would emit `NaN`.
   */
  capacity?: number;
  temp: number;
  firmware: string;
  serial: string;
  type: string;
  hours: number;
  cycles: number;
  attributes: Array<SmartAttribute>;
  updated: string;
}

/**
 * The SMART attributes that actually predict failure. A full attribute dump is dozens of
 * vendor-specific counters that mean nothing without a datasheet, so tool output carries
 * only these plus anything the drive itself flagged as failing.
 */
const HEALTH_ATTRIBUTES = new Set([
  'Reallocated_Sector_Ct',
  'Reallocated_Event_Count',
  'Current_Pending_Sector',
  'Offline_Uncorrectable',
  'Reported_Uncorrect',
  'UDMA_CRC_Error_Count',
  'Wear_Leveling_Count',
  'Media_Wearout_Indicator',
  'Percentage_Used',
  'Available_Spare',
  'Temperature_Celsius',
  'Airflow_Temperature_Cel',
]);

/**
 * Binary GB (2^30), which is what a `Gb` suffix means everywhere else in this server and what
 * Beszel itself reports: `agent/utils/utils.go:30` `BytesToGigabytes` divides by 1073741824, and
 * the dashboard's SMART table formats capacity through `formatBytes`
 * (`internal/site/src/lib/utils.ts:278-282`), which divides by `1024 ** 3`. A drive sold as "1 TB"
 * reports 1000204886016 bytes and therefore reads as 931.5 GB in both places — using 10^9 here
 * would print 1000.2 and disagree with both the dashboard and this server's own `memoryGb`.
 */
const BYTES_PER_GB = 1_073_741_824;

/** An attribute is flagged failing only when `wf` names a real condition; upstream writes `-` for none. */
function isFailing(attribute: SmartAttribute): boolean {
  return Boolean(attribute.wf && attribute.wf !== '-');
}

interface SystemNameRecord {
  id: string;
  name: string;
}

const inputSchema = z.object({
  system: z.string().optional().describe('System name or record id. Omit to report disks across every system.'),
});

export default defineTool({
  name: 'list_smart_devices',
  config: {
    title: 'List disk SMART health',
    description:
      'Report SMART health for physical disks: model, serial, capacity, temperature, power-on hours, overall SMART verdict, and the attributes that predict failure. Use this to answer whether any disk is dying.',
    inputSchema,
    annotations: {readOnlyHint: true},
  },
  handler: async (input, {client}) => {
    let filter: string | undefined;
    let systemName: string | undefined;
    if (input.system) {
      const resolved = await client.resolveSystem(input.system);
      systemName = resolved.name;
      filter = client.filter('system = {:id}', {id: resolved.id});
    }

    const [records, systems] = await Promise.all([
      client.list<SmartDeviceRecord>('smart_devices', {
        filter,
        sort: 'name'
      }),
      client.list<SystemNameRecord>('systems', {fields: 'id,name'}),
    ]);
    const namesById = new Map(systems.map((system) => [system.id, system.name]));

    const devices = records.map((record) => {
      const attributes = (record.attributes ?? [])
        .filter((attribute) => HEALTH_ATTRIBUTES.has(attribute.n) || isFailing(attribute))
        .map((attribute) => ({
          id: attribute.id,
          name: attribute.n,
          value: attribute.v,
          worst: attribute.w,
          threshold: attribute.t,
          raw: attribute.rv,
          failing: isFailing(attribute),
        }));

      const anyFailing = attributes.some((attribute) => attribute.failing);
      // `agent/smart.go:913` only ever writes PASSED / FAILED / UNKNOWN, so an empty state means
      // the verdict was never read. Claiming `healthy: true` for a disk nobody asked is the one
      // answer this tool must not give, so the field is omitted instead.
      const healthy = record.state === '' ? undefined : record.state.toUpperCase() === 'PASSED' && !anyFailing;

      return {
        system: namesById.get(record.system) ?? record.system,
        name: record.name,
        model: record.model,
        serial: record.serial,
        type: record.type,
        capacityGb: record.capacity === undefined ? undefined : round(record.capacity / BYTES_PER_GB, 1),
        smartState: record.state,
        temperatureC: record.temp,
        powerOnHours: record.hours,
        powerCycles: record.cycles,
        firmware: record.firmware,
        healthy,
        attributes,
      };
    });

    return {
      system: systemName,
      count: devices.length,
      devices
    };
  },
});
