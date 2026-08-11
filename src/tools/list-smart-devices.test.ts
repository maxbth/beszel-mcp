import {test, expect} from 'bun:test';
import tool from './list-smart-devices';
import type {BeszelClient} from '../client';

const device = {
  id: 'd1',
  system: 's1',
  name: '/dev/sda',
  model: 'Samsung 870',
  state: 'PASSED',
  // BYTES (`agent/smart.go:875`, `UserCapacity.Bytes`). This is what a drive sold as 1 TB reports.
  capacity: 1_000_204_886_016,
  temp: 38,
  firmware: 'SVQ01B6Q',
  serial: 'S5Y8N',
  type: 'SSD',
  hours: 12_345,
  cycles: 88,
  attributes: [
    {
      id: 5,
      n: 'Reallocated_Sector_Ct',
      v: 100,
      w: 100,
      t: 10,
      rv: 0
    },
    {
      id: 194,
      n: 'Temperature_Celsius',
      v: 62,
      rv: 38
    },
    {
      id: 197,
      n: 'Current_Pending_Sector',
      v: 100,
      rv: 4,
      wf: 'FAILING_NOW'
    },
    {
      id: 12,
      n: 'Power_Cycle_Count',
      v: 99,
      rv: 88
    },
  ],
};

function fakeClient(devices: Array<unknown>, systems: Array<unknown> = [
  {
    id: 's1',
    name: 'nas'
  }
]): BeszelClient {
  return {
    resolveSystem: async () => ({
      id: 's1',
      name: 'nas'
    }),
    list: async (collection: string) => (collection === 'smart_devices' ? devices : systems),
    filter: (expression: string) => expression,
  } as unknown as BeszelClient;
}

test('returns decoded disks with health-relevant attributes only', async () => {
  const result = (await tool.handler({}, {client: fakeClient([device])})) as Record<string, unknown>;
  const disk = (result.devices as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  expect(disk.name).toBe('/dev/sda');
  expect(disk.model).toBe('Samsung 870');
  expect(disk.smartState).toBe('PASSED');
  // 1000204886016 / 2^30 = 931.5127..., i.e. 931.5 GB — binary GB, the same unit as `memoryGb`
  // here and the same number Beszel's own SMART table prints via `formatBytes`.
  expect(disk.capacityGb).toBe(931.5);
  // The system id is resolved to its name, as list_alerts and get_alert_history already do.
  expect(disk.system).toBe('nas');
  expect(disk.temperatureC).toBe(38);
  expect(disk.powerOnHours).toBe(12_345);
  const attributes = disk.attributes as Array<Record<string, unknown>>;
  const names = attributes.map((attribute) => attribute.name);
  expect(names).toContain('Reallocated_Sector_Ct');
  expect(names).toContain('Current_Pending_Sector');
  expect(names).not.toContain('Power_Cycle_Count');
});

test('a row with no capacity reports no capacity rather than NaN', async () => {
  const noCapacity: Record<string, unknown> = {...device};
  delete noCapacity.capacity;
  const result = (await tool.handler({}, {client: fakeClient([noCapacity])})) as Record<string, unknown>;
  const disk = (result.devices as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  expect(disk.capacityGb).toBeUndefined();
});

test('flags an attribute reported as failing', async () => {
  const result = (await tool.handler({}, {client: fakeClient([device])})) as Record<string, unknown>;
  const disk = (result.devices as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  const attributes = disk.attributes as Array<Record<string, unknown>>;
  const pending = attributes.find((attribute) => attribute.name === 'Current_Pending_Sector') as Record<string, unknown>;
  expect(pending.failing).toBe(true);
  expect(disk.healthy).toBe(false);
});

test('marks a clean disk healthy', async () => {
  const clean = {
    ...device,
    attributes: [
      {
        id: 5,
        n: 'Reallocated_Sector_Ct',
        v: 100,
        rv: 0
      }
    ]
  };
  const result = (await tool.handler({}, {client: fakeClient([clean])})) as Record<string, unknown>;
  const disk = (result.devices as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  expect(disk.healthy).toBe(true);
});

test('a disk whose SMART verdict was never read is not reported as healthy', async () => {
  // `agent/smart.go:913` only ever writes PASSED / FAILED / UNKNOWN, so '' means "never read".
  const unread = {
    ...device,
    state: '',
    attributes: []
  };
  const result = (await tool.handler({}, {client: fakeClient([unread])})) as Record<string, unknown>;
  const disk = (result.devices as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  expect(disk.healthy).toBeUndefined();
});

test('an attribute whose wf flag is "-" is not treated as failing, and is excluded like any other', async () => {
  const dashed = {
    ...device,
    attributes: [
      {
        id: 12,
        n: 'Power_Cycle_Count',
        v: 99,
        rv: 88,
        wf: '-'
      }
    ],
  };
  const result = (await tool.handler({}, {client: fakeClient([dashed])})) as Record<string, unknown>;
  const disk = (result.devices as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  expect(disk.attributes).toEqual([]);
  expect(disk.healthy).toBe(true);
});
