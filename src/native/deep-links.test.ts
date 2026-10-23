import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (event: { url: string }) => Promise<void>;

const { listeners, exchangeCodeForSession, setSession, isNativePlatform, close } = vi.hoisted(
  () => ({
    listeners: [] as Listener[],
    exchangeCodeForSession: vi.fn(),
    setSession: vi.fn(),
    isNativePlatform: vi.fn(() => true),
    close: vi.fn(),
  })
);

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (_event: string, listener: Listener) => {
      listeners.push(listener);
      return Promise.resolve({ remove: () => undefined });
    },
  },
}));
vi.mock('@capacitor/browser', () => ({ Browser: { close: () => close() } }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}));
vi.mock('../supabase/supabase.config', () => ({
  supabase: {
    auth: {
      exchangeCodeForSession: (code: string) => exchangeCodeForSession(code),
      setSession: (session: unknown) => setSession(session),
    },
  },
}));

import { NATIVE_AUTH_CALLBACK, initDeepLinks } from './deep-links';

/** The operating system handing the app a link, as iOS and Android do. */
async function open(url: string) {
  for (const listener of listeners) await listener({ url });
}

beforeEach(() => {
  vi.clearAllMocks();
  listeners.length = 0;
  isNativePlatform.mockReturnValue(true);
  exchangeCodeForSession.mockResolvedValue({ error: null });
  close.mockResolvedValue(undefined);
});

describe('the sign-in callback in the native shell', () => {
  it('turns the code it carries into a session, and closes the browser', async () => {
    initDeepLinks();
    await open(`${NATIVE_AUTH_CALLBACK}?code=the-code`);

    expect(exchangeCodeForSession).toHaveBeenCalledWith('the-code');
    expect(close).toHaveBeenCalled();
  });

  /* Any page can link to the scheme. Taken as they came, these would have
     signed the app into the account they belong to. */
  it('takes no session that arrives as tokens, whoever sent them', async () => {
    initDeepLinks();
    await open(`${NATIVE_AUTH_CALLBACK}#access_token=someone-else&refresh_token=theirs`);

    expect(setSession).not.toHaveBeenCalled();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('passes on the refusal of a code this app did not start', async () => {
    exchangeCodeForSession.mockResolvedValue({
      error: new Error('PKCE code verifier not found in storage'),
    });
    initDeepLinks();

    await expect(open(`${NATIVE_AUTH_CALLBACK}?code=not-ours`)).rejects.toThrow('verifier');
  });

  it('leaves every other link alone', async () => {
    initDeepLinks();
    await open('com.cloudstorage.app://elsewhere?code=the-code');
    await open('https://example.com/?code=the-code');

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('listens for nothing in a browser', () => {
    isNativePlatform.mockReturnValue(false);
    initDeepLinks();

    expect(listeners).toHaveLength(0);
  });
});
