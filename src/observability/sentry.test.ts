import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrorEvent } from '@sentry/core';
import { failedQuery, refused } from '../test/postgrest';

const sent = vi.hoisted((): ErrorEvent[] => []);

vi.mock('../env', () => ({ env: { VITE_SENTRY_DSN: 'https://public@o0.ingest.sentry.io/0' } }));

/* The real Sentry, keeping here what it would send. The facade's own init
   runs, scrub.ts with it; what is replaced is the last step, the request, and
   the integrations a browser page installs are left out. */
vi.mock('./sentry-client', async (importOriginal) => {
  const real = await importOriginal<typeof import('./sentry-client')>();
  return {
    ...real,
    init: (options: Parameters<typeof real.init>[0] = {}) =>
      real.init({
        ...options,
        defaultIntegrations: false,
        integrations: [],
        sendClientReports: false,
        transport: () => ({ send: async () => ({}), flush: async () => true }),
        beforeSend: (event, hint) => {
          const kept = options.beforeSend ? options.beforeSend(event, hint) : event;
          if (kept) sent.push(kept as ErrorEvent);
          return null;
        },
      }),
  };
});

import { captureException } from './sentry';
import * as client from './sentry-client';

const RLS = 'new row violates row-level security policy for table "files"';
const TIMEOUT = 'canceling statement due to statement timeout';

const exceptionOf = (event: ErrorEvent | undefined) => event?.exception?.values?.[0];

beforeAll(async () => {
  // The facade fetches Sentry on first use; this is that use.
  captureException(new Error('loaded'));
  await vi.waitFor(() => expect(sent).toHaveLength(1));
});

beforeEach(() => {
  sent.length = 0;
});

describe('a failed query', () => {
  it('had, as it came, the title every failed query had', async () => {
    client.captureException(await failedQuery(refused('42501', RLS, 403)));

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(exceptionOf(sent[0])?.value).toBe(
      'Object captured as exception with keys: code, details, hint, message'
    );
  });

  it("is titled by what the database said, with its code and the call site's context", async () => {
    const error = await failedQuery(refused('42501', RLS, 403));

    captureException(error, {
      tags: { context: 'storage.uploadFile' },
      extra: { userId: 'user-1' },
    });

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const [event] = sent;
    expect(exceptionOf(event)).toMatchObject({ type: 'PostgrestError', value: RLS });
    expect(event!.tags).toEqual({ context: 'storage.uploadFile', 'postgrest.code': '42501' });
    expect(event!.extra).toEqual({ userId: 'user-1' });
    expect(event!.contexts?.postgrest).toEqual({ code: '42501', details: null, hint: null });
  });

  it('makes two kinds of failure in one place two issues', async () => {
    captureException(await failedQuery(refused('42501', RLS, 403)), {
      tags: { context: 'supabase.getFiles' },
    });
    captureException(await failedQuery(refused('57014', TIMEOUT, 500)), {
      tags: { context: 'supabase.getFiles' },
    });

    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent.map((event) => event.fingerprint)).toEqual([
      ['{{ default }}', '42501'],
      ['{{ default }}', '57014'],
    ]);
  });

  it('is named when no answer came, and that has no code', async () => {
    captureException(await failedQuery(() => Promise.reject(new TypeError('Failed to fetch'))));

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(exceptionOf(sent[0])).toMatchObject({
      type: 'PostgrestError',
      value: 'TypeError: Failed to fetch',
    });
    expect(sent[0]!.fingerprint).toEqual(['{{ default }}', 'no code']);
  });

  it('is sent once when it is reported twice, as before', async () => {
    // A service reports a failed query and throws it; the offline queue
    // reports what reaches it again.
    const error = await failedQuery(refused('42501', RLS, 403));

    captureException(error, { tags: { context: 'supabase.createFolder' } });
    captureException(error, { tags: { context: 'offlineQueue.flush' } });

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.tags).toMatchObject({ context: 'supabase.createFolder' });
  });
});

describe('anything else', () => {
  it('is passed on as it was', async () => {
    captureException(Object.assign(new Error('Storage limit exceeded'), { code: 'PT413' }), {
      tags: { context: 'storage.uploadFile' },
    });
    captureException({ message: '<html><body>502 Bad Gateway</body></html>' });

    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(exceptionOf(sent[0])).toMatchObject({ type: 'Error', value: 'Storage limit exceeded' });
    expect(sent[0]!.tags).toEqual({ context: 'storage.uploadFile' });
    expect(exceptionOf(sent[1])?.value).toBe('Object captured as exception with keys: message');
  });

  it('keeps a context given as a function as it is', async () => {
    captureException(await failedQuery(refused('42501', RLS, 403)), (scope) =>
      scope.setTag('context', 'given as a function')
    );

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(exceptionOf(sent[0])?.type).toBe('PostgrestError');
    expect(sent[0]!.tags).toEqual({ context: 'given as a function' });
  });
});
