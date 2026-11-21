import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const { resources, deleteResources, config, send } = vi.hoisted(() => ({
  resources: vi.fn(),
  deleteResources: vi.fn(),
  config: vi.fn(),
  send: vi.fn(),
}));

vi.mock('cloudinary', () => ({
  v2: {
    config,
    api: {
      resources: (...args: unknown[]) => resources(...args),
      delete_resources: (...args: unknown[]) => deleteResources(...args),
    },
  },
}));

vi.mock('./r2', () => ({
  getS3Client: () => ({ send }),
  getR2BucketName: () => 'test-bucket',
}));

import { reconcileDeps } from './reconcile-providers';

const OWNER = '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f';

/** The calls a query builder saw, and the answer it gives. */
function fakeSupabase(answers: { rows?: unknown[][]; rpc?: unknown; update?: unknown[] } = {}) {
  const calls: { op: string; args: unknown[] }[] = [];
  const pages = [...(answers.rows ?? [[]])];
  const remove = vi.fn(async () => ({ data: [], error: null }));

  const builder = () => {
    let updating = false;
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'order', 'range', 'update']) {
      chain[op] = (...args: unknown[]) => {
        calls.push({ op, args });
        if (op === 'update') updating = true;
        return chain;
      };
    }
    chain.then = (resolve: (value: unknown) => unknown) =>
      resolve(
        updating
          ? { data: answers.update ?? [], error: null }
          : { data: pages.length > 1 ? pages.shift() : pages[0], error: null }
      );
    return chain;
  };

  const client = {
    from: (table: string) => {
      calls.push({ op: 'from', args: [table] });
      return builder();
    },
    rpc: vi.fn(async () => ({ data: answers.rpc ?? [], error: null })),
    storage: { from: vi.fn(() => ({ remove })) },
  };
  return { client: client as unknown as SupabaseClient, calls, rpc: client.rpc, remove };
}

