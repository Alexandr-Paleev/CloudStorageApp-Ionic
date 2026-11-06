import { describe, it, expect } from 'vitest';
import { isDemoEmail } from './demo-address';

describe('isDemoEmail', () => {
  it.each([
    ['demo-123-abc@example.com', true],
    // The e2e suite creates accounts on the same domain. Deleting one mid-run
    // would fail a test that has nothing to do with the demo.
    ['e2e-123-abc@example.com', false],
    ['someone@example.com', false],
    [undefined, false],
    // A profile with no address.
    [null, false],
    // People. Sign-up is open by e-mail and through Google, and these are
    // addresses their owners can confirm; the sweep erases what matches.
    ['demo-anna@company.com', false],
    ['demo-1700000000000-abc@gmail.com', false],
    ['demo-1700000000000-abc@example.com.evil.io', false],
  ])('%s -> %s', (email, expected) => {
    expect(isDemoEmail(email)).toBe(expected);
  });
});
