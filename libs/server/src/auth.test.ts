import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockRequest } from './test-utils';

/**
 * Every handler that touches a user's data goes through authenticateUser, and
 * every handler test mocks it — so until now the gate itself ran in no test at
 * all.
 */
const { getUser, rpc, callerKeys } = vi.hoisted(() => {
  // The module builds its Supabase client at import time and refuses to start
  // without these. `sb_secret_…` keys are opaque, which assertServiceRoleKey
  // accepts: an unverifiable key is not a provably wrong one.
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';

  return { getUser: vi.fn(), rpc: vi.fn(), callerKeys: [] as unknown[] };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, key: string, options?: unknown) => {
    if (key === 'sb_publishable_test') callerKeys.push(options);
    return {
      auth: { getUser: (...args: unknown[]) => getUser(...args) },
      rpc: (...args: unknown[]) => rpc(...args),
    };
  },
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
 * signature is not this module's to check (getUser and the database are
 * mocked), only the payload is read.
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
    rpc.mockResolvedValue({ data: true, error: null });
    callerKeys.length = 0;
  });

  it('is refused by every route that asks for a person', async () => {
    // Auth refuses it by itself once 025's hook is on; this is for when it is not.
    const agent = requestWith(tokenWith({ sub: 'user-1', client_id: 'client-1' }));

    await expect(authenticate(agent)).rejects.toThrow('only reads files, through /mcp');
    await expect(authenticateUser(agent)).rejects.toBeInstanceOf(AuthError);
  });

  it('is the only one /mcp takes, with the assistant it was issued to', async () => {
    const agent = requestWith(
      tokenWith({ sub: 'user-1', email: 'alex@example.com', client_id: 'client-1' })
    );
    const person = requestWith(tokenWith({ sub: 'user-1', session_id: 'session-1' }));

    await expect(authenticate(agent, 'agent')).resolves.toEqual({
      id: 'user-1',
      email: 'alex@example.com',
      clientId: 'client-1',
    });
    await expect(authenticate(person, 'agent')).rejects.toThrow('issued to an assistant');
  });

  it('is checked by the database as the caller, not by Auth (migration 025)', async () => {
    // 025's hook gives the token a session_id Auth has no session for, so
    // getUser would refuse every assistant: the database is asked instead,
    // with the caller's own token, so that PostgREST checks the signature.
    const token = tokenWith({ sub: 'user-1', client_id: 'client-1' });

    await authenticate(requestWith(token), 'agent');

    expect(getUser).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('assistant_session_alive');
    expect(callerKeys).toEqual([
      expect.objectContaining({
        global: { headers: { Authorization: `Bearer ${token}` } },
      }),
    ]);
  });

  it('is refused when PostgREST will not take it: forged, or expired', async () => {
    for (const code of ['PGRST301', 'PGRST303']) {
      rpc.mockResolvedValueOnce({ data: null, error: { code, message: 'JWT' } });
      const agent = requestWith(tokenWith({ sub: 'user-1', client_id: 'client-1' }));
      await expect(authenticate(agent, 'agent')).rejects.toThrow('Invalid or expired token');
    }
  });

  it('is refused the moment it is revoked, or if issued while the hook was off', async () => {
    // Revoking deletes the session; a token from before the hook has no
    // mcp_session_id. Either way the database finds no session.
    rpc.mockResolvedValue({ data: false, error: null });
    const agent = requestWith(tokenWith({ sub: 'user-1', client_id: 'client-1' }));

    const refusal = authenticate(agent, 'agent');
    await expect(refusal).rejects.toBeInstanceOf(AuthError);
    await expect(refusal).rejects.toThrow('connect it again');
  });

  it('is not a sign-in failure when the database fails: that is ours to see', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } });
    const agent = requestWith(tokenWith({ sub: 'user-1', client_id: 'client-1' }));

    const failure = authenticate(agent, 'agent');
    await expect(failure).rejects.not.toBeInstanceOf(AuthError);
    await expect(failure).rejects.toThrow('boom');
  });

  it('is refused without a subject, whatever the database says', async () => {
    const agent = requestWith(tokenWith({ client_id: 'client-1' }));

    await expect(authenticate(agent, 'agent')).rejects.toBeInstanceOf(AuthError);
  });

  it("leaves a person's session as it was", async () => {
    const person = requestWith(tokenWith({ sub: 'user-1', session_id: 'session-1' }));

    await expect(authenticate(person)).resolves.toEqual({
      id: 'user-1',
      email: 'alex@example.com',
    });
    expect(rpc).not.toHaveBeenCalled();
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
      await expect(authenticate(requestWith(token), 'agent')).rejects.toBeInstanceOf(AuthError);
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

describe('migration 025, an assistant is no session to Auth', () => {
  const sql = readFileSync(
    new URL('../../../migrations/025_assistant_tokens_do_not_reach_auth.sql', import.meta.url),
    'utf8'
  );
  const code = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  const hook = code.slice(
    code.indexOf('FUNCTION public.hide_assistant_session'),
    code.indexOf('FUNCTION public.assistant_session_alive')
  );

  it('hides the session of an assistant’s token alone, under a fresh id, never the nil one', () => {
    // Auth skips the session lookup for the nil uuid: the token would be a
    // full session again.
    expect(hook).toContain("IF claims ->> 'client_id' IS NULL THEN\n        RETURN event;");
    expect(hook).toContain("'{mcp_session_id}', COALESCE(claims -> 'session_id'");
    expect(hook).toContain("'{session_id}', to_jsonb(gen_random_uuid()::text)");
    expect(code).not.toMatch(/00000000-0000-0000-0000-000000000000|uuid_nil/);
  });

  it('lets Auth alone run the hook, and an account alone ask after its own session', () => {
    expect(code).toContain(
      'REVOKE EXECUTE ON FUNCTION public.hide_assistant_session(jsonb) FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(code).toContain(
      'GRANT EXECUTE ON FUNCTION public.hide_assistant_session(jsonb) TO supabase_auth_admin;'
    );
    expect(code).toContain(
      'REVOKE EXECUTE ON FUNCTION public.assistant_session_alive() FROM PUBLIC, anon, service_role;'
    );
    expect(code).toContain(
      'GRANT EXECUTE ON FUNCTION public.assistant_session_alive() TO authenticated;'
    );
  });

  it('finds the session the assistant was let in with, for that assistant and that account', () => {
    const alive = code.slice(code.indexOf('FUNCTION public.assistant_session_alive'));
    for (const condition of [
      'WHERE s.id = asked_session',
      'AND s.user_id = asked_owner',
      "AND s.oauth_client_id::text = claims ->> 'client_id'",
      'AND (s.not_after IS NULL OR s.not_after > now())',
    ]) {
      expect(alive).toContain(condition);
    }
    expect(alive).toContain("(claims ->> 'mcp_session_id')::uuid");
    expect(alive).toContain('SECURITY DEFINER');
    expect(alive).toContain("SET search_path = ''");
  });

  it('stops every read an assistant may make once its session is gone', () => {
    const policies = [
      ...code.matchAll(
        /CREATE POLICY "[^"]+" ON (\S+)\s+AS RESTRICTIVE FOR SELECT TO authenticated\s+USING \((.*)\);/g
      ),
    ];
    expect(policies.map(([, table]) => table).sort()).toEqual(
      [
        'public.file_chunks',
        'public.file_embeddings',
        'public.files',
        'public.folders',
        'storage.objects',
      ].sort()
    );
    for (const [, , condition] of policies) {
      expect(condition).toBe(
        "(SELECT auth.jwt() ->> 'client_id') IS NULL OR (SELECT public.assistant_session_alive())"
      );
    }
  });
});
