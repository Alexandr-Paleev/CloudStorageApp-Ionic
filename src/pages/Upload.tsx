import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
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
  IonProgressBar,
  IonToast,
  IonButtons,
  IonBackButton,
  IonSpinner,
  IonAlert,
} from '@ionic/react';
import { useAuth } from '../contexts/AuthContext';
import storageService, {
  UploadProgress,
  MAX_USER_STORAGE_LIMIT,
} from '../services/storage.service';
import googleDriveAuthService from '../services/googledrive-auth.service';
import { formatFileSize } from '../utils/format.utils';

const Upload: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { folderId } = useParams<{ folderId?: string }>();
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState('');
  const [showGoogleDriveAlert, setShowGoogleDriveAlert] = useState(false);
  const [useGoogleDrive, setUseGoogleDrive] = useState(false);

  // Check storage size
  const { data: storageSize } = useQuery({
    queryKey: ['storageSize', user?.id],
    queryFn: () => {
      if (!user?.id) throw new Error('User not authenticated');
      return storageService.getUserStorageSize(user.id);
    },
    enabled: !!user?.id,
  });

  const { data: isGoogleDriveConnected } = useQuery({
    queryKey: ['googleDriveConnected'],
    queryFn: () => googleDriveAuthService.isAuthorized(),
    staleTime: 1000 * 60 * 5,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!user?.id) throw new Error('User not authenticated');

      return storageService.uploadFile(
        user.id,
        file,
        (progress) => {
          setUploadProgress(progress);
        },
        folderId || null,
        useGoogleDrive
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['storageSize', user?.id] });
      if (folderId) {
        navigate(`/dashboard/${folderId}`);
      } else {
        navigate('/dashboard');
      }
    },
    onError: (err: Error) => {
      setError(err.message);
      setUploadProgress(null);
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError('');
      setUploadProgress(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !user?.id) return;

    setError('');
    setUploadProgress({ bytesTransferred: 0, totalBytes: selectedFile.size, progress: 0 });

    // Check if storage limit would be exceeded
    const wouldExceedLimit =
      storageSize !== undefined && storageSize + selectedFile.size > MAX_USER_STORAGE_LIMIT;

    if (wouldExceedLimit && !isGoogleDriveConnected && !useGoogleDrive) {
      setShowGoogleDriveAlert(true);
      return;
    }

    try {
      await uploadMutation.mutateAsync(selectedFile);
    } catch (err) {
      // Error handled in onError
    }
  };

  const handleConnectGoogleDrive = async () => {
    try {
      await googleDriveAuthService.authorize();
      queryClient.invalidateQueries({ queryKey: ['googleDriveConnected'] });
      setUseGoogleDrive(true);
      setShowGoogleDriveAlert(false);
      // Retry upload after connecting
      if (selectedFile) {
        await uploadMutation.mutateAsync(selectedFile);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Google Drive');
    }
  };


  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/dashboard" />
          </IonButtons>
          <IonTitle>Upload File</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="ion-padding">
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>Select File</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <input
              type="file"
              id="file-input"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
              disabled={uploadMutation.isPending}
            />
            <IonButton
              expand="block"
              fill="outline"
              onClick={() => document.getElementById('file-input')?.click()}
              disabled={uploadMutation.isPending}
            >
              Choose File
            </IonButton>

            {selectedFile && (
              <IonItem style={{ marginTop: '20px' }}>
                <IonLabel>
                  <h2>{selectedFile.name}</h2>
                  <p>
                    {formatFileSize(selectedFile.size)} • {selectedFile.type}
                  </p>
                </IonLabel>
              </IonItem>
            )}

            {uploadProgress && (
              <div style={{ marginTop: '20px' }}>
                <IonLabel>Uploading... {uploadProgress.progress.toFixed(1)}%</IonLabel>
                <IonProgressBar value={uploadProgress.progress / 100} />
                <IonLabel
                  style={{ fontSize: '12px', color: '#666', marginTop: '5px', display: 'block' }}
                >
                  {formatFileSize(uploadProgress.bytesTransferred)} /{' '}
                  {formatFileSize(uploadProgress.totalBytes)}
                </IonLabel>
              </div>
            )}

            {error && (
              <IonLabel color="danger" style={{ display: 'block', marginTop: '10px' }}>
                {error}
              </IonLabel>
            )}

            {isGoogleDriveConnected && (
              <IonItem style={{ marginTop: '10px' }}>
                <IonLabel>
                  <p style={{ fontSize: '12px', color: '#2dd36f' }}>
                    ✓ Google Drive connected - files will be saved to Google Drive
                  </p>
                </IonLabel>
              </IonItem>
            )}

            <IonButton
              expand="block"
              onClick={handleUpload}
              disabled={!selectedFile || uploadMutation.isPending}
              style={{ marginTop: '20px' }}
            >
              {uploadMutation.isPending ? <IonSpinner name="crescent" /> : 'Upload'}
            </IonButton>
          </IonCardContent>
        </IonCard>

        <IonToast
          isOpen={!!error}
          message={error}
          duration={5000}
          color="danger"
          onDidDismiss={() => setError('')}
        />

        <IonAlert
          isOpen={showGoogleDriveAlert}
          onDidDismiss={() => setShowGoogleDriveAlert(false)}
          header="Storage Limit Exceeded"
          message={`You've used ${((storageSize || 0) / 1024 / 1024).toFixed(2)} MB of your 500 MB limit. Connect Google Drive to upload more files?`}
          buttons={[
            {
              text: 'Cancel',
              role: 'cancel',
            },
            {
              text: 'Connect Google Drive',
              handler: handleConnectGoogleDrive,
            },
          ]}
        />
      </IonContent>
    </IonPage>
  );
};

export default Upload;
