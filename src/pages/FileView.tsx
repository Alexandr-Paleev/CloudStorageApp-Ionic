import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
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
  IonInput,
  IonButtons,
  IonToast,
  IonSpinner,
  IonIcon,
  IonModal,
} from '@ionic/react';
import { download, create, trash, arrowBack } from 'ionicons/icons';
import { useAuth } from '../contexts/AuthContext';
import storageService from '../services/storage.service';
import { FileMetadata } from '../schemas/file.schema';

const FileView: React.FC = () => {
  const { fileId } = useParams<{ fileId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [showRenameModal, setShowRenameModal] = useState(false);

  const { data: file, isLoading, refetch } = useQuery<FileMetadata | null>({
    queryKey: ['file', fileId],
    queryFn: () => {
      if (!fileId) throw new Error('File ID is required');
      return storageService.getFileMetadata(fileId);
    },
    enabled: !!fileId,
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!fileId) throw new Error('File ID is required');
      return storageService.deleteFile(fileId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['storageSize', user?.id] });
      navigate('/dashboard');
    },
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) => {
      if (!fileId) throw new Error('File ID is required');
      // Note: storageService rename logic might need update if we want to change this
      // For now, let's keep it simple or implement in storage.service
      return storageService.renameFile(fileId, name);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['file', fileId] });
      queryClient.invalidateQueries({ queryKey: ['items', user?.id] });
      setShowRenameModal(false);
    },
  });

  const handleRename = () => {
    if (file) {
      setNewName(file.name);
      setShowRenameModal(true);
    }
  };

  const handleRenameSubmit = () => {
    if (newName.trim()) {
      renameMutation.mutate(newName.trim());
    }
  };

  const handleDelete = () => {
    if (window.confirm('Are you sure you want to delete this file?')) {
      deleteMutation.mutate();
    }
  };

  const getDownloadUrl = () => {
    if (!file) return undefined;
    return file.download_url;
  };

  const handleDownload = () => {
    const url = getDownloadUrl();
    if (url) {
      window.open(url, '_blank');
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const formatDate = (date: string | undefined) => {
    if (!date) return 'Unknown date';
    try {
      return new Date(date).toLocaleString();
    } catch (e) {
      return 'Invalid date';
    }
  };

  const isImage = file?.type?.startsWith('image/') ?? false;
  const downloadUrl = getDownloadUrl();
  const isPDF =
    file?.type === 'application/pdf' ||
    file?.name?.toLowerCase().endsWith('.pdf') ||
    downloadUrl?.toLowerCase().split('?')[0].endsWith('.pdf');

  if (isLoading) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonButtons slot="start">
              <IonButton onClick={() => navigate(-1)}>
                <IonIcon icon={arrowBack} />
              </IonButton>
            </IonButtons>
            <IonTitle>File</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              height: '100%',
            }}
          >
            <IonSpinner />
          </div>
        </IonContent>
      </IonPage>
    );
  }

  if (!file) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonButtons slot="start">
              <IonButton onClick={() => navigate(-1)}>
                <IonIcon icon={arrowBack} />
              </IonButton>
            </IonButtons>
            <IonTitle>File Not Found</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent>
          <IonCard>
            <IonCardContent>
              <IonLabel>File not found</IonLabel>
            </IonCardContent>
          </IonCard>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => navigate(-1)}>
              <IonIcon icon={arrowBack} />
            </IonButton>
          </IonButtons>
          <IonTitle>{file.name}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        {/* File Preview */}
        <div
          style={{
            width: '100%',
            height: '50vh',
            backgroundColor: '#f5f5f5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          {isImage && downloadUrl && (
            <img
              src={downloadUrl}
              alt={file.name}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              onError={() => {
                console.log('Image failed to load, probably expired. Refreshing...');
                refetch();
              }}
            />
          )}
          {isPDF && downloadUrl && (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
              }}
            >
              <iframe
                src={downloadUrl}
                style={{
                  width: '100%',
                  height: 'calc(100% - 60px)',
                  border: 'none',
                  flex: 1,
                  backgroundColor: '#fff',
                }}
                title={file.name}
                onError={() => {
                  console.log('PDF failed to load, probably expired. Refreshing...');
                  refetch();
                }}
              />
              <div
                style={{
                  padding: '10px',
                  textAlign: 'center',
                  backgroundColor: '#fff',
                  width: '100%',
                  borderTop: '1px solid #e0e0e0',
                }}
              >
                <IonButton
                  size="small"
                  fill="outline"
                  onClick={() => window.open(downloadUrl, '_blank')}
                >
                  <IonIcon icon={download} slot="start" />
                  Open in New Tab
                </IonButton>
              </div>
            </div>
          )}
          {!isImage && !isPDF && (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <IonLabel>
                <h2>No preview available</h2>
                <p style={{ fontSize: '14px', color: '#666', marginTop: '10px' }}>
                  File type: {file.type || 'Unknown'}
                </p>
                <p style={{ fontSize: '12px', color: '#999', marginTop: '5px' }}>
                  File name: {file.name}
                </p>
              </IonLabel>
            </div>
          )}
        </div>

        {/* File Info */}
        <div className="ion-padding">
          <IonCard>
            <IonCardHeader>
              <IonCardTitle>File Information</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <IonItem>
                <IonLabel>
                  <h2>Name</h2>
                  <p>{file.name}</p>
                </IonLabel>
              </IonItem>
              <IonItem>
                <IonLabel>
                  <h2>Size</h2>
                  <p>{formatFileSize(file.size)}</p>
                </IonLabel>
              </IonItem>
              <IonItem>
                <IonLabel>
                  <h2>Type</h2>
                  <p>{file.type}</p>
                </IonLabel>
              </IonItem>
              <IonItem>
                <IonLabel>
                  <h2>Uploaded</h2>
                  <p>{formatDate(file.created_at)}</p>
                </IonLabel>
              </IonItem>
              <IonItem>
                <IonLabel>
                  <h2>Storage</h2>
                  <p>{file.storage_type}</p>
                </IonLabel>
              </IonItem>
            </IonCardContent>
          </IonCard>

          {/* Actions */}
          <IonButton expand="block" onClick={handleDownload} style={{ marginTop: '20px' }}>
            <IonIcon icon={download} slot="start" />
            Download
          </IonButton>
          <IonButton
            expand="block"
            fill="outline"
            onClick={handleRename}
            style={{ marginTop: '10px' }}
          >
            <IonIcon icon={create} slot="start" />
            Rename
          </IonButton>
          <IonButton
            expand="block"
            fill="outline"
            color="danger"
            onClick={handleDelete}
            style={{ marginTop: '10px' }}
            disabled={deleteMutation.isPending}
          >
            <IonIcon icon={trash} slot="start" />
            {deleteMutation.isPending ? <IonSpinner name="crescent" /> : 'Delete'}
          </IonButton>
        </div>

        {/* Rename Modal */}
        <IonModal isOpen={showRenameModal} onDidDismiss={() => setShowRenameModal(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>Rename File</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setShowRenameModal(false)}>Cancel</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonItem>
              <IonLabel position="stacked">New Name</IonLabel>
              <IonInput
                value={newName}
                onIonInput={(e) => setNewName(e.detail.value!)}
                placeholder="Enter new file name"
              />
            </IonItem>
            <IonButton
              expand="block"
              onClick={handleRenameSubmit}
              disabled={!newName.trim() || renameMutation.isPending}
              style={{ marginTop: '20px' }}
            >
              {renameMutation.isPending ? <IonSpinner name="crescent" /> : 'Save'}
            </IonButton>
          </IonContent>
        </IonModal>

        <IonToast
          isOpen={deleteMutation.isError || renameMutation.isError}
          message={deleteMutation.isError ? 'Failed to delete file' : 'Failed to rename file'}
          duration={3000}
          color="danger"
        />
      </IonContent>
    </IonPage>
  );
};

export default FileView;
