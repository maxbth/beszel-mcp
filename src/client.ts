import PocketBase, {ClientResponseError} from 'pocketbase';
import type {BeszelConfig} from './config';

export class BeszelError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'BeszelError';
    this.status = status;
  }
}

export interface ListOptions {
  filter?: string;
  sort?: string;
  fields?: string;
  limit?: number;
}

export interface SystemRef {
  id: string;
  name: string;
}

interface SystemNameRecord {
  id: string;
  name: string;
}

/**
 * Authenticated read-only client for a Beszel hub.
 *
 * Auth is lazy: nothing happens until the first request, so an unreachable hub does not
 * stop the MCP server from starting and reporting the problem through a tool call. A 401
 * triggers exactly one re-auth and one retry — a second 401 is a real credential failure,
 * and retrying past that would just spin.
 */
export class BeszelClient {
  private readonly pb: PocketBase;
  private readonly config: BeszelConfig;
  private authPromise?: Promise<void>;
  /**
   * Tracks auth state ourselves rather than trusting `pb.authStore.isValid`: that getter
   * decodes the token as a JWT and reports invalid for any token it cannot parse, which is
   * the wrong signal here (a `BESZEL_TOKEN` is taken on faith, and a real hub token should
   * not need re-decoding to know we just obtained it).
   */
  private authenticated = false;

  constructor(config: BeszelConfig) {
    this.config = config;
    this.pb = new PocketBase(config.url);
    this.pb.autoCancellation(false);
    this.pb.beforeSend = (url, options) => {
      options.signal = AbortSignal.timeout(config.timeoutMs);
      return {
        url,
        options,
      };
    };
  }

  filter(expression: string, params: Record<string, unknown>): string {
    return this.pb.filter(expression, params);
  }

  private async authenticate(): Promise<void> {
    if (this.config.token) {
      this.pb.authStore.save(this.config.token, null);
      return;
    }
    const collection = this.config.superuser ? '_superusers' : 'users';
    await this.pb.collection(collection).authWithPassword(this.config.email ?? '', this.config.password ?? '');
  }

  /** Ensures a token exists, collapsing concurrent first-calls onto one login. */
  private async ensureAuth(): Promise<void> {
    if (this.authenticated) {
      return;
    }
    this.authPromise ??= this.authenticate()
      .then(() => {
        this.authenticated = true;
      })
      .finally(() => {
        this.authPromise = undefined;
      });
    await this.authPromise;
  }

  private async withAuth<T>(operation: () => Promise<T>): Promise<T> {
    await this.ensureAuth().catch((error: unknown) => {
      throw this.toBeszelError(error, 'authenticate with');
    });
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ClientResponseError && error.status === 401) {
        this.pb.authStore.clear();
        this.authenticated = false;
        await this.ensureAuth().catch((authError: unknown) => {
          throw this.toBeszelError(authError, 'authenticate with');
        });
        try {
          return await operation();
        } catch (retryError) {
          throw this.toBeszelError(retryError, 'read from');
        }
      }
      throw this.toBeszelError(error, 'read from');
    }
  }

  /**
   * Maps a transport failure onto a message that says what to do about it. Never
   * interpolates any part of the configured credentials.
   */
  private toBeszelError(error: unknown, action: string): BeszelError {
    if (error instanceof BeszelError) {
      return error;
    }
    if (error instanceof ClientResponseError) {
      if (error.status === 0) {
        return new BeszelError(
          `Cannot reach the Beszel hub at ${this.config.url}. Check BESZEL_URL is correct and reachable from this process (inside a container, "localhost" is the container itself).`,
          0,
        );
      }
      if (error.status === 401 || error.status === 403) {
        return new BeszelError(
          `Beszel rejected the configured credentials (HTTP ${error.status}). Check BESZEL_EMAIL and BESZEL_PASSWORD, or BESZEL_TOKEN.`,
          error.status,
        );
      }
      if (error.status === 404) {
        return new BeszelError('Beszel returned 404 for this request.', 404);
      }
      return new BeszelError(`Failed to ${action} the Beszel hub: HTTP ${error.status}.`, error.status);
    }
    if (error instanceof Error && error.name === 'TimeoutError') {
      return new BeszelError(`Timed out after ${this.config.timeoutMs}ms waiting for the Beszel hub.`);
    }
    return new BeszelError(`Failed to ${action} the Beszel hub.`);
  }

  /**
   * A `limit` is a real bound on the work done, not a post-hoc slice. `getFullList`'s `batch`
   * is PocketBase's *page size*: it keeps requesting pages until one comes back short, so
   * `batch: 50` against 6,000 matching rows is 121 round-trips and 6,000 records materialised
   * to return 50. A bounded query is therefore a single `getList(1, limit)` instead, with
   * `skipTotal` so the hub does not run a COUNT it has no use for.
   */
  async list<T>(collection: string, options: ListOptions = {}): Promise<Array<T>> {
    return this.withAuth(async () => {
      if (options.limit !== undefined) {
        const page = await this.pb.collection(collection).getList<T>(1, options.limit, {
          filter: options.filter,
          sort: options.sort,
          fields: options.fields,
          skipTotal: true,
        });
        return page.items;
      }
      return this.pb.collection(collection).getFullList<T>({
        filter: options.filter,
        sort: options.sort,
        fields: options.fields,
        batch: 500,
      });
    });
  }

  async first<T>(collection: string, options: ListOptions = {}): Promise<T | undefined> {
    const records = await this.list<T>(collection, {
      ...options,
      limit: 1,
    });
    return records[0];
  }

  async send<T>(path: string, query: Record<string, string>): Promise<T> {
    return this.withAuth(async () =>
      this.pb.send<T>(path, {
        method: 'GET',
        query,
      }),
    );
  }

  /**
   * Accepts a system name or a record id. Name is tried first because that is what a user
   * types; the id fallback exists because tool output carries ids and agents echo them
   * back. A miss lists the names that do exist, since "system not found" without that is
   * unactionable.
   */
  async resolveSystem(nameOrId: string): Promise<SystemRef> {
    const byName = await this.first<SystemNameRecord>('systems', {
      filter: this.filter('name = {:name}', {name: nameOrId}),
      fields: 'id,name',
    });
    if (byName) {
      return {
        id: byName.id,
        name: byName.name,
      };
    }

    const byId = await this.first<SystemNameRecord>('systems', {
      filter: this.filter('id = {:id}', {id: nameOrId}),
      fields: 'id,name',
    });
    if (byId) {
      return {
        id: byId.id,
        name: byId.name,
      };
    }

    const all = await this.list<SystemNameRecord>('systems', {
      fields: 'id,name',
      sort: 'name',
    });
    const known = all.map((system) => system.name).join(', ');
    throw new BeszelError(
      all.length === 0
        ? `No system named "${nameOrId}". This account can see no systems at all — the hub shares systems per user, so check that the configured account is a member of them, or that the hub sets SHARE_ALL_SYSTEMS=true.`
        : `No system named "${nameOrId}". Known systems: ${known}.`,
      404,
    );
  }
}
