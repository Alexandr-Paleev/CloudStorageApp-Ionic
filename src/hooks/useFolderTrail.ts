import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import storageService from '../services/storage.service';

/** Where the dashboard is: the folder it shows, the folders above it, and the one just above. */
export function useFolderTrail(folderId: string | undefined) {
  const { user } = useAuth();

  const { data: folder } = useQuery({
    queryKey: ['folder', folderId],
    queryFn: () => {
      if (!user?.id || !folderId) return null;
      return storageService.getFolder(folderId, user.id);
    },
    enabled: !!user?.id && !!folderId,
  });

  /* The chain above the current folder, for the breadcrumb bar and for the
     back button — which used to go to the root from any depth. */
  const { data: path = [] } = useQuery({
    queryKey: ['folderPath', user?.id, folderId],
    queryFn: () => {
      if (!user?.id || !folderId) return [];
      return storageService.getFolderPath(folderId, user.id);
    },
    enabled: !!user?.id && !!folderId,
  });

  /** Null at the first level down as well as at the root: above it is the root. */
  const parentId = path.length > 1 ? (path[path.length - 2]?.id ?? null) : null;

  return { folder, path, parentId };
}
