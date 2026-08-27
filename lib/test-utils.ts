import type { VercelRequest, VercelResponse } from '@vercel/node';
import { vi } from 'vitest';

/**
 * Minimal stand-ins for the Vercel request/response pair.
 *
 * They live in lib/ rather than next to the specs because Vercel turns every
 * .ts file under api/ into its own serverless function, and the Hobby plan
 * allows twelve.
 */
export function mockRequest(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
    body: {},
    query: {},
    ...overrides,
  } as VercelRequest;
}

/**
 * A request whose body can only be read as a stream.
 *
 * The Stripe webhook verifies its signature against the raw bytes, so it
 * consumes `req` with `for await` rather than touching `req.body`.
 */
export function mockRawRequest(
  raw: string | Buffer,
  overrides: Partial<VercelRequest> = {}
): VercelRequest {
  const buf = typeof raw === 'string' ? Buffer.from(raw) : raw;
  const req = mockRequest(overrides) as VercelRequest & {
    [Symbol.asyncIterator]: () => AsyncGenerator<Buffer>;
  };
  req[Symbol.asyncIterator] = async function* () {
    yield buf;
  };
  return req;
}

export interface MockResponse extends VercelResponse {
  /** Status passed to res.status(); 0 means the handler never answered */
  statusCode: number;
  /** Body passed to res.json() */
  body: unknown;
}

export function mockResponse(): MockResponse {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
    setHeader: vi.fn(),
    end: vi.fn(),
  };
  return res as unknown as MockResponse;
}

/**
 * Stands in for the Supabase client, resolving whatever the table is mapped to.
 *
 * Query builders are chainable and thenable, so `.from(t).select().eq().limit()`
 * and `.from(t).select().eq().range()` both settle on the same canned answer —
 * the handlers only care about `{ data, error }` at the end of the chain.
 */
export type TableAnswer = { data?: unknown[] | null; error?: { message: string } | null };

/** `args` is present only when the call carried any — so a bare `.delete()`
 *  still matches `{ table, op }` exactly. */
export type RecordedCall = { table: string; op: string; args?: unknown[] };

export function mockSupabase(tables: Record<string, TableAnswer | TableAnswer[]>) {
  const calls: RecordedCall[] = [];
  const pending: Record<string, TableAnswer[]> = {};

  for (const [table, answer] of Object.entries(tables)) {
    pending[table] = Array.isArray(answer) ? [...answer] : [answer];
  }

  function answerFor(table: string): TableAnswer {
    const queue = pending[table];
    if (!queue || queue.length === 0) return { data: [], error: null };
    // Repeat the last answer once the queue runs dry: paged reads call the same
    // table twice and the second page is expected to come back short.
    return queue.length === 1 ? queue[0] : (queue.shift() as TableAnswer);
  }

  function builder(table: string) {
    // .single() unwraps to one row — or to PGRST116 when there is none. Keeping
    // that difference matters: a bare [] would read as truthy and let a "no
    // profile row" test pass while the handler took the happy path.
    let single = false;

    const settled = () => {
      const answer = answerFor(table);
      const rows = answer.data ?? [];
      if (answer.error) return Promise.resolve({ data: null, error: answer.error });
      if (!single) return Promise.resolve({ data: rows, error: null });
      return Promise.resolve(
        rows.length > 0
          ? { data: rows[0], error: null }
          : { data: null, error: { code: 'PGRST116', message: 'no rows returned' } }
      );
    };

    const chain: Record<string, unknown> = {
      then: (...args: Parameters<Promise<unknown>['then']>) => settled().then(...args),
    };
    for (const method of ['select', 'eq', 'limit', 'range', 'order', 'single', 'maybeSingle']) {
      chain[method] = () => {
        calls.push({ table, op: method });
        if (method === 'single' || method === 'maybeSingle') single = true;
        return chain;
      };
    }
    return chain;
  }

  return {
    calls,
    client: {
      from: (table: string) => {
        const api: Record<string, unknown> = {};
        for (const op of ['select', 'insert', 'update', 'upsert', 'delete']) {
          api[op] = (...args: unknown[]) => {
            calls.push(args.length > 0 ? { table, op, args } : { table, op });
            return builder(table);
          };
        }
        return api;
      },
    },
  };
}
