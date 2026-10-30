import { describe, it, expect, beforeEach, vi } from 'vitest';
import { APP_ORIGIN } from '@cloud-storage/core/origins';
import { passwordResetService } from './password-reset.service';

const { resetPasswordForEmail, updateUser, isNativePlatform } = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  isNativePlatform: vi.fn(),
}));

vi.mock('../supabase/supabase.config', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: (...a: unknown[]) => resetPasswordForEmail(...a),
      updateUser: (...a: unknown[]) => updateUser(...a),
    },
  },
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => isNativePlatform() } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  isNativePlatform.mockReturnValue(false);
  resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  updateUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
});

describe('asking for a link', () => {
  it('asks for one that comes back to the new-password page of this origin', async () => {
    await passwordResetService.requestLink('a@example.com');

    expect(resetPasswordForEmail).toHaveBeenCalledWith('a@example.com', {
      redirectTo: window.location.origin + '/new-password',
    });
  });

  it('throws what Supabase said, a rate limit among it', async () => {
    resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { message: 'For security purposes, you can only request this after 42 seconds.' },
    });

    await expect(passwordResetService.requestLink('a@example.com')).rejects.toMatchObject({
      message: 'For security purposes, you can only request this after 42 seconds.',
    });
  });

  /* The shell's client asks for PKCE, and a PKCE link becomes a session only
     beside the verifier the app kept, while the link opens in a browser. */
  it('asks from the shell without PKCE, for a link the web app can finish', async () => {
    isNativePlatform.mockReturnValue(true);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    await passwordResetService.requestLink('a@example.com');

    expect(resetPasswordForEmail).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    const asked = new URL(url);
    expect(`${asked.origin}${asked.pathname}`).toBe('https://project.supabase.co/auth/v1/recover');
    expect(asked.searchParams.get('redirect_to')).toBe(`${APP_ORIGIN}/new-password`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).apikey).toBe('test-anon-key');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@example.com' });
  });

  it("throws the auth server's words when the shell is refused", async () => {
    isNativePlatform.mockReturnValue(true);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          code: 429,
          error_code: 'over_email_send_rate_limit',
          msg: 'email rate limit exceeded',
        }),
      })
    );

    await expect(passwordResetService.requestLink('a@example.com')).rejects.toThrow(
      'email rate limit exceeded'
    );
  });
});

describe('setting the new password', () => {
  it('sets it on the session the link brought', async () => {
    await passwordResetService.setNewPassword('a new one');
    expect(updateUser).toHaveBeenCalledWith({ password: 'a new one' });
  });

  it('throws what Supabase said about it', async () => {
    updateUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'New password should be different from the old password.' },
    });

    await expect(passwordResetService.setNewPassword('the old one')).rejects.toMatchObject({
      message: 'New password should be different from the old password.',
    });
  });
});
