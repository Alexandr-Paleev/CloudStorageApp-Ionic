import {
  IonButton,
  IonIcon,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  IonItem,
  IonLabel,
  IonList,
  IonSpinner,
  IonText,
} from '@ionic/react';
import { cloud, documentTextOutline, trashOutline } from 'ionicons/icons';
import type { FileMetadata } from '../services/storage.service';
import { formatDateTime, formatFileSize } from '../utils/format.utils';
import { HttpError } from '../utils/http.utils';
import { getThumbnailUrl } from '../utils/thumbnail.utils';

interface FileListProps {
  files: FileMetadata[];
  /** The first page has not arrived yet. */
  loading: boolean;
  /** Why the list could not be had, when it could not. */
  error: Error | null;
  /** Something is typed into the search: an empty list is then a result. */
  searching: boolean;
  /** The list is a search by meaning rather than the folder's own files. */
  smartSearching: boolean;
  /** The folder holds folders, so it is not empty even with no files in it. */
  hasFolders: boolean;
  /** There are rows past the last one shown. */
  hasNextPage: boolean;
  /** Asks for the next page. Scrolling waits for it before asking again. */
  onLoadMore: () => Promise<unknown>;
  /** The row was pressed. */
  onOpen: (file: FileMetadata) => void;
  /** The bin was pressed. Whether anything is deleted is DeleteFileDialog's question. */
  onDelete: (file: FileMetadata) => void;
}

/**
 * The files of the folder that is open, or the answer to a search: the rows,
 * the next page as the list is scrolled, and what the list says instead of
 * rows while it is loading, when it failed and when there is nothing in it.
 */
const FileList: React.FC<FileListProps> = ({
  files,
  loading,
  error,
  searching,
  smartSearching,
  hasFolders,
  hasNextPage,
  onLoadMore,
  onOpen,
  onDelete,
}) => (
  <div>
    <IonText color="dark" className="section-title">
      Files
    </IonText>

    {loading && (
      <div className="files-loading">
        <IonSpinner color="primary" aria-label="Loading files" />
      </div>
    )}

    {error && (
      <div className="files-error">
        {/* The message itself for a smart search. It fails for reasons
            the person can act on — this deployment has no key for the
            provider, this database has no migration 011 — and "Error
            loading items" hides every one of them behind the same
            sentence. */}
        {smartSearching && error instanceof HttpError && error.status === 501
          ? /* The server's own words name environment variables. That
               sentence is for whoever deploys this, not for whoever is
               looking at it — it stays in the console and in Sentry. */
            'Smart search is not set up on this deployment.'
          : smartSearching && error instanceof Error
            ? error.message
            : 'Error loading items.'}
      </div>
    )}

    {!loading &&
      /* Not while searching: an empty result is not an empty account,
         and the note under the searchbar has already said which of
         the two this is. */
      !searching &&
      files.length === 0 &&
      !hasFolders && (
        <div className="files-empty">
          <IonIcon icon={cloud} className="files-empty-icon" aria-hidden="true" />
          <p>No files yet. Upload something!</p>
        </div>
      )}

    <IonList lines="none" className="files-list">
      {files.map((file) => (
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
              /* An image is drawn as itself, above, so every file that
                 reaches this branch gets the document icon. */
              <div className="file-icon-box">
                <IonIcon icon={documentTextOutline} className="file-icon" aria-hidden="true" />
              </div>
            )}
          </div>

          <IonLabel className="ion-text-wrap">
            <h2 className="file-meta-name">{file.name}</h2>
            <p className="file-meta-details">
              {formatFileSize(file.size)} • {formatDateTime(file.created_at)}
            </p>
            {'summary' in file && typeof file.summary === 'string' && (
              /* Why this one came back. A ranked list with no reason
                 attached is indistinguishable from a wrong one — and
                 the sentence under the name is also what the search
                 actually matched against. */
              <p className="file-meta-summary">{file.summary}</p>
            )}
          </IonLabel>

          {/* Stretched over the row rather than wrapped around it, so
                the whole card stays clickable without swallowing the
                delete button. */}
          <button type="button" className="row-open" onClick={() => onOpen(file)}>
            <span className="sr-only">Open {file.name}</span>
          </button>

          <IonButton
            slot="end"
            fill="clear"
            color="medium"
            aria-label={`Delete ${file.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(file);
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
        await onLoadMore();
        (ev.target as HTMLIonInfiniteScrollElement).complete();
      }}
      disabled={!hasNextPage}
    >
      <IonInfiniteScrollContent loadingText="" loadingSpinner="bubbles" />
    </IonInfiniteScroll>
  </div>
);

export default FileList;
