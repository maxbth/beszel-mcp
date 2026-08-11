import {z} from 'zod';
import {defineTool} from './types';
import {BeszelError} from '../client';

interface SystemdDetails {
  Description?: string;
  ActiveState?: string;
  SubState?: string;
  LoadState?: string;
  MainPID?: number;
  MemoryCurrent?: number | null;
  MemoryPeak?: number | null;
  CPUUsageNSec?: number | null;
  NRestarts?: number;
  Result?: string;
  UnitFileState?: string;
  FragmentPath?: string;
  StateChangeTimestamp?: number;
}

const BYTES_PER_MB = 1_048_576;
const NANOSECONDS_PER_SECOND = 1_000_000_000;

/**
 * `null`, not just `undefined`: the agent leaves unavailable D-Bus properties nil
 * (`agent/systemd.go:268`), which arrives as JSON `null`. Reporting a unit with no memory
 * accounting as using 0 MB is a different claim from not knowing.
 */
function toMb(bytes: number | null | undefined): number | undefined {
  return bytes === undefined || bytes === null ? undefined : Math.round((bytes / BYTES_PER_MB) * 100) / 100;
}

const inputSchema = z.object({
  system: z.string().describe('System name or record id.'),
  service: z.string().describe('Exact unit name, as reported by list_services (e.g. "nginx.service").'),
});

export default defineTool({
  name: 'get_service_details',
  config: {
    title: 'Get systemd service detail',
    description:
      'Detail for one systemd unit, proxied live from the agent: description, active/sub/load state, main PID, memory current and peak, CPU time, restart count and unit file path. Use after list_services identifies a unit worth inspecting.',
    inputSchema,
    annotations: {readOnlyHint: true},
  },
  handler: async (input, {client}) => {
    const {id, name} = await client.resolveSystem(input.system);

    let response: {details?: SystemdDetails};
    try {
      response = await client.send<{details?: SystemdDetails}>('/api/beszel/systemd/info', {
        system: id,
        service: input.service,
      });
    } catch (error) {
      // The hub returns 404 both for an unknown unit and for a system this account cannot
      // see. resolveSystem already proved the system is visible, so a 404 here is the unit.
      if (error instanceof BeszelError && error.status === 404) {
        throw new BeszelError(`No systemd unit named "${input.service}" on ${name}. Run list_services to see what exists.`, 404);
      }
      throw error;
    }

    const details = response.details ?? {};
    return {
      system: name,
      name: input.service,
      description: details.Description,
      activeState: details.ActiveState,
      subState: details.SubState,
      loadState: details.LoadState,
      unitFileState: details.UnitFileState,
      mainPid: details.MainPID,
      memoryCurrentMb: toMb(details.MemoryCurrent),
      memoryPeakMb: toMb(details.MemoryPeak),
      cpuUsageSeconds:
        details.CPUUsageNSec === undefined || details.CPUUsageNSec === null
          ? undefined
          : Math.round((details.CPUUsageNSec / NANOSECONDS_PER_SECOND) * 100) / 100,
      restarts: details.NRestarts,
      result: details.Result,
      fragmentPath: details.FragmentPath,
      stateChangedAt:
        details.StateChangeTimestamp === undefined || details.StateChangeTimestamp === 0
          ? undefined
          : new Date(details.StateChangeTimestamp / 1_000).toISOString(),
    };
  },
});
