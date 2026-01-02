import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonItem,
  IonLabel,
  IonIcon,
  IonButtons,
  IonToast,
  IonSpinner,
  IonRefresher,
  IonRefresherContent,
  IonAlert,
} from '@ionic/react';
import { add, logOut, document, image, folder as folderIcon, arrowBack, createOutline } from 'ionicons/icons';
import { useAuth } from '../contexts/AuthContext';
import storageService from '../services/storage.service';
import { MAX_USER_STORAGE_LIMIT } from '../services/storage.service';
import { useState } from 'react';

const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { folderId } = useParams<{ folderId?: string }>();
  const queryClient = useQueryClient();
  const [showFolderAlert, setShowFolderAlert] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  const {
    data: items,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['items', user?.id, folderId || 'root'],
    queryFn: () => {
      if (!user?.id) throw new Error('User not authenticated');
      return storageService.getItems(user.id, folderId || null);
    },
    enabled: !!user?.id,
  });

  const { data: storageSize } = useQuery({
    queryKey: ['storageSize', user?.id],
    queryFn: () => {
      if (!user?.id) throw new Error('User not authenticated');
      return storageService.getUserStorageSize(user.id);
    },
    enabled: !!user?.id,
  });

  const deleteFileMutation = useMutation({
    mutationFn: (fileId: string) => storageService.deleteFile(fileId),
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
    onError: (err: any) => {
      setErrorToast(err.message || 'Failed to create folder. Ensure Supabase is configured.');
    }
  });

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleDeleteFile = async (fileId: string) => {
    if (window.confirm('Are you sure you want to delete this file?')) {
      try {
        await deleteFileMutation.mutateAsync(fileId);
      } catch (err) {
        console.error('Failed to delete file:', err);
      }
    }
  };

  const handleRefresh = async (event: CustomEvent) => {
    await queryClient.invalidateQueries({ queryKey: ['items', user?.id] });
    await queryClient.invalidateQueries({ queryKey: ['storageSize', user?.id] });
    (event.target as HTMLIonRefresherElement).complete();
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const getFileIcon = (type: string | undefined) => {
    if (!type) return document;
    if (type.startsWith('image/')) return image;
    if (type === 'application/pdf') return document;
    return document;
  };

  const formatDate = (date: any) => {
    if (!date) return 'Unknown date';
    try {
      if (typeof date === 'string') return new Date(date).toLocaleDateString();
      if (date && typeof date === 'object' && date.toMillis && typeof date.toMillis === 'function') {
        return new Date(date.toMillis()).toLocaleDateString();
      }
      return new Date(date).toLocaleDateString();
    } catch (e) {
      console.error('Date formatting error:', e);
      return 'Invalid date';
    }
  };

  const storagePercentage = storageSize
    ? ((storageSize / MAX_USER_STORAGE_LIMIT) * 100).toFixed(1)
    : '0';

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            {folderId && (
              <IonButton onClick={() => navigate(-1)}>
                <IonIcon icon={arrowBack} />
              </IonButton>
            )}
          </IonButtons>
          <IonTitle>{folderId ? 'Folder Content' : 'My Files'}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={handleLogout}>
              <IonIcon icon={logOut} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        <div className="ion-padding">
          {/* Storage Usage Card */}
          <IonCard>
            <IonCardHeader>
              <IonCardTitle>Storage Usage</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <div
                style={{
                  width: '100%',
                  height: '20px',
                  backgroundColor: '#e0e0e0',
                  borderRadius: '10px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.min(Number(storagePercentage), 100)}%`,
                    height: '100%',
                    backgroundColor: Number(storagePercentage) > 80 ? '#eb445a' : '#2dd36f',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
              <IonLabel
                style={{ fontSize: '12px', color: '#666', marginTop: '8px', display: 'block' }}
              >
                {storagePercentage}% used
              </IonLabel>
            </IonCardContent>
          </IonCard>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <IonButton
              expand="block"
              style={{ flex: 1 }}
              onClick={() => navigate(folderId ? `/upload/${folderId}` : '/upload')}
            >
              <IonIcon icon={add} slot="start" />
              Upload
            </IonButton>
            <IonButton
              expand="block"
              fill="outline"
              style={{ flex: 1 }}
              onClick={() => setShowFolderAlert(true)}
            >
              <IonIcon icon={createOutline} slot="start" />
              New Folder
            </IonButton>
          </div>

          {/* Items List */}
          {(isLoading) && (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <IonSpinner />
            </div>
          )}

          {error && (
            <IonCard>
              <IonCardContent>
                <IonLabel color="danger">Error loading items. Please try again.</IonLabel>
              </IonCardContent>
            </IonCard>
          )}

          {items && items.files.length === 0 && items.folders.length === 0 && (
            <IonCard>
              <IonCardContent>
                <IonLabel>This folder is empty.</IonLabel>
              </IonCardContent>
            </IonCard>
          )}

          {/* Folders List */}
          {items?.folders.map((f) => (
            <IonCard
              key={f.id}
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/dashboard/${f.id}`)}
              className="folder-card"
            >
              <IonCardContent>
                <IonItem lines="none">
                  <IonIcon
                    icon={folderIcon}
                    slot="start"
                    style={{ fontSize: '32px', color: '#3171e0' }}
                  />
                  <IonLabel>
                    <h2>{f.name}</h2>
                    <p>{formatDate(f.created_at)}</p>
                  </IonLabel>
                </IonItem>
              </IonCardContent>
            </IonCard>
          ))}

          {/* Files List */}
          {items?.files.map((file) => (
            <IonCard
              key={file.id}
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/file/${file.id}`)}
            >
              <IonCardContent>
                <IonItem lines="none">
                  <IonIcon
                    icon={getFileIcon(file.type)}
                    slot="start"
                    style={{ fontSize: '32px' }}
                  />
                  <IonLabel>
                    <h2>{file.name}</h2>
                    <p>
                      {formatFileSize(file.size)} •{' '}
                      {formatDate(file.created_at || (file as any).uploadedAt)}
                    </p>
                  </IonLabel>
                  <IonButton
                    slot="end"
                    fill="clear"
                    color="danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteFile(file.id!);
                    }}
                  >
                    Delete
                  </IonButton>
                </IonItem>
              </IonCardContent>
            </IonCard>
          ))}
        </div>

        <IonToast
          isOpen={deleteFileMutation.isError}
          message="Failed to delete file"
          duration={3000}
          color="danger"
        />

        <IonAlert
          isOpen={showFolderAlert}
          onDidDismiss={() => setShowFolderAlert(false)}
          header={'New Folder'}
          inputs={[
            {
              name: 'folderName',
              type: 'text',
              placeholder: 'Folder name'
            }
          ]}
          buttons={[
            {
              text: 'Cancel',
              role: 'cancel',
              handler: () => setShowFolderAlert(false)
            },
            {
              text: 'Create',
              handler: (data) => {
                if (data.folderName) {
                  createFolderMutation.mutate(data.folderName);
                }
              }
            }
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
