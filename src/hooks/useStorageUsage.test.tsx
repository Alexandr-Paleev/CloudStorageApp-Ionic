import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { DEFAULT_STORAGE_LIMIT } from '@cloud-storage/core/tiers';
import { useStorageUsage } from './useStorageUsage';
import { withQueryClient } from '../test/utils';

const MB = 1024 * 1024;

const { getUserStorageSize, account } = vi.hoisted(() => ({
  getUserStorageSize: vi.fn(),
  account: { profile: null as { storage_limit: number } | null },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('../services/storage.service', () => ({ default: { getUserStorageSize } }));
vi.mock('./useProfile', () => ({ useProfile: () => ({ profile: account.profile }) }));

function show() {
  const { wrapper } = withQueryClient();
  return renderHook(() => useStorageUsage(), { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  account.profile = { storage_limit: 5 * 1024 * MB };
  getUserStorageSize.mockResolvedValue(100 * MB);
});

describe('useStorageUsage', () => {
  it('measures what is stored against the limit the profile carries', async () => {
    const { result } = show();

    await waitFor(() => expect(result.current.usedBytes).toBe(100 * MB));
    expect(getUserStorageSize).toHaveBeenCalledWith('user-1');
    expect(result.current.storageLimit).toBe(5 * 1024 * MB);
  });

  /* No profile is the free tier, whether it has not arrived or was never
     written: an account with no room at all is not an honest placeholder. */
  it('measures against the free tier’s limit while there is no profile', () => {
    account.profile = null;
    const { result } = show();

    expect(result.current.storageLimit).toBe(DEFAULT_STORAGE_LIMIT);
    expect(DEFAULT_STORAGE_LIMIT).toBe(500 * MB);
  });

  it('counts nothing as stored until the size arrives', () => {
    getUserStorageSize.mockReturnValue(new Promise(() => {}));
    const { result } = show();

    expect(result.current.usedBytes).toBe(0);
  });

  it('asks for the size again when told to refresh', async () => {
    const { result } = show();
    await waitFor(() => expect(result.current.usedBytes).toBe(100 * MB));
    getUserStorageSize.mockResolvedValue(150 * MB);

    await act(() => result.current.refresh());

    expect(getUserStorageSize).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.usedBytes).toBe(150 * MB));
  });
});
