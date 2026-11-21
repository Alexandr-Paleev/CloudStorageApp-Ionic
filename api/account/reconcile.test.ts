import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { mockRequest, mockResponse } from '../../libs/server/src/test-utils';
import type { ReconcileDeps } from '../../libs/server/src/reconcile';

const { report, deps } = vi.hoisted(() => ({
  report: vi.fn(),
  deps: { current: null as ReconcileDeps | null },
}));

vi.mock('../../libs/server/src/auth', () => ({
  AuthError: class extends Error {},
  authenticateUser: vi.fn(),
  supabase: {},
}));

vi.mock('../../libs/server/src/reconcile-providers', () => ({
  reconcileDeps: () => deps.current,
}));

vi.mock('../../libs/server/src/report', () => ({
  report: (...args: unknown[]) => report(...args),
}));

import handler from './[action]';

const SECRET = 'cron-secret-of-sixteen-plus';

function cronRequest(overrides: Parameters<typeof mockRequest>[0] = {}) {
  return mockRequest({
    method: 'GET',
    query: { action: 'reconcile' },
    headers: { authorization: `Bearer ${SECRET}` },
    ...overrides,
  });
}

function quietDeps(overrides: Partial<ReconcileDeps> = {}): ReconcileDeps {
  return {
    rows: vi.fn(async () => []),
    storageBucket: vi.fn(async () => []),
    removeFromBucket: vi.fn(async () => undefined),
    resize: vi.fn(async () => true),
    recount: vi.fn(async () => []),
    ...overrides,
  };
}

const ORPHAN = {
  kind: 'orphan' as const,
  path: '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f/1_left.txt',
  file_id: null,
  recorded: null,
  actual: 32,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.stubEnv('RECONCILE_APPLY', '');
  deps.current = quietDeps();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('who may start the reconciliation', () => {
  it('refuses to run open when the deployment has no CRON_SECRET', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const res = mockResponse();

    await handler(cronRequest(), res);

    expect(res.statusCode).toBe(503);
    expect(deps.current!.storageBucket).not.toHaveBeenCalled();
  });

  it.each([
    ['no header', undefined],
    ['a wrong secret', 'Bearer cron-secret-of-sixteen-plut'],
    ['a shorter one', 'Bearer cron'],
    ['the secret without its scheme', SECRET],
    ['a session token', 'Bearer eyJhbGciOiJIUzI1NiJ9'],
  ])('answers 401 to %s', async (_, authorization) => {
    const res = mockResponse();

    await handler(cronRequest({ headers: authorization ? { authorization } : {} }), res);

    expect(res.statusCode).toBe(401);
    expect(deps.current!.storageBucket).not.toHaveBeenCalled();
  });

  it('answers only GET, which is what Vercel Cron sends', async () => {
    const res = mockResponse();
    await handler(cronRequest({ method: 'POST' }), res);
    expect(res.statusCode).toBe(405);
  });
});

describe('a night', () => {
  it('is a dry run unless RECONCILE_APPLY is true', async () => {
    deps.current = quietDeps({ storageBucket: vi.fn(async () => [ORPHAN]) });
    const res = mockResponse();

    await handler(cronRequest(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ applied: false });
    expect(deps.current.removeFromBucket).not.toHaveBeenCalled();
    expect(deps.current.recount).toHaveBeenCalledWith(false);
  });

  it.each(['1', 'yes', 'TRUE'])('stays a dry run for RECONCILE_APPLY=%s', async (value) => {
    vi.stubEnv('RECONCILE_APPLY', value);
    const res = mockResponse();

    await handler(cronRequest(), res);

    expect(res.body).toMatchObject({ applied: false });
  });

  it('acts with RECONCILE_APPLY=true', async () => {
    vi.stubEnv('RECONCILE_APPLY', 'true');
    deps.current = quietDeps({ storageBucket: vi.fn(async () => [ORPHAN]) });
    const res = mockResponse();

    await handler(cronRequest(), res);

    expect(res.body).toMatchObject({ applied: true });
    expect(deps.current.removeFromBucket).toHaveBeenCalledWith([ORPHAN.path]);
  });

  it('tells the owner what it found, as a warning, in counts', async () => {
    deps.current = quietDeps({ storageBucket: vi.fn(async () => [ORPHAN]) });

    await handler(cronRequest(), mockResponse());

    expect(report).toHaveBeenCalledOnce();
    const [error, context] = report.mock.calls[0]!;
    expect((error as Error).message).toBe(
      'Reconciliation (dry run): supabase_storage: 1 objects with no row (32 bytes), 0 removed'
    );
    expect(context).toEqual({ route: 'account/reconcile', level: 'warning' });
  });

  it('reports a failed provider as an error', async () => {
    deps.current = quietDeps({
      storageBucket: vi.fn(async () => Promise.reject(new Error('function does not exist'))),
    });
    const res = mockResponse();

    await handler(cronRequest(), res);

    expect(res.statusCode).toBe(200);
    expect(report.mock.calls[0]![1]).toMatchObject({ level: 'error' });
  });

  it('reports nothing on a night with nothing to say', async () => {
    const res = mockResponse();
    await handler(cronRequest(), res);
    expect(res.statusCode).toBe(200);
    expect(report).not.toHaveBeenCalled();
  });
});

describe('the actions of the function', () => {
  it.each(['nothing', 'toString', 'constructor'])('answers 404 to %s', async (action) => {
    const res = mockResponse();
    await handler(cronRequest({ query: { action } }), res);
    expect(res.statusCode).toBe(404);
  });
});

describe('the schedule', () => {
  /* From the root, where Vitest runs: `import.meta` is not something the
     functions' tsconfig (npm run typecheck:vercel) allows. */
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    crons?: { path: string; schedule: string }[];
    functions?: Record<string, unknown>;
  };

  it('calls this action', () => {
    expect(vercel.crons).toEqual([
      { path: '/api/account/reconcile', schedule: expect.any(String) },
    ]);
  });

  /* A Hobby project may run a cron job once a day at most; a deployment with
     a more frequent one fails. Five fields: minute and hour fixed, the rest
     every. */
  it('runs once a day, which is what the Hobby plan allows', () => {
    expect(vercel.crons![0]!.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });

  it('gives this function the minute it may need', () => {
    expect(vercel.functions).toHaveProperty(['api/account/*.ts', 'maxDuration'], 60);
  });
});
