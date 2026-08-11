import {test, expect} from 'bun:test';
import {loadConfig, ConfigError} from './config';

const base = {
  BESZEL_URL: 'https://hub.example.com',
  BESZEL_EMAIL: 'a@b.c',
  BESZEL_PASSWORD: 'pw',
};

test('loads a minimal valid config with defaults', () => {
  const config = loadConfig(base, []);
  expect(config.beszel.url).toBe('https://hub.example.com');
  expect(config.beszel.superuser).toBe(false);
  expect(config.beszel.timeoutMs).toBe(15_000);
  expect(config.mcp.transport).toBe('http');
  expect(config.mcp.host).toBe('127.0.0.1');
  expect(config.mcp.port).toBe(3_000);
  expect(config.mcp.allowedOrigins).toEqual([]);
  expect(config.logLevel).toBe('info');
});

test('strips a trailing slash from the hub url', () => {
  expect(
    loadConfig(
      {
        ...base,
        BESZEL_URL: 'https://hub.example.com/',
      },
      [],
    ).beszel.url,
  ).toBe('https://hub.example.com');
});

test('accepts a token instead of email and password', () => {
  const config = loadConfig(
    {
      BESZEL_URL: 'https://h.example.com',
      BESZEL_TOKEN: 'tok',
    },
    [],
  );
  expect(config.beszel.token).toBe('tok');
  expect(config.beszel.email).toBeUndefined();
});

test('rejects a config with no credentials at all', () => {
  expect(() => loadConfig({BESZEL_URL: 'https://h.example.com'}, [])).toThrow(ConfigError);
});

test('rejects a missing hub url', () => {
  expect(() =>
    loadConfig(
      {
        BESZEL_EMAIL: 'a@b.c',
        BESZEL_PASSWORD: 'pw',
      },
      [],
    ),
  ).toThrow(/BESZEL_URL/);
});

test('rejects a hub url that is not a url', () => {
  expect(() =>
    loadConfig(
      {
        ...base,
        BESZEL_URL: 'not-a-url',
      },
      [],
    ),
  ).toThrow(ConfigError);
});

test('the --stdio flag overrides MCP_TRANSPORT', () => {
  expect(
    loadConfig(
      {
        ...base,
        MCP_TRANSPORT: 'http',
      },
      ['--stdio'],
    ).mcp.transport,
  ).toBe('stdio');
});

test('MCP_TRANSPORT=stdio is honoured without the flag', () => {
  expect(
    loadConfig(
      {
        ...base,
        MCP_TRANSPORT: 'stdio',
      },
      [],
    ).mcp.transport,
  ).toBe('stdio');
});

test('parses a comma-separated origin allowlist and trims blanks', () => {
  const config = loadConfig(
    {
      ...base,
      MCP_ALLOWED_ORIGINS: 'a.example.com, b.example.com ,',
    },
    [],
  );
  expect(config.mcp.allowedOrigins).toEqual(['a.example.com', 'b.example.com']);
});

test('rejects a non-numeric port', () => {
  expect(() =>
    loadConfig(
      {
        ...base,
        MCP_PORT: 'http',
      },
      [],
    ),
  ).toThrow(ConfigError);
});

test('the error message never contains the password', () => {
  try {
    loadConfig(
      {
        ...base,
        BESZEL_URL: 'not-a-url',
      },
      [],
    );
    throw new Error('should have thrown');
  } catch (error) {
    expect((error as Error).message).not.toContain('pw');
  }
});
