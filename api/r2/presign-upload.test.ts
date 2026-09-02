import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockRequest, mockResponse, mockSupabase, type TableAnswer } from '../../lib/test-utils';
import { TIER_LIMITS } from '../../lib/tiers';
import { PRESIGN_IP_LIMIT, PRESIGN_LIMIT, resetRateLimits } from '../../lib/rate-limit';

const MB = 1024 * 1024;
const GB = 1024 * MB;

// vi.mock factories are hoisted above every declaration in this file, so
// anything they close over has to be hoisted with them.
const { FakeAuthError, authenticateUser, db, signedCommands } = vi.hoisted(() => ({
  FakeAuthError: class FakeAuthError extends Error {},
  authenticateUser: vi.fn(),
  /** Reassigned per test; the mock reads through it at call time. */
  db: { client: null as { from: (table: string) => unknown } | null },
  /** The command the handler signs — asserting on it beats parsing a URL. */
  signedCommands: [] as { input: Record<string, unknown> }[],
}));

vi.mock('../../lib/auth', () => ({
  AuthError: FakeAuthError,
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
  supabase: { from: (table: string) => db.client!.from(table) },
}));

vi.mock('../../lib/r2', () => ({
  getS3Client: () => ({}),
  getR2BucketName: () => 'test-bucket',
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (_client: unknown, command: { input: Record<string, unknown> }) => {
    signedCommands.push(command);
    return Promise.resolve('https://r2.example/signed-url');
  },
}));

import handler from './[action]';

/**
 * The seven R2 routes share one function now (see api/r2/[action].ts), so the
 * segment Vercel would have matched has to be supplied by hand. Everything in
 * this file exercises the presign-upload action.
 */
const withAction = (overrides: Record<string, unknown> = {}) =>
  mockRequest({ query: { action: 'presign-upload' }, ...overrides });

function setupTables(profile: TableAnswer, files: TableAnswer) {
  db.client = mockSupabase({ profiles: profile, files }).client;
}

/** A profile on the given tier, with the given bytes already stored. */
function account(limit: number, used: number) {
  // Both numbers come off the profile now: bytes_used is a counter kept by the
  // trigger in migrations/007, not a sum this handler takes for itself.
  setupTables({ data: [{ storage_limit: limit, bytes_used: used }] }, { data: [] });
}

beforeEach(() => {
  vi.clearAllMocks();
  // The limiters are module-scope singletons, so a spent limit would otherwise
  // follow one test into the next.
  resetRateLimits();
  signedCommands.length = 0;
  authenticateUser.mockResolvedValue('user-1');
  account(TIER_LIMITS.free.storage_limit, 0);
});

