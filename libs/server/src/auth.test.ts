import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockRequest } from './test-utils';

/**
 * Every handler that touches a user's data goes through authenticateUser, and
 * every handler test mocks it — so until now the gate itself ran in no test at
 * all.
 */
const { getUser } = vi.hoisted(() => {
  // The module builds its Supabase client at import time and refuses to start
  // without these. `sb_secret_…` keys are opaque, which assertServiceRoleKey
  // accepts: an unverifiable key is not a provably wrong one.
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';

  return { getUser: vi.fn() };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: (...args: unknown[]) => getUser(...args) } }),
}));

import { authenticate, authenticateUser, AuthError } from './auth';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('authenticateUser', () => {
  it('returns the id behind a valid token', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    await expect(authenticateUser(mockRequest())).resolves.toBe('user-1');
    expect(getUser).toHaveBeenCalledWith('test-token');
  });

  it('turns away a request carrying no token', async () => {
    await expect(authenticateUser(mockRequest({ headers: {} }))).rejects.toBeInstanceOf(AuthError);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('turns away a token Supabase rejects', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'jwt expired' } });

    await expect(authenticateUser(mockRequest())).rejects.toThrow('Invalid or expired token');
  });

  it('turns away a token that resolves to no user at all', async () => {
    // Supabase can answer without an error and without a user; treating that
    // as success would authenticate a request as `undefined`.
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(authenticateUser(mockRequest())).rejects.toBeInstanceOf(AuthError);
  });

  it('accepts the header only in the form the client sends it', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    await authenticateUser(mockRequest({ headers: { authorization: 'Bearer abc.def.ghi' } }));

    expect(getUser).toHaveBeenCalledWith('abc.def.ghi');
  });
});

/**
 * A token shaped as Supabase signs one, made here from its claims: the
 * signature is not this module's to check (getUser is mocked), only the
 * payload is read.
 */
function tokenWith(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'ES256', typ: 'JWT' })}.${part(claims)}.signed`;
}

function requestWith(token: string) {
  return mockRequest({ headers: { authorization: `Bearer ${token}` } });
}

describe("an assistant's token (ADR 0020)", () => {
  beforeEach(() => {
    getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'alex@example.com' } },
      error: null,
    });
  });

  it('is refused by every route that asks for a person', async () => {
    const agent = requestWith(tokenWith({ sub: 'user-1', client_id: 'client-1' }));

    await expect(authenticate(agent)).rejects.toThrow('only reads files, through /mcp');
    await expect(authenticateUser(agent)).rejects.toBeInstanceOf(AuthError);
  });

  it('is the only one /mcp takes, with the assistant it was issued to', async () => {
    const agent = requestWith(tokenWith({ sub: 'user-1', client_id: 'client-1' }));
    const person = requestWith(tokenWith({ sub: 'user-1', session_id: 'session-1' }));

    await expect(authenticate(agent, 'agent')).resolves.toEqual({
      id: 'user-1',
      email: 'alex@example.com',
      clientId: 'client-1',
    });
    await expect(authenticate(person, 'agent')).rejects.toThrow('issued to an assistant');
  });

  it('is told apart only after Supabase has accepted it', async () => {
    // A forged payload must not reach /mcp as an assistant, nor get past a
    // route as a person: Supabase refusing the token comes first.
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } });
    const agent = requestWith(tokenWith({ sub: 'user-1', client_id: 'client-1' }));

    await expect(authenticate(agent, 'agent')).rejects.toThrow('Invalid or expired token');
  });

  it("leaves a person's session as it was", async () => {
    const person = requestWith(tokenWith({ sub: 'user-1', session_id: 'session-1' }));

    await expect(authenticate(person)).resolves.toEqual({
      id: 'user-1',
      email: 'alex@example.com',
    });
  });

  it('reads any client_id but none as an assistant’s, as migration 024 does', async () => {
    // `auth.jwt() ->> 'client_id' IS NULL` is a person: '' and 42 are not.
    for (const client_id of ['', 42, { id: 'client-1' }]) {
      const token = requestWith(tokenWith({ sub: 'user-1', client_id }));
      await expect(authenticate(token)).rejects.toBeInstanceOf(AuthError);
      await expect(authenticate(token, 'agent')).resolves.toMatchObject({ id: 'user-1' });
    }
    const none = requestWith(tokenWith({ sub: 'user-1', client_id: null }));
    await expect(authenticate(none)).resolves.toEqual({ id: 'user-1', email: 'alex@example.com' });
    await expect(authenticate(none, 'agent')).rejects.toBeInstanceOf(AuthError);
  });

  it("reads a token that is not a JWT as a person's, for Supabase to judge", async () => {
    for (const token of ['opaque', 'a.%%%.c', `a.${Buffer.from('null').toString('base64url')}.c`]) {
      await expect(authenticate(requestWith(token))).resolves.toMatchObject({ id: 'user-1' });
    }
  });
});

describe('migration 024, the same rule in the database', () => {
  const sql = readFileSync(
    new URL('../../../migrations/024_agent_tokens_only_read.sql', import.meta.url),
    'utf8'
  );
  const policies = [
    ...sql.matchAll(/CREATE POLICY "[^"]+" ON (\S+)\s+AS RESTRICTIVE FOR (\w+) TO authenticated/g),
  ].map(([, table, command]) => `${table} ${command}`);

  it('refuses every write to the files, their folders and their objects, and reading nothing else', () => {
    expect(policies.sort()).toEqual(
      [
        'public.files DELETE',
        'public.files INSERT',
        'public.files UPDATE',
        'public.folders DELETE',
        'public.folders INSERT',
        'public.folders UPDATE',
        'public.profiles ALL',
        'public.shared_links ALL',
        'storage.objects DELETE',
        'storage.objects INSERT',
        'storage.objects UPDATE',
      ].sort()
    );
  });

  it('tells an assistant by the claim this module reads, and nothing looser', () => {
    const conditions = [...sql.matchAll(/(?:USING|WITH CHECK) \(([^;]*?)\)(?=\s*(?:WITH|;))/g)];
    expect(conditions.length).toBeGreaterThanOrEqual(policies.length);
    for (const [, condition] of conditions) {
      expect(condition).toBe("(SELECT auth.jwt() ->> 'client_id') IS NULL");
    }
  });
});
