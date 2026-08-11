import {z} from 'zod';
import {defineTool} from './types';

interface HubInfo {
  v?: string;
  cu?: boolean;
  key?: string;
}

interface SystemStatusRecord {
  id: string;
  status: string;
}

const inputSchema = z.object({});

export default defineTool({
  name: 'get_hub_info',
  config: {
    title: 'Get hub info',
    description:
      'Beszel hub version and a count of systems by status. Call this first to confirm the MCP server can reach and authenticate against the hub.',
    inputSchema,
    annotations: {readOnlyHint: true},
  },
  handler: async (_input, {client}) => {
    const [info, systems] = await Promise.all([
      client.send<HubInfo>('/api/beszel/info', {}),
      client.list<SystemStatusRecord>('systems', {fields: 'id,status'}),
    ]);

    const systemsByStatus: Record<string, number> = {};
    for (const system of systems) {
      systemsByStatus[system.status] = (systemsByStatus[system.status] ?? 0) + 1;
    }

    // The hub's SSH public key is deliberately not returned: it is a deployment credential,
    // not monitoring data, and nothing an agent asks for needs it.
    return {
      hubVersion: info.v,
      updateCheckEnabled: info.cu ?? false,
      systemCount: systems.length,
      systemsByStatus,
    };
  },
});
