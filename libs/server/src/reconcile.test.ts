import { describe, it, expect, vi } from 'vitest';
import {
  HOLD_ABOVE,
  MAX_REMOVALS,
  failed,
  reconcile,
  summarize,
  type BucketFinding,
  type ListedStore,
  type RecordedRow,
  type ReconcileDeps,
  type StoredObject,
} from './reconcile';

const NOW = new Date('2026-11-21T03:00:00Z');
const OLD = new Date('2026-11-19T03:00:00Z');
const YOUNG = new Date('2026-11-21T02:00:00Z');
const OWNER = '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f';

const object = (
  path: string,
  size: number,
  createdAt = OLD,
  resourceType = 'image'
): StoredObject => ({
  path,
  size,
  createdAt,
  resourceType,
});
const row = (id: string, path: string, size: number, createdAt = OLD): RecordedRow => ({
  id,
  path,
  size,
  createdAt,
});

function store(
  objects: StoredObject[],
  order: string[] = []
): ListedStore & {
  remove: ReturnType<typeof vi.fn>;
} {
  return {
    list: vi.fn(async () => {
      order.push('list');
      return objects;
    }),
    remove: vi.fn(async () => undefined),
  };
}

function deps(overrides: Partial<ReconcileDeps> = {}): ReconcileDeps & {
  removeFromBucket: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  recount: ReturnType<typeof vi.fn>;
} {
  return {
    rows: vi.fn(async () => []),
    storageBucket: vi.fn(async () => []),
    removeFromBucket: vi.fn(async () => undefined),
    resize: vi.fn(async () => true),
    recount: vi.fn(async () => []),
    ...overrides,
  } as never;
}

describe('a provider the server lists', () => {
  const objects = [
    object(`users/${OWNER}/kept.png`, 100),
    object(`users/${OWNER}/orphan.png`, 40),
    object(`users/${OWNER}/young.png`, 30, YOUNG),
    object(`users/${OWNER}/grown.png`, 900),
  ];
  const rows = [
    row('a', `users/${OWNER}/kept.png`, 100),
    row('b', `users/${OWNER}/grown.png`, 10),
    row('c', `users/${OWNER}/gone.png`, 50),
  ];

  it('in a dry run, finds what it would act on and changes nothing', async () => {
    const cloudinary = store(objects);
    const d = deps({ rows: vi.fn(async () => rows), cloudinary });

    const outcome = await reconcile(d, { now: NOW, apply: false });

    expect(outcome.applied).toBe(false);
    expect(outcome.providers.cloudinary).toMatchObject({
      orphans: 1,
      orphanBytes: 40,
      removed: 0,
      misweighed: 1,
      resized: 0,
      missing: 1,
    });
    expect(cloudinary.remove).not.toHaveBeenCalled();
    expect(d.resize).not.toHaveBeenCalled();
    expect(d.recount).toHaveBeenCalledWith(false);
  });

  /* An upload stores its object and then asks for its row: an object younger
     than a day may be one whose row is a moment away. */
  it('removes an object with no row only once it is a day old', async () => {
    const cloudinary = store(objects);
    const d = deps({ rows: vi.fn(async () => rows.slice(0, 2)), cloudinary });

    const outcome = await reconcile(d, { now: NOW, apply: true });

    expect(cloudinary.remove).toHaveBeenCalledWith([objects[1]]);
    expect(outcome.providers.cloudinary?.removed).toBe(1);
  });

  it('gives a misweighed row the size its provider holds, conditional on the size it read', async () => {
    const d = deps({ rows: vi.fn(async () => rows), cloudinary: store(objects) });

    const outcome = await reconcile(d, { now: NOW, apply: true });

    expect(d.resize).toHaveBeenCalledExactlyOnceWith('b', 10, 900);
    expect(outcome.providers.cloudinary?.resized).toBe(1);
  });

  it('does not count a row the owner deleted meanwhile as corrected', async () => {
    const d = deps({
      rows: vi.fn(async () => rows),
      cloudinary: store(objects),
      resize: vi.fn(async () => false),
    });

    const outcome = await reconcile(d, { now: NOW, apply: true });

    expect(outcome.providers.cloudinary?.misweighed).toBe(1);
    expect(outcome.providers.cloudinary?.resized).toBe(0);
  });

  /* Read the other way round, an upload confirmed between the two reads
     would look like a row whose object is gone. */
  it('reads the rows before it lists the objects', async () => {
    const order: string[] = [];
    const d = deps({
      rows: vi.fn(async () => {
        order.push('rows');
        return rows;
      }),
      r2: store(objects, order),
    });

    await reconcile(d, { now: NOW, apply: false });

    expect(order).toEqual(['rows', 'list']);
  });

  it('never removes a row, even one with no object', async () => {
    const d = deps({ rows: vi.fn(async () => rows), cloudinary: store(objects) });

    const outcome = await reconcile(d, { now: NOW, apply: true });

    expect(outcome.providers.cloudinary?.missing).toBe(1);
    expect(d.resize).not.toHaveBeenCalledWith('c', expect.anything(), expect.anything());
  });

  it('does not count a young row with no object as missing', async () => {
    const d = deps({
      rows: vi.fn(async () => [row('d', `users/${OWNER}/new.png`, 5, YOUNG)]),
      cloudinary: store([]),
    });

    const outcome = await reconcile(d, { now: NOW, apply: false });

    expect(outcome.providers.cloudinary?.missing).toBe(0);
  });
});

