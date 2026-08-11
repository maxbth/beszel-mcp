import {test, expect} from 'bun:test';
import tool from './list-alerts';
import type {BeszelClient} from '../client';

const alert = {
  id: 'a1',
  system: 's1',
  name: 'CPU',
  value: 80,
  min: 10,
  triggered: true
};

function fakeClient(alerts: Array<unknown>): BeszelClient {
  return {
    resolveSystem: async () => ({
      id: 's1',
      name: 'nas'
    }),
    list: async (collection: string) => (collection === 'alerts' ? alerts : [
      {
        id: 's1',
        name: 'nas'
      }
    ]),
    filter: (expression: string) => expression,
  } as unknown as BeszelClient;
}

test('resolves the system id to its name', async () => {
  const result = (await tool.handler({}, {client: fakeClient([alert])})) as Record<string, unknown>;
  const first = (result.alerts as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  expect(first.system).toBe('nas');
  expect(first.metric).toBe('CPU');
  expect(first.threshold).toBe(80);
  expect(first.sustainMinutes).toBe(10);
  expect(first.triggered).toBe(true);
});

test('triggeredOnly drops untriggered alerts', async () => {
  const alerts = [
    alert, {
      ...alert,
      id: 'a2',
      name: 'Memory',
      triggered: false
    }
  ];
  const result = (await tool.handler({triggeredOnly: true}, {client: fakeClient(alerts)})) as Record<string, unknown>;
  const metrics = (result.alerts as Array<Record<string, unknown>>).map((entry) => entry.metric);
  expect(metrics).toEqual(['CPU']);
});

test('reports how many are currently firing', async () => {
  const alerts = [
    alert, {
      ...alert,
      id: 'a2',
      triggered: false
    }
  ];
  const result = (await tool.handler({}, {client: fakeClient(alerts)})) as Record<string, unknown>;
  expect(result.triggeredCount).toBe(1);
  expect(result.count).toBe(2);
});
