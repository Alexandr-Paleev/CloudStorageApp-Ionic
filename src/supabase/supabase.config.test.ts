import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createClient, isNativePlatform } = vi.hoisted(() => ({
  createClient: vi.fn((..._args: unknown[]) => ({})),
  isNativePlatform: vi.fn(() => false),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}));
vi.mock('../env', () => ({
  env: { VITE_SUPABASE_URL: 'https://example-ref.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' },
}));

/** The options the module creates its client with, loaded afresh. */
async function optionsOfTheClient() {
  vi.resetModules();
  await import('./supabase.config');
  return createClient.mock.calls.at(-1)?.[2];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the Supabase client', () => {
  it('takes a sign-in in the native shell as a code that only it can redeem', async () => {
    isNativePlatform.mockReturnValue(true);

    expect(await optionsOfTheClient()).toEqual({
      auth: { flowType: 'pkce', detectSessionInUrl: false },
    });
  });

  it('keeps the default flow on the web', async () => {
    isNativePlatform.mockReturnValue(false);

    expect(await optionsOfTheClient()).toEqual({});
  });
});
