import {z} from 'zod';
import {defineTool} from './types';

interface AlertRecord {
  id: string;
  system: string;
  name: string;
  value: number;
  min: number;
  triggered: boolean;
}

interface SystemNameRecord {
  id: string;
  name: string;
}

const inputSchema = z.object({
  system: z.string().optional().describe('System name or record id. Omit for alerts across every system.'),
  triggeredOnly: z.boolean().default(false).describe('Return only alerts that are currently firing.'),
});

export default defineTool({
  name: 'list_alerts',
  config: {
    title: 'List configured alerts',
    description:
      'List the alert thresholds configured for the authenticated user, with the metric, threshold, sustain window, and whether each is currently firing. Alerts are per-user, so this shows only what this account configured.',
    inputSchema,
    annotations: {readOnlyHint: true},
  },
  handler: async (input, {client}) => {
    let filter: string | undefined;
    if (input.system) {
      const resolved = await client.resolveSystem(input.system);
      filter = client.filter('system = {:id}', {id: resolved.id});
    }

    const triggeredOnly = input.triggeredOnly ?? false;

    const [records, systems] = await Promise.all([
      client.list<AlertRecord>('alerts', {
        filter,
        sort: 'name'
      }),
      client.list<SystemNameRecord>('systems', {fields: 'id,name'}),
    ]);
    const namesById = new Map(systems.map((system) => [system.id, system.name]));

    const alerts = records
      .filter((record) => !triggeredOnly || record.triggered)
      .map((record) => ({
        system: namesById.get(record.system) ?? record.system,
        metric: record.name,
        threshold: record.value,
        sustainMinutes: record.min,
        triggered: record.triggered,
      }));

    return {
      count: alerts.length,
      triggeredCount: alerts.filter((alert) => alert.triggered).length,
      alerts,
    };
  },
});