describe('presign-upload: request validation', () => {
  it('refuses anything but POST', async () => {
    const res = mockResponse();
    await handler(withAction({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('answers 401 when the caller is not authenticated', async () => {
    authenticateUser.mockRejectedValue(new FakeAuthError('Missing authorization token'));
    const res = mockResponse();
    await handler(withAction({ body: { fileName: 'a.pdf', size: 1 } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('requires a file name', async () => {
    const res = mockResponse();
    await handler(withAction({ body: { size: 1 } }), res);
    expect(res.statusCode).toBe(400);
  });

  it.each([
    ['missing', undefined],
    ['a string', '100'],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects a size that is %s', async (_label, size) => {
    const res = mockResponse();
    await handler(withAction({ body: { fileName: 'a.pdf', size } }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('presign-upload: quota enforcement', () => {
  it('signs an upload that fits', async () => {
    account(TIER_LIMITS.free.storage_limit, 100 * MB);
    const res = mockResponse();
    await handler(withAction({ body: { fileName: 'a.pdf', size: 10 * MB } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ uploadUrl: 'https://r2.example/signed-url' });
  });

  it('refuses an upload that would cross the limit', async () => {
    account(TIER_LIMITS.free.storage_limit, 495 * MB);
    const res = mockResponse();
    await handler(withAction({ body: { fileName: 'a.pdf', size: 10 * MB } }), res);

    expect(res.statusCode).toBe(413);
    expect(signedCommands).toHaveLength(0);
  });

  it('counts the incoming file, not just what is already stored', async () => {
    // Exactly at the limit: nothing stored is over quota, but the file is.
    account(100, 100);
    const res = mockResponse();
    await handler(withAction({ body: { fileName: 'a.pdf', size: 1 } }), res);
    expect(res.statusCode).toBe(413);
  });

  it('states the numbers in units a person can read', async () => {
    account(TIER_LIMITS.free.storage_limit, 495 * MB);
    const res = mockResponse();
    await handler(withAction({ body: { fileName: 'a.pdf', size: 10 * MB } }), res);

    const { message } = res.body as { message: string };
    expect(message).toContain('500.0 MB');
    expect(message).not.toMatch(/\d{7,}/); // no raw byte counts
  });

  it('says how far over the limit a downgraded account is', async () => {
    // Cancelling Pro drops the limit to 500 MB with 3 GB already stored.
    account(TIER_LIMITS.free.storage_limit, 3 * GB);
    const res = mockResponse();
    await handler(withAction({ body: { fileName: 'a.pdf', size: 1 } }), res);

    expect(res.statusCode).toBe(413);
    expect((res.body as { message: string }).message).toMatch(/over the limit/);
  });

  it('honours the tier stored on the profile, not a hardcoded free limit', async () => {
    account(TIER_LIMITS.pro.storage_limit, 2 * GB);
    const res = mockResponse();
    await handler(withAction({ body: { fileName: 'big.zip', size: 1 * GB } }), res);

    expect(res.statusCode).toBe(200);
  });

  it('fails loudly when the profile cannot be read', async () => {
    // Falling back to the default here would quietly cap a Pro user at 500 MB
    // and reject a legitimate upload with 413.
    setupTables({ error: { message: 'connection reset' } }, { data: [] });
    const res = mockResponse();
    await handler(withAction({ body: { fileName: 'a.pdf', size: 1 } }), res);

    expect(res.statusCode).toBe(500);
    expect(res.statusCode).not.toBe(413);
  });

  it('names the missing migration rather than leaking a column error', async () => {
    // Deploy order: the code reads a column that arrives with 007. If the two
    // ever land out of order, the log should say which one is missing.
    setupTables({ error: { message: 'column profiles.bytes_used does not exist' } }, { data: [] });
    const res = mockResponse();
    await handler(withAction({ body: { fileName: 'a.pdf', size: 1 } }), res);

    expect(res.statusCode).toBe(500);
    expect((res.body as { message: string }).message).toContain('migrations/007');
  });

  it('treats a profile that does not exist as an empty account, not as no limit', async () => {
    setupTables({ data: [] }, { data: [] });
    const res = mockResponse();
    await handler(
      withAction({ body: { fileName: 'a.pdf', size: TIER_LIMITS.free.storage_limit + 1 } }),
      res
    );

    expect(res.statusCode).toBe(413);
  });
});

describe('presign-upload: the signed URL', () => {
  it('binds the approved size into the signature', async () => {
    // Without ContentLength in the signature the client could upload something
    // far larger than the quota check approved.
    const res = mockResponse();
    await handler(withAction({ body: { fileName: 'a.pdf', size: 42 } }), res);

    expect(res.statusCode).toBe(200);
    expect(signedCommands[0].input).toMatchObject({ ContentLength: 42 });
  });

  it('scopes the key to the caller, whatever name they send', async () => {
    authenticateUser.mockResolvedValue('user-abc');
    const res = mockResponse();
    await handler(withAction({ body: { fileName: '../../escape.pdf', size: 1 } }), res);

    const { key } = res.body as { key: string };
    expect(key.startsWith('users/user-abc/')).toBe(true);
    expect(key).not.toContain('..');
  });

  it('defaults the content type rather than signing an empty one', async () => {
    const res = mockResponse();
    await handler(withAction({ body: { fileName: 'a.bin', size: 1 } }), res);
    expect(signedCommands[0].input).toMatchObject({ ContentType: 'application/octet-stream' });
  });
});

describe('presign-upload: rate limiting', () => {
  const upload = (overrides: Record<string, unknown> = {}) =>
    withAction({ body: { fileName: 'a.pdf', size: 1 }, ...overrides });

  /** A request from a given address, so the per-address limit is isolated. */
  const uploadFrom = (ip: string) =>
    upload({ headers: { authorization: 'Bearer t', 'x-forwarded-for': ip } });

  it('stops signing once the account has asked too often', async () => {
    for (let i = 0; i < PRESIGN_LIMIT; i++) {
      const ok = mockResponse();
      await handler(upload(), ok);
      expect(ok.statusCode).toBe(200);
    }

    const res = mockResponse();
    await handler(upload(), res);

    expect(res.statusCode).toBe(429);
    // The limit is spent, so no further URL was signed.
    expect(signedCommands).toHaveLength(PRESIGN_LIMIT);
  });

  it('says when to try again', async () => {
    for (let i = 0; i <= PRESIGN_LIMIT; i++) {
      await handler(upload(), mockResponse());
    }
    const res = mockResponse();
    await handler(upload(), res);

    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.stringMatching(/^[1-9]\d*$/));
  });

  it('charges the account, not the address it shares with everyone else', async () => {
    for (let i = 0; i < PRESIGN_LIMIT; i++) {
      await handler(upload(), mockResponse());
    }

    authenticateUser.mockResolvedValue('user-2');
    const res = mockResponse();
    await handler(upload(), res);

    expect(res.statusCode).toBe(200);
  });

  it('caps an address before it validates a token', async () => {
    // Validating one costs a round trip to Supabase, so a caller with no valid
    // token must not be able to buy that work by asking repeatedly.
    for (let i = 0; i < PRESIGN_IP_LIMIT; i++) {
      await handler(uploadFrom('203.0.113.9'), mockResponse());
    }

    authenticateUser.mockClear();
    const res = mockResponse();
    await handler(uploadFrom('203.0.113.9'), res);

    expect(res.statusCode).toBe(429);
    expect(authenticateUser).not.toHaveBeenCalled();
  });

  it('does not answer 429 to a method it would refuse anyway', async () => {
    // 405 first: a GET was never going to sign anything, and counting it would
    // let a misconfigured client eat into the limit of a caller who could.
    const res = mockResponse();
    await handler(withAction({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('leaves the quota to the quota', async () => {
    // Being under the rate limit says nothing about having room to store the
    // file; the two refusals are different and answer differently.
    account(TIER_LIMITS.free.storage_limit, TIER_LIMITS.free.storage_limit);
    const res = mockResponse();
    await handler(upload(), res);

    expect(res.statusCode).toBe(413);
  });
});
