/**
 * One IndexedDB request, as a promise that settles when the data is really
 * there.
 *
 * Written once because there are two stores that need it — the unfinished
 * uploads and the queued mutations — and the first copy of this had a bug the
 * second one fixed: resolving on `request.onsuccess` rather than on the
 * transaction completing. The request succeeding only means the write was
 * accepted; the transaction can still be in flight, and a read opened straight
 * afterwards can answer with the state from before it. A fix worth making
 * twice is a fix that belongs in one place.
 */

export interface DatabaseSpec {
  name: string;
  version: number;
  /** Created on upgrade if they are not there yet. */
  stores: { name: string; options?: IDBObjectStoreParameters }[];
}

function open(spec: DatabaseSpec): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const request = indexedDB.open(spec.name, spec.version);

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of spec.stores) {
        if (!db.objectStoreNames.contains(store.name)) {
          db.createObjectStore(store.name, store.options);
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`Could not open ${spec.name}`));
  });
}

/**
 * Runs one request against one store.
 *
 * The promise settles on `transaction.oncomplete`, so a resolved write is a
 * committed write and whatever reads next sees it.
 */
export async function idbRun<T>(
  spec: DatabaseSpec,
  storeName: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await open(spec);

  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = work(tx.objectStore(storeName));

    let result: T;
    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => reject(request.error ?? new Error(`${storeName} request failed`));

    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error(`${storeName} transaction aborted`));
    };
  });
}
