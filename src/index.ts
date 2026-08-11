import {loadConfig, ConfigError} from './config';
import {BeszelClient} from './client';
import {startHttp} from './transports/http';
import {startStdio} from './transports/stdio';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(error instanceof ConfigError ? error.message : 'Failed to load configuration.');
    process.exit(1);
  }

  const deps = {client: new BeszelClient(config.beszel)};

  if (config.mcp.transport === 'stdio') {
    await startStdio(deps);
    return;
  }
  startHttp(config, deps);
}

await main();
