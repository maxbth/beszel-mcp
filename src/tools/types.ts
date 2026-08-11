import type {z} from 'zod';
import type {BeszelClient} from '../client';

export interface ToolDeps {
  client: BeszelClient;
}

/**
 * The contract every tool file satisfies. Handlers return plain data — `server.ts` owns the
 * MCP envelope and error mapping, so no tool file contains protocol boilerplate.
 */
export interface ToolModule<Schema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  config: {
    title: string;
    description: string;
    inputSchema: Schema;
    annotations: {readOnlyHint: true};
  };
  handler: (input: z.infer<Schema>, deps: ToolDeps) => Promise<unknown>;
}

/** Identity function that pins the generic so each tool file gets full inference. */
export function defineTool<Schema extends z.ZodTypeAny>(module: ToolModule<Schema>): ToolModule {
  return module as ToolModule;
}
