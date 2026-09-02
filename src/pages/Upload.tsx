import { useRef, useState } from 'react';
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
  FileMetadata,
  PendingUpload,
} from '../services/storage.service';
import { DEFAULT_STORAGE_LIMIT } from '../../lib/tiers';
import googleDriveAuthService from '../services/googledrive-auth.service';
import { useProfile } from '../hooks/useProfile';
import ProviderSelector from '../components/ProviderSelector';
import ResumableUploads from '../components/ResumableUploads';
import { formatFileSize } from '../utils/format.utils';
import { shouldUseMultipart } from '../../lib/multipart';
import { useAnalytics } from '../hooks/useAnalytics';

const Upload: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { folderId } = useParams<{ folderId?: string }>();
  const queryClient = useQueryClient();
  const { trackFileUpload } = useAnalytics();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState('');
  const [showGoogleDriveAlert, setShowGoogleDriveAlert] = useState(false);
  const [useGoogleDrive, setUseGoogleDrive] = useState(false);
  const [preferredProvider, setPreferredProvider] = useState<string | undefined>(undefined);
  const [paused, setPaused] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  /* Held in a ref rather than in state: aborting must not wait for a render,
     and nothing about the controller itself belongs on screen. */
  const abortRef = useRef<AbortController | null>(null);
  const { profile } = useProfile();
  const storageLimit = profile?.storage_limit ?? DEFAULT_STORAGE_LIMIT;

  // Check storage size
  const { data: storageSize } = useQuery({
    queryKey: ['storageSize', user?.id],
    queryFn: () => {
      if (!user?.id) throw new Error('User not authenticated');
      return storageService.getUserStorageSize(user.id);
    },
    enabled: !!user?.id,
  });

  /* Read from IndexedDB, so an upload interrupted by a closed tab is offered
     again when the page comes back. */
  const { data: resumable = [] } = useQuery({
    queryKey: ['resumableUploads', user?.id],
    queryFn: () => storageService.resumableUploads(),
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

      abortRef.current = new AbortController();
      setPaused(false);

      return storageService.uploadFile(
        user.id,
        file,
        (progress) => {
          setUploadProgress(progress);
        },
        folderId || null,
        useGoogleDrive,
        {
          preferredProvider,
          allowedProviders: profile?.allowed_providers,
          storageLimit: profile?.storage_limit,
          signal: abortRef.current.signal,
        }
      );
    },
    onSuccess: (result: FileMetadata, file: File) => {
      // Track file upload analytics
      trackFileUpload({
        file_type: file.type,
        file_size: file.size,
        storage_provider: result.storage_type,
        folder_id: folderId || undefined,
      });

      finishUpload(result);
    },
    onError: (err: Error) => {
      // Pausing raises too — it is how the part loop stops — but it is not a
      // failure, and saying so in red would be a lie about what happened.
      if (err.name === 'UploadPausedError' || err.name === 'AbortError') {
        setPaused(true);
        queryClient.invalidateQueries({ queryKey: ['resumableUploads', user?.id] });
        return;
      }

      setError(err.message);
      setUploadProgress(null);
    },
  });

  const finishUpload = (result: FileMetadata) => {
    queryClient.invalidateQueries({ queryKey: ['items', user?.id] });
    queryClient.invalidateQueries({ queryKey: ['storageSize', user?.id] });
    queryClient.invalidateQueries({ queryKey: ['resumableUploads', user?.id] });
    navigate(folderId ? `/dashboard/${folderId}` : '/dashboard');
    return result;
  };

  const resumeMutation = useMutation({
    mutationFn: async (upload: PendingUpload) => {
      if (!user?.id) throw new Error('User not authenticated');

      abortRef.current = new AbortController();
      setBusyKey(upload.key);
      setPaused(false);
      setUploadProgress({ bytesTransferred: 0, totalBytes: upload.size, progress: 0 });

      return storageService.resumeUpload(
        user.id,
        upload,
        setUploadProgress,
        abortRef.current.signal
      );
    },
    onSuccess: finishUpload,
    onError: (err: Error) => {
      setBusyKey(null);
      if (err.name === 'UploadPausedError' || err.name === 'AbortError') {
        setPaused(true);
        queryClient.invalidateQueries({ queryKey: ['resumableUploads', user?.id] });
        return;
      }
      setError(err.message);
      setUploadProgress(null);
    },
    onSettled: () => setBusyKey(null),
  });

  const discardMutation = useMutation({
    mutationFn: async (upload: PendingUpload) => {
      setBusyKey(upload.key);
      await storageService.discardUpload(upload);
    },
    onSettled: () => {
      setBusyKey(null);
      queryClient.invalidateQueries({ queryKey: ['resumableUploads', user?.id] });
    },
  });

  const pauseUpload = () => abortRef.current?.abort();

  /* Whether this upload is one that can be paused at all: a single PUT has no
     parts to come back to. */
  const isResumable = !!selectedFile && shouldUseMultipart(selectedFile.size);

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
      storageSize !== undefined && storageSize + selectedFile.size > storageLimit;

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
      setPreferredProvider(undefined);
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
        <ResumableUploads
          uploads={resumable}
          busyKey={busyKey}
          onResume={(upload) => resumeMutation.mutate(upload)}
          onDiscard={(upload) => discardMutation.mutate(upload)}
        />

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
                  {/* data-hj-suppress masks file names from Hotjar recordings for privacy */}
                  <h2 data-hj-suppress>{selectedFile.name}</h2>
                  <p>
                    {formatFileSize(selectedFile.size)} • {selectedFile.type}
                  </p>
                </IonLabel>
              </IonItem>
            )}

            {profile?.tier === 'pro' && (
              <ProviderSelector
                selectedProvider={preferredProvider}
                allowedProviders={profile.allowed_providers}
                onSelect={setPreferredProvider}
              />
            )}

            {uploadProgress && (
              <div style={{ marginTop: '20px' }}>
                <IonLabel>
                  {paused ? 'Paused at' : 'Uploading...'} {uploadProgress.progress.toFixed(1)}%
                </IonLabel>
                <IonProgressBar value={uploadProgress.progress / 100} />
                <IonLabel
                  style={{ fontSize: '12px', color: '#666', marginTop: '5px', display: 'block' }}
                >
                  {formatFileSize(uploadProgress.bytesTransferred)} /{' '}
                  {formatFileSize(uploadProgress.totalBytes)}
                </IonLabel>

                {/* Only large files go up in parts, and only those can be
                    picked up again — offering to pause a single PUT would
                    promise something the protocol cannot deliver. */}
                {isResumable &&
                  !paused &&
                  (uploadMutation.isPending || resumeMutation.isPending) && (
                    <IonButton
                      size="small"
                      fill="outline"
                      onClick={pauseUpload}
                      style={{ marginTop: '10px' }}
                    >
                      Pause
                    </IonButton>
                  )}

                {paused && (
                  <IonLabel
                    color="medium"
                    style={{ display: 'block', marginTop: '8px', fontSize: '13px' }}
                  >
                    The parts already sent are kept. Resume it above, now or after a reload.
                  </IonLabel>
                )}
              </div>
            )}

            {error && (
              <IonLabel color="danger" style={{ display: 'block', marginTop: '10px' }}>
                {error}
              </IonLabel>
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
          message={`You've used ${((storageSize || 0) / 1024 / 1024).toFixed(2)} MB of your ${(storageLimit / 1024 / 1024).toFixed(0)} MB limit. Connect Google Drive to upload more files?`}
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
