import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
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
import { DEFAULT_STORAGE_LIMIT } from '@cloud-storage/core/tiers';
import googleDriveAuthService from '../services/googledrive-auth.service';
import { useProfile } from '../hooks/useProfile';
import ProviderSelector from '../components/ProviderSelector';
import ResumableUploads from '../components/ResumableUploads';
import UploadQueue from '../components/UploadQueue';
import { formatBytes, formatStorage } from '@cloud-storage/core/format';
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

/** Where the queue sends its files: everything to Drive, to a provider
 *  chosen by hand, or, with neither, to the provider each file is routed to. */
interface Route {
  useGoogleDrive: boolean;
  preferredProvider: string | undefined;
}

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
  /* Why Drive is being offered: the files do not fit the plan, or one is
     larger than any provider here takes. */
  const [driveOffer, setDriveOffer] = useState<'quota' | 'size' | null>(null);
  const [useGoogleDrive, setUseGoogleDrive] = useState(false);
  const [preferredProvider, setPreferredProvider] = useState<string | undefined>(undefined);
  const [paused, setPaused] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  /* Held in a ref rather than in state: aborting must not wait for a render,
     and nothing about the controller itself belongs on screen. */
  const abortRef = useRef<AbortController | null>(null);

  /* The runner walks a local copy of the queue — state updates do not land in
     the middle of a loop — and reads this to pick up files added while it was
     already working.

     Mirrored in an effect rather than assigned during render. A ref written
     while rendering escapes the render that computed it, which is why React
     forbids it; here the value is only ever read after an `await`, so a commit
     has always landed by the time the loop looks. */
  const queueRef = useRef<QueueItem[]>([]);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
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
    queryFn: () => storageService.resumableUploads(user!.id),
    enabled: !!user?.id,
  });

  /**
   * Sends the queue, one file at a time.
   *
   * Sequential on purpose. Parallel uploads would race for the same quota —
   * the trigger on public.files serialises them anyway and the loser gets a
   * 413 — and a progress bar per file is only honest if one of them is moving.
   *
   * Where the files go is an argument, the page's choice unless told
   * otherwise. Connecting Drive from the alert changes that choice in the
   * same press, and the queue the alert was rendered with still holds the one
   * from before: a Pro account that had picked a provider by hand and filled
   * its plan connected Drive, and was then told on every file to upgrade.
   */
  const runQueue = async (route: Route = { useGoogleDrive, preferredProvider }) => {
    if (!user?.id || isUploading) return;

    setIsUploading(true);
    setError('');

    /* A local copy, because setQueue does not take effect inside this loop.
       Every mutation goes through here so the screen and the walk agree.

       Seeded from state rather than from the ref: this line runs before the
       first `await`, and `queue` is by definition the queue the click was made
       against. The ref is for what arrives later. */
    let items = queue;
    const apply = (id: string, patch: Partial<QueueItem>) => {
      items = update(items, id, patch);
      setQueue(items);
    };

    try {
      for (;;) {
        items = absorb(items, queueRef.current);
        const item = nextPending(items);
        if (!item) break;

        apply(item.id, { status: 'uploading', progress: 0, error: undefined, resumable: false });
        abortRef.current = new AbortController();
        setPaused(false);

        try {
          const result = await storageService.uploadFile(
            user.id,
            item.file,
            (progress) => apply(item.id, { progress: progress.progress }),
            folderId || null,
            route.useGoogleDrive,
            {
              preferredProvider: route.preferredProvider,
              allowedProviders: profile?.allowed_providers,
              storageLimit: profile?.storage_limit,
              signal: abortRef.current.signal,
              onStart: ({ resumable }) => apply(item.id, { resumable }),
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

  /* A page closed or loaded again in the middle of an upload loses it: of the
     providers here only R2 continues one, and the demo does not run R2. So
     while a file is on its way the browser asks first. That covers a tab
     closed by hand, and another tab's no to analytics, which loads this one
     again (analytics/collectors.ts). A layout effect, so that the question
     is gone by the time a pause is on screen: reloading then is safe, and the
     end-to-end suite does it. */
  const sending = isUploading || resumeMutation.isPending;
  useLayoutEffect(() => {
    if (!sending) return;
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // What Chrome and Edge before 119 read instead (MDN, beforeunload).
      event.returnValue = true;
    };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [sending]);

  /** The file being sent right now, if any — what the Pause button acts on. */
  const uploading = queue.find((item) => item.status === 'uploading');

  /* Only an upload its provider can continue: R2's parts stay in the bucket,
     and a single PUT, or any upload to Supabase Storage or Cloudinary, keeps
     nothing to come back to. The button used to go by size alone, and on
     production, where files go to those two, it showed and did nothing. */
  const canPause = !!uploading?.resumable;

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

  /* What no provider this deployment hosts would take, which only Drive can:
     known before a byte travels. */
  const largestHosted = storageService.largestHostedUpload();
  const oversized = queue.filter(
    (item) => item.status === 'pending' && item.file.size > largestHosted
  );
  const fitting = queue.filter((item) => item.status === 'pending').length - oversized.length;

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

    /* Asked now, not read from a cache five minutes old, and asked even when
       Drive was chosen earlier: a token runs out in an hour, and a choice of
       Drive without a token behind it sent a full account on to uploads that
       could only fail, with nothing on screen offering to connect again. */
    if (wouldExceedLimit && !(await googleDriveAuthService.isAuthorized())) {
      setDriveOffer('quota');
      return;
    }

    /* Only Drive takes these. A provider chosen by hand says it is too small
       itself, file by file. */
    if (
      !preferredProvider &&
      oversized.length > 0 &&
      !(await googleDriveAuthService.isAuthorized())
    ) {
      setDriveOffer('size');
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
      /* Over the plan, every file goes to Drive. Over a provider's size, only
         the files that are: the choice of provider sends them there itself.
         Handed to the queue as well as kept, because this render's queue
         still holds the choice from before the press. */
      const route: Route =
        driveOffer === 'quota'
          ? { useGoogleDrive: true, preferredProvider: undefined }
          : { useGoogleDrive, preferredProvider };
      setUseGoogleDrive(route.useGoogleDrive);
      setPreferredProvider(route.preferredProvider);
      setDriveOffer(null);
      // Carry on with the queue that was stopped by the alert
      await runQueue(route);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Google Drive');
    }
  };

  /* Choosing Drive is the moment to connect it. This page has no other place
     to, and a choice left unconnected failed every upload with "Please
     authorize it first". Asked in the press itself, so the window Google
     opens is not taken for a pop-up nobody asked for. */
  const chooseProvider = async (provider: string | undefined) => {
    if (provider === 'googledrive' && !(await googleDriveAuthService.isAuthorized())) {
      try {
        await googleDriveAuthService.authorize();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect Google Drive');
        return;
      }
    }
    setPreferredProvider(provider);
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
                configuredProviders={storageService.configuredProviders()}
                onSelect={chooseProvider}
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

                {/* Only an upload its provider can pick up again: offering
                    to pause any other would promise what nothing keeps. */}
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
          isOpen={driveOffer !== null}
          onDidDismiss={() => setDriveOffer(null)}
          header={driveOffer === 'size' ? 'Too Large to Store Here' : 'Storage Limit Exceeded'}
          message={
            driveOffer === 'size'
              ? oversized.length === 1
                ? `${oversized[0]!.file.name} is ${formatBytes(oversized[0]!.file.size)}. Over ${formatStorage(largestHosted)}, a file can only go to Google Drive. Connect Google Drive to upload it?`
                : `${oversized.length} files are over ${formatStorage(largestHosted)}, which only Google Drive takes. Connect Google Drive to upload them?`
              : `You've used ${((storageSize || 0) / 1024 / 1024).toFixed(2)} MB of your ${(storageLimit / 1024 / 1024).toFixed(0)} MB limit. Connect Google Drive to upload more files?`
          }
          buttons={[
            {
              text: 'Cancel',
              role: 'cancel',
            },
            /* A file only Drive takes must not hold back the ones that fit.
               They go, and each large one is refused before a byte is sent,
               with the reason beside it. */
            ...(driveOffer === 'size' && fitting > 0
              ? [{ text: 'Upload the rest', handler: () => void runQueue() }]
              : []),
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
