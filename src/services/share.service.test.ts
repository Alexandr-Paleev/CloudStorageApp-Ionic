import { describe, it, expect, beforeEach, vi } from 'vitest';
import shareService from './share.service';

const getSession = vi.fn();
const order = vi.fn();
const select = vi.fn();

vi.mock('../supabase/supabase.config', () => ({
  supabase: {
    auth: { getSession: () => getSession() },
    from: () => ({
      select: (columns: string) => {
        select(columns);
        return { eq: (...args: unknown[]) => ({ order: () => order(...args) }) };
      },
    }),
  },
}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  getSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } } });
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ url: 'https://app.test/s/tok', expiresAt: '2026-09-13T00:00:00Z' }),
  });
  order.mockResolvedValue({ data: [], error: null });
});

describe('creating a link', () => {
  it('returns the URL and its expiry, and asks with the session token', async () => {
    await expect(shareService.createLink('file-1', 7)).resolves.toEqual({
      url: 'https://app.test/s/tok',
      expiresAt: '2026-09-13T00:00:00Z',
    });

    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
    expect(JSON.parse(init.body as string)).toEqual({ fileId: 'file-1', expiresInDays: 7 });
  });

  it('reports the reason the server gave', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ message: 'File not found' }) });
    await expect(shareService.createLink('nope')).rejects.toThrow('File not found');
  });

  /* A 502 from the platform is HTML, not JSON. Letting the parse throw would
     replace "could not create the link" with "Unexpected token <", which tells
     the user nothing and hides which request failed. */
  it('survives an error body that is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });

    await expect(shareService.createLink('file-1')).rejects.toThrow('Failed to create share link');
  });
});

describe('listing the links for a file', () => {
  /* The row stores only the token's hash, and this is the read the owner's own
     screen makes. Selecting `*` here would put that hash in front of the
     browser — not the token, but not nothing either, and there is no reason for
     it to leave the database. */
  it('never asks for the token hash', async () => {
    await shareService.listLinks('file-1');

    const columns = select.mock.calls[0]![0] as string;
    expect(columns).toBe('id, created_at, expires_at, revoked_at');
    expect(columns).not.toContain('token');
  });

  it('answers with an empty list rather than null', async () => {
    order.mockResolvedValue({ data: null, error: null });
    await expect(shareService.listLinks('file-1')).resolves.toEqual([]);
  });

  it('rethrows a database error rather than showing no links', async () => {
    order.mockResolvedValue({ data: null, error: { message: 'denied' } });
    await expect(shareService.listLinks('file-1')).rejects.toMatchObject({ message: 'denied' });
  });
});

describe('revoking a link', () => {
  /* The id goes into a query string. Unencoded, an id carrying `&` or `#`
     truncates the parameter and the DELETE lands on a different link — or on
     none, reporting success either way. */
  it('encodes the id it puts in the URL', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ revoked: true }) });
    await shareService.revokeLink('a&b#c');

    const [url] = fetchMock.mock.calls[0]! as [string];
    expect(url).toContain('id=a%26b%23c');
    expect(url).not.toContain('a&b#c');
  });

  it('throws when the server refuses', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ message: 'Not yours' }) });
    await expect(shareService.revokeLink('link-1')).rejects.toThrow('Not yours');
  });
});
