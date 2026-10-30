import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockRequest, mockResponse } from '../../libs/server/src/test-utils';
import {
  DEMO_RATE_LIMIT,
  DEMO_SWEEP_LIMIT,
  DEMO_SWEEP_PAGE_SIZE,
  DEMO_SWEEP_PAGES,
  DEMO_TTL_MS,
} from '../../libs/server/src/demo';

const APP_URL = 'https://app.example';

const { admin, storage, table, providers } = vi.hoisted(() => ({
  /* What configuredProviders() hands the sweep. Empty by default, which is a
     deployment with neither R2 nor Cloudinary configured. */
  providers: { current: {} as Record<string, unknown> },
  admin: {
    createUser: vi.fn(),
    listUsers: vi.fn(),
    deleteUser: vi.fn(),
  },
  storage: {
    upload: vi.fn(),
    createSignedUrl: vi.fn(),
    list: vi.fn(),
    remove: vi.fn(),
  },
  table: {
    calls: [] as { table: string; op: string; args?: unknown[] }[],
    folderId: 'folder-1' as string | null,
  },
}));

vi.mock('../../libs/server/src/auth', () => ({
  supabase: {
    auth: { admin },
    storage: { from: () => storage },
    from: (name: string) => ({
      insert: (args: unknown) => {
        table.calls.push({ table: name, op: 'insert', args: [args] });
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { id: table.folderId }, error: null }),
          }),
          then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
        };
      },
      delete: () => ({
        eq: (column: string, value: unknown) => {
          table.calls.push({ table: name, op: 'delete', args: [column, value] });
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
  },
}));

vi.mock('../../libs/server/src/erase-providers', () => ({
  configuredProviders: () => providers.current,
}));

import handler from './session';

/** Each test uses its own address: the limiter lives in module scope and the
 *  module is imported once, so counts would otherwise leak between tests. */
let ipCounter = 0;
const post = (headers: Record<string, string> = {}) =>
  mockRequest({
    method: 'POST',
    headers: {
      origin: APP_URL,
      'x-forwarded-for': `198.51.100.${++ipCounter}`,
      ...headers,
    },
  });