describe('what keeps a misread from deleting everyone’s files', () => {
  /* Twelve assets on production: under the threshold below, and every one of
     them would be an orphan if the rows held their paths in another shape. */
  it('removes nothing when rows miss their objects and objects their rows at once', async () => {
    const assets = [object(`users/${OWNER}/a`, 1), object(`users/${OWNER}/b`, 1)];
    const cloudinary = store(assets);
    const d = deps({
      rows: vi.fn(async () => [row('a', `${OWNER}/a`, 1), row('b', `${OWNER}/b`, 1)]),
      cloudinary,
    });

    const outcome = await reconcile(d, { now: NOW, apply: true });

    expect(cloudinary.remove).not.toHaveBeenCalled();
    expect(outcome.providers.cloudinary?.held).toBe(
      '2 rows have no object while 2 objects have no row; the paths may be misread'
    );
  });

  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => object(`users/${OWNER}/${i}.png`, 1));

  it('removes nothing when most of what a provider holds has no row', async () => {
    const r2 = store(many(HOLD_ABOVE + 1));
    const d = deps({ rows: vi.fn(async () => []), r2 });

    const outcome = await reconcile(d, { now: NOW, apply: true });

    expect(r2.remove).not.toHaveBeenCalled();
    expect(outcome.providers.r2?.held).toMatch(/21 of 21 objects have no row/);
    expect(outcome.providers.r2?.removed).toBe(0);
  });

  it('still removes a few, even when they are all there is', async () => {
    const r2 = store(many(HOLD_ABOVE));
    const d = deps({ rows: vi.fn(async () => []), r2 });

    const outcome = await reconcile(d, { now: NOW, apply: true });

    expect(r2.remove).toHaveBeenCalledOnce();
    expect(outcome.providers.r2?.removed).toBe(HOLD_ABOVE);
  });

  it('removes at most a night’s share', async () => {
    /* More recorded than not, so that the hold above stays out of it. */
    const objects = many(MAX_REMOVALS + 20);
    const rows = objects.map((o, i) => row(`r${i}`, o.path, 1));
    const extra = many(MAX_REMOVALS + 10).map((o) => ({ ...o, path: `${o.path}.extra` }));
    const r2 = store([...objects, ...extra]);
    const d = deps({ rows: vi.fn(async () => rows), r2 });

    const outcome = await reconcile(d, { now: NOW, apply: true });

    expect(r2.remove.mock.calls[0]![0]).toHaveLength(MAX_REMOVALS);
    expect(outcome.providers.r2?.orphans).toBe(MAX_REMOVALS + 10);
    expect(outcome.providers.r2?.removed).toBe(MAX_REMOVALS);
  });
});

describe('the Storage bucket, compared in the database', () => {
  const findings: BucketFinding[] = [
    { kind: 'orphan', path: `${OWNER}/1_left.txt`, file_id: null, recorded: null, actual: 32 },
    { kind: 'misweighed', path: `${OWNER}/2_grown.pdf`, file_id: 'f1', recorded: 10, actual: 800 },
    { kind: 'missing', path: `${OWNER}/3_gone.txt`, file_id: 'f2', recorded: 5, actual: null },
  ];

  it('asks for objects older than a day', async () => {
    const d = deps();
    await reconcile(d, { now: NOW, apply: false });
    expect(d.storageBucket).toHaveBeenCalledWith(new Date('2026-11-20T03:00:00Z'));
  });

  it('removes the orphans by path and corrects the misweighed rows', async () => {
    const d = deps({ storageBucket: vi.fn(async () => findings) });

    const outcome = await reconcile(d, { now: NOW, apply: true });

    expect(d.removeFromBucket).toHaveBeenCalledWith([`${OWNER}/1_left.txt`]);
    expect(d.resize).toHaveBeenCalledExactlyOnceWith('f1', 10, 800);
    expect(outcome.providers.supabase_storage).toEqual({
      orphans: 1,
      orphanBytes: 32,
      removed: 1,
      misweighed: 1,
      resized: 1,
      missing: 1,
    });
  });

  it('in a dry run, removes and corrects nothing', async () => {
    const d = deps({ storageBucket: vi.fn(async () => findings) });

    await reconcile(d, { now: NOW, apply: false });

    expect(d.removeFromBucket).not.toHaveBeenCalled();
    expect(d.resize).not.toHaveBeenCalled();
  });
});

