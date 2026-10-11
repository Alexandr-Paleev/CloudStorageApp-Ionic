import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_ORIGIN } from '@cloud-storage/core/origins';
import config from './next.config';

/**
 * The config cannot import the app's address, so it has a copy: the comment
 * there says why. This holds the copy to the original, and the two rules
 * that carry headers to what each is for.
 */

type Rule = { source: string; headers: { key: string; value: string }[] };

async function rulesIn(environment: string): Promise<Rule[]> {
  vi.stubEnv('NODE_ENV', environment);
  return (await config.headers?.()) ?? [];
}

const valueOf = (rule: Rule | undefined, key: string) =>
  rule?.headers.find((header) => header.key === key)?.value;

const named = (policy = '') => policy.match(/https?:\/\/[^\s;]+/g) ?? [];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the headers the site sends', () => {
  it('lets the share page talk to the app, at the address libs/core gives it', async () => {
    const [, share] = await rulesIn('production');
    const policy = valueOf(share, 'Content-Security-Policy');

    expect(share?.source).toBe('/s/:token');
    expect(named(policy)).toEqual([APP_ORIGIN]);
    expect(policy).toContain(`connect-src 'self' ${APP_ORIGIN};`);
  });

  it('lets no other page talk to anyone', async () => {
    const [everyPage] = await rulesIn('production');

    expect(everyPage?.source).toBe('/:path*');
    expect(named(valueOf(everyPage, 'Content-Security-Policy'))).toEqual([]);
  });

  /* Of two rules that set one header, the later is the one that is sent. */
  it('puts the share page after the rule for every page, so that its policy is the one sent', async () => {
    const rules = await rulesIn('production');

    expect(rules.map((rule) => rule.source)).toEqual(['/:path*', '/s/:token']);
  });

  it.each(['production', 'development'])(
    'keeps a share page out of every index, in %s',
    async (environment) => {
      const [, share] = await rulesIn(environment);

      expect(valueOf(share, 'X-Robots-Tag')).toBe('noindex, nofollow');
    }
  );

  /* React's refresh needs `eval`, which the policy refuses. */
  it('sends no policy in development', async () => {
    for (const rule of await rulesIn('development')) {
      expect(valueOf(rule, 'Content-Security-Policy')).toBeUndefined();
    }
  });
});
