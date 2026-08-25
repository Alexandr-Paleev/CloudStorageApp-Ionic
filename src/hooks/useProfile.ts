import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import billingService from '../services/billing.service';
import { UserProfile } from '../types/billing.types';

export function useProfile() {
  const { user } = useAuth();

  const query = useQuery<UserProfile | null>({
    queryKey: ['profile', user?.id],
    queryFn: () => billingService.getProfile(user!.id),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  return {
    profile: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
