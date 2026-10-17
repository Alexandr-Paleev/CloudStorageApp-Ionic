import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* The webhook is loaded for real here, with the real libs/server/src/auth:
   what is under test is whether loading it runs the check on the key. Only
   the two clients are stood in for, so that nothing leaves the process. */
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: vi.fn() }),
}));

vi.mock('stripe', () => ({
  default: class {
    webhooks = { constructEvent: vi.fn() };
    subscriptions = { list: vi.fn() };
  },
}));

/** A key in the shape Supabase issues, carrying the given role. Made here
 *  rather than written out, so that nothing in this file looks like a secret. */
function keyWithRole(role: string): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return [part({ alg: 'HS256', typ: 'JWT' }), part({ role }), 'signature'].join('.');
}

describe('the key the webhook writes with', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses to start on an anon key under the service-role name', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', keyWithRole('anon'));

    await expect(import('./webhook')).rejects.toThrow('holds a "anon" key, not service_role');
  });

  /* The other half of the first: under the same stand-ins the webhook does
     load, so what stopped it above was the key. */
  it('starts on a service-role key', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', keyWithRole('service_role'));

    await expect(import('./webhook')).resolves.toHaveProperty('default');
  });
});