function seedableFetch() {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.startsWith(`${APP_URL}/demo/`)) {
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Response;
    }
    return {
      ok: true,
      json: async () => ({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3600,
      }),
    } as unknown as Response;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  table.calls = [];
  table.folderId = 'folder-1';
  providers.current = {};

  process.env.DEMO_ENABLED = 'true';
  process.env.SUPABASE_URL = 'https://supa.example';
  process.env.VITE_SUPABASE_ANON_KEY = 'anon-key';
  // getAppUrl takes an Origin only when it is this deployment's own address.
  process.env.VERCEL_PROJECT_PRODUCTION_URL = 'app.example';

  admin.createUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  admin.listUsers.mockResolvedValue({ data: { users: [] }, error: null });
  admin.deleteUser.mockResolvedValue({ data: null, error: null });
  storage.upload.mockResolvedValue({ data: { path: 'p' }, error: null });
  storage.createSignedUrl.mockResolvedValue({
    data: { signedUrl: 'https://supa.example/signed' },
    error: null,
  });
  storage.list.mockResolvedValue({ data: [], error: null });
  storage.remove.mockResolvedValue({ data: null, error: null });

  vi.stubGlobal('fetch', seedableFetch());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/demo/session', () => {
  it('returns a session the browser can adopt', async () => {
    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 3600,
    });
  });

  it('creates a confirmed account, so the visitor never sees a verification mail', async () => {
    await handler(post(), mockResponse());

    expect(admin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email_confirm: true, email: expect.stringMatching(/^demo-/) })
    );
  });

  it('seeds a folder and the root files the dashboard shows', async () => {
    await handler(post(), mockResponse());

    const folders = table.calls.filter((c) => c.table === 'folders' && c.op === 'insert');
    const files = table.calls.filter((c) => c.table === 'files' && c.op === 'insert');

    expect(folders).toHaveLength(1);
    expect(files.length).toBeGreaterThan(1);
    expect(files.some((c) => (c.args?.[0] as { folder_id?: string }).folder_id === null)).toBe(
      true
    );
    expect(
      files.some((c) => (c.args?.[0] as { folder_id?: string }).folder_id === 'folder-1')
    ).toBe(true);
  });

  it('records the real byte length, so the storage meter is not fiction', async () => {
    await handler(post(), mockResponse());

    const file = table.calls.find((c) => c.table === 'files')?.args?.[0] as { size: number };
    expect(file.size).toBe(3);
  });

  it.each(['capacitor://localhost', 'https://elsewhere.example'])(
    'seeds from this deployment, not from the Origin %s',
    async (origin) => {
      // A shell sends its own origin, and a plain request can claim any. The
      // assets used to be fetched from whichever it was.
      await handler(post({ origin }), mockResponse());

      const seeded = vi
        .mocked(fetch)
        .mock.calls.map(([input]) => String(input))
        .filter((url) => url.includes('/demo/'));

      expect(seeded.length).toBeGreaterThan(0);
      expect(seeded.every((url) => url.startsWith(`${APP_URL}/demo/`))).toBe(true);
    }
  );

  it('still hands over a session when a seed asset is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.startsWith(`${APP_URL}/demo/`)) return { ok: false } as Response;
        return {
          ok: true,
          json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-1' }),
        } as unknown as Response;
      })
    );

    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(201);
    expect(table.calls.filter((c) => c.table === 'files')).toHaveLength(0);
  });

  it('sweeps expired demo accounts and leaves everything else alone', async () => {
    const old = new Date(Date.now() - DEMO_TTL_MS - 1000).toISOString();
    const fresh = new Date().toISOString();
    admin.listUsers.mockResolvedValue({
      data: {
        users: [
          { id: 'stale', email: 'demo-1-a@example.com', created_at: old },
          { id: 'young', email: 'demo-2-b@example.com', created_at: fresh },
          { id: 'real', email: 'someone@example.com', created_at: old },
          { id: 'e2e', email: 'e2e-1@example.com', created_at: old },
          // A person whose address begins like a demo's, at a domain they can confirm.
          { id: 'person', email: 'demo-anna@company.com', created_at: old },
        ],
      },
      error: null,
    });

    await handler(post(), mockResponse());

    expect(admin.deleteUser).toHaveBeenCalledTimes(1);
    expect(admin.deleteUser).toHaveBeenCalledWith('stale');
  });

  it('removes an expired account rows-first, so nothing is orphaned', async () => {
    admin.listUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: 'stale',
            email: 'demo-1-a@example.com',
            created_at: new Date(Date.now() - DEMO_TTL_MS - 1000).toISOString(),
          },
        ],
      },
      error: null,
    });
    storage.list.mockResolvedValue({ data: [{ name: '1_a.png' }], error: null });

    await handler(post(), mockResponse());

    expect(storage.remove).toHaveBeenCalledWith(['stale/1_a.png']);
    const deletions = table.calls.filter((c) => c.op === 'delete').map((c) => c.table);
    expect(deletions).toEqual(['files', 'folders']);
  });

  it('erases an expired account from R2 and Cloudinary too, not only Supabase Storage', async () => {
    // Images go to Cloudinary by default. The sweep used to stop at Supabase
    // Storage, so every image a visitor uploaded outlived the account.
    const eraseR2 = vi.fn().mockResolvedValue(undefined);
    const eraseCloudinary = vi.fn().mockResolvedValue(undefined);
    providers.current = { eraseR2, eraseCloudinary };
    admin.listUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: 'stale',
            email: 'demo-1-a@example.com',
            created_at: new Date(Date.now() - DEMO_TTL_MS - 1000).toISOString(),
          },
        ],
      },
      error: null,
    });

    await handler(post(), mockResponse());

    expect(eraseR2).toHaveBeenCalledWith('stale');
    expect(eraseCloudinary).toHaveBeenCalledWith('stale');
    expect(admin.deleteUser).toHaveBeenCalledWith('stale');
  });

  it('keeps sweeping when one expired account will not go', async () => {
    const old = new Date(Date.now() - DEMO_TTL_MS - 1000).toISOString();
    admin.listUsers.mockResolvedValue({
      data: {
        users: [
          { id: 'stuck', email: 'demo-1-a@example.com', created_at: old },
          { id: 'stale', email: 'demo-2-b@example.com', created_at: old },
        ],
      },
      error: null,
    });
    admin.deleteUser
      .mockResolvedValueOnce({ data: null, error: { message: 'user not found' } })
      .mockResolvedValueOnce({ data: null, error: null });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = mockResponse();
    await handler(post(), res);

    expect(admin.deleteUser).toHaveBeenCalledWith('stuck');
    expect(admin.deleteUser).toHaveBeenCalledWith('stale');
    expect(res.statusCode).toBe(201);
  });

  describe('reading the accounts a page at a time', () => {
    const old = () => new Date(Date.now() - DEMO_TTL_MS - 1000).toISOString();

    /** A full page of accounts the sweep must leave alone. */
    const people = (page: number) =>
      Array.from({ length: DEMO_SWEEP_PAGE_SIZE }, (_, i) => ({
        id: `person-${page}-${i}`,
        email: `person-${page}-${i}@company.com`,
        created_at: new Date().toISOString(),
      }));

    /* The admin API answers newest first. The sweep read the first page only,
       so a demo account with two hundred newer accounts in front of it was
       never looked at again. */
    it('finds an expired account past the first page', async () => {
      admin.listUsers.mockImplementation(async ({ page }: { page: number }) => ({
        data: {
          users:
            page < 3
              ? people(page)
              : [{ id: 'stale', email: 'demo-1-a@example.com', created_at: old() }],
        },
        error: null,
      }));

      await handler(post(), mockResponse());

      expect(admin.listUsers.mock.calls.map(([args]) => args)).toEqual([
        { page: 1, perPage: DEMO_SWEEP_PAGE_SIZE },
        { page: 2, perPage: DEMO_SWEEP_PAGE_SIZE },
        { page: 3, perPage: DEMO_SWEEP_PAGE_SIZE },
      ]);
      expect(admin.deleteUser).toHaveBeenCalledWith('stale');
    });

    it('stops reading once it has as many as it will erase', async () => {
      admin.listUsers.mockImplementation(async ({ page }: { page: number }) => ({
        data: {
          users: Array.from({ length: DEMO_SWEEP_PAGE_SIZE }, (_, i) => ({
            id: `stale-${page}-${i}`,
            email: `demo-${page}${i}-a@example.com`,
            created_at: old(),
          })),
        },
        error: null,
      }));

      await handler(post(), mockResponse());

      expect(admin.listUsers).toHaveBeenCalledTimes(1);
      expect(admin.deleteUser).toHaveBeenCalledTimes(DEMO_SWEEP_LIMIT);
    });

    /* A visitor is waiting while it reads. Newest first, an account expires near
       the front, so the bound costs nothing until two thousand accounts are made
       in a day. */
    it('gives up after DEMO_SWEEP_PAGES full pages', async () => {
      admin.listUsers.mockImplementation(async ({ page }: { page: number }) => ({
        data: { users: people(page) },
        error: null,
      }));

      const res = mockResponse();
      await handler(post(), res);

      expect(admin.listUsers).toHaveBeenCalledTimes(DEMO_SWEEP_PAGES);
      expect(admin.deleteUser).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(201);
    });

    it('erases what it found before a page failed', async () => {
      admin.listUsers
        .mockResolvedValueOnce({
          data: {
            users: [
              ...people(1).slice(1),
              { id: 'stale', email: 'demo-1-a@example.com', created_at: old() },
            ],
          },
          error: null,
        })
        .mockResolvedValueOnce({ data: { users: [] }, error: { message: 'admin API hiccup' } });

      await handler(post(), mockResponse());

      expect(admin.listUsers).toHaveBeenCalledTimes(2);
      expect(admin.deleteUser).toHaveBeenCalledWith('stale');
    });
  });

  it('serves the visitor even when the sweep fails', async () => {
    admin.listUsers.mockRejectedValue(new Error('admin API down'));

    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(201);
  });

  it('refuses one session past the limit from the same address within the hour', async () => {
    const ip = '203.0.113.77';
    for (let i = 0; i < DEMO_RATE_LIMIT; i++) {
      const res = mockResponse();
      await handler(
        mockRequest({ method: 'POST', headers: { origin: APP_URL, 'x-forwarded-for': ip } }),
        res
      );
      expect(res.statusCode).toBe(201);
    }

    const res = mockResponse();
    await handler(
      mockRequest({ method: 'POST', headers: { origin: APP_URL, 'x-forwarded-for': ip } }),
      res
    );
    expect(res.statusCode).toBe(429);
  });

  it('looks like a route that does not exist when the demo is switched off', async () => {
    delete process.env.DEMO_ENABLED;

    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(404);
    expect(admin.createUser).not.toHaveBeenCalled();
  });

  it('rejects anything but POST', async () => {
    const res = mockResponse();
    await handler(mockRequest({ method: 'GET' }), res);

    expect(res.statusCode).toBe(405);
    expect(res.setHeader).toHaveBeenCalledWith('Allow', 'POST');
  });

  it('answers 500 without leaking the reason when the account cannot be created', async () => {
    admin.createUser.mockResolvedValue({ data: null, error: { message: 'quota exceeded' } });

    const res = mockResponse();
    await handler(post(), res);

    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('quota exceeded');
  });
});
