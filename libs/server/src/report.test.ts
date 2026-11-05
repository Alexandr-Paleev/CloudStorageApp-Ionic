import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseDsn, report, scrubbed } from './report';

const DSN = 'https://public-key@o123.ingest.sentry.io/4567';
const OWNER = '5304486a-3709-4b58-8f68-d7872b34953f';

const fetchMock = vi.fn();

interface SentEvent {
  event_id: string;
  exception: { values: { type: string; value: string }[] };
  [field: string]: unknown;
}

/** The three lines of the envelope the last report sent, parsed. */
function sent(): { header: Record<string, unknown>; item: unknown; event: SentEvent } {
  const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  const [header, item, event] = String(init.body)
    .split('\n')
    .map((line) => JSON.parse(line));
  return { header, item, event };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubEnv('SENTRY_DSN', DSN);
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123');
  // Reports stay quiet under Vitest, so that no other test sends one.
  vi.stubEnv('VITEST', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('parseDsn', () => {
  it('reads the envelope endpoint and the key out of a DSN', () => {
    expect(parseDsn(DSN)).toEqual({
      endpoint: 'https://o123.ingest.sentry.io/api/4567/envelope/',
      publicKey: 'public-key',
      dsn: DSN,
    });
  });

  it('keeps the path a self-hosted Sentry is served under', () => {
    expect(parseDsn('https://k@sentry.example.com/errors/42')?.endpoint).toBe(
      'https://sentry.example.com/errors/api/42/envelope/'
    );
  });

  it.each([undefined, '', 'not a url', 'https://o123.ingest.sentry.io/4567'])(
    'finds nothing to send to in %j',
    (dsn) => {
      expect(parseDsn(dsn)).toBeNull();
    }
  );
});

describe('scrubbed', () => {
  /* Decision 0015: a signed URL keeps its token in the query string, and a
     stored path names the file after the owner's id. */
  it('cuts an address at its query string and fragment', () => {
    expect(
      scrubbed('Reading https://p.supabase.co/storage/v1/object/sign/x?token=SECRET#y answered 404')
    ).toBe('Reading https://p.supabase.co/storage/v1/object/sign/x answered 404');
  });

  it("cuts a stored file's name after the owner's id, spaces and all", () => {
    expect(scrubbed(`missing users/${OWNER}/tax return 2025.pdf: not found`)).toBe(
      `missing users/${OWNER}/…`
    );
    expect(scrubbed(`missing ${OWNER}/1700000000_passport.jpg`)).toBe(`missing ${OWNER}/…`);
    expect(scrubbed(`Object "users/${OWNER}/a b.pdf" not found`)).toBe(
      `Object "users/${OWNER}/…" not found`
    );
  });

  it('leaves a sentence with neither alone', () => {
    expect(scrubbed('Stripe did not answer')).toBe('Stripe did not answer');
  });
});

describe('report', () => {
  it('sends one envelope to the project, authenticated with the public key', async () => {
    await report(new Error('Webhook handler failed'), { route: 'stripe/webhook' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://o123.ingest.sentry.io/api/4567/envelope/');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Sentry-Auth']).toContain(
      'sentry_key=public-key'
    );
    const { header, item, event } = sent();
    expect(header).toMatchObject({ dsn: DSN, event_id: event.event_id });
    expect(item).toEqual({ type: 'event' });
  });

  it('says where it happened, in which release and deployment', async () => {
    await report(new Error('boom'), { route: 'ai/index', userId: 'user-1', level: 'warning' });

    expect(sent().event).toMatchObject({
      platform: 'node',
      level: 'warning',
      environment: 'production',
      release: 'abc123',
      transaction: 'ai/index',
      tags: { route: 'ai/index' },
      user: { id: 'user-1' },
      exception: { values: [{ type: 'Error', value: 'boom' }] },
    });
  });

  it('sends what decision 0015 allows of the message and the stack', async () => {
    const error = new Error(`Could not sign ${OWNER}/1700000000_passport.jpg?token=SECRET`);
    await report(error, { route: 'share' });

    const body = String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body);
    expect(body).not.toContain('passport');
    expect(body).not.toContain('SECRET');
  });

  it('reads the message of a failure that is not an Error', async () => {
    await report(
      { code: '08006', details: null, hint: null, message: 'connection reset' },
      {
        route: 'account/delete',
      }
    );

    expect(sent().event.exception.values[0]).toEqual({ type: 'Error', value: 'connection reset' });
  });

  it('sends nothing where no DSN is configured', async () => {
    vi.stubEnv('SENTRY_DSN', '');
    vi.stubEnv('VITE_SENTRY_DSN', '');

    await report(new Error('boom'), { route: 'share' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the browser's DSN, which is the same project", async () => {
    vi.stubEnv('SENTRY_DSN', '');
    vi.stubEnv('VITE_SENTRY_DSN', DSN);

    await report(new Error('boom'), { route: 'share' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends nothing from a test run, whatever the .env holds', async () => {
    vi.stubEnv('VITEST', 'true');

    await report(new Error('boom'), { route: 'share' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  /* A report that cannot be sent must not become the failure the caller
     answers with. */
  it('never throws, even when Sentry cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(report(new Error('boom'), { route: 'share' })).resolves.toBeUndefined();
  });
});
