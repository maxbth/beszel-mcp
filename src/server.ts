import {McpServer} from '@modelcontextprotocol/server';
import {BeszelError} from './client';
import {TOOLS} from './tools/index';
import type {ToolDeps} from './tools/types';

const NAME = 'beszel-mcp';
const VERSION = '0.1.0';

/**
 * Builds a fully registered MCP server.
 *
 * Both SDK v2 entry points take a factory rather than an instance — `createMcpHandler`
 * calls it per request (which is what makes stateless HTTP work) and `serveStdio` pins one
 * instance per connection. `deps` is created once by the caller and closed over, so
 * per-request construction never means per-request re-authentication.
 */
export function createServer(deps: ToolDeps): McpServer {
  const server = new McpServer(
    {
      name: NAME,
      version: VERSION,
    },
    {capabilities: {tools: {}}},
  );

  for (const tool of TOOLS) {
    server.registerTool(tool.name, tool.config, async (input: unknown) => {
      try {
        const result = await tool.handler(input, deps);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, undefined, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof BeszelError ? error.message : `Unexpected failure in ${tool.name}.`;
        return {
          content: [
            {
              type: 'text' as const,
              text: message,
            },
          ],
          isError: true,
        };
      }
    });
  }

  return server;
}
