import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import SubscriptionSuccess, { CHECK_EVERY_MS, GIVE_UP_AFTER_MS } from './SubscriptionSuccess';
import { renderWithProviders } from '../test/utils';

const { getProfile, navigate } = vi.hoisted(() => ({ getProfile: vi.fn(), navigate: vi.fn() }));

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));

vi.mock('../services/billing.service', () => ({
  default: { getProfile: (...a: unknown[]) => getProfile(...a) },
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => navigate };
});

const FREE = { id: 'user-1', tier: 'free' };
const PRO = { id: 'user-1', tier: 'pro' };

function show() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<SubscriptionSuccess />} />
    </Routes>
  );
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SubscriptionSuccess', () => {
  /* Stripe sends the person back here and the event to the webhook apart,
     and only the webhook writes the plan. Until the profile says Pro, the
     page cannot say it is. */
  it('says nothing about the subscription until the profile says Pro', async () => {
    getProfile.mockResolvedValue(FREE);
    show();

    expect(await screen.findByText(/Confirming your subscription/)).toBeInTheDocument();
    await advance(5000);

    expect(screen.queryByText('Welcome to Pro!')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('welcomes once the webhook has written the plan, then goes on to the dashboard', async () => {
    getProfile.mockResolvedValueOnce(FREE).mockResolvedValueOnce(FREE).mockResolvedValue(PRO);
    show();

    await advance(CHECK_EVERY_MS * 2 + 100);
    expect(await screen.findByText('Welcome to Pro!')).toBeInTheDocument();
    expect(getProfile).toHaveBeenCalledTimes(3);

    await advance(3000);
    expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true });

    // And stops asking once it has its answer.
    await advance(CHECK_EVERY_MS * 3);
    expect(getProfile).toHaveBeenCalledTimes(3);
  });

  it('welcomes at once an account that is Pro already', async () => {
    getProfile.mockResolvedValue(PRO);
    show();
    expect(await screen.findByText('Welcome to Pro!')).toBeInTheDocument();
  });

  it('says so when Stripe has not confirmed within half a minute, and keeps asking', async () => {
    getProfile.mockResolvedValue(FREE);
    show();

    await advance(GIVE_UP_AFTER_MS + 100);
    expect(screen.getByText('Stripe has not confirmed it yet')).toBeInTheDocument();

    getProfile.mockResolvedValue(PRO);
    await advance(CHECK_EVERY_MS + 100);
    expect(await screen.findByText('Welcome to Pro!')).toBeInTheDocument();
  });

  /* Left as Free, the entry would be the dashboard's for five minutes. */
  it('has the dashboard read the profile again when the person goes on before it changed', async () => {
    getProfile.mockResolvedValue(FREE);
    const { queryClient } = show();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await advance(GIVE_UP_AFTER_MS + 100);
    fireEvent.click(screen.getByText('Go to the dashboard'));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['profile'] });
    expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });
});
