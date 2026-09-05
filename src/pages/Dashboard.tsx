import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonButton,
  IonItem,
  IonLabel,
  IonIcon,
  IonButtons,
  IonToast,
  IonSpinner,
  IonRefresher,
  IonRefresherContent,
  IonAlert,
  IonActionSheet,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  IonList,
  IonGrid,
  IonRow,
  IonCol,
  IonText,
} from '@ionic/react';
import {
  add,
  logOutOutline,
  personCircleOutline,
  documentTextOutline,
  imageOutline,
  folderOpen,
  ellipsisHorizontal,
  arrowBack,
  createOutline,
  trashOutline,
  cloud,
  rocketOutline,
  star,
} from 'ionicons/icons';
import { useAuth } from '../contexts/AuthContext';
import FileFilters, { type FileFiltersValue } from '../components/FileFilters';
import FolderBreadcrumbs from '../components/FolderBreadcrumbs';
import OfflineQueueBanner from '../components/OfflineQueueBanner';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import { applyPending } from '../services/mutation-queue';
import { DEFAULT_DIRECTION, DEFAULT_SORT } from '../utils/file-query';
import storageService, { type Folder } from '../services/storage.service';
import { DEFAULT_STORAGE_LIMIT } from '../../lib/tiers';
import { useProfile } from '../hooks/useProfile';
import UpgradeBanner from '../components/UpgradeBanner';
import { billingIsOffered } from '../utils/billing.utils';
import { useState } from 'react';
import { getThumbnailUrl } from '../utils/thumbnail.utils';
import { formatFileSize, formatDateTime } from '../utils/format.utils';
import { storageMeter } from '../utils/quota.utils';
import './Dashboard.css';

