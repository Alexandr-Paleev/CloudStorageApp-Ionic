import { describe, expect, it } from 'vitest';
import { withoutQuery, withoutSecrets } from './scrub';

const SIGN_IN = 'https://app.example/dashboard#access_token=aaa.bbb.ccc&refresh_token=rrr';

describe('an address, cut at its ? and its #', () => {
  it.each([
    ['tokens after the #, as a sign-in returns them', SIGN_IN, 'https://app.example/dashboard'],
    [
      'a code after the ?, as an OAuth callback carries it',
      'https://app.example/auth/dropbox/callback?code=ccc&state=sss',
      'https://app.example/auth/dropbox/callback',
    ],
    ['a path with both', '/dashboard?next=1#access_token=aaa', '/dashboard'],
    [
      'an upload address signed in its query string',
      'https://bucket.r2.example/users/u/file.pdf?X-Amz-Signature=sss&X-Amz-Expires=600',
      'https://bucket.r2.example/users/u/file.pdf',
    ],
    [
      'the method and the address Sentry describes a request by',
      'GET https://project.supabase.example/rest/v1/files?select=*&id=eq.1',
      'GET https://project.supabase.example/rest/v1/files',
    ],
    [
      'the address of a native shell',
      'capacitor://localhost/dashboard#access_token=aaa',
      'capacitor://localhost/dashboard',
    ],
  ])('%s', (_what, address, cut) => {
    expect(withoutQuery(address)).toBe(cut);
  });

  it.each([
    ['an address with nothing to cut', 'https://app.example/assets/index-abc123.js'],
    ['a path alone', '/dashboard'],
    ['a sentence that asks something', 'Why did the upload fail?'],
    ['a sentence with a # in it', 'Queued change #3 discarded'],
    ['a file name', 'report?.pdf'],
    ['nothing', ''],
  ])('leaves %s as it is', (_what, text) => {
    expect(withoutQuery(text)).toBe(text);
  });

  /* The limit, said out loud: an address inside a sentence is not found. */
  it('does not find an address inside a sentence', () => {
    const sentence = `Failed to load ${SIGN_IN}`;

    expect(withoutQuery(sentence)).toBe(sentence);
  });
});

/* The shape of an event this app really sent, trimmed, with a sign-in's
   tokens standing in the address when it was made. Every one of these fields
   carried them. */
function eventAtASignIn() {
  return {
    type: 'transaction',
    transaction: '/dashboard',
    request: {
      url: SIGN_IN,
      headers: { Referer: 'https://accounts.google.example/o/oauth2/auth?client_id=abc' },
      query_string: 'next=1',
    },
    contexts: {
      trace: {
        op: 'navigation',
        data: {
          'url.full': SIGN_IN,
          'url.path': '/dashboard',
          'url.fragment': '#access_token=aaa',
        },
      },
    },
    spans: [
      { op: 'ui.long-task', description: SIGN_IN, data: {} },
      {
        op: 'http.client',
        description: 'PUT https://bucket.r2.example/users/u/file.pdf?X-Amz-Signature=sss',
        data: {
          'url.full': 'https://bucket.r2.example/users/u/file.pdf?X-Amz-Signature=sss',
          'http.query': '?X-Amz-Signature=sss',
          'http.fragment': '',
          'server.address': 'bucket.r2.example',
        },
      },
    ],
    breadcrumbs: [
      {
        category: 'navigation',
        data: { from: '/dashboard#access_token=aaa.bbb.ccc', to: '/login' },
      },
      {
        category: 'fetch',
        data: { url: '/api/share?id=link-1', method: 'DELETE', status_code: 200 },
      },
    ],
    exception: {
      values: [
        {
          type: 'Error',
          value: 'Queued change discarded: quota exceeded',
          stacktrace: {
            frames: [{ filename: 'https://app.example/assets/index-abc123.js', lineno: 1 }],
          },
        },
      ],
    },
    tags: { context: 'offlineQueue.flush' },
    extra: { address: 'https://files.example/a.pdf?token=ttt' },
  };
}

describe('a Sentry event, before it is sent', () => {
  it('carries no token, no code and no signature anywhere in it', () => {
    const sent = JSON.stringify(withoutSecrets(eventAtASignIn()));

    for (const secret of ['aaa', 'rrr', 'sss', 'ttt', 'client_id', 'next=1', 'id=link-1']) {
      expect(sent).not.toContain(secret);
    }
  });

  it('keeps where things happened, and everything that is not an address', () => {
    const event = withoutSecrets(eventAtASignIn());

    expect(event.request.url).toBe('https://app.example/dashboard');
    expect(event.contexts.trace.data['url.full']).toBe('https://app.example/dashboard');
    expect(event.contexts.trace.data['url.path']).toBe('/dashboard');
    expect(event.spans[1]?.description).toBe('PUT https://bucket.r2.example/users/u/file.pdf');
    expect(event.spans[1]?.data['server.address']).toBe('bucket.r2.example');
    expect(event.breadcrumbs[0]?.data).toEqual({ from: '/dashboard', to: '/login' });
    expect(event.breadcrumbs[1]?.data).toEqual({
      url: '/api/share',
      method: 'DELETE',
      status_code: 200,
    });
    expect(event.exception.values[0]?.value).toBe('Queued change discarded: quota exceeded');
    expect(event.exception.values[0]?.stacktrace.frames[0]?.filename).toBe(
      'https://app.example/assets/index-abc123.js'
    );
    expect(event.tags).toEqual({ context: 'offlineQueue.flush' });
  });

  it('drops the fields that hold a query string or a fragment by themselves', () => {
    const event = withoutSecrets(eventAtASignIn());

    expect(event.request).not.toHaveProperty('query_string');
    expect(event.contexts.trace.data).not.toHaveProperty('url.fragment');
    expect(event.spans[1]?.data).not.toHaveProperty('http.query');
    expect(event.spans[1]?.data).not.toHaveProperty('http.fragment');
  });

  /* An event is not all data. What is not a plain object is not edited, and
     an event that points back at itself is still walked to the end. */
  it('leaves alone what is not plain data, and survives an event that contains itself', () => {
    class Scope {
      address = SIGN_IN;
    }
    const scope = new Scope();
    const event: Record<string, unknown> = { request: { url: SIGN_IN }, scope };
    event.self = event;

    expect(() => withoutSecrets(event)).not.toThrow();
    expect((event.request as { url: string }).url).toBe('https://app.example/dashboard');
    expect(scope.address).toBe(SIGN_IN);
  });

  it('hands back the event it was given, which is what Sentry sends', () => {
    const event = eventAtASignIn();

    expect(withoutSecrets(event)).toBe(event);
  });
});