beforeEach(() => {
  vi.clearAllMocks();
  resources.mockResolvedValue({ resources: [] });
  deleteResources.mockResolvedValue({});
  send.mockResolvedValue({ Contents: [], IsTruncated: false });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function withCloudinary() {
  vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'demo-cloud');
  vi.stubEnv('CLOUDINARY_API_KEY', 'key');
  vi.stubEnv('CLOUDINARY_API_SECRET', 'not-a-real-one');
}

describe('the providers a deployment has', () => {
  it('leaves out Cloudinary and R2 when they are not configured', () => {
    vi.stubEnv('CLOUDINARY_API_KEY', '');
    vi.stubEnv('R2_ENDPOINT', '');
    const deps = reconcileDeps(fakeSupabase().client);
    expect(deps.cloudinary).toBeUndefined();
    expect(deps.r2).toBeUndefined();
  });

  it('configures Cloudinary to keep its secret out of a failed request', () => {
    withCloudinary();
    reconcileDeps(fakeSupabase().client);
    expect(config).toHaveBeenCalledWith(expect.objectContaining({ hide_sensitive: true }));
  });
});

describe('Cloudinary', () => {
  it('lists every resource type, under the app’s prefix only, page by page', async () => {
    withCloudinary();
    resources.mockImplementation(
      async (options: { resource_type: string; next_cursor?: string }) =>
        options.resource_type === 'image' && !options.next_cursor
          ? {
              resources: [
                { public_id: `users/${OWNER}/a`, bytes: 10, created_at: '2026-11-19T00:00:00Z' },
              ],
              next_cursor: 'page-2',
            }
          : options.resource_type === 'raw'
            ? {
                resources: [
                  {
                    public_id: `users/${OWNER}/b.pdf`,
                    bytes: 20,
                    created_at: '2026-11-19T00:00:00Z',
                  },
                ],
              }
            : { resources: [] }
    );

    const listed = await reconcileDeps(fakeSupabase().client).cloudinary!.list();

    expect(resources.mock.calls.map(([o]) => [o.resource_type, o.prefix, o.next_cursor])).toEqual([
      ['image', 'users/', undefined],
      ['image', 'users/', 'page-2'],
      ['raw', 'users/', undefined],
      ['video', 'users/', undefined],
    ]);
    expect(listed).toEqual([
      {
        path: `users/${OWNER}/a`,
        size: 10,
        createdAt: new Date('2026-11-19T00:00:00Z'),
        resourceType: 'image',
      },
      {
        path: `users/${OWNER}/b.pdf`,
        size: 20,
        createdAt: new Date('2026-11-19T00:00:00Z'),
        resourceType: 'raw',
      },
    ]);
  });

  it('removes by type, a hundred ids at a time', async () => {
    withCloudinary();
    const images = Array.from({ length: 150 }, (_, i) => ({
      path: `users/${OWNER}/${i}`,
      size: 1,
      createdAt: new Date(),
      resourceType: 'image',
    }));
    const raw = [
      { path: `users/${OWNER}/x.pdf`, size: 1, createdAt: new Date(), resourceType: 'raw' },
    ];

    await reconcileDeps(fakeSupabase().client).cloudinary!.remove([...images, ...raw]);

    expect(deleteResources.mock.calls.map(([ids, o]) => [ids.length, o.resource_type])).toEqual([
      [100, 'image'],
      [50, 'image'],
      [1, 'raw'],
    ]);
  });
});

describe('R2', () => {
  beforeEach(() => {
    vi.stubEnv('R2_ENDPOINT', 'https://r2.test');
    vi.stubEnv('R2_BUCKET_NAME', 'bucket');
  });

  it('lists under the app’s prefix only', async () => {
    send.mockResolvedValueOnce({
      Contents: [{ Key: `users/${OWNER}/a`, Size: 5, LastModified: new Date('2026-11-19') }],
      IsTruncated: false,
    });

    const listed = await reconcileDeps(fakeSupabase().client).r2!.list();

    expect(send.mock.calls[0]![0].input).toMatchObject({ Prefix: 'users/' });
    expect(listed).toEqual([
      { path: `users/${OWNER}/a`, size: 5, createdAt: new Date('2026-11-19') },
    ]);
  });

  it('fails when R2 says some keys were not removed', async () => {
    send.mockResolvedValueOnce({ Errors: [{ Key: 'k', Code: 'AccessDenied' }] });
    const r2 = reconcileDeps(fakeSupabase().client).r2!;

    await expect(
      r2.remove([{ path: `users/${OWNER}/a`, size: 1, createdAt: new Date() }])
    ).rejects.toThrow('R2 did not remove 1 objects');
  });
});

describe('the database', () => {
  it('reads every row of a provider, page by page', async () => {
    const page = (n: number, from: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `r${from + i}`,
        storage_path: `users/${OWNER}/${from + i}`,
        size: '7',
        created_at: '2026-11-19T00:00:00Z',
      }));
    const db = fakeSupabase({ rows: [page(1000, 0), page(3, 1000)] });

    const rows = await reconcileDeps(db.client).rows('cloudinary');

    expect(rows).toHaveLength(1003);
    expect(rows[0]).toEqual({
      id: 'r0',
      path: `users/${OWNER}/0`,
      size: 7,
      createdAt: new Date('2026-11-19T00:00:00Z'),
    });
    expect(db.calls.filter((c) => c.op === 'eq')).toEqual([
      { op: 'eq', args: ['storage_type', 'cloudinary'] },
      { op: 'eq', args: ['storage_type', 'cloudinary'] },
    ]);
    expect(db.calls.filter((c) => c.op === 'range').map((c) => c.args)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('corrects a size only where the row still says what was read', async () => {
    const db = fakeSupabase({ update: [{ id: 'f1' }] });

    const changed = await reconcileDeps(db.client).resize('f1', 10, 800);

    expect(changed).toBe(true);
    expect(db.calls.filter((c) => c.op === 'update' || c.op === 'eq')).toEqual([
      { op: 'update', args: [{ size: 800 }] },
      { op: 'eq', args: ['id', 'f1'] },
      { op: 'eq', args: ['size', 10] },
    ]);
  });

  it('asks the functions of migration 021, with numbers as numbers', async () => {
    const db = fakeSupabase({
      rpc: [{ kind: 'misweighed', path: 'p', file_id: 'f', recorded: '10', actual: '800' }],
    });
    const deps = reconcileDeps(db.client);

    const findings = await deps.storageBucket(new Date('2026-11-20T03:00:00Z'));
    await deps.recount(true);

    expect(db.rpc).toHaveBeenCalledWith('reconcile_storage_bucket', {
      p_created_before: '2026-11-20T03:00:00.000Z',
    });
    expect(db.rpc).toHaveBeenCalledWith('reconcile_bytes_used', { p_apply: true });
    expect(findings[0]).toMatchObject({ recorded: 10, actual: 800 });
  });

  it('removes from the files bucket', async () => {
    const db = fakeSupabase();
    await reconcileDeps(db.client).removeFromBucket([`${OWNER}/1_a.txt`]);
    expect(db.client.storage.from).toHaveBeenCalledWith('files');
    expect(db.remove).toHaveBeenCalledWith([`${OWNER}/1_a.txt`]);
  });
});