describe('a failure', () => {
  it('stops its own provider and not the others, and the recount still runs', async () => {
    const d = deps({
      storageBucket: vi.fn(async () => {
        throw new Error('Could not compare the Storage bucket: function does not exist');
      }),
      rows: vi.fn(async () => []),
      cloudinary: store([object(`users/${OWNER}/a.png`, 1)]),
      recount: vi.fn(async () => [{ user_id: OWNER, recorded: 5, counted: 7 }]),
    });

    const outcome = await reconcile(d, { now: NOW, apply: true });

    expect(outcome.providers.supabase_storage?.failure).toMatch(/function does not exist/);
    expect(outcome.providers.cloudinary?.removed).toBe(1);
    expect(outcome.quota).toEqual({ drifted: 1, corrected: 1 });
    expect(failed(outcome)).toBe(true);
  });

  /* The Cloudinary SDK rejects with a plain object that carries the request
     it made; only its message is kept. */
  it('keeps a provider’s message and nothing of its request', async () => {
    const cloudinary: ListedStore = {
      list: vi.fn(async () => {
        throw {
          error: { message: 'Rate Limit Exceeded', http_code: 420 },
          request_options: { auth: 'key:secret' },
        };
      }),
      remove: vi.fn(),
    };
    const d = deps({ cloudinary });

    const outcome = await reconcile(d, { now: NOW, apply: false });

    expect(outcome.providers.cloudinary?.failure).toBe('Rate Limit Exceeded');
    expect(JSON.stringify(outcome)).not.toContain('secret');
  });

  it('of the recount is reported with the rest', async () => {
    const d = deps({ recount: vi.fn(async () => Promise.reject(new Error('permission denied'))) });

    const outcome = await reconcile(d, { now: NOW, apply: false });

    expect(outcome.quota.failure).toBe('permission denied');
    expect(failed(outcome)).toBe(true);
  });
});

describe('the recount', () => {
  it('counts drift in a dry run and corrects it only when applied', async () => {
    const drift = [{ user_id: OWNER, recorded: 5, counted: 7 }];

    const dry = await reconcile(deps({ recount: vi.fn(async () => drift) }), {
      now: NOW,
      apply: false,
    });
    const applied = await reconcile(deps({ recount: vi.fn(async () => drift) }), {
      now: NOW,
      apply: true,
    });

    expect(dry.quota).toEqual({ drifted: 1, corrected: 0 });
    expect(applied.quota).toEqual({ drifted: 1, corrected: 1 });
  });

  it('runs after the providers, so that it sees the sizes they corrected', async () => {
    const order: string[] = [];
    const d = deps({
      storageBucket: vi.fn(async () => {
        order.push('bucket');
        return [];
      }),
      recount: vi.fn(async () => {
        order.push('recount');
        return [];
      }),
    });

    await reconcile(d, { now: NOW, apply: true });

    expect(order).toEqual(['bucket', 'recount']);
  });
});

describe('the summary', () => {
  it('is nothing on a night with nothing to say', async () => {
    const outcome = await reconcile(deps({ cloudinary: store([]) }), { now: NOW, apply: true });
    expect(summarize(outcome)).toBeNull();
    expect(failed(outcome)).toBe(false);
  });

  it('says what it found in counts, and never a path', async () => {
    const d = deps({
      storageBucket: vi.fn(async () => [
        {
          kind: 'orphan',
          path: `${OWNER}/1_secret plan.pdf`,
          file_id: null,
          recorded: null,
          actual: 32,
        },
      ]) as ReconcileDeps['storageBucket'],
      recount: vi.fn(async () => [{ user_id: OWNER, recorded: 5, counted: 7 }]),
    });

    const summary = summarize(await reconcile(d, { now: NOW, apply: false }));

    expect(summary).toBe(
      'Reconciliation (dry run): supabase_storage: 1 objects with no row (32 bytes), 0 removed; ' +
        'quota: 1 counters off their rows, 0 corrected'
    );
    expect(summary).not.toContain(OWNER);
    expect(summary).not.toContain('secret plan');
  });

  it('says when it held back, and why', async () => {
    const many = Array.from({ length: HOLD_ABOVE + 1 }, (_, i) => object(`users/${OWNER}/${i}`, 1));
    const outcome = await reconcile(deps({ r2: store(many) }), { now: NOW, apply: true });

    expect(summarize(outcome)).toContain('r2: held, 21 of 21 objects have no row');
  });
});
