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
  IonItem,
  IonInput,
  IonButtons,
  IonToast,
  IonSpinner,
  IonIcon,
  IonModal,
  IonActionSheet,
  IonGrid,
  IonRow,
  IonCol,
  IonText,
} from '@ionic/react';
import {
  createOutline,
  trashOutline,
  arrowBack,
  linkOutline,
  shareSocialOutline,
  logoWhatsapp,
  logoFacebook,
  logoTwitter,
  paperPlaneOutline,
  documentTextOutline,
  cloudDownloadOutline,
} from 'ionicons/icons';
import { useAuth } from '../contexts/AuthContext';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import OfflineQueueBanner from '../components/OfflineQueueBanner';
import storageService from '../services/storage.service';
import shareService from '../services/share.service';
import ShareLinks from '../components/ShareLinks';
import { FileMetadata } from '../schemas/file.schema';
import { formatFileSize, formatDateTime } from '../utils/format.utils';
import { offerSystemShare, warnFeedback } from '../native/shell';
import './FileView.css';

const FileView: React.FC = () => {
  const { fileId } = useParams<{ fileId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const offlineQueue = useOfflineQueue();

  /* A rename queued offline has to be visible here, or the page keeps showing
     the old name and the only reasonable conclusion is that it did not work —
     so the user renames it again, and the queue grows a second entry for a
     decision they made once. */
  const queuedRename = offlineQueue.ops.find(
    (op): op is Extract<typeof op, { kind: 'renameFile' }> =>
      op.kind === 'renameFile' && op.fileId === fileId
  );
  const queuedName = queuedRename?.name;
  const [newName, setNewName] = useState('');
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showShareSheet, setShowShareSheet] = useState(false);
  const [shareLink, setShareLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [sharePending, setSharePending] = useState(false);
  const [copyToast, setCopyToast] = useState<{
    show: boolean;
    message: string;
    color: 'success' | 'danger';
  }>({
    show: false,
    message: '',
    color: 'success',
  });

  const {
    data: file,
    isLoading,
    refetch,
  } = useQuery<FileMetadata | null>({
    queryKey: ['file', fileId, user?.id],
    queryFn: () => {
      if (!fileId) throw new Error('File ID is required');
      if (!user?.id) throw new Error('User not authenticated');
      return storageService.getFileMetadata(fileId, user.id);
    },
    enabled: !!fileId && !!user?.id,
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!fileId) throw new Error('File ID is required');
      if (!user?.id) throw new Error('User not authenticated');
      const userId = user.id;

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
      navigate('/dashboard');
    },
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) => {
      if (!fileId) throw new Error('File ID is required');
      if (!user?.id) throw new Error('User not authenticated');
      const userId = user.id;

      /* A rename typed on a train is the change most worth keeping: it costs
         nothing to send later, and losing it means typing it again. */
      return offlineQueue.runOrQueue({ kind: 'renameFile', fileId, name }, () =>
        storageService.renameFile(fileId, userId, name)
      );
    },
    /* Without this TanStack pauses the mutation while the browser reports no
       network and never calls mutationFn at all — the change would live only
       in this tab's memory, and a reload would lose it. The queue in
       services/mutation-queue.ts is what makes it durable, and it only gets
       the chance if the attempt is actually made. */
    networkMode: 'always' as const,

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['file', fileId, user?.id] });
      queryClient.invalidateQueries({ queryKey: ['items', user?.id] });
      setShowRenameModal(false);
    },
  });

  const handleRename = () => {
    if (file) {
      setNewName(queuedName ?? file.name);
      setShowRenameModal(true);
    }
  };

  const handleRenameSubmit = () => {
    if (newName.trim()) {
      renameMutation.mutate(newName.trim());
    }
  };

  const handleDelete = () => {
    /* The one place in this app where a tap starts something irreversible. A
       phone can say that in a way a dialog cannot. */
    warnFeedback();
    setShowDeleteModal(true);
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

  /**
   * A share link, created on demand and reused for the rest of the visit.
   *
   * Sharing download_url directly, as this page used to, meant handing out
   * either a permanent unrevocable URL (Cloudinary, Dropbox) or a signed one
   * that dies in an hour (R2, Supabase Storage). A share link expires on a
   * known schedule and its owner can revoke it.
   */
  const ensureShareLink = async (): Promise<string | null> => {
    if (shareLink) return shareLink.url;
    if (!fileId) return null;

    setSharePending(true);
    try {
      const link = await shareService.createLink(fileId);
      setShareLink(link);
      queryClient.invalidateQueries({ queryKey: ['shareLinks', fileId] });
      return link.url;
    } catch (err) {
      setCopyToast({
        show: true,
        message: err instanceof Error ? err.message : 'Failed to create share link',
        color: 'danger',
      });
      return null;
    } finally {
      setSharePending(false);
    }
  };

  const handleCopyLink = async () => {
    const url = await ensureShareLink();
    if (!url) return;

    /* On a device this is the system share sheet, which is where a person
       expects a link to go — into Messages, or Mail, or whatever they actually
       use. Copying to a clipboard they then have to paste somewhere is what a
       web page does because it has no other option. Returns false wherever
       there is no sheet, and the clipboard below is the fallback rather than a
       second-best. */
    if (await offerSystemShare(url, file?.name ?? 'Shared file')) return;

    try {
      await navigator.clipboard.writeText(url);
      setCopyToast({
        show: true,
        message: 'Share link copied — expires in 7 days',
        color: 'success',
      });
    } catch {
      setCopyToast({ show: true, message: 'Failed to copy link', color: 'danger' });
    }
  };

  const handleSocialShare = async (platform: 'telegram' | 'whatsapp' | 'facebook' | 'x') => {
    const url = await ensureShareLink();
    if (!file || !url) return;

    const text = `Check out ${file.name}`;
    let shareUrl = '';

    switch (platform) {
      case 'telegram':
        shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
        break;
      case 'whatsapp':
        shareUrl = `https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`;
        break;
      case 'facebook':
        shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
        break;
      case 'x':
        shareUrl = `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
        break;
    }

    if (shareUrl) {
      window.open(shareUrl, '_blank');
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
        <IonHeader className="ion-no-border">
          <IonToolbar>
            <IonButtons slot="start">
              <IonButton onClick={() => navigate(-1)} color="dark" aria-label="Back">
                <IonIcon icon={arrowBack} aria-hidden="true" />
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <OfflineQueueBanner
            pending={offlineQueue.pending}
            discarded={offlineQueue.lastResult?.discarded ?? []}
            onRetry={() => offlineQueue.flush()}
          />

          <div className="file-view-loader">
            <IonSpinner color="primary" aria-label="Loading file" />
          </div>
        </IonContent>
      </IonPage>
    );
  }

  if (!file) {
    return (
      <IonPage>
        <IonHeader className="ion-no-border">
          <IonToolbar>
            <IonButtons slot="start">
              <IonButton onClick={() => navigate(-1)} color="dark" aria-label="Back">
                <IonIcon icon={arrowBack} aria-hidden="true" />
              </IonButton>
            </IonButtons>
            <IonTitle>File Not Found</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <div className="file-not-found">
            <p>File not found or access denied.</p>
          </div>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonHeader className="ion-no-border">
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => navigate(-1)} color="dark" aria-label="Back">
              <IonIcon icon={arrowBack} aria-hidden="true" />
            </IonButton>
          </IonButtons>
          <IonTitle>{queuedName ?? file.name}</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen>
        <div className="file-view-container">
          <div className="bg-gradient-mesh preview-area">
            {isImage && downloadUrl ? (
              <img
                src={downloadUrl}
                alt={file.name}
                className="preview-image"
                onError={() => refetch()}
              />
            ) : isPDF && downloadUrl ? (
              <div className="preview-pdf-container">
                <iframe src={downloadUrl} className="preview-pdf-frame" title={file.name} />
              </div>
            ) : (
              <div className="preview-placeholder">
                <div className="preview-icon-box">
                  <IonIcon icon={documentTextOutline} className="preview-icon" aria-hidden="true" />
                </div>
                <IonText color="dark">
                  <h2 className="preview-title">No preview</h2>
                  <p className="preview-type">{file.type || 'Unknown Type'}</p>
                </IonText>
              </div>
            )}
          </div>

          <div className="ion-padding-horizontal">
            <div className="glass-card metadata-card">
              <IonGrid className="metadata-grid">
                <IonRow>
                  <IonCol size="6">
                    <IonText color="medium" className="metadata-label">
                      Created
                    </IonText>
                    <div className="metadata-value">{formatDateTime(file.created_at)}</div>
                  </IonCol>
                  <IonCol size="6">
                    <IonText color="medium" className="metadata-label">
                      Size
                    </IonText>
                    <div className="metadata-value">{formatFileSize(file.size)}</div>
                  </IonCol>
                </IonRow>
              </IonGrid>
            </div>

            <div className="actions-container">
              <IonButton
                expand="block"
                className="premium-button download-button"
                onClick={handleDownload}
              >
                <IonIcon icon={cloudDownloadOutline} slot="start" aria-hidden="true" />
                Download Original
              </IonButton>

              <IonGrid className="action-grid">
                <IonRow>
                  <IonCol size="6">
                    <IonButton
                      expand="block"
                      fill="outline"
                      onClick={() => setShowShareSheet(true)}
                      className="action-button"
                    >
                      <IonIcon icon={shareSocialOutline} aria-hidden="true" />
                      <span className="action-button-label">Share</span>
                    </IonButton>
                  </IonCol>
                  <IonCol size="6">
                    <IonButton
                      expand="block"
                      fill="outline"
                      onClick={handleCopyLink}
                      disabled={sharePending}
                      className="action-button"
                    >
                      <IonIcon icon={linkOutline} aria-hidden="true" />
                      <span className="action-button-label">Copy Link</span>
                    </IonButton>
                  </IonCol>
                  <IonCol size="6">
                    <IonButton
                      expand="block"
                      fill="outline"
                      onClick={handleRename}
                      className="action-button"
                    >
                      <IonIcon icon={createOutline} aria-hidden="true" />
                      <span className="action-button-label">Rename</span>
                    </IonButton>
                  </IonCol>
                  <IonCol size="6">
                    <IonButton
                      expand="block"
                      fill="outline"
                      color="danger"
                      onClick={handleDelete}
                      disabled={deleteMutation.isPending}
                      className="delete-button"
                    >
                      {!deleteMutation.isPending ? (
                        <>
                          <IonIcon icon={trashOutline} aria-hidden="true" />
                          <span className="action-button-label">Delete</span>
                        </>
                      ) : (
                        <IonSpinner name="crescent" aria-label="Working" />
                      )}
                    </IonButton>
                  </IonCol>
                </IonRow>
              </IonGrid>

              {shareLink && (
                <IonText color="medium">
                  {/* Says what revoking actually does. For files on providers
                      that serve permanent public URLs (Cloudinary, Dropbox,
                      Google Drive) the direct file address keeps working once
                      someone has opened it — promising a clean revoke here
                      would be a lie. */}
                  <p className="share-note">
                    Anyone with this link can download the file until{' '}
                    {formatDateTime(shareLink.expiresAt)}. Revoking stops the link from opening — it
                    cannot take back a file someone has already downloaded.
                  </p>
                </IonText>
              )}

              {fileId && <ShareLinks fileId={fileId} />}
            </div>
          </div>
        </div>

        <IonActionSheet
          isOpen={showShareSheet}
          onDidDismiss={() => setShowShareSheet(false)}
          header="Share via"
          buttons={[
            {
              text: 'Telegram',
              icon: paperPlaneOutline,
              handler: () => handleSocialShare('telegram'),
            },
            { text: 'WhatsApp', icon: logoWhatsapp, handler: () => handleSocialShare('whatsapp') },
            { text: 'Facebook', icon: logoFacebook, handler: () => handleSocialShare('facebook') },
            { text: 'X', icon: logoTwitter, handler: () => handleSocialShare('x') },
            { text: 'Cancel', role: 'cancel' },
          ]}
        />

        <IonModal
          isOpen={showDeleteModal}
          onDidDismiss={() => setShowDeleteModal(false)}
          className="glass-modal"
          breakpoints={[0, 0.4]}
          initialBreakpoint={0.4}
        >
          <IonContent className="ion-padding">
            <div style={{ textAlign: 'center', paddingTop: '20px', paddingBottom: '30px' }}>
              <div
                style={{
                  width: '60px',
                  height: '60px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                }}
              >
                <IonIcon
                  icon={trashOutline}
                  color="danger"
                  style={{ fontSize: '32px' }}
                  aria-hidden="true"
                />
              </div>
              <IonText color="dark">
                <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px' }}>
                  Delete File?
                </h2>
                <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '24px' }}>
                  Are you sure you want to delete <b>{file?.name}</b>?<br />
                  This action cannot be undone.
                </p>
              </IonText>
              <IonGrid>
                <IonRow>
                  <IonCol size="6">
                    <IonButton
                      expand="block"
                      fill="outline"
                      color="medium"
                      onClick={() => setShowDeleteModal(false)}
                      style={{ height: '48px', '--border-radius': '12px' }}
                    >
                      Cancel
                    </IonButton>
                  </IonCol>
                  <IonCol size="6">
                    <IonButton
                      expand="block"
                      color="danger"
                      onClick={() => {
                        setShowDeleteModal(false);
                        deleteMutation.mutate();
                      }}
                      style={{ height: '48px', '--border-radius': '12px' }}
                    >
                      Delete
                    </IonButton>
                  </IonCol>
                </IonRow>
              </IonGrid>
            </div>
          </IonContent>
        </IonModal>

        <IonModal
          isOpen={showRenameModal}
          onDidDismiss={() => setShowRenameModal(false)}
          className="glass-modal"
          breakpoints={[0, 0.45]}
          initialBreakpoint={0.45}
        >
          <IonContent className="ion-padding">
            <h2 className="rename-title">Rename File</h2>
            <div className="custom-input has-focus">
              <IonItem lines="none">
                <IonInput
                  value={newName}
                  onIonInput={(e) => setNewName(e.detail.value!)}
                  placeholder="Enter new name"
                />
              </IonItem>
            </div>
            <div style={{ paddingBottom: '30px' }}>
              <IonButton
                className="premium-button save-button"
                expand="block"
                onClick={handleRenameSubmit}
                disabled={!newName.trim() || renameMutation.isPending}
              >
                {renameMutation.isPending ? 'Renaming...' : 'Save Changes'}
              </IonButton>
            </div>
          </IonContent>
        </IonModal>

        <IonToast
          isOpen={deleteMutation.isError || renameMutation.isError}
          message={deleteMutation.isError ? 'Failed to delete' : 'Failed to rename'}
          duration={3000}
          color="danger"
        />
        <IonToast
          isOpen={copyToast.show}
          message={copyToast.message}
          duration={2000}
          color={copyToast.color}
          onDidDismiss={() => setCopyToast({ ...copyToast, show: false })}
        />
      </IonContent>
    </IonPage>
  );
};

export default FileView;
