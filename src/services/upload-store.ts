/**
 * The record of an upload that has not finished yet.
 *
 * Kept in IndexedDB rather than in memory, because the whole point of a
 * resumable upload is surviving the things that clear memory: a reload, a
 * crash, a phone deciding the tab has been in the background long enough.
 *
 * The File itself is stored alongside the bookkeeping. Structured clone
 * accepts it, and without it a resumed upload would have nothing to read the
 * remaining parts from — the browser cannot re-open a path the user picked in
 * a previous session, so the alternative is asking them to find the file
 * again, which is not resuming.
 */

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface PendingUpload {
  /** The object key, which is also this record's primary key: R2 hands it out
   *  once and it is unique per upload by construction (it carries a timestamp
   *  and the user id). */
  key: string;
  uploadId: string;
  fileName: string;
  size: number;
  contentType: string;
  partSize: number;
  partCount: number;
  /** Parts R2 has acknowledged, with the ETags the completion needs. */
  completed: CompletedPart[];
  file: File;
  folderId: string | null;
  createdAt: number;
  updatedAt: number;
}

const DB_NAME = 'cloud-storage-uploads';
const DB_VERSION = 1;
const STORE = 'pending';

/** Records older than this are rubbish: R2's own lifecycle rule sweeps
 *  abandoned parts, and a week-old File reference is usually stale anyway. */
export const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the upload store'));
  });
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Upload store request failed'));
        tx.oncomplete = () => db.close();
      })
  );
}

export interface UploadStore {
  save(record: PendingUpload): Promise<void>;
  get(key: string): Promise<PendingUpload | undefined>;
  list(): Promise<PendingUpload[]>;
  remove(key: string): Promise<void>;
}

/**
 * Every method swallows storage failures.
 *
 * A browser in private mode, a full disk or a user who blocked site data
 * should cost the resume feature, not the upload: the parts still go up, they
 * just cannot be picked up again afterwards.
 */
export const uploadStore: UploadStore = {
  async save(record) {
    try {
      await run('readwrite', (store) => store.put({ ...record, updatedAt: Date.now() }));
    } catch {
      /* resume is a convenience; the upload in flight is not */
    }
  },

  async get(key) {
    try {
      return await run<PendingUpload | undefined>('readonly', (store) => store.get(key));
    } catch {
      return undefined;
    }
  },

  async list() {
    try {
      const all = await run<PendingUpload[]>('readonly', (store) => store.getAll());
      const fresh = all.filter((r) => Date.now() - r.createdAt < PENDING_TTL_MS);

      // Sweep on read rather than on a timer: this runs when someone is looking
      // at the list, which is the only moment the answer matters.
      for (const stale of all.filter((r) => !fresh.includes(r))) {
        await this.remove(stale.key);
      }

      return fresh.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  },

  async remove(key) {
    try {
      await run('readwrite', (store) => store.delete(key));
    } catch {
      /* nothing to do about it, and nothing depends on it */
    }
  },
};
