import {test, expect} from 'bun:test';
import tool from './list-services';
import type {BeszelClient} from '../client';

const service = {
  id: 'sv1',
  system: 's1',
  name: 'nginx.service',
  state: 0,
  sub: 1,
  cpu: 0.5,
  cpuPeak: 2.5,
  // BYTES: the raw D-Bus MemoryCurrent / MemoryPeak (`agent/systemd.go:204-228`).
  // 50 MiB current, 90 MiB peak.
  memory: 52_428_800,
  memPeak: 94_371_840,
  updated: 1_754_400_000,
};

function fakeClient(records: Array<unknown>): BeszelClient {
  return {
    resolveSystem: async () => ({
      id: 's1',
      name: 'nas'
    }),
    list: async () => records,
    filter: (expression: string) => expression,
  } as unknown as BeszelClient;
}

test('decodes state and sub-state from their numeric enums', async () => {
  const result = (await tool.handler({system: 'nas'}, {client: fakeClient([service])})) as Record<string, unknown>;
  const services = result.services as Array<Record<string, unknown>>;
  const first = services[0] as Record<string, unknown>;
  expect(first.state).toBe('Active');
  expect(first.subState).toBe('Running');
  expect(first.name).toBe('nginx.service');
});

test('reports unit memory in megabytes, agreeing with get_service_details', async () => {
  const result = (await tool.handler({system: 'nas'}, {client: fakeClient([service])})) as Record<string, unknown>;
  const first = (result.services as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  expect(first.memoryMb).toBe(50);
  expect(first.memoryPeakMb).toBe(90);
  expect(first.memoryGb).toBeUndefined();
});

test('filters to failed services by state name', async () => {
  const records = [
    service, {
      ...service,
      id: 'sv2',
      name: 'broken.service',
      state: 2,
      sub: 3
    }
  ];
  const result = (await tool.handler({
    system: 'nas',
    state: 'Failed'
  }, {client: fakeClient(records)})) as Record<string, unknown>;
  const services = result.services as Array<Record<string, unknown>>;
  expect(services.map((s) => s.name)).toEqual(['broken.service']);
});

test('filters by name substring', async () => {
  const records = [
    service, {
      ...service,
      id: 'sv2',
      name: 'postgresql.service'
    }
  ];
  const result = (await tool.handler({
    system: 'nas',
    nameContains: 'postgres'
  }, {client: fakeClient(records)})) as Record<string, unknown>;
  const services = result.services as Array<Record<string, unknown>>;
  expect(services.map((s) => s.name)).toEqual(['postgresql.service']);
});
