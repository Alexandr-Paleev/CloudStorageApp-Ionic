import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('./auth', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import {
  AI_DAILY_LIMITS,
  BudgetSpent,
  claimAiCall,
  dailyLimit,
  secondsUntilTomorrow,
} from './ai-budget';

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: 'ok', error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('claimAiCall', () => {
  it('claims one call from both counters, with the limits for that action', async () => {
    await claimAiCall('user-1', 'index');

    expect(rpc).toHaveBeenCalledWith('claim_ai_call', {
      p_user: 'user-1',
      p_action: 'index',
      p_user_limit: AI_DAILY_LIMITS.index.perAccount,
      p_total_limit: AI_DAILY_LIMITS.index.total,
    });
  });

  it('counts searches apart from descriptions', async () => {
    await claimAiCall('user-1', 'embed');

    expect(rpc).toHaveBeenCalledWith(
      'claim_ai_call',
      expect.objectContaining({ p_action: 'embed', p_total_limit: AI_DAILY_LIMITS.embed.total })
    );
  });

  it('says whose limit is spent, in words for the person who hit it', async () => {
    rpc.mockResolvedValue({ data: 'account', error: null });
    const account = await claimAiCall('user-1', 'index').catch((error: unknown) => error);

    expect(account).toBeInstanceOf(BudgetSpent);
    expect(account).toMatchObject({ scope: 'account', message: expect.stringMatching(/tomorrow/) });

    rpc.mockResolvedValue({ data: 'deployment', error: null });
    const site = await claimAiCall('user-1', 'embed').catch((error: unknown) => error);

    expect(site).toMatchObject({ scope: 'deployment', message: expect.stringMatching(/by name/) });
  });

  it('names the migration when the function is not in the database', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.claim_ai_call in the schema cache',
      },
    });

    await expect(claimAiCall('user-1', 'index')).rejects.toThrow(/migrations\/017/);
  });

  /* The point of the check is to bound a bill. One that waved calls through
     whenever it could not read its counter would bound nothing on exactly the
     day the database was having trouble. */
  it('refuses rather than lets the call through when the counter cannot be read', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } });

    await expect(claimAiCall('user-1', 'index')).rejects.not.toBeInstanceOf(BudgetSpent);
    await expect(claimAiCall('user-1', 'index')).rejects.toThrow(/connection reset/);
  });

  it('does not take an answer it does not know for a yes', async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    await expect(claimAiCall('user-1', 'index')).rejects.toThrow(/answered null/);
  });
});

describe('dailyLimit', () => {
  it('takes the deployment-wide limit from the environment', () => {
    vi.stubEnv('AI_INDEX_DAILY_LIMIT', '40');

    expect(dailyLimit('index')).toEqual({
      perAccount: AI_DAILY_LIMITS.index.perAccount,
      total: 40,
    });
    // Each action has a variable of its own.
    expect(dailyLimit('embed')).toEqual(AI_DAILY_LIMITS.embed);
  });

  it('takes 0, which stops the spending without taking the keys away', () => {
    vi.stubEnv('AI_EMBED_DAILY_LIMIT', '0');

    expect(dailyLimit('embed').total).toBe(0);
  });

  it.each(['ten', '-5', '2.5', ''])('keeps the default for %j', (value) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('AI_INDEX_DAILY_LIMIT', value);

    expect(dailyLimit('index')).toEqual(AI_DAILY_LIMITS.index);
  });
});

describe('secondsUntilTomorrow', () => {
  it('counts to midnight UTC', () => {
    expect(secondsUntilTomorrow(new Date('2026-11-01T23:59:30Z'))).toBe(30);
    expect(secondsUntilTomorrow(new Date('2026-11-01T00:00:00Z'))).toBe(86_400);
  });

  it('never says zero, which a client reads as now', () => {
    expect(secondsUntilTomorrow(new Date('2026-11-01T23:59:59.999Z'))).toBe(1);
  });
});
