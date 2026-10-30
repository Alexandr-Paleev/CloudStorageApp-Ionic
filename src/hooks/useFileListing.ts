import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import type { FileFiltersValue } from '../components/FileFilters';
import aiService from '../services/ai.service';
import { applyPending } from '../services/mutation-queue';
import storageService, { type FileMetadata } from '../services/storage.service';
import { smartSearchIsOffered } from '../utils/smart-search.utils';
import { useOfflineQueue } from './useOfflineQueue';

const PAGE_SIZE = 15;

/**
 * What the dashboard lists: one folder under the filters, page by page, or the
 * same search asked of the index instead of the file names. Either way with
 * the changes this device has queued and not yet sent laid over the top.
 */
export function useFileListing(folderId: string | undefined, filters: FileFiltersValue) {
  const { user } = useAuth();
  const { ops } = useOfflineQueue();
  const queryClient = useQueryClient();

  const searching = filters.search.trim().length > 0;
  /** A search by meaning, offered by this deployment, with something to
   *  search for. All three, or the ordinary list. */
  const smartSearching = smartSearchIsOffered() && filters.mode === 'smart' && searching;

  const { data, fetchNextPage, hasNextPage, isLoading, error } = useInfiniteQuery({
    /* The filters belong in the key: they are part of the question being
       asked, so changing one has to fetch rather than re-render what the
       previous question returned. */
    queryKey: ['items', user?.id, folderId || 'root', filters],
    queryFn: ({ pageParam = 0 }) => {
      if (!user?.id) throw new Error('User not authenticated');
      return storageService.getItems(user.id, {
        folderId: folderId || null,
        page: pageParam as number,
        pageSize: PAGE_SIZE,
        ...filters,
      });
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.files.length < PAGE_SIZE) return undefined;
      return allPages.length;
    },
    initialPageParam: 0,
    // Not merely ignored while searching by meaning — not asked for. The two
    // lists answer different questions, and the ordinary one costs a query.
    enabled: !!user?.id && !smartSearching,
  });

  /**
   * The same question asked of the index instead of the file names.
   *
   * One page and no scrolling: `match_files` returns the nearest handful, and
   * "more results" past the twentieth nearest neighbour is not a page of a
   * list, it is noise with a worse score.
   */
  const {
    data: smart,
    isLoading: smartLoading,
    error: smartError,
  } = useQuery({
    queryKey: ['smart-search', user?.id, filters.search.trim()],
    queryFn: () => aiService.smartSearch(filters.search),
    enabled: !!user?.id && smartSearching,
    /* Typing "invoice" again a moment later is the same question, and the
       answer costs an embedding on a paid API. */
    staleTime: 60_000,
    retry: false,
  });

  /* The server's answer, plus whatever this device has queued and not yet
     sent. The cache stays a truthful snapshot; the queue is applied on top —
     including over search results, where a file deleted offline would
     otherwise come back from the database as a perfectly good match. */
  const items = applyPending(
    smartSearching
      ? { files: smart?.files ?? [], folders: [] }
      : {
          files: data?.pages.flatMap((page) => page.files) || [],
          folders: data?.pages[0]?.folders || [],
        },
    ops
  );

  return {
    items,
    searching,
    smartSearching,
    /** The model the matches were found with: what "indexed" means for them. */
    smartModel: smartSearching ? smart?.model : undefined,
    loading: smartSearching ? smartLoading : isLoading,
    error: smartSearching ? smartError : error,
    hasNextPage,
    fetchNextPage,
    /** Asks again for every folder and every filter this account has listed. */
    refresh: () => queryClient.invalidateQueries({ queryKey: ['items', user?.id] }),
    /** A fresh address for a file's picture: the listing hands back the one
     *  stored at upload, and on Supabase Storage and R2 that runs out. */
    refreshPicture: async (file: FileMetadata): Promise<string | null> => {
      if (!user?.id || !file.id) return null;
      const fresh = await storageService.getFileMetadata(file.id, user.id);
      return fresh?.download_url ?? null;
    },
  };
}
