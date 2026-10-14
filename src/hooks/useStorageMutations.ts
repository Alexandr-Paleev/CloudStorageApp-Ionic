import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import storageService, { type Folder } from '../services/storage.service';
import { useOfflineQueue } from './useOfflineQueue';

/* Without this TanStack pauses the mutation while the browser reports no
   network and never calls mutationFn at all — the change would live only
   in this tab's memory, and a reload would lose it. The queue in
   services/mutation-queue.ts is what makes it durable, and it only gets
   the chance if the attempt is actually made. */
const THROUGH_THE_QUEUE = { networkMode: 'always' } as const;

interface StorageMutationsOptions {
  /** The folder the dashboard is in. A new folder is made inside it. */
  folderId: string | undefined;
  /** Given a sentence for the person when a change could not be made. */
  onProblem: (message: string) => void;
}

/**
 * The changes the dashboard makes: a folder renamed, a folder deleted, a file
 * deleted, a folder made.
 *
 * The first three go through the offline queue, which does them now or writes
 * them down until the network is back. Making a folder does not.
 */
export function useStorageMutations({ folderId, onProblem }: StorageMutationsOptions) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const offlineQueue = useOfflineQueue();

  const renameFolder = useMutation({
    ...THROUGH_THE_QUEUE,
    mutationFn: ({ folder, name }: { folder: Folder; name: string }) => {
      if (!user?.id || !folder.id) throw new Error('User not authenticated');
      const folderId = folder.id;

      return offlineQueue.runOrQueue({ kind: 'renameFolder', folderId, name }, () =>
        storageService.renameFolder(folderId, user.id, name)
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['folder', folderId] });
      queryClient.invalidateQueries({ queryKey: ['folderPath', user?.id] });
    },
    onError: (err: Error) => onProblem(err.message),
  });

  const deleteFolder = useMutation({
    ...THROUGH_THE_QUEUE,
    mutationFn: (folder: Folder) => {
      if (!user?.id || !folder.id) throw new Error('User not authenticated');
      const folderId = folder.id;

      /* No deadline: this walks the whole tree, one request per file, and is
         the one operation a timeout would duplicate rather than rescue. */
      return offlineQueue.runOrQueue(
        { kind: 'deleteFolder', folderId },
        () => storageService.deleteFolder(folderId, user.id),
        { deadline: null }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', user?.id] });
      // Deleting a folder deletes its files, so the meter moves too.
      queryClient.invalidateQueries({ queryKey: ['storageSize', user?.id] });
    },
    onError: (err: Error) => onProblem(err.message),
  });

  /* No onProblem here: the dashboard says "Failed to delete file" itself,
     from `isError`. */
  const deleteFile = useMutation({
    ...THROUGH_THE_QUEUE,
    mutationFn: (fileId: string) => {
      if (!user?.id) throw new Error('User not authenticated');
      const userId = user.id;

      /* Offline this is written down and applied to the listing; online it is
         an ordinary delete. Either way the button does what it says. */
      return offlineQueue.runOrQueue({ kind: 'deleteFile', fileId }, () =>
        storageService.deleteFile(fileId, userId)
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['storageSize', user?.id] });
    },
  });

  const createFolder = useMutation({
    mutationFn: (name: string) => {
      if (!user?.id) throw new Error('User not authenticated');
      return storageService.createFolder(user.id, name, folderId || null);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', user?.id] });
    },
    onError: (err: Error) => {
      onProblem(err.message || 'Failed to create folder. Ensure Supabase is configured.');
    },
  });

  return { renameFolder, deleteFolder, deleteFile, createFolder };
}
