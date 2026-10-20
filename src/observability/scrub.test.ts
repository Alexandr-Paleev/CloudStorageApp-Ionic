import { describe, expect, it } from 'vitest';
import { withoutName, withoutQuery, withoutSecrets } from './scrub';

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

/* An owner's id as Supabase writes one, and the time an upload is named by. */
const OWNER = '7d0b3e8a-2c4f-4b1e-9a6d-0f5e2c1b3a49';
const UPLOADED = '1760950000000';

describe('a stored file, without its name', () => {
  it.each([
    [
      'an upload to Supabase Storage, as Sentry describes the request',
      `POST https://project.supabase.example/storage/v1/object/files/${OWNER}/${UPLOADED}_payslip-march.pdf`,
      `POST https://project.supabase.example/storage/v1/object/files/${OWNER}/${UPLOADED}_[name]`,
    ],
    [
      'the signing of one, which the page asks for to show it',
      `https://project.supabase.example/storage/v1/object/sign/files/${OWNER}/${UPLOADED}_payslip-march.pdf`,
      `https://project.supabase.example/storage/v1/object/sign/files/${OWNER}/${UPLOADED}_[name]`,
    ],
    [
      'an upload to R2, its name escaped as an address escapes it',
      `https://account.r2.example/files/users/${OWNER}/${UPLOADED}_payslip%20march%20(1).pdf`,
      `https://account.r2.example/files/users/${OWNER}/${UPLOADED}_[name]`,
    ],
    [
      'an R2 key by itself, as an error report holds it',
      `users/${OWNER}/${UPLOADED}_payslip march (1).pdf`,
      `users/${OWNER}/${UPLOADED}_[name]`,
    ],
    [
      'a Supabase Storage path by itself',
      `${OWNER}/${UPLOADED}_payslip-march.pdf`,
      `${OWNER}/${UPLOADED}_[name]`,
    ],
    [
      'a path that does not start with the time',
      `${OWNER}/payslip-march.pdf_${UPLOADED}`,
      `${OWNER}/[name]`,
    ],
    [
      'a Cloudinary picture, whose id is Cloudinary’s own and goes as well',
      `https://res.cloudinary.example/demo/image/upload/v1767872018/users/${OWNER}/k3j9x2`,
      `https://res.cloudinary.example/demo/image/upload/v1767872018/users/${OWNER}/[name]`,
    ],
  ])('%s', (_what, text, cut) => {
    expect(withoutName(text)).toBe(cut);
  });

  it.each([
    ['a page of the app that ends at an id', `/file/${OWNER}`],
    ['a folder on the dashboard', `https://app.example/dashboard/${OWNER}`],
    ['the folder of an owner with nothing after it', `users/${OWNER}/`],
    ['an id that is not a segment of its own', `https://app.example/x${OWNER}/a`],
    ['an address with no owner in it', 'https://app.example/assets/index-abc123.js'],
  ])('leaves %s as it is', (_what, text) => {
    expect(withoutName(text)).toBe(text);
  });

  /* The same limit as for an address, said out loud. */
  it('does not find a path inside a sentence', () => {
    const sentence = `Could not delete users/${OWNER}/${UPLOADED}_payslip-march.pdf`;

    expect(withoutName(sentence)).toBe(sentence);
  });
});

/* An upload that failed after its bytes had gone, and whose object could not
   be removed: the breadcrumbs of the two requests, the trace of the second,
   and what storage.service.ts reports about the object left behind. */
function eventOfAnUpload() {
  const signed = `https://account.r2.example/files/users/${OWNER}/${UPLOADED}_payslip%20march.pdf?X-Amz-Signature=sss`;
  return {
    breadcrumbs: [
      {
        category: 'fetch',
        data: {
          method: 'POST',
          url: `https://project.supabase.example/storage/v1/object/sign/files/${OWNER}/${UPLOADED}_payslip-march.pdf`,
          status_code: 200,
        },
      },
      { category: 'xhr', data: { method: 'PUT', url: signed, status_code: 0 } },
    ],
    spans: [
      {
        op: 'http.client',
        description: `PUT ${signed}`,
        data: { 'url.full': signed, 'server.address': 'account.r2.example' },
      },
    ],
    exception: { values: [{ type: 'Error', value: 'R2 unreachable' }] },
    tags: { context: 'storage.uploadFile.cleanup' },
    extra: { path: `users/${OWNER}/${UPLOADED}_payslip march.pdf`, userId: OWNER },
  };
}

describe('a Sentry event about an upload, before it is sent', () => {
  it('carries no name of the file anywhere in it', () => {
    const sent = JSON.stringify(withoutSecrets(eventOfAnUpload()));

    expect(sent).not.toContain('payslip');
    expect(sent).not.toContain('sss');
  });

  it('still says which object it was: whose, and when it was uploaded', () => {
    const event = withoutSecrets(eventOfAnUpload());

    expect(event.extra).toEqual({ path: `users/${OWNER}/${UPLOADED}_[name]`, userId: OWNER });
    expect(event.breadcrumbs[1]?.data.url).toBe(
      `https://account.r2.example/files/users/${OWNER}/${UPLOADED}_[name]`
    );
    expect(event.spans[0]?.description).toBe(
      `PUT https://account.r2.example/files/users/${OWNER}/${UPLOADED}_[name]`
    );
    expect(event.exception.values[0]?.value).toBe('R2 unreachable');
  });
});
