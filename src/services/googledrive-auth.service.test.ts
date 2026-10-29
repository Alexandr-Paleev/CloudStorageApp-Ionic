import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { getSession, captureMessage } = vi.hoisted(() => ({
  getSession: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock('../supabase/supabase.config', () => ({
  supabase: { auth: { getSession: () => getSession() } },
}));

vi.mock('../observability/sentry', () => ({ captureMessage }));

type Config = {
  callback: (response: { access_token: string; expires_in?: number; error?: string }) => void;
  error_callback: (error: { type?: string }) => void;
};

let config: Config;
const requestAccessToken = vi.fn();

/** Signed in as `userId`, with a Google token on the session or without. */
function signedIn(userId: string | null, providerToken?: string) {
  getSession.mockResolvedValue({
    data: {
      session: userId ? { user: { id: userId }, provider_token: providerToken ?? null } : null,
    },
  });
}

function stored(record: { token: string; userId: string; expiresAt: number }) {
  localStorage.setItem('gdrive_token', JSON.stringify(record));
}

/* A fresh module per test: the Google client it builds is kept between calls,
   and one test's client must not answer the next one's request. jsdom fetches
   no scripts, so loading Google's is answered here. */
async function service(load: 'loads' | 'fails' = 'loads') {
  vi.resetModules();
  vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
    const script = node as HTMLScriptElement;
    queueMicrotask(() =>
      load === 'loads' ? script.onload?.(new Event('load')) : script.onerror?.(new Event('error'))
    );
    return node;
  });
  return (await import('./googledrive-auth.service')).default;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  signedIn('user-1');
  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: (given: unknown) => {
          config = given as Config;
          return { requestAccessToken };
        },
        revoke: vi.fn(),
      },
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('which token Drive is used with', () => {
  it('takes the one signing in with Google came with, first', async () => {
    signedIn('user-1', 'ya29.session');
    stored({ token: 'ya29.stored', userId: 'user-1', expiresAt: Date.now() + 60_000 });

    expect(await (await service()).getAccessToken()).toBe('ya29.session');
  });

  it('takes the stored one for the account that connected it, while it lives', async () => {
    stored({ token: 'ya29.stored', userId: 'user-1', expiresAt: Date.now() + 60_000 });

    expect(await (await service()).getAccessToken()).toBe('ya29.stored');
  });

  /* The shared browser: the next account to sign in was handed the previous
     one's token, and uploaded into the previous one's Drive. */
  it("refuses another account's token, and drops it", async () => {
    stored({ token: 'ya29.theirs', userId: 'user-1', expiresAt: Date.now() + 60_000 });
    signedIn('user-2');
    const drive = await service();

    expect(await drive.getAccessToken()).toBeNull();
    expect(await drive.isAuthorized()).toBe(false);
    expect(localStorage.getItem('gdrive_token')).toBeNull();
  });

  /* Kept past its hour, it made Drive look connected while Google refused
     every upload. */
  it('refuses a token past its end, and drops it', async () => {
    stored({ token: 'ya29.old', userId: 'user-1', expiresAt: Date.now() - 1 });
    const drive = await service();

    expect(await drive.isAuthorized()).toBe(false);
    expect(localStorage.getItem('gdrive_token')).toBeNull();
  });

  it('has nothing for nobody', async () => {
    stored({ token: 'ya29.stored', userId: 'user-1', expiresAt: Date.now() + 60_000 });
    signedIn(null);

    expect(await (await service()).getAccessToken()).toBeNull();
  });
});

describe('connecting Drive', () => {
  it('keeps the token with its owner and its end', async () => {
    const drive = await service();
    const connecting = drive.authorize();
    await vi.waitFor(() => expect(requestAccessToken).toHaveBeenCalled());

    config.callback({ access_token: 'ya29.new', expires_in: 3599 });

    await expect(connecting).resolves.toBe('ya29.new');
    const record = JSON.parse(localStorage.getItem('gdrive_token')!);
    expect(record).toMatchObject({ token: 'ya29.new', userId: 'user-1' });
    expect(record.expiresAt).toBeGreaterThan(Date.now() + 3_400_000);
    expect(record.expiresAt).toBeLessThan(Date.now() + 3_600_000);
  });

  /* 'consent' showed the whole consent screen on every reconnection. */
  it('asks Google to show its consent screen only when it has to', async () => {
    const drive = await service();
    void drive.authorize();
    await vi.waitFor(() => expect(requestAccessToken).toHaveBeenCalledWith({ prompt: '' }));
  });

  /* Closing Google's window used to leave the request waiting for good. */
  it('gives up when the window is closed', async () => {
    const drive = await service();
    const connecting = drive.authorize();
    await vi.waitFor(() => expect(requestAccessToken).toHaveBeenCalled());

    config.error_callback({ type: 'popup_closed' });

    await expect(connecting).rejects.toThrow('Google Drive was not connected');
    expect(localStorage.getItem('gdrive_token')).toBeNull();
  });

  it('says so when a pop-up blocker kept the window from opening', async () => {
    const drive = await service();
    const connecting = drive.authorize();
    await vi.waitFor(() => expect(requestAccessToken).toHaveBeenCalled());

    config.error_callback({ type: 'popup_failed_to_open' });

    await expect(connecting).rejects.toThrow(/Allow pop-ups/);
  });

  it('takes no for an answer without reporting it', async () => {
    const drive = await service();
    const connecting = drive.authorize();
    await vi.waitFor(() => expect(requestAccessToken).toHaveBeenCalled());

    config.callback({ access_token: '', error: 'access_denied' });

    await expect(connecting).rejects.toThrow('Google Drive was not connected');
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('refuses to connect for nobody', async () => {
    signedIn(null);
    await expect((await service()).authorize()).rejects.toThrow(/Sign in/);
    expect(requestAccessToken).not.toHaveBeenCalled();
  });

  /* An extension or no network kept Google's script from loading, and the
     Connect button waited on it for good. */
  it('fails when Google sign-in cannot be loaded', async () => {
    await expect((await service('fails')).authorize()).rejects.toThrow(
      'Google sign-in could not be loaded'
    );
  });
});
