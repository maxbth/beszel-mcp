import {z} from 'zod';
import {defineTool} from './types';
import {BeszelError} from '../client';

interface ContainerRecord {
  id: string;
  name: string;
}

const inputSchema = z.object({
  system: z.string().describe('System name or record id.'),
  container: z.string().describe('Container name, as reported by list_containers.'),
  tail: z.number().int().min(1).max(2_000).default(200).describe('Number of trailing log lines to return.'),
});

export default defineTool({
  name: 'get_container_logs',
  config: {
    title: 'Get container logs',
    description:
      'Fetch recent logs for one container, proxied live from the agent. Requires the hub to have container details enabled. Use after list_containers identifies a suspect container.',
    inputSchema,
    annotations: {readOnlyHint: true},
  },
  handler: async (input, {client}) => {
    const {id: systemId, name: systemName} = await client.resolveSystem(input.system);
    const tail = input.tail ?? 200;

    const containers = await client.list<ContainerRecord>('containers', {
      filter: client.filter('system = {:id}', {id: systemId}),
      fields: 'id,name',
      sort: 'name',
    });
    const match = containers.find((record) => record.name === input.container);
    if (!match) {
      const known = containers.map((record) => record.name).join(', ');
      throw new BeszelError(
        known.length === 0
          ? `No container named "${input.container}" on ${systemName}, which reports no containers at all.`
          : `No container named "${input.container}" on ${systemName}. Known containers: ${known}.`,
        404,
      );
    }

    // The hub validates this against ^[a-fA-F0-9]{12,64}$ — it is the Docker container ID,
    // which Beszel stores as the record id. Sending the name here would be rejected as a
    // bad request, which is why the lookup above is not optional.
    let response: {logs?: string};
    try {
      response = await client.send<{logs?: string}>('/api/beszel/containers/logs', {
        system: systemId,
        container: match.id,
      });
    } catch (error) {
      if (error instanceof BeszelError && error.status === 404) {
        throw new BeszelError(
          'The hub does not expose container logs. That route is only registered when the hub runs with CONTAINER_DETAILS unset or set to something other than "false".',
          404,
        );
      }
      throw error;
    }

    // Docker log output ends with a trailing newline, so splitting it raw yields a phantom
    // empty last element — which would make `tail: 2` return one real line, and empty logs
    // report `lineCount: 1`.
    const body = (response.logs ?? '').replace(/\n$/, '');
    const lines = body === '' ? [] : body.split('\n');
    const trimmed = lines.length > tail ? lines.slice(-tail) : lines;

    return {
      system: systemName,
      container: match.name,
      lineCount: trimmed.length,
      truncated: lines.length > trimmed.length,
      logs: trimmed.join('\n'),
    };
  },
});
