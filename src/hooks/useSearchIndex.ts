import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import aiService, { type UnindexedFile } from '../services/ai.service';
import { readSkips, skipsKey, writeSkips } from '../utils/index-skips';

interface SearchIndexOptions {
  /** True where this account may index: a deployment that offers search by
   *  meaning, and an account that is not a demo. */
  enabled: boolean;
  /** Given a sentence for the person when a run did not do all it was asked. */
  onProblem: (message: string) => void;
  /** Given a sentence that is news rather than a fault: files it cannot read. */
  onNotice: (message: string) => void;
}

/** A file the index will not take, with the reason the route gave. */
export interface UnreadableFile extends UnindexedFile {
  reason: string;
}

/** The files a search by meaning cannot find yet, and the act of indexing them. */
export function useSearchIndex({ enabled, onProblem, onNotice }: SearchIndexOptions) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  /* Indexed means indexed by the model this deployment uses: the search
     compares no other rows, and the server picks the models by which keys it
     has. Asked of the server once a session, at no cost, rather than learned
     from a search by meaning, which is why "Index them" used to appear only
     after one. */
  const { data: model } = useQuery({
    queryKey: ['ai-model'],
    queryFn: () => aiService.indexModel(),
    enabled: !!user?.id && enabled,
    staleTime: Infinity,
  });

  const { data: unindexed } = useQuery({
    queryKey: ['unindexed', user?.id, model],
    queryFn: () => aiService.unindexedFiles(user!.id, model!),
    enabled: !!user?.id && enabled && !!model,
  });

  /* The files the route would not index, and why. Its reasons do not change
     between runs (a ZIP, a scan with no text, a picture too large), and these
     files used to be offered again on every visit, as "N not indexed" that
     indexing never made go away. Kept in this browser, per account and model:
     lost, they are only offered once more. */
  const key = user?.id && model ? skipsKey(user.id, model) : null;
  const [skips, setSkips] = useState<{ key: string | null; reasons: Record<string, string> }>({
    key: null,
    reasons: {},
  });
  if (skips.key !== key) setSkips({ key, reasons: key ? readSkips(key) : {} });
  const reasons = skips.key === key ? skips.reasons : {};

  const pending = unindexed?.filter((file) => !(file.id in reasons));
  const unreadable: UnreadableFile[] = (unindexed ?? [])
    .filter((file) => file.id in reasons)
    .map((file) => ({ ...file, reason: reasons[file.id]! }));

  const remember = (next: Record<string, string>) => {
    if (key) writeSkips(key, next);
    setSkips({ key, reasons: next });
  };

  /** Offers the files it would not read once more: a reason can go away. */
  const retryUnreadable = () => remember({});

  const [indexing, setIndexing] = useState<{ done: number; total: number } | null>(null);

  /* Indexing is a deliberate act, not something an upload triggers on its
     own: every file takes a unit of the day's budget, and this deployment
     hands an account to any visitor. */
  const indexMissing = async () => {
    const ids = (pending ?? []).map((file) => file.id);
    setIndexing({ done: 0, total: ids.length });
    try {
      /* Counted rather than awaited in silence: describing twenty files is
         minutes of a spinner, and a run where every one of them failed — no
         key on this deployment, say — used to end exactly like a run where
         every one succeeded. */
      const {
        indexed,
        skipped,
        failed,
        skips: newSkips,
        stopped,
      } = await aiService.indexMany(ids, (done, total) => setIndexing({ done, total }));

      if (newSkips.length > 0) {
        remember({
          ...reasons,
          ...Object.fromEntries(newSkips.map(({ fileId, reason }) => [fileId, reason])),
        });
      }

      const files = (n: number) => `${n} file${n === 1 ? '' : 's'}`;
      if (stopped) {
        onProblem(`Indexed ${indexed} of ${ids.length}. ${stopped}`);
      } else if (failed > 0) {
        onProblem(
          `Indexed ${indexed} of ${ids.length}. ${failed} failed — smart search will not find those yet.`
        );
      } else if (skipped > 0) {
        /* Not a fault: a file the model cannot read is a normal file, and
           the list under the button now says which and why. */
        onNotice(
          indexed === 0
            ? `Nothing could be indexed: ${files(skipped)} cannot be read. The list says why.`
            : `Indexed ${indexed} of ${ids.length}. ${files(skipped)} cannot be read. The list says why.`
        );
      }

      await queryClient.invalidateQueries({ queryKey: ['unindexed', user?.id] });
      await queryClient.invalidateQueries({ queryKey: ['smart-search'] });
    } finally {
      setIndexing(null);
    }
  };

  return { pending, unreadable, indexing, indexMissing, retryUnreadable };
}
