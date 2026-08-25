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
  documentTextOutline,
  imageOutline,
  folderOpen,
  arrowBack,
  createOutline,
  trashOutline,
  cloud,
  rocketOutline,
  star,
} from 'ionicons/icons';
import { useAuth } from '../contexts/AuthContext';
import storageService from '../services/storage.service';
import { MAX_USER_STORAGE_LIMIT } from '../services/storage.service';
import { useProfile } from '../hooks/useProfile';
import UpgradeBanner from '../components/UpgradeBanner';
import { env } from '../env';
import { useState } from 'react';
import { getThumbnailUrl } from '../utils/thumbnail.utils';
import { formatFileSize, formatDateTime } from '../utils/format.utils';
import './Dashboard.css';

const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const { profile } = useProfile();
  const navigate = useNavigate();
  const { folderId } = useParams<{ folderId?: string }>();
  const queryClient = useQueryClient();
  const [showFolderAlert, setShowFolderAlert] = useState(false);
  const [showDeleteAlert, setShowDeleteAlert] = useState<{
    isOpen: boolean;
    fileId: string | null;
  }>({
    isOpen: false,
    fileId: null,
  });
  const [errorToast, setErrorToast] = useState<string | null>(null);

  const PAGE_SIZE = 15;

  const { data, fetchNextPage, hasNextPage, isLoading, error } = useInfiniteQuery({
    queryKey: ['items', user?.id, folderId || 'root'],
    queryFn: ({ pageParam = 0 }) => {
      if (!user?.id) throw new Error('User not authenticated');
      return storageService.getItems(user.id, folderId || null, pageParam as number, PAGE_SIZE);
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.files.length < PAGE_SIZE) return undefined;
      return allPages.length;
    },
    initialPageParam: 0,
    enabled: !!user?.id,
  });

  const items = {
    files: data?.pages.flatMap((page) => page.files) || [],
    folders: data?.pages[0]?.folders || [],
  };

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

  const deleteFileMutation = useMutation({
    mutationFn: (fileId: string) => {
      if (!user?.id) throw new Error('User not authenticated');
      return storageService.deleteFile(fileId, user.id);
    },
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
  const storageLimit = profile?.storage_limit ?? MAX_USER_STORAGE_LIMIT;
  // The bar stops at full, the number does not: cancelling Pro drops the limit
  // back to 500 MB, and rounding that down to "100.0%" hides how far over the
  // account actually is — which is also why uploads start failing.
  const storageRatio = storageLimit > 0 ? usedBytes / storageLimit : 0;
  const barWidth = (Math.min(storageRatio, 1) * 100).toFixed(1);
  const percentageDisplay = (storageRatio * 100).toFixed(1);
  const isOverLimit = usedBytes > storageLimit;

  return (
    <IonPage>
      <IonHeader className="ion-no-border">
        <IonToolbar>
          <IonButtons slot="start">
            {folderId && (
              <IonButton onClick={() => navigate('/dashboard')} color="dark">
                <IonIcon icon={arrowBack} />
              </IonButton>
            )}
          </IonButtons>
          <IonTitle>{folderId && currentFolder ? currentFolder.name : 'Folder'}</IonTitle>
          <IonButtons slot="end">
            {/* The only permanent way into billing: UpgradeBanner appears at
                80% usage, so without this a user could not reach the plans at
                all, and a Pro user had no route to the customer portal.
                Hidden where Stripe is not configured — see VITE_BILLING_ENABLED. */}
            {env.VITE_BILLING_ENABLED && (
              <IonButton
                onClick={() => navigate('/pricing')}
                color="dark"
                data-testid="pricing-link"
                title={profile?.tier === 'pro' ? 'Manage subscription' : 'Plans'}
              >
                <IonIcon icon={profile?.tier === 'pro' ? star : rocketOutline} />
              </IonButton>
            )}
            <IonButton onClick={handleLogout} color="dark">
              <IonIcon icon={logOutOutline} />
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
              <IonIcon icon={add} slot="start" />
              Upload
            </IonButton>
            <IonButton
              color="light"
              className="premium-button new-folder-button"
              expand="block"
              onClick={() => setShowFolderAlert(true)}
            >
              <IonIcon icon={createOutline} slot="start" />
              New Folder
            </IonButton>
          </div>

          {items?.folders && items.folders.length > 0 && (
            <div className="folders-section">
              <IonText color="dark" className="section-title">
                Folders
              </IonText>
              <IonGrid className="folders-grid">
                <IonRow>
                  {items.folders.map((f) => (
                    <IonCol size="6" sizeSm="4" sizeMd="3" key={f.id}>
                      <div
                        onClick={() => navigate(`/dashboard/${f.id}`)}
                        className="folder-card"
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            navigate(`/dashboard/${f.id}`);
                          }
                        }}
                      >
                        <IonIcon icon={folderOpen} className="folder-icon" />
                        <IonText color="dark" className="folder-name">
                          {f.name}
                        </IonText>
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
                <IonSpinner color="primary" />
              </div>
            )}

            {error && <div className="files-error">Error loading items.</div>}

            {!isLoading &&
              items?.files.length === 0 &&
              (!items.folders || items.folders.length === 0) && (
                <div className="files-empty">
                  <IonIcon icon={cloud} className="files-empty-icon" />
                  <p>No files yet. Upload something!</p>
                </div>
              )}

            <IonList lines="none" className="files-list">
              {items?.files.map((file) => (
                <div
                  key={file.id}
                  className="glass-card file-list-item"
                  onClick={() => navigate(`/file/${file.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      navigate(`/file/${file.id}`);
                    }
                  }}
                >
                  <IonItem detail={false} lines="none" className="file-item-inner">
                    <div slot="start" className="file-thumbnail-container">
                      {file.type?.startsWith('image/') ? (
                        <div className="file-thumbnail-img-box">
                          <img
                            src={getThumbnailUrl(file.download_url, file.storage_type, 100, 100)}
                            alt={file.name}
                            className="file-thumbnail-img"
                          />
                        </div>
                      ) : (
                        <div className="file-icon-box">
                          <IonIcon icon={getFileIcon(file.type)} className="file-icon" />
                        </div>
                      )}
                    </div>

                    <IonLabel className="ion-text-wrap">
                      <h2 className="file-meta-name">{file.name}</h2>
                      <p className="file-meta-details">
                        {formatFileSize(file.size)} • {formatDateTime(file.created_at)}
                      </p>
                    </IonLabel>

                    <IonButton
                      slot="end"
                      fill="clear"
                      color="medium"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFile(file.id!);
                      }}
                    >
                      <IonIcon icon={trashOutline} color="danger" className="file-delete-icon" />
                    </IonButton>
                  </IonItem>
                </div>
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
