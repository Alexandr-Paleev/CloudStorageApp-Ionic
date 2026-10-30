import { describe, it, expect } from 'vitest';
import { NEW_PASSWORD_PATH, misplacedResetLink } from './password-reset.utils';

/** The fragment Supabase's verify endpoint sends a reset link back with. */
const RESET =
  '#access_token=at&expires_at=1&expires_in=3600&refresh_token=rt&token_type=bearer&type=recovery';

describe('misplacedResetLink', () => {
  it('moves a reset link that landed on the root to the new-password page, fragment and all', () => {
    expect(misplacedResetLink('/', RESET)).toBe(`${NEW_PASSWORD_PATH}${RESET}`);
  });

  it('moves one that landed anywhere else as well', () => {
    expect(misplacedResetLink('/dashboard', RESET)).toBe(`${NEW_PASSWORD_PATH}${RESET}`);
  });

  it('leaves one that is already where it belongs', () => {
    expect(misplacedResetLink(NEW_PASSWORD_PATH, RESET)).toBeNull();
  });

  /* A Google sign-in and a confirmed sign-up come back with a session in the
     fragment too, and belong where they landed. */
  it('leaves every other fragment alone', () => {
    expect(misplacedResetLink('/dashboard', '#access_token=at&type=signup')).toBeNull();
    expect(misplacedResetLink('/dashboard', '#access_token=at&provider_token=pt')).toBeNull();
    expect(misplacedResetLink('/', '')).toBeNull();
  });

  /* What Supabase sends back for a link that has run out: nothing to sign in
     with, so nothing the new-password page could finish. */
  it('leaves an expired link alone', () => {
    expect(
      misplacedResetLink('/', '#error=access_denied&error_code=otp_expired&type=recovery')
    ).toBeNull();
  });
});
