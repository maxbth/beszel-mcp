import {z} from 'zod';
import {defineTool} from './types';
import {BeszelError} from '../client';

interface AlertHistoryRecord {
  id: string;
  system: string;
  name: string;
  value: number;
  created: string;
  resolved?: string | null;
}

interface SystemNameRecord {
  id: string;
  name: string;
}

const SEVEN_DAYS_MS = 7 * 86_400_000;
const DEFAULT_LIMIT = 50;

const inputSchema = z.object({
  system: z.string().optional().describe('System name or record id. Omit for history across every system.'),
  since: z.string().optional().describe('ISO 8601 timestamp. Defaults to seven days ago.'),
  limit: z.number().int().min(1).max(200).default(DEFAULT_LIMIT).describe('Maximum entries to return, newest first.'),
});

export default defineTool({
  name: 'get_alert_history',
  config: {
    title: 'Get alert history',
    description:
      'Past alert firings with when each started, when it resolved, and how long it lasted. Use this to see whether a problem is recurring rather than a one-off.',
    inputSchema,
    annotations: {readOnlyHint: true},
  },
  handler: async (input, {client}) => {
    const since = input.since ? new Date(input.since) : new Date(Date.now() - SEVEN_DAYS_MS);
    // An agent that passes "7 days ago" otherwise gets an Invalid Date, whose `toISOString()`
    // throws a RangeError that server.ts flattens into an unhelpful generic failure.
    if (Number.isNaN(since.getTime())) {
      throw new BeszelError(`"${input.since ?? ''}" is not a timestamp. Pass an ISO 8601 value such as "2026-08-01T00:00:00Z".`);
    }
    const sinceParam = since.toISOString().replace('T', ' ').replace('Z', '');
    const limit = input.limit ?? DEFAULT_LIMIT;

    const clauses = ['created >= {:since}'];
    const params: Record<string, unknown> = {since: sinceParam};
    if (input.system) {
      const resolved = await client.resolveSystem(input.system);
      clauses.push('system = {:id}');
      params.id = resolved.id;
    }

    const [records, systems] = await Promise.all([
      client.list<AlertHistoryRecord>('alerts_history', {
        filter: client.filter(clauses.join(' && '), params),
        sort: '-created',
        limit,
      }),
      client.list<SystemNameRecord>('systems', {fields: 'id,name'}),
    ]);
    const namesById = new Map(systems.map((system) => [system.id, system.name]));

    const history = records.map((record) => {
      const startedAt = new Date(record.created.replace(' ', 'T') + (record.created.endsWith('Z') ? '' : 'Z'));
      const resolvedAt = record.resolved
        ? new Date(record.resolved.replace(' ', 'T') + (record.resolved.endsWith('Z') ? '' : 'Z'))
        : undefined;
      return {
        system: namesById.get(record.system) ?? record.system,
        metric: record.name,
        value: record.value,
        // ISO, matching `since` in the same response — PocketBase's raw form is space-separated.
        firedAt: startedAt.toISOString(),
        resolvedAt: resolvedAt?.toISOString(),
        stillFiring: !resolvedAt,
        durationMinutes: resolvedAt ? Math.round((resolvedAt.getTime() - startedAt.getTime()) / 60_000) : undefined,
      };
    });

    return {
      count: history.length,
      since: since.toISOString(),
      history
    };
  },
});
