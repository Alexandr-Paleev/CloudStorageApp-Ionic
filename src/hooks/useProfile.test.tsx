import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';
import { useProfile } from './useProfile';
import { useAuth } from '../contexts/AuthContext';
import billingService from '../services/billing.service';
import { UserProfile } from '../types/billing.types';
import { createTestQueryClient } from '../test/utils';

vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../services/billing.service', () => ({
  default: { getProfile: vi.fn() },
}));

const proProfile = {
  id: 'user-1',
  tier: 'pro',
  storage_limit: 5 * 1024 * 1024 * 1024,
  allowed_providers: ['cloudinary', 'r2', 'supabase_storage', 'googledrive', 'dropbox'],
} as UserProfile;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

function signedIn(user: User | null) {
  vi.mocked(useAuth).mockReturnValue({
    user,
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useProfile', () => {
  it('asks for nothing until there is a user to ask about', () => {
    signedIn(null);

    const { result } = renderHook(() => useProfile(), { wrapper });

    expect(billingService.getProfile).not.toHaveBeenCalled();
    expect(result.current.profile).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("returns the paid plan's limits", async () => {
    signedIn({ id: 'user-1' } as User);
    vi.mocked(billingService.getProfile).mockResolvedValue(proProfile);

    const { result } = renderHook(() => useProfile(), { wrapper });

    await waitFor(() => expect(result.current.profile).toEqual(proProfile));
    expect(billingService.getProfile).toHaveBeenCalledWith('user-1');
  });

  it('reports a missing row as no profile, not as a failure', async () => {
    // A user whose profiles row never got written must fall back to the free
    // tier — the callers read `profile?.storage_limit ?? DEFAULT`, so null has
    // to mean free, not "still loading".
    signedIn({ id: 'user-1' } as User);
    vi.mocked(billingService.getProfile).mockResolvedValue(null);

    const { result } = renderHook(() => useProfile(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.profile).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('surfaces a failed lookup instead of pretending the user is on free', async () => {
    signedIn({ id: 'user-1' } as User);
    vi.mocked(billingService.getProfile).mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useProfile(), { wrapper });

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.profile).toBeNull();
  });
});
