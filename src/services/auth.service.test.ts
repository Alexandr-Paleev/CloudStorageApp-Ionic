import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authService } from './auth.service';
import { NATIVE_AUTH_CALLBACK } from '../native/deep-links';

const signUp = vi.fn();
const signInWithPassword = vi.fn();
const signOut = vi.fn();
const getUser = vi.fn();
const onAuthStateChange = vi.fn();
const signInWithOAuth = vi.fn();

vi.mock('../supabase/supabase.config', () => ({
  supabase: {
    auth: {
      signUp: (...a: unknown[]) => signUp(...a),
      signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
      signOut: () => signOut(),
      getUser: () => getUser(),
      onAuthStateChange: (...a: unknown[]) => onAuthStateChange(...a),
      signInWithOAuth: (...a: unknown[]) => signInWithOAuth(...a),
    },
  },
}));

const isNativePlatform = vi.fn();
const browserOpen = vi.fn();

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => isNativePlatform() } }));
vi.mock('@capacitor/browser', () => ({
  Browser: { open: (...a: unknown[]) => browserOpen(...a) },
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn() } }));

const USER = { id: 'user-1', email: 'a@example.com' };

beforeEach(() => {
  vi.clearAllMocks();
  isNativePlatform.mockReturnValue(false);
  signUp.mockResolvedValue({ data: { user: USER }, error: null });
  signInWithPassword.mockResolvedValue({ data: { user: USER }, error: null });
  signOut.mockResolvedValue({ error: null });
  getUser.mockResolvedValue({ data: { user: USER } });
  signInWithOAuth.mockResolvedValue({ data: { url: 'https://accounts.google.com/o/oauth2/v2' } });
});

describe('email and password', () => {
  it('returns the user on success', async () => {
    await expect(authService.register('a@example.com', 'hunter2')).resolves.toEqual(USER);
    await expect(authService.login('a@example.com', 'hunter2')).resolves.toEqual(USER);
  });

  it('throws what Supabase said rather than a generic failure', async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    });

    await expect(authService.login('a@example.com', 'wrong')).rejects.toMatchObject({
      message: 'Invalid login credentials',
    });
  });

  /* A success with no user is not a success. Returning it would hand the rest
     of the app a null it does not expect and sign nobody in silently. */
  it('refuses a response that carries no user', async () => {
    signUp.mockResolvedValue({ data: { user: null }, error: null });
    await expect(authService.register('a@example.com', 'x')).rejects.toThrow('Registration failed');

    signInWithPassword.mockResolvedValue({ data: { user: null }, error: null });
    await expect(authService.login('a@example.com', 'x')).rejects.toThrow('Login failed');
  });

  it('throws when signing out fails, so the interface does not claim it worked', async () => {
    signOut.mockResolvedValue({ error: { message: 'network' } });
    await expect(authService.logout()).rejects.toMatchObject({ message: 'network' });
  });

  it('reports nobody signed in as null', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(authService.getCurrentUser()).resolves.toBeNull();
  });
});

describe('watching the session', () => {
  it('hands the callback the user, and unsubscribes when released', () => {
    const unsubscribe = vi.fn();
    let emit: (event: string, session: unknown) => void = () => undefined;
    onAuthStateChange.mockImplementation((cb: typeof emit) => {
      emit = cb;
      return { data: { subscription: { unsubscribe } } };
    });

    const seen: unknown[] = [];
    const release = authService.onAuthStateChanged((u) => seen.push(u));

    emit('SIGNED_IN', { user: USER });
    emit('SIGNED_OUT', null);
    expect(seen).toEqual([USER, null]);

    release();
    expect(unsubscribe).toHaveBeenCalled();
  });
});

/**
 * Where Google is asked to come back to.
 *
 * This is the one that was actually broken in production for both shells. The
 * page has no origin worth naming inside a Capacitor WebView — it is served
 * from `capacitor://localhost`, which Google will not accept as a redirect
 * target — so the shell asks for a custom scheme and opens the sign-in page in
 * the system browser, because letting the WebView navigate to Google replaces
 * the app with a page it cannot come back from.
 */
describe('signing in with Google', () => {
  const optionsUsed = () =>
    (signInWithOAuth.mock.calls[0]![0] as { options: Record<string, unknown> }).options;

  it('comes back to a page in the browser', async () => {
    await authService.signInWithGoogle();

    expect(optionsUsed().redirectTo).toBe(window.location.origin + '/dashboard');
    expect(optionsUsed().skipBrowserRedirect).toBe(false);
    // Supabase navigates in place here; opening a second browser would leave
    // the user with two tabs and a session in the wrong one.
    expect(browserOpen).not.toHaveBeenCalled();
  });

  it('comes back to the deep link in the shell, and opens the system browser', async () => {
    isNativePlatform.mockReturnValue(true);

    await authService.signInWithGoogle();

    expect(optionsUsed().redirectTo).toBe(NATIVE_AUTH_CALLBACK);
    expect(optionsUsed().skipBrowserRedirect).toBe(true);
    expect(browserOpen).toHaveBeenCalledWith({
      url: 'https://accounts.google.com/o/oauth2/v2',
    });
  });

  /* The property behind the address, not the address itself: an http(s) value
     here would be one the shell cannot receive, and this is exactly the class
     of mistake that had Google sign-in failing on both platforms. */
  it('uses a custom scheme in the shell, never a URL', () => {
    expect(NATIVE_AUTH_CALLBACK.startsWith('http')).toBe(false);
    expect(NATIVE_AUTH_CALLBACK).toMatch(/^[a-z][a-z0-9.+-]*:\/\//i);
  });

  it('asks for the Drive scope, since uploads go there for connected accounts', async () => {
    await authService.signInWithGoogle();
    expect(optionsUsed().scopes).toContain('drive.file');
  });

  it('does not try to open a browser when Supabase returned no URL', async () => {
    isNativePlatform.mockReturnValue(true);
    signInWithOAuth.mockResolvedValue({ data: { url: null } });

    await authService.signInWithGoogle();
    expect(browserOpen).not.toHaveBeenCalled();
  });

  it('throws what Supabase said', async () => {
    signInWithOAuth.mockResolvedValue({ data: null, error: { message: 'provider disabled' } });
    await expect(authService.signInWithGoogle()).rejects.toMatchObject({
      message: 'provider disabled',
    });
  });
});
