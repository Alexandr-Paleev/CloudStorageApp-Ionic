import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_STORAGE_LIMIT } from '@cloud-storage/core/tiers';
import { useAuth } from '../contexts/AuthContext';
import storageService from '../services/storage.service';
import { useProfile } from './useProfile';

/** How much this account stores, and how much it may. */
export function useStorageUsage() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const queryClient = useQueryClient();

  const { data: storageSize } = useQuery({
    queryKey: ['storageSize', user?.id],
    queryFn: () => {
      if (!user?.id) throw new Error('User not authenticated');
      return storageService.getUserStorageSize(user.id);
    },
    enabled: !!user?.id,
  });

  return {
    usedBytes: storageSize || 0,
    /* The profile's, so that a paid account is measured against what it paid
       for. Until the profile arrives, and for an account that has none, the
       free tier's: an account with no room at all is not an honest
       placeholder. */
    storageLimit: profile?.storage_limit ?? DEFAULT_STORAGE_LIMIT,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['storageSize', user?.id] }),
  };
}
