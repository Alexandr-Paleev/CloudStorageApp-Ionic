import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import storageService, { type Folder } from '../services/storage.service';
import googleDriveAuthService, { needsDriveConnected } from '../services/googledrive-auth.service';
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

/** A deletion that stopped at a file in Google Drive. */
type DriveBlocked = { kind: 'file'; fileId: string } | { kind: 'folder'; folder: Folder };

/**
 * The changes the dashboard makes: a folder renamed, a folder deleted, a file
 * deleted, a folder made.
 *
 * The first three go through the offline queue, which does them now or writes
 * them down until the network is back. Making a folder does not.
 *
 * A deletion that Google Drive would not take, because it is not connected
 * any more, is offered in `drive` for ReconnectDriveDialog to ask about.
 */
export function useStorageMutations({ folderId, onProblem }: StorageMutationsOptions) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const offlineQueue = useOfflineQueue();

  const deletionsChanged = () => {
    queryClient.invalidateQueries({ queryKey: ['items', user?.id] });
    queryClient.invalidateQueries({ queryKey: ['storageSize', user?.id] });
    /* A search by meaning keeps its answer for a minute (useFileListing),
       and a deleted file stayed in it for that long, leading nowhere. */
    queryClient.invalidateQueries({ queryKey: ['smart-search', user?.id] });
  };

  const renameFolder = useMutation({
    ...THROUGH_THE_QUEUE,
    mutationFn: ({ folder, name }: { folder: Folder; name: string }) => {
      if (!user?.id || !folder.id) throw new Error('User not authenticated');
      const folderId = folder.id;

      return offlineQueue.runOrQueue({ kind: 'renameFolder', folderId, name }, () =>
        storageService.renameFolder(folderId, user.id, name)
      );
    },
    onSuccess: (_renamed, { folder }) => {
      queryClient.invalidateQueries({ queryKey: ['items', user?.id] });
      /* The folder that was renamed, whose own page shows its name as the
         title. It is a card on this page, not the folder this page is in. */
      queryClient.invalidateQueries({ queryKey: ['folder', folder.id] });
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
    // Deleting a folder deletes its files, so the meter moves too.
    onSuccess: deletionsChanged,
    /* Drive asking to be connected again is asked about instead: `drive`. */
    onError: (err: Error) => {
      if (!needsDriveConnected(err)) onProblem(err.message);
    },
  });

  /* No onError here at all: the dashboard says "Failed to delete file" itself,
     from `isError`, and one of its own would replace the one main.tsx gives
     every mutation, which reports the failure to Google Analytics. */
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
    onSuccess: deletionsChanged,
  });

  /* Not through the queue. It answers a deletion that has just been tried
     online, and the queue has no way to write down "and leave the Drive
     files where they are": a deletion replayed later would stop at the same
     file again. */
  const leaveInDrive = useMutation({
    mutationFn: (blocked: DriveBlocked) => {
      if (!user?.id) throw new Error('User not authenticated');
      if (blocked.kind === 'file') return storageService.forgetFile(blocked.fileId, user.id);
      if (!blocked.folder.id) throw new Error('Folder not found');
      return storageService.deleteFolder(blocked.folder.id, user.id, { keepTheirCloud: true });
    },
    onSuccess: deletionsChanged,
    onError: (err: Error) => onProblem(err.message),
  });

  /* Read from the deletion that stopped, rather than kept beside it: what it
     was asked to delete is its variables, and putting the question away is
     resetting it. */
  const blocked: DriveBlocked | null =
    deleteFile.isError && needsDriveConnected(deleteFile.error) && deleteFile.variables
      ? { kind: 'file', fileId: deleteFile.variables }
      : deleteFolder.isError && needsDriveConnected(deleteFolder.error) && deleteFolder.variables
        ? { kind: 'folder', folder: deleteFolder.variables }
        : null;

  const putAway = () => {
    if (blocked?.kind === 'file') deleteFile.reset();
    if (blocked?.kind === 'folder') deleteFolder.reset();
  };

  const drive = {
    /** What a deletion stopped at, for the dialog to ask about. */
    blocked: blocked?.kind ?? null,
    dismiss: putAway,
    /* Asked in the press itself, as the upload page asks it, so the window
       Google opens is not taken for a pop-up nobody asked for. Then the same
       deletion again: what went before the stop is gone, and is not asked
       for twice. */
    connect: async () => {
      putAway();
      if (!blocked) return;
      try {
        await googleDriveAuthService.authorize();
      } catch (err) {
        onProblem(err instanceof Error ? err.message : 'Google Drive was not connected');
        return;
      }
      if (blocked.kind === 'file') deleteFile.mutate(blocked.fileId);
      else deleteFolder.mutate(blocked.folder);
    },
    removeFromList: () => {
      putAway();
      if (blocked) leaveInDrive.mutate(blocked);
    },
  };

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

  return { renameFolder, deleteFolder, deleteFile, createFolder, drive };
}
