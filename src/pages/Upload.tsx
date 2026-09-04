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
  IonIcon,
  IonText,
  IonLabel,
  IonProgressBar,
  IonToast,
  IonButtons,
  IonBackButton,
  IonSpinner,
  IonAlert,
} from '@ionic/react';
import { useAuth } from '../contexts/AuthContext';
import storageService, { FileMetadata, PendingUpload } from '../services/storage.service';
import { DEFAULT_STORAGE_LIMIT } from '../../lib/tiers';
import googleDriveAuthService from '../services/googledrive-auth.service';
import { useProfile } from '../hooks/useProfile';
import ProviderSelector from '../components/ProviderSelector';
import ResumableUploads from '../components/ResumableUploads';
import { shouldUseMultipart } from '../../lib/multipart';
import UploadQueue from '../components/UploadQueue';
import {
  absorb,
  enqueue,
  nextPending,
  overallProgress,
  remove as removeFromQueue,
  summarise,
  summaryText,
  update,
  type QueueItem,
} from '../utils/upload-queue';
import { useAnalytics } from '../hooks/useAnalytics';
import { cloudUploadOutline } from 'ionicons/icons';
import './Upload.css';

const Upload: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { folderId } = useParams<{ folderId?: string }>();
  const queryClient = useQueryClient();
  const { trackFileUpload } = useAnalytics();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  /* Resuming is not part of the queue: it continues an upload from a previous
     session, whose File lives in IndexedDB rather than in a picker. */
  const [resumeProgress, setResumeProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [showGoogleDriveAlert, setShowGoogleDriveAlert] = useState(false);
  const [useGoogleDrive, setUseGoogleDrive] = useState(false);
  const [preferredProvider, setPreferredProvider] = useState<string | undefined>(undefined);
  const [paused, setPaused] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  /* Held in a ref rather than in state: aborting must not wait for a render,
     and nothing about the controller itself belongs on screen. */
  const abortRef = useRef<AbortController | null>(null);

  /* The runner walks a local copy of the queue — state updates do not land in
     the middle of a loop — and reads this to pick up files added while it was
     already working. */
  const queueRef = useRef<QueueItem[]>([]);
  queueRef.current = queue;
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

  /**
   * Sends the queue, one file at a time.
   *
   * Sequential on purpose. Parallel uploads would race for the same quota —
   * the trigger on public.files serialises them anyway and the loser gets a
   * 413 — and a progress bar per file is only honest if one of them is moving.
   */
  const runQueue = async () => {
    if (!user?.id || isUploading) return;

    setIsUploading(true);
    setError('');

    /* A local copy, because setQueue does not take effect inside this loop.
       Every mutation goes through here so the screen and the walk agree. */
    let items = queueRef.current;
    const apply = (id: string, patch: Partial<QueueItem>) => {
      items = update(items, id, patch);
      setQueue(items);
    };

    try {
      for (;;) {
        items = absorb(items, queueRef.current);
        const item = nextPending(items);
        if (!item) break;

        apply(item.id, { status: 'uploading', progress: 0, error: undefined });
        abortRef.current = new AbortController();
        setPaused(false);

        try {
          const result = await storageService.uploadFile(
            user.id,
            item.file,
            (progress) => apply(item.id, { progress: progress.progress }),
            folderId || null,
            useGoogleDrive,
            {
              preferredProvider,
              allowedProviders: profile?.allowed_providers,
              storageLimit: profile?.storage_limit,
              signal: abortRef.current.signal,
            }
          );

          trackFileUpload({
            file_type: item.file.type,
            file_size: item.file.size,
            storage_provider: result.storage_type,
            folder_id: folderId || undefined,
          });

          apply(item.id, { status: 'done', progress: 100 });
          invalidateAfterUpload();
        } catch (err) {
          const error = err as Error;

          // Pausing raises too — it is how the part loop stops — but it is a
          // decision, not a failure, and it stops the queue rather than
          // marking the file broken and moving on.
          if (error.name === 'UploadPausedError' || error.name === 'AbortError') {
            apply(item.id, { status: 'paused' });
            setPaused(true);
            queryClient.invalidateQueries({ queryKey: ['resumableUploads', user?.id] });
            break;
          }

          /* The rest of the queue still goes: one file too large for the plan
             should not strand the nine behind it. */
          apply(item.id, { status: 'failed', error: error.message });
        }
      }
    } finally {
      setIsUploading(false);
    }

    /* Only leave when every file landed. A failure has to stay on screen next
       to the file it belongs to, and a paused one is not finished at all —
       navigating away from it would hide the queue and the card offering to
       resume it in the same movement. */
    const finished = summarise(items);
    if (finished.finished && finished.failed === 0) {
      navigate(folderId ? `/dashboard/${folderId}` : '/dashboard');
    }
  };

  const invalidateAfterUpload = () => {
    queryClient.invalidateQueries({ queryKey: ['items', user?.id] });
    queryClient.invalidateQueries({ queryKey: ['storageSize', user?.id] });
    queryClient.invalidateQueries({ queryKey: ['resumableUploads', user?.id] });
  };

  const finishUpload = (result: FileMetadata) => {
    invalidateAfterUpload();
    navigate(folderId ? `/dashboard/${folderId}` : '/dashboard');
    return result;
  };

  const resumeMutation = useMutation({
    mutationFn: async (upload: PendingUpload) => {
      if (!user?.id) throw new Error('User not authenticated');

      abortRef.current = new AbortController();
      setBusyKey(upload.key);
      setPaused(false);
      setResumeProgress(0);

      return storageService.resumeUpload(
        user.id,
        upload,
        (progress) => setResumeProgress(progress.progress),
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
      setResumeProgress(null);
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

  /** The file being sent right now, if any — what the Pause button acts on. */
  const uploading = queue.find((item) => item.status === 'uploading');

  /* Only a file large enough to go up in parts can be paused and continued: a
     single PUT has nothing to come back to. */
  const canPause = !!uploading && shouldUseMultipart(uploading.file.size);

  const addFiles = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;

    /* Copied out of the FileList here rather than inside the updater below.
       React runs that updater whenever it gets round to it, and by then the
       input has been cleared — a live FileList empties with it, so the picked
       files would arrive as none. */
    const picked = Array.from(files);

    setError('');
    setQueue((items) => enqueue(items, picked));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files);
    // Cleared so picking the same file again still fires a change event.
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer?.files ?? null);
  };

  const handleUpload = async () => {
    if (!user?.id) return;

    const waiting = queue.filter((item) => item.status === 'pending');
    if (waiting.length === 0) return;

    setError('');

    /* The whole selection weighed at once. Checking file by file would wave
       through five files that fit one at a time and not together — and the
       trigger would then refuse the last of them mid-queue. */
    const incoming = waiting.reduce((sum, item) => sum + item.file.size, 0);
    const wouldExceedLimit = storageSize !== undefined && storageSize + incoming > storageLimit;

    if (wouldExceedLimit && !isGoogleDriveConnected && !useGoogleDrive) {
      setShowGoogleDriveAlert(true);
      return;
    }

    await runQueue();
  };

  const summary = summarise(queue);
  const overall = overallProgress(queue);

  /** Puts a paused file back in line. */
  const retryItem = (id: string) => {
    setQueue((items) => update(items, id, { status: 'pending', progress: 0, error: undefined }));
    setPaused(false);
  };

  const handleConnectGoogleDrive = async () => {
    try {
      await googleDriveAuthService.authorize();
      queryClient.invalidateQueries({ queryKey: ['googleDriveConnected'] });
      setUseGoogleDrive(true);
      setPreferredProvider(undefined);
      setShowGoogleDriveAlert(false);
      // Carry on with the queue that was stopped by the alert
      await runQueue();
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
            <IonCardTitle>Select Files</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <input
              type="file"
              id="file-input"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileSelect}
              disabled={isUploading}
            />

            {/* A drop target as well as a button. preventDefault on dragOver is
                what makes a drop possible at all — without it the browser
                opens the file instead, replacing the app with the PDF. */}
            <div
              className={`upload-dropzone${dragging ? ' upload-dropzone--active' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => document.getElementById('file-input')?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  document.getElementById('file-input')?.click();
                }
              }}
              data-testid="dropzone"
            >
              <IonIcon
                icon={cloudUploadOutline}
                className="upload-dropzone-icon"
                aria-hidden="true"
              />
              <IonText color="dark">
                <strong>Choose files</strong> or drop them here
              </IonText>
              <IonLabel color="medium" className="upload-dropzone-hint">
                Several at a time — they go up one after another
              </IonLabel>
            </div>

            <UploadQueue
              items={queue}
              running={isUploading}
              onRemove={(id) => setQueue((items) => removeFromQueue(items, id))}
              onRetry={retryItem}
            />

            {profile?.tier === 'pro' && (
              <ProviderSelector
                selectedProvider={preferredProvider}
                allowedProviders={profile.allowed_providers}
                onSelect={setPreferredProvider}
              />
            )}

            {(isUploading || summary.total > 0 || resumeProgress !== null) && (
              <div style={{ marginTop: '20px' }}>
                <IonLabel>
                  {resumeProgress !== null
                    ? `Resuming — ${resumeProgress.toFixed(0)}%`
                    : `${
                        isUploading
                          ? `Uploading ${summary.done + 1} of ${summary.total}`
                          : summaryText(summary)
                      } — ${overall.toFixed(0)}%`}
                </IonLabel>
                <IonProgressBar
                  value={(resumeProgress ?? overall) / 100}
                  aria-label="Upload progress"
                />

                {/* Only large files go up in parts, and only those can be
                    picked up again — offering to pause a single PUT would
                    promise something the protocol cannot deliver. */}
                {(canPause || resumeMutation.isPending) && !paused && (
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
              disabled={summary.pending === 0 || isUploading}
              style={{ marginTop: '20px' }}
            >
              {isUploading ? (
                <IonSpinner name="crescent" aria-label="Working" />
              ) : summary.pending > 1 ? (
                `Upload ${summary.pending} files`
              ) : (
                'Upload'
              )}
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