const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const { profile } = useProfile();
  const navigate = useNavigate();
  const { folderId } = useParams<{ folderId?: string }>();
  const queryClient = useQueryClient();
  const offlineQueue = useOfflineQueue();
  const [showFolderAlert, setShowFolderAlert] = useState(false);
  const [showDeleteAlert, setShowDeleteAlert] = useState<{
    isOpen: boolean;
    fileId: string | null;
  }>({
    isOpen: false,
    fileId: null,
  });
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [folderMenu, setFolderMenu] = useState<Folder | null>(null);
  const [folderAction, setFolderAction] = useState<'rename' | 'delete' | null>(null);
  const [renaming, setRenaming] = useState<Folder | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null);
  const [filters, setFilters] = useState<FileFiltersValue>({
    search: '',
    sort: DEFAULT_SORT,
    direction: DEFAULT_DIRECTION,
    group: 'all',
  });

  const PAGE_SIZE = 15;

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
    enabled: !!user?.id,
  });

  /* The server's answer, plus whatever this device has queued and not yet
     sent. The cache stays a truthful snapshot; the queue is applied on top. */
  const items = applyPending(
    {
      files: data?.pages.flatMap((page) => page.files) || [],
      folders: data?.pages[0]?.folders || [],
    },
    offlineQueue.ops
  );

  const { data: storageSize } = useQuery({
    queryKey: ['storageSize', user?.id],
    queryFn: () => {
      if (!user?.id) throw new Error('User not authenticated');
      return storageService.getUserStorageSize(user.id);
    },
    enabled: !!user?.id,
  });

  const { data: currentFolder } = useQuery({
    queryKey: ['folder', folderId],
    queryFn: () => {
      if (!user?.id || !folderId) return null;
      return storageService.getFolder(folderId, user.id);
    },
    enabled: !!user?.id && !!folderId,
  });

  /* The chain above the current folder, for the breadcrumb bar and for the
     back button — which used to go to the root from any depth. */
  const { data: folderPath = [] } = useQuery({
    queryKey: ['folderPath', user?.id, folderId],
    queryFn: () => {
      if (!user?.id || !folderId) return [];
      return storageService.getFolderPath(folderId, user.id);
    },
    enabled: !!user?.id && !!folderId,
  });

  const parentId = folderPath.length > 1 ? (folderPath[folderPath.length - 2].id ?? null) : null;

  const openFolder = (id: string | null) => navigate(id ? `/dashboard/${id}` : '/dashboard');

  const renameFolderMutation = useMutation({
    mutationFn: ({ folder, name }: { folder: Folder; name: string }) => {
      if (!user?.id || !folder.id) throw new Error('User not authenticated');
      const folderId = folder.id;

      return offlineQueue.runOrQueue({ kind: 'renameFolder', folderId, name }, () =>
        storageService.renameFolder(folderId, user.id, name)
      );
    },
    /* Without this TanStack pauses the mutation while the browser reports no
       network and never calls mutationFn at all — the change would live only
       in this tab's memory, and a reload would lose it. The queue in
       services/mutation-queue.ts is what makes it durable, and it only gets
       the chance if the attempt is actually made. */
    networkMode: 'always' as const,

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['folder', folderId] });
      queryClient.invalidateQueries({ queryKey: ['folderPath', user?.id] });
    },
    onError: (err: Error) => setErrorToast(err.message),
  });

  const deleteFolderMutation = useMutation({
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
    /* Without this TanStack pauses the mutation while the browser reports no
       network and never calls mutationFn at all — the change would live only
       in this tab's memory, and a reload would lose it. The queue in
       services/mutation-queue.ts is what makes it durable, and it only gets
       the chance if the attempt is actually made. */
    networkMode: 'always' as const,

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', user?.id] });
      // Deleting a folder deletes its files, so the meter moves too.
      queryClient.invalidateQueries({ queryKey: ['storageSize', user?.id] });
    },
    onError: (err: Error) => setErrorToast(err.message),
  });

  const deleteFileMutation = useMutation({
    mutationFn: (fileId: string) => {
      if (!user?.id) throw new Error('User not authenticated');
      const userId = user.id;

      /* Offline this is written down and applied to the listing; online it is
         an ordinary delete. Either way the button does what it says. */
      return offlineQueue.runOrQueue({ kind: 'deleteFile', fileId }, () =>
        storageService.deleteFile(fileId, userId)
      );
    },
    /* Without this TanStack pauses the mutation while the browser reports no
       network and never calls mutationFn at all — the change would live only
       in this tab's memory, and a reload would lose it. The queue in
       services/mutation-queue.ts is what makes it durable, and it only gets
       the chance if the attempt is actually made. */
    networkMode: 'always' as const,

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['storageSize', user?.id] });
    },
  });

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => {
      if (!user?.id) throw new Error('User not authenticated');
      return storageService.createFolder(user.id, name, folderId || null);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', user?.id] });
      setShowFolderAlert(false);
    },
    onError: (err: Error) => {
      setErrorToast(err.message || 'Failed to create folder. Ensure Supabase is configured.');
    },
  });

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleDeleteFile = (fileId: string) => {
    setShowDeleteAlert({ isOpen: true, fileId });
  };

  const handleRefresh = async (event: CustomEvent) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['items', user?.id] }),
      queryClient.invalidateQueries({ queryKey: ['storageSize', user?.id] }),
    ]);
    (event.target as HTMLIonRefresherElement).complete();
  };

  const getFileIcon = (type: string | undefined) => {
    if (!type) return documentTextOutline;
    if (type.startsWith('image/')) return imageOutline;
    if (type === 'application/pdf') return documentTextOutline;
    return documentTextOutline;
  };

  // Safe calculation for storage — use dynamic limit from profile
  const usedBytes = storageSize || 0;
  const storageLimit = profile?.storage_limit ?? DEFAULT_STORAGE_LIMIT;
  const {
    barWidth,
    percentage: percentageDisplay,
    isOverLimit,
  } = storageMeter(usedBytes, storageLimit);

  return (
    <IonPage>
      <IonHeader className="ion-no-border">
        <IonToolbar>
          <IonButtons slot="start">
            {folderId && (
              /* The folder above, not the root: from two levels down those are
                 different places, and only one of them is "back". */
              <IonButton
                onClick={() => openFolder(parentId)}
                color="dark"
                title="Up one folder"
                aria-label="Up one folder"
              >
                <IonIcon icon={arrowBack} aria-hidden="true" />
              </IonButton>
            )}
          </IonButtons>
          {/* At the root you are not inside a folder, and the bar said "Folder"
              anyway — on the dashboard, in the mobile header, and in the hero
              screenshot of the README. */}
          <IonTitle>{folderId && currentFolder ? currentFolder.name : 'My Files'}</IonTitle>
          <IonButtons slot="end">
            {/* The only permanent way into billing: UpgradeBanner appears at
                80% usage, so without this a user could not reach the plans at
                all, and a Pro user had no route to the customer portal.
                Hidden where Stripe is not configured, and in the native shell,
                which sells nothing at all — see billingIsOffered. */}
            {billingIsOffered() && (
              <IonButton
                onClick={() => navigate('/pricing')}
                color="dark"
                data-testid="pricing-link"
                title={profile?.tier === 'pro' ? 'Manage subscription' : 'Plans'}
                aria-label={profile?.tier === 'pro' ? 'Manage subscription' : 'Plans'}
              >
                <IonIcon icon={profile?.tier === 'pro' ? star : rocketOutline} aria-hidden="true" />
              </IonButton>
            )}
            {/* Both stores require a person who can create an account to be
                able to delete it from inside the app, and to find that without
                being told where it is — Apple 5.1.1(v), Google's account
                deletion policy. The page behind it is where it lives. */}
            <IonButton
              onClick={() => navigate('/account')}
              color="dark"
              data-testid="account-link"
              title="Account"
              aria-label="Account"
            >
              <IonIcon icon={personCircleOutline} aria-hidden="true" />
            </IonButton>
            <IonButton onClick={handleLogout} color="dark" aria-label="Sign out">
              <IonIcon icon={logOutOutline} aria-hidden="true" />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen className="ion-padding-horizontal">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        <div className="dashboard-header-spacer">
          <div className="glass-card storage-card">
            <div className="storage-header">
              <IonText color="dark" className="storage-title">
                Storage Used
              </IonText>
              <IonText color={isOverLimit ? 'danger' : 'medium'} className="storage-percentage">
                {percentageDisplay}%
              </IonText>
            </div>

            <div className="storage-bar-container">
              <div
                className="storage-bar-fill"
                style={{
                  width: `${barWidth}%`,
                }}
              />
            </div>

            <IonText color={isOverLimit ? 'danger' : 'medium'} className="storage-stats">
              {formatFileSize(usedBytes)} of {formatFileSize(storageLimit)} used
              {isOverLimit &&
                ` — ${formatFileSize(usedBytes - storageLimit)} over the limit, uploads are blocked until you free up space`}
              {profile?.tier === 'pro' && <span className="tier-badge tier-badge--pro">Pro</span>}
            </IonText>
          </div>

          <UpgradeBanner usedBytes={usedBytes} storageLimit={storageLimit} tier={profile?.tier} />

          <div className="dashboard-actions-grid">
            <IonButton
              className="premium-button"
              expand="block"
              onClick={() => navigate(folderId ? `/upload/${folderId}` : '/upload')}
            >
              <IonIcon icon={add} slot="start" aria-hidden="true" />
              Upload
            </IonButton>
            <IonButton
              color="light"
              className="premium-button new-folder-button"
              expand="block"
              onClick={() => setShowFolderAlert(true)}
            >
              <IonIcon icon={createOutline} slot="start" aria-hidden="true" />
              New Folder
            </IonButton>
          </div>

          <OfflineQueueBanner
            pending={offlineQueue.pending}
            discarded={offlineQueue.lastResult?.discarded ?? []}
            onRetry={() => offlineQueue.flush()}
          />

          {folderId && folderPath.length > 0 && (
            <FolderBreadcrumbs path={folderPath} onNavigate={openFolder} />
          )}

          <FileFilters value={filters} onChange={setFilters} resultCount={items.files.length} />

          {items?.folders && items.folders.length > 0 && (
            <div className="folders-section">
              <IonText color="dark" className="section-title">
                Folders
              </IonText>
              <IonGrid className="folders-grid">
                <IonRow>
                  {items.folders.map((f) => (
                    <IonCol size="6" sizeSm="4" sizeMd="3" key={f.id}>
                      <div className="folder-card">
                        <IonIcon icon={folderOpen} className="folder-icon" aria-hidden="true" />
                        <IonText color="dark" className="folder-name">
                          {f.name}
                        </IonText>

                        {/* The card was the button, and the menu below was a
                            button inside it. Now the card is a plain container
                            and this one covers it, leaving the menu a sibling
                            that keyboard and screen readers can reach on their
                            own. */}
                        <button
                          type="button"
                          className="row-open"
                          onClick={() => navigate(`/dashboard/${f.id}`)}
                        >
                          <span className="sr-only">Open {f.name}</span>
                        </button>

                        {/* stopPropagation, or opening the menu also opens the
                            folder the menu belongs to. */}
                        <IonButton
                          fill="clear"
                          size="small"
                          className="folder-menu-button"
                          aria-label={`Actions for ${f.name}`}
                          data-testid={`folder-actions-${f.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setFolderMenu(f);
                          }}
                        >
                          <IonIcon icon={ellipsisHorizontal} aria-hidden="true" />
                        </IonButton>
                      </div>
                    </IonCol>
                  ))}
                </IonRow>
              </IonGrid>
            </div>
          )}

          <div>
            <IonText color="dark" className="section-title">
              Files
            </IonText>

            {isLoading && (
              <div className="files-loading">
                <IonSpinner color="primary" aria-label="Loading files" />
              </div>
            )}

            {error && <div className="files-error">Error loading items.</div>}

            {!isLoading &&
              items?.files.length === 0 &&
              (!items.folders || items.folders.length === 0) && (
                <div className="files-empty">
                  <IonIcon icon={cloud} className="files-empty-icon" aria-hidden="true" />
                  <p>No files yet. Upload something!</p>
                </div>
              )}

            <IonList lines="none" className="files-list">
              {items?.files.map((file) => (
                /* The row is the list item itself. It used to be a div with
                   role="button" wrapped around an ion-item, which broke three
                   things at once: a list whose children were not list items, a
                   list item with no list above it, and a delete button nested
                   inside a button. The primary action is now a real button
                   stretched over the row, and delete is its sibling — two
                   controls side by side, inside one list item. */
                <IonItem
                  key={file.id}
                  detail={false}
                  lines="none"
                  className="glass-card file-list-item file-item-inner"
                >
                  <div slot="start" className="file-thumbnail-container">
                    {file.type?.startsWith('image/') ? (
                      <div className="file-thumbnail-img-box">
                        {/* getThumbnailUrl only resizes on Cloudinary — the
                              other backends hand back the original, so a long
                              list would otherwise fetch every full-size image
                              at once. lazy + async decoding keeps the ones
                              below the fold out of the way; the dimensions
                              reserve the box so the list does not jump. */}
                        <img
                          src={getThumbnailUrl(file.download_url, file.storage_type, 100, 100)}
                          alt={file.name}
                          className="file-thumbnail-img"
                          loading="lazy"
                          decoding="async"
                          width={100}
                          height={100}
                        />
                      </div>
                    ) : (
                      <div className="file-icon-box">
                        <IonIcon
                          icon={getFileIcon(file.type)}
                          className="file-icon"
                          aria-hidden="true"
                        />
                      </div>
                    )}
                  </div>

                  <IonLabel className="ion-text-wrap">
                    <h2 className="file-meta-name">{file.name}</h2>
                    <p className="file-meta-details">
                      {formatFileSize(file.size)} • {formatDateTime(file.created_at)}
                    </p>
                  </IonLabel>

                  {/* Stretched over the row rather than wrapped around it, so
                        the whole card stays clickable without swallowing the
                        delete button. */}
                  <button
                    type="button"
                    className="row-open"
                    onClick={() => navigate(`/file/${file.id}`)}
                  >
                    <span className="sr-only">Open {file.name}</span>
                  </button>

                  <IonButton
                    slot="end"
                    fill="clear"
                    color="medium"
                    aria-label={`Delete ${file.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteFile(file.id!);
                    }}
                  >
                    <IonIcon
                      icon={trashOutline}
                      color="danger"
                      className="file-delete-icon"
                      aria-hidden="true"
                    />
                  </IonButton>
                </IonItem>
              ))}
            </IonList>

            <IonInfiniteScroll
              onIonInfinite={async (ev) => {
                await fetchNextPage();
                (ev.target as HTMLIonInfiniteScrollElement).complete();
              }}
              disabled={!hasNextPage}
            >
              <IonInfiniteScrollContent loadingText="" loadingSpinner="bubbles" />
            </IonInfiniteScroll>
          </div>
        </div>

        <IonActionSheet
          isOpen={!!folderMenu}
          header={folderMenu?.name}
          /* The dialog opens here rather than in the button handler: Ionic
             presents one overlay at a time, and an alert asked for while the
             sheet is still dismissing never appears. */
          onDidDismiss={() => {
            const folder = folderMenu;
            setFolderMenu(null);
            if (folderAction === 'rename') setRenaming(folder);
            if (folderAction === 'delete') setDeletingFolder(folder);
            setFolderAction(null);
          }}
          buttons={[
            { text: 'Rename', handler: () => setFolderAction('rename') },
            { text: 'Delete', role: 'destructive', handler: () => setFolderAction('delete') },
            { text: 'Cancel', role: 'cancel' },
          ]}
        />

        <IonAlert
          isOpen={!!renaming}
          onDidDismiss={() => setRenaming(null)}
          header="Rename folder"
          inputs={[
            { name: 'name', type: 'text', value: renaming?.name, placeholder: 'Folder name' },
          ]}
          buttons={[
            { text: 'Cancel', role: 'cancel' },
            {
              text: 'Save',
              handler: (data: { name?: string }) => {
                const name = data.name?.trim();
                if (!renaming || !name || name === renaming.name) return;
                renameFolderMutation.mutate({ folder: renaming, name });
              },
            },
          ]}
        />

        <IonAlert
          isOpen={!!deletingFolder}
          onDidDismiss={() => setDeletingFolder(null)}
          header="Delete folder?"
          /* Said in full, because it cannot be undone and because what goes is
             more than what was clicked: every file inside, and every folder
             below it. */
          message={`“${deletingFolder?.name}” and everything inside it — files and subfolders — will be deleted from storage. This cannot be undone.`}
          buttons={[
            { text: 'Cancel', role: 'cancel' },
            {
              text: 'Delete',
              role: 'destructive',
              handler: () => {
                if (deletingFolder) deleteFolderMutation.mutate(deletingFolder);
              },
            },
          ]}
        />

        <IonToast
          isOpen={deleteFileMutation.isError}
          message="Failed to delete file"
          duration={3000}
          color="danger"
        />

        <IonAlert
          isOpen={showDeleteAlert.isOpen}
          onDidDismiss={() => setShowDeleteAlert({ isOpen: false, fileId: null })}
          header="Delete File"
          message="Are you sure you want to delete this file? This action is permanent."
          buttons={[
            {
              text: 'Cancel',
              role: 'cancel',
              handler: () => setShowDeleteAlert({ isOpen: false, fileId: null }),
            },
            {
              text: 'Delete',
              role: 'destructive',
              handler: () => {
                if (showDeleteAlert.fileId) {
                  deleteFileMutation.mutate(showDeleteAlert.fileId);
                }
              },
            },
          ]}
        />

        <IonAlert
          isOpen={showFolderAlert}
          onDidDismiss={() => setShowFolderAlert(false)}
          header={'New Folder'}
          inputs={[
            {
              name: 'folderName',
              type: 'text',
              placeholder: 'Folder name',
            },
          ]}
          buttons={[
            {
              text: 'Cancel',
              role: 'cancel',
              handler: () => setShowFolderAlert(false),
            },
            {
              text: 'Create',
              handler: (data) => {
                if (data.folderName) {
                  createFolderMutation.mutate(data.folderName);
                }
              },
            },
          ]}
        />
        <IonToast
          isOpen={!!errorToast}
          message={errorToast || 'An error occurred'}
          duration={3000}
          color="danger"
          onDidDismiss={() => setErrorToast(null)}
        />
      </IonContent>
    </IonPage>
  );
};

export default Dashboard;
