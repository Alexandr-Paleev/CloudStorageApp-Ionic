import { describe, it, expect } from 'vitest';
import { readKeyRole, assertServiceRoleKey } from './supabase-key';

/** Builds a JWT-shaped string with the given payload. Signature is irrelevant
 *  here — nothing verifies it, the claim is read for a configuration check. */
function jwtWith(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.signature`;
}

const SERVICE = jwtWith({ iss: 'supabase', ref: 'abcdefghijklmnop', role: 'service_role' });
const ANON = jwtWith({ iss: 'supabase', ref: 'abcdefghijklmnop', role: 'anon' });

describe('readKeyRole', () => {
  it('reads the role out of a Supabase JWT', () => {
    expect(readKeyRole(SERVICE)).toBe('service_role');
    expect(readKeyRole(ANON)).toBe('anon');
  });

  it('returns null for keys that carry no readable claims', () => {
    // Supabase's newer opaque keys — unverifiable, which is not the same as wrong
    expect(readKeyRole('sb_secret_zAOgQ0mVHXm8kQ8L7Nn2Rw')).toBeNull();
    expect(readKeyRole('')).toBeNull();
    expect(readKeyRole('not.a.jwt')).toBeNull();
    expect(readKeyRole(jwtWith({ ref: 'abc' }))).toBeNull();
  });
});

describe('assertServiceRoleKey', () => {
  it('accepts a service_role key', () => {
    expect(() => assertServiceRoleKey(SERVICE)).not.toThrow();
  });

  it('rejects an anon key — the outage this exists to prevent', () => {
    expect(() => assertServiceRoleKey(ANON)).toThrow(/holds a "anon" key, not service_role/);
  });

  it('explains the consequence, not just the mismatch', () => {
    // A bare "wrong key" message sends people hunting in the wrong place: the
    // symptom is queries returning nothing, which reads like missing data.
    expect(() => assertServiceRoleKey(ANON)).toThrow(/subject to RLS and return no rows/);
  });

  it('names the variable it is complaining about', () => {
    expect(() => assertServiceRoleKey(ANON)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(() => assertServiceRoleKey(ANON, 'OTHER_KEY')).toThrow(/OTHER_KEY/);
  });

  it('lets an unverifiable key through rather than blocking a valid deploy', () => {
    expect(() => assertServiceRoleKey('sb_secret_zAOgQ0mVHXm8kQ8L7Nn2Rw')).not.toThrow();
  });
});
