import {test, expect} from 'bun:test';
import tool from './get-container-logs';
import {BeszelError} from '../client';
import type {BeszelClient} from '../client';

const container = {
  id: 'a1b2c3d4e5f60718',
  name: 'caddy'
};

function fakeClient(options: {
  logs?: string;
  sendError?: unknown;
  containers?: Array<unknown>;
  captureQuery?: (query: Record<string, string>) => void;
}): BeszelClient {
  return {
    resolveSystem: async () => ({
      id: 's1',
      name: 'nas'
    }),
    list: async () => options.containers ?? [container],
    first: async () => (options.containers ?? [container])[0],
    filter: (expression: string) => expression,
    send: async (_path: string, query: Record<string, string>) => {
      options.captureQuery?.(query);
      if (options.sendError) {
        throw options.sendError;
      }
      return {logs: options.logs ?? ''};
    },
  } as unknown as BeszelClient;
}

test('returns the log text for a container looked up by name', async () => {
  const result = (await tool.handler({
    system: 'nas',
    container: 'caddy'
  }, {
    client: fakeClient({logs: 'line1\nline2'}),
  })) as Record<string, unknown>;
  expect(result.logs).toBe('line1\nline2');
  expect(result.container).toBe('caddy');
});

test('sends the docker container id, not the name, as the container parameter', async () => {
  // The hub validates this against ^[a-fA-F0-9]{12,64}$ (`internal/hub/api.go:30,314`) and 400s
  // on anything else, so sending `match.name` here would break every call against a real hub.
  let query: Record<string, string> | undefined;
  await tool.handler({
    system: 'nas',
    container: 'caddy'
  }, {
    client: fakeClient({
      logs: 'x',
      captureQuery: (q) => (query = q)
    }),
  });
  expect(query?.container).toBe('a1b2c3d4e5f60718');
  expect(query?.container).toMatch(/^[a-fA-F0-9]{12,64}$/);
  expect(query?.system).toBe('s1');
});

test('trims to the requested number of trailing lines', async () => {
  const logs = Array.from({length: 100}, (_, index) => `line${index}`).join('\n');
  const result = (await tool.handler({
    system: 'nas',
    container: 'caddy',
    tail: 3
  }, {client: fakeClient({logs})})) as Record<string, unknown>;
  expect((result.logs as string).split('\n')).toEqual(['line97', 'line98', 'line99']);
});

test('tail counts real lines when the log ends with a trailing newline', async () => {
  // Docker log output always ends with one, so splitting it raw yields a phantom empty element
  // and `tail: 2` would return one real line.
  const result = (await tool.handler({
    system: 'nas',
    container: 'caddy',
    tail: 2
  }, {client: fakeClient({logs: 'a\nb\nc\n'})})) as Record<string, unknown>;
  expect(result.logs).toBe('b\nc');
  expect(result.lineCount).toBe(2);
});

test('empty logs report no lines at all', async () => {
  const result = (await tool.handler({
    system: 'nas',
    container: 'caddy'
  }, {client: fakeClient({logs: ''})})) as Record<string, unknown>;
  expect(result.lineCount).toBe(0);
  expect(result.logs).toBe('');
});

test('explains that container details are disabled when the route 404s', async () => {
  const client = fakeClient({sendError: new BeszelError('Beszel returned 404 for this request.', 404)});
  await expect(tool.handler({
    system: 'nas',
    container: 'caddy'
  }, {client})).rejects.toThrow(/CONTAINER_DETAILS/);
});

test('names the containers that do exist when the requested one does not', async () => {
  const client = fakeClient({containers: []});
  await expect(tool.handler({
    system: 'nas',
    container: 'nope'
  }, {client})).rejects.toThrow(/No container/);
});
