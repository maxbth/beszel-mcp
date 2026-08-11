import {test, expect, mock, afterEach} from 'bun:test';
import {BeszelClient, BeszelError} from './client';
import type {BeszelConfig} from './config';

const config: BeszelConfig = {
  url: 'https://hub.example.com',
  email: 'a@b.c',
  password: 'secret-password',
  superuser: false,
  timeoutMs: 5_000,
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Builds a fetch stub that replies with the given queue of JSON bodies. */
function stubFetch(
  responses: Array<{
    status: number;
    body: unknown;
  }>,
) {
  const calls: Array<{
    url: string;
    init?: RequestInit;
  }> = [];
  const impl = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({
      url,
      init,
    });
    const next = responses.shift() ?? {
      status: 500,
      body: {},
    };
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: {'Content-Type': 'application/json'},
    });
  });
  return {
    impl,
    calls,
  };
}

const authOk = {
  status: 200,
  body: {
    token: 'tok-1',
    record: {id: 'u1'},
  },
};

test('authenticates once and reuses the token across calls', async () => {
  const {impl, calls} = stubFetch([
    authOk,
    {
      status: 200,
      body: {
        items: [{id: 's1'}],
        totalPages: 1,
      },
    },
    {
      status: 200,
      body: {
        items: [],
        totalPages: 1,
      },
    },
  ]);
  globalThis.fetch = impl as unknown as typeof fetch;
  const client = new BeszelClient(config);
  await client.list('systems');
  await client.list('containers');
  const authCalls = calls.filter((call) => call.url.includes('auth-with-password'));
  expect(authCalls.length).toBe(1);
});

test('re-authenticates exactly once on a 401 and retries the request', async () => {
  const {impl, calls} = stubFetch([
    authOk,
    {
      status: 401,
      body: {message: 'expired'},
    },
    {
      status: 200,
      body: {
        token: 'tok-2',
        record: {id: 'u1'},
      },
    },
    {
      status: 200,
      body: {
        items: [{id: 's1'}],
        totalPages: 1,
      },
    },
  ]);
  globalThis.fetch = impl as unknown as typeof fetch;
  const client = new BeszelClient(config);
  const result = await client.list<{id: string}>('systems');
  expect(result).toEqual([{id: 's1'}]);
  expect(calls.filter((call) => call.url.includes('auth-with-password')).length).toBe(2);
});

test('gives up after a second 401 rather than looping', async () => {
  const {impl} = stubFetch([
    authOk,
    {
      status: 401,
      body: {message: 'nope'},
    },
    {
      status: 200,
      body: {
        token: 'tok-2',
        record: {id: 'u1'},
      },
    },
    {
      status: 401,
      body: {message: 'nope'},
    },
  ]);
  globalThis.fetch = impl as unknown as typeof fetch;
  const client = new BeszelClient(config);
  await expect(client.list('systems')).rejects.toThrow(BeszelError);
});

test('never leaks the password in an error message', async () => {
  const {impl} = stubFetch([
    {
      status: 400,
      body: {message: 'Failed to authenticate.'},
    },
  ]);
  globalThis.fetch = impl as unknown as typeof fetch;
  const client = new BeszelClient(config);
  try {
    await client.list('systems');
    throw new Error('should have thrown');
  } catch (error) {
    expect((error as Error).message).not.toContain('secret-password');
  }
});

test('resolveSystem finds a system by exact name', async () => {
  const {impl} = stubFetch([
    authOk,
    {
      status: 200,
      body: {
        items: [
          {
            id: 's1',
            name: 'nas',
          },
        ],
        totalPages: 1,
      },
    },
  ]);
  globalThis.fetch = impl as unknown as typeof fetch;
  const client = new BeszelClient(config);
  expect(await client.resolveSystem('nas')).toEqual({
    id: 's1',
    name: 'nas',
  });
});

test('resolveSystem falls back to treating the input as a record id', async () => {
  const {impl} = stubFetch([
    authOk,
    {
      status: 200,
      body: {
        items: [],
        totalPages: 1,
      },
    },
    {
      status: 200,
      body: {
        items: [
          {
            id: 'abc123',
            name: 'nas',
          },
        ],
        totalPages: 1,
      },
    },
  ]);
  globalThis.fetch = impl as unknown as typeof fetch;
  const client = new BeszelClient(config);
  expect(await client.resolveSystem('abc123')).toEqual({
    id: 'abc123',
    name: 'nas',
  });
});

test('resolveSystem lists the known system names when nothing matches', async () => {
  const {impl} = stubFetch([
    authOk,
    {
      status: 200,
      body: {
        items: [],
        totalPages: 1,
      },
    },
    {
      status: 200,
      body: {
        items: [],
        totalPages: 1,
      },
    },
    {
      status: 200,
      body: {
        items: [
          {
            id: 's1',
            name: 'nas',
          },
          {
            id: 's2',
            name: 'web',
          },
        ],
        totalPages: 1,
      },
    },
  ]);
  globalThis.fetch = impl as unknown as typeof fetch;
  const client = new BeszelClient(config);
  await expect(client.resolveSystem('nope')).rejects.toThrow(/nas, web/);
});

test('filter escapes interpolated parameters', () => {
  const client = new BeszelClient(config);
  expect(client.filter('system = {:id}', {id: "a'b"})).toContain('\\');
});

test('a limited list is one page, not a full paginated sweep sliced afterwards', async () => {
  // `getFullList`'s `batch` is PocketBase's PAGE SIZE, not a cap: it keeps requesting pages
  // until one comes back short. A real hub always returns `perPage`, so a filter matching
  // thousands of rows would cost dozens of round-trips to return `limit` of them. This proves
  // the bounded path issues exactly one request and asks the hub for exactly `limit` rows.
  const fullPage = Array.from({length: 50}, (_, index) => ({id: `a${index}`}));
  const {impl, calls} = stubFetch([
    authOk,
    {
      status: 200,
      body: {
        page: 1,
        perPage: 50,
        totalItems: 6_000,
        totalPages: 120,
        items: fullPage,
      },
    },
  ]);
  globalThis.fetch = impl as unknown as typeof fetch;

  const client = new BeszelClient(config);
  const records = await client.list<{id: string}>('alerts_history', {limit: 50});

  expect(records.length).toBe(50);
  const listCalls = calls.filter((call) => call.url.includes('alerts_history'));
  expect(listCalls.length).toBe(1);
  expect(listCalls[0]?.url).toContain('perPage=50');
  expect(listCalls[0]?.url).toContain('skipTotal=true');
});

test('an unlimited list still pages until the hub returns a short page', async () => {
  const {impl, calls} = stubFetch([
    authOk,
    {
      status: 200,
      body: {
        page: 1,
        perPage: 500,
        totalItems: 501,
        totalPages: 2,
        items: Array.from({length: 500}, (_, index) => ({id: `a${index}`})),
      },
    },
    {
      status: 200,
      body: {
        page: 2,
        perPage: 500,
        totalItems: 501,
        totalPages: 2,
        items: [{id: 'last'}],
      },
    },
  ]);
  globalThis.fetch = impl as unknown as typeof fetch;

  const client = new BeszelClient(config);
  const records = await client.list<{id: string}>('systems');

  expect(records.length).toBe(501);
  expect(calls.filter((call) => call.url.includes('systems')).length).toBe(2);
});
