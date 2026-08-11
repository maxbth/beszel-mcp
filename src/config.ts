import {z} from 'zod';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface BeszelConfig {
  url: string;
  email?: string;
  password?: string;
  token?: string;
  superuser: boolean;
  timeoutMs: number;
}

export interface McpConfig {
  transport: 'http' | 'stdio';
  host: string;
  port: number;
  authToken?: string;
  allowedOrigins: Array<string>;
}

export interface Config {
  beszel: BeszelConfig;
  mcp: McpConfig;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

const optionalString = z.string().trim().min(1).optional();

const schema = z.object({
  BESZEL_URL: z.string({error: 'BESZEL_URL is required'}).url('BESZEL_URL must be a valid URL'),
  BESZEL_EMAIL: optionalString,
  BESZEL_PASSWORD: optionalString,
  BESZEL_TOKEN: optionalString,
  BESZEL_SUPERUSER: z.enum(['true', 'false']).default('false'),
  BESZEL_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  MCP_TRANSPORT: z.enum(['http', 'stdio']).default('http'),
  MCP_HOST: z.string().default('127.0.0.1'),
  MCP_PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  MCP_AUTH_TOKEN: optionalString,
  MCP_ALLOWED_ORIGINS: z.string().default(''),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

/**
 * Reads and validates configuration. This is the only place in the codebase permitted to
 * touch `process.env`; everything else receives the resolved `Config`.
 *
 * Failures throw `ConfigError` with a message naming exactly what is wrong. Secrets are
 * never interpolated into that message.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env, argv: Array<string> = process.argv.slice(2)): Config {
  const present: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== '') {
      present[key] = value;
    }
  }

  const parsed = schema.safeParse(present);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`);
    throw new ConfigError(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }

  const data = parsed.data;
  const hasPassword = Boolean(data.BESZEL_EMAIL) && Boolean(data.BESZEL_PASSWORD);
  const hasToken = Boolean(data.BESZEL_TOKEN);
  if (!hasPassword && !hasToken) {
    throw new ConfigError('Invalid configuration:\n  credentials: set BESZEL_EMAIL and BESZEL_PASSWORD, or set BESZEL_TOKEN');
  }

  return {
    beszel: {
      url: data.BESZEL_URL.replace(/\/+$/, ''),
      email: hasToken ? undefined : data.BESZEL_EMAIL,
      password: hasToken ? undefined : data.BESZEL_PASSWORD,
      token: data.BESZEL_TOKEN,
      superuser: data.BESZEL_SUPERUSER === 'true',
      timeoutMs: data.BESZEL_TIMEOUT_MS,
    },
    mcp: {
      transport: argv.includes('--stdio') ? 'stdio' : data.MCP_TRANSPORT,
      host: data.MCP_HOST,
      port: data.MCP_PORT,
      authToken: data.MCP_AUTH_TOKEN,
      allowedOrigins: data.MCP_ALLOWED_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    },
    logLevel: data.LOG_LEVEL,
  };
}
