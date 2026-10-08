import { describe, it, expect } from 'vitest';
import {
  generateShareToken,
  hashShareToken,
  resolveExpiry,
  shareUnusableReason,
  shareUrl,
  DEFAULT_SHARE_DAYS,
  MAX_SHARE_DAYS,
} from './share';

const DAY = 24 * 60 * 60 * 1000;

describe('generateShareToken', () => {
  it('is long and URL-safe', () => {
    const token = generateShareToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('does not repeat itself', () => {
    // The token is the only credential the link carries; a collision would hand
    // one recipient somebody else's file.
    const tokens = new Set(Array.from({ length: 500 }, generateShareToken));
    expect(tokens.size).toBe(500);
  });
});

describe('hashShareToken', () => {
  it('is stable for the same token', () => {
    const token = generateShareToken();
    expect(hashShareToken(token)).toBe(hashShareToken(token));
  });

  it('differs for different tokens', () => {
    expect(hashShareToken('a')).not.toBe(hashShareToken('b'));
  });

  it('does not leak the token it came from', () => {
    // What is stored must be useless to whoever reads the table.
    const token = generateShareToken();
    const hash = hashShareToken(token);
    expect(hash).not.toContain(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('resolveExpiry', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  it('defaults when nothing sensible is asked for', () => {
    for (const input of [undefined, null, 'soon', Number.NaN, {}]) {
      expect(resolveExpiry(input, now).getTime()).toBe(now.getTime() + DEFAULT_SHARE_DAYS * DAY);
    }
  });

  it('honours a reasonable request', () => {
    expect(resolveExpiry(30, now).getTime()).toBe(now.getTime() + 30 * DAY);
  });

  it('never issues a link that is already dead', () => {
    expect(resolveExpiry(0, now).getTime()).toBe(now.getTime() + DAY);
    expect(resolveExpiry(-5, now).getTime()).toBe(now.getTime() + DAY);
  });

  it('caps a link that would outlive its usefulness', () => {
    expect(resolveExpiry(99999, now).getTime()).toBe(now.getTime() + MAX_SHARE_DAYS * DAY);
  });
});

describe('shareUnusableReason', () => {
  const now = new Date('2026-01-10T00:00:00.000Z');

  it('passes a live link', () => {
    expect(
      shareUnusableReason({ expires_at: '2026-01-11T00:00:00.000Z', revoked_at: null }, now)
    ).toBeNull();
  });

  it('reports a revoked link', () => {
    expect(
      shareUnusableReason(
        { expires_at: '2026-01-11T00:00:00.000Z', revoked_at: '2026-01-09T00:00:00.000Z' },
        now
      )
    ).toBe('revoked');
  });

  it('reports an expired link', () => {
    expect(
      shareUnusableReason({ expires_at: '2026-01-09T00:00:00.000Z', revoked_at: null }, now)
    ).toBe('expired');
  });

  it('treats the exact expiry moment as past', () => {
    expect(shareUnusableReason({ expires_at: now.toISOString(), revoked_at: null }, now)).toBe(
      'expired'
    );
  });

  it('prefers revoked over expired when both apply', () => {
    // Revocation is a decision someone made; expiry just happened.
    expect(
      shareUnusableReason(
        { expires_at: '2026-01-01T00:00:00.000Z', revoked_at: '2026-01-05T00:00:00.000Z' },
        now
      )
    ).toBe('revoked');
  });

  it('accepts a link with no expiry set', () => {
    expect(shareUnusableReason({ expires_at: null, revoked_at: null }, now)).toBeNull();
  });
});

describe('shareUrl', () => {
  it('builds a link on the given deployment', () => {
    expect(shareUrl('https://app.example', 'tok')).toBe('https://app.example/s/tok');
  });

  it('does not double the slash', () => {
    expect(shareUrl('https://app.example/', 'tok')).toBe('https://app.example/s/tok');
  });
});
