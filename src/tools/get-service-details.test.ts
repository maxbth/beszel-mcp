import {test, expect} from 'bun:test';
import tool from './get-service-details';
import {BeszelError} from '../client';
import type {BeszelClient} from '../client';

const details = {
  Description: 'The nginx HTTP server',
  ActiveState: 'active',
  SubState: 'running',
  LoadState: 'loaded',
  MainPID: 1_234,
  MemoryCurrent: 52_428_800,
  MemoryPeak: 94_371_840,
  CPUUsageNSec: 1_500_000_000,
  NRestarts: 2,
  Result: 'success',
  UnitFileState: 'enabled',
  FragmentPath: '/lib/systemd/system/nginx.service',
  StateChangeTimestamp: 1_754_400_000_000_000,
  Requires: ['system.slice'],
  WantedBy: ['multi-user.target'],
};

function fakeClient(options: {
  sendError?: unknown;
  details?: Record<string, unknown>;
} = {}): BeszelClient {
  return {
    resolveSystem: async () => ({
      id: 's1',
      name: 'nas'
    }),
    send: async () => {
      if (options.sendError) {
        throw options.sendError;
      }
      return {details: options.details ?? details};
    },
  } as unknown as BeszelClient;
}

test('omits memory and cpu when the unit has no accounting rather than reporting zero', async () => {
  // The agent leaves unavailable D-Bus properties nil (`agent/systemd.go:268`), which arrives
  // as JSON null. "Not measured" and "measured as 0" are different claims.
  const result = (await tool.handler({
    system: 'nas',
    service: 'nginx.service'
  }, {
    client: fakeClient({
      details: {
        Description: 'x',
        MemoryCurrent: null,
        MemoryPeak: null,
        CPUUsageNSec: null
      }
    }),
  })) as Record<string, unknown>;
  expect(result.memoryCurrentMb).toBeUndefined();
  expect(result.memoryPeakMb).toBeUndefined();
  expect(result.cpuUsageSeconds).toBeUndefined();
});

test('returns the useful subset of the systemd unit detail', async () => {
  const result = (await tool.handler({
    system: 'nas',
    service: 'nginx.service'
  }, {client: fakeClient()})) as Record<string, unknown>;
  expect(result.description).toBe('The nginx HTTP server');
  expect(result.activeState).toBe('active');
  expect(result.subState).toBe('running');
  expect(result.loadState).toBe('loaded');
  expect(result.mainPid).toBe(1_234);
  expect(result.memoryCurrentMb).toBe(50);
  expect(result.memoryPeakMb).toBe(90);
  expect(result.cpuUsageSeconds).toBe(1.5);
  expect(result.restarts).toBe(2);
  expect(result.result).toBe('success');
  expect(result.unitFileState).toBe('enabled');
  expect(result.fragmentPath).toBe('/lib/systemd/system/nginx.service');
});

test('does not dump the entire raw unit blob', async () => {
  const result = (await tool.handler({
    system: 'nas',
    service: 'nginx.service'
  }, {client: fakeClient()})) as Record<string, unknown>;
  expect(result.Requires).toBeUndefined();
  expect(result.WantedBy).toBeUndefined();
});

test('distinguishes a missing service from a hub error on 404', async () => {
  const client = fakeClient({sendError: new BeszelError('Beszel returned 404 for this request.', 404)});
  await expect(tool.handler({
    system: 'nas',
    service: 'nope.service'
  }, {client})).rejects.toThrow(/nope.service/);
});
