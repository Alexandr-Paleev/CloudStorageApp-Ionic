import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import aiService from '../services/ai.service';

interface SearchIndexOptions {
  /** True while a search by meaning is on screen, and only then. */
  enabled: boolean;
  /** Given a sentence for the person when a run did not do all it was asked. */
  onProblem: (message: string) => void;
}

/** The files a search by meaning cannot find yet, and the act of indexing them. */
export function useSearchIndex({ enabled, onProblem }: SearchIndexOptions) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  /* Only asked while a smart search is on screen: it is the one moment the
     answer matters, and the answer is two reads the dashboard need not make
     on every visit. */
  const { data: unindexed } = useQuery({
    queryKey: ['unindexed', user?.id],
    queryFn: () => aiService.unindexedFileIds(user!.id),
    enabled: !!user?.id && enabled,
  });

  const [indexing, setIndexing] = useState<{ done: number; total: number } | null>(null);

  /* Indexing is a deliberate act, not something an upload triggers on its
     own: every file costs a request at a model provider, and this deployment
     hands an account to any visitor. */
  const indexMissing = async () => {
    const ids = unindexed ?? [];
    setIndexing({ done: 0, total: ids.length });
    try {
      /* Counted rather than awaited in silence: describing twenty files is
         minutes of a spinner, and a run where every one of them failed — no
         key on this deployment, say — used to end exactly like a run where
         every one succeeded. */
      const { indexed, skipped, failed } = await aiService.indexMany(ids, (done, total) =>
        setIndexing({ done, total })
      );

      if (failed > 0) {
        onProblem(
          `Indexed ${indexed} of ${ids.length}. ${failed} failed — smart search will not find those yet.`
        );
      } else if (indexed === 0 && skipped > 0) {
        onProblem(`Nothing to index: ${skipped} file${skipped === 1 ? '' : 's'} cannot be read.`);
      }

      await queryClient.invalidateQueries({ queryKey: ['unindexed', user?.id] });
      await queryClient.invalidateQueries({ queryKey: ['smart-search'] });
    } finally {
      setIndexing(null);
    }
  };

  return { unindexed, indexing, indexMissing };
}
