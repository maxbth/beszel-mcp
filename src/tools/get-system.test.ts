import {test, expect} from 'bun:test';
import tool from './get-system';
import type {BeszelClient} from '../client';

const systemRecord = {
  id: 's1',
  name: 'nas',
  host: '10.0.0.5',
  port: '45876',
  status: 'up',
  updated: '2026-08-05 11:59:00.000Z',
  info: {
    h: 'nas',
    cpu: 12.5,
    c: 4,
    m: 'Intel N100',
    u: 3_600,
    mp: 61.2,
    dp: 44.4,
    bb: 1_572_864,
    v: '0.9.1'
  },
};
const detailsRecord = {
  system: 's1',
  hostname: 'nas',
  kernel: '6.1.0',
  cores: 4,
  threads: 8,
  cpu: 'Intel N100',
  os: 0,
  os_name: 'Debian 12',
  arch: 'x86_64',
  // BYTES: `agent/system.go:95` sets MemoryTotal = hostInfo.MemTotal. This is a 16 GiB machine.
  memory: 17_179_869_184,
  podman: false,
};
const statsRecord = {
  system: 's1',
  type: '1m',
  created: '2026-08-05 11:59:00.000Z',
  stats: {
    cpu: 20,
    m: 16,
    mu: 8,
    mp: 50,
    mb: 2,
    s: 4,
    su: 1,
    d: 500,
    du: 250,
    dp: 50,
    dr: 1,
    dw: 2,
    b: [524_288, 1_572_864]
  },
};

function fakeClient(byCollection: Record<string, Array<unknown>>): BeszelClient {
  return {
    resolveSystem: async () => ({
      id: 's1',
      name: 'nas'
    }),
    first: async (collection: string) => (byCollection[collection] ?? [])[0],
    list: async (collection: string) => byCollection[collection] ?? [],
    filter: (expression: string) => expression,
  } as unknown as BeszelClient;
}

test('merges the system record, its details and its latest stats', async () => {
  const result = (await tool.handler({system: 'nas'}, {
    client: fakeClient({
      systems: [systemRecord],
      system_details: [detailsRecord],
      system_stats: [statsRecord]
    }),
  })) as Record<string, unknown>;
  expect(result.name).toBe('nas');
  expect(result.address).toBe('10.0.0.5:45876');
  const hardware = result.hardware as Record<string, unknown>;
  expect(hardware.cpuModel).toBe('Intel N100');
  expect(hardware.cores).toBe(4);
  expect(hardware.threads).toBe(8);
  // 17179869184 bytes is 16 GB — and must agree with latestStats.memoryTotalGb below.
  expect(hardware.memoryGb).toBe(16);
  expect(hardware.osName).toBe('Debian 12');
  expect(hardware.arch).toBe('x86_64');
  expect(hardware.kernel).toBe('6.1.0');
  const latestStats = result.latestStats as Record<string, unknown>;
  expect(latestStats.cpuPercent).toBe(20);
  expect(latestStats.memoryUsedGb).toBe(8);
  // The same machine's RAM must not be reported as two different numbers in one response.
  expect(latestStats.memoryTotalGb).toBe(hardware.memoryGb);
  expect(latestStats.networkSentMbPerSec).toBe(0.5);
  expect(latestStats.networkReceivedMbPerSec).toBe(1.5);
});

test('works when the hub has no system_details row yet', async () => {
  const result = (await tool.handler({system: 'nas'}, {
    client: fakeClient({
      systems: [systemRecord],
      system_details: [],
      system_stats: [statsRecord]
    }),
  })) as Record<string, unknown>;
  expect(result.name).toBe('nas');
  expect(result.hardware).toBeUndefined();
});

test('works when no stats have been recorded yet', async () => {
  const result = (await tool.handler({system: 'nas'}, {
    client: fakeClient({
      systems: [systemRecord],
      system_details: [detailsRecord],
      system_stats: []
    }),
  })) as Record<string, unknown>;
  expect(result.latestStats).toBeUndefined();
});

test('throws when the system record itself has vanished', async () => {
  await expect(
    tool.handler({system: 'nas'}, {
      client: fakeClient({
        systems: [],
        system_details: [],
        system_stats: []
      })
    }),
  ).rejects.toThrow();
});
