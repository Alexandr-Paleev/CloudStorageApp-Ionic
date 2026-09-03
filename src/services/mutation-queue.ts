/**
 * Changes made while the network was not there.
 *
 * The app is a PWA and has been half of one: the service worker serves the
 * shell and the last listing from cache, so an offline visitor can look at
 * their files and can do nothing to them. Renaming a file on a train would
 * fail with a network error and lose the new name.
 *
 * This is the other half. A mutation that cannot reach the server is written
 * down instead, applied to what is on screen, and sent when the connection
 * comes back.
 *
 * What is deliberately **not** queued:
 *
 *   * Uploads. The bytes are the hard part, and resumable uploads already
 *     solve that in their own way — a file waits in IndexedDB and continues
 *     when asked (see upload-store.ts).
 *   * Creating a folder. Its id comes from the database, so anything queued
 *     against a folder created offline — a rename, an upload into it — would
 *     have nothing to point at until it exists. Queueing the first without the
 *     second is a half-feature that reads as a bug.
 *
 * What is queued are the four changes that name a row that already exists.
 */

export type PendingOp =
  | { kind: 'renameFile'; fileId: string; name: string }
  | { kind: 'deleteFile'; fileId: string }
  | { kind: 'renameFolder'; folderId: string; name: string }
  | { kind: 'deleteFolder'; folderId: string };

export interface QueuedMutation {
  id: string;
  op: PendingOp;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

/** Given up on after this many tries, so a permanently broken change cannot
 *  block the ones behind it forever. */
export const MAX_ATTEMPTS = 3;

/** The row an operation acts on — what makes two of them comparable. */
export function targetOf(op: PendingOp): string {
  return 'fileId' in op ? `file:${op.fileId}` : `folder:${op.folderId}`;
}

/**
 * Reduces a queue to what actually needs sending.
 *
 * Renaming a file three times offline is one rename, and renaming something
 * that is then deleted is no rename at all. Without this, coming back online
 * replays every keystroke of a decision the user has already changed their
 * mind about — and each replay is a round trip that can fail on its own.
 */
export function coalesce(queue: QueuedMutation[]): QueuedMutation[] {
  const result: QueuedMutation[] = [];

  for (const entry of queue) {
    const target = targetOf(entry.op);
    const previous = result.findIndex((other) => targetOf(other.op) === target);

    if (previous === -1) {
      result.push(entry);
      continue;
    }

    const isDelete = entry.op.kind === 'deleteFile' || entry.op.kind === 'deleteFolder';

    if (isDelete) {
      // A deletion makes everything queued before it about that row moot.
      result.splice(previous, 1);
      result.push(entry);
      continue;
    }

    const earlier = result[previous].op;
    if (earlier.kind === 'deleteFile' || earlier.kind === 'deleteFolder') {
      // Renaming something already queued for deletion: keep the deletion.
      continue;
    }

    // Two renames of the same row: the last one is what the user meant.
    result[previous] = entry;
  }

  return result;
}

/**
 * Shows a listing as it will look once the queue has been sent.
 *
 * The alternative — editing TanStack's cache when a change is queued — puts
 * the same fact in two places and makes the cache a mixture of what the server
 * said and what this device intends. Applied at render instead, the cache
 * stays a truthful snapshot of the server, the queue stays the record of what
 * has not reached it, and the screen is the two of them added together.
 */
export function applyPending<
  File extends { id?: string; name: string },
  Dir extends { id?: string; name: string },
>(items: { files: File[]; folders: Dir[] }, ops: PendingOp[]): { files: File[]; folders: Dir[] } {
  let { files, folders } = items;

  for (const op of ops) {
    switch (op.kind) {
      case 'deleteFile':
        files = files.filter((file) => file.id !== op.fileId);
        break;
      case 'renameFile':
        files = files.map((file) => (file.id === op.fileId ? { ...file, name: op.name } : file));
        break;
      case 'deleteFolder':
        folders = folders.filter((folder) => folder.id !== op.folderId);
        break;
      case 'renameFolder':
        folders = folders.map((folder) =>
          folder.id === op.folderId ? { ...folder, name: op.name } : folder
        );
        break;
    }
  }

  return { files, folders };
}

/**
 * How long a change waits for an answer before it is treated as undeliverable.
 *
 * Not a guess at server latency — a bound on hanging. A request made with no
 * network does not always fail: supabase-js waits on a token refresh that
 * cannot happen, and the promise simply never settles. Without a deadline the
 * change sits in a mutation nobody can see, and the queue that exists to keep
 * it never hears about it.
 */
export const REQUEST_DEADLINE_MS = 8_000;

/**
 * The flush ran with nobody signed in.
 *
 * Distinct from a refusal on purpose: the server never saw the request, so the
 * change is still perfectly good and must not spend an attempt. This happens
 * more easily than it sounds — the provider sits at the root of the app, so
 * its online listener is alive on the login page, after a sign-out, and in the
 * moment after a reload before Supabase has restored the session.
 */
export class NotSignedIn extends Error {
  constructor() {
    super('Nobody is signed in, so the queue cannot be sent yet');
    this.name = 'NotSignedIn';
  }
}

export class RequestTimeout extends Error {
  constructor() {
    super('The request did not answer in time');
    this.name = 'RequestTimeout';
  }
}

/** Rejects with RequestTimeout if the promise has not settled in time. */
export function withDeadline<T>(work: Promise<T>, ms = REQUEST_DEADLINE_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RequestTimeout()), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Whether a failure means "no network" rather than "no".
 *
 * The difference decides everything: a request that never left the device
 * should be kept and retried, while a 404 or a 403 will answer the same way
 * forever and has to be given up on. `fetch` rejects with a TypeError when it
 * cannot reach the host, which is unhelpfully the same thing a programming
 * mistake produces — so the check also accepts what Supabase and this app's
 * own helpers report.
 */
export function looksOffline(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;

  /* Not `instanceof Error`: supabase-js hands back a plain object carrying the
     message, and that object is exactly what a failed request looks like when
     the browser still believes it is online — a captive portal, a host that
     stopped answering, a VPN that dropped. Missing it there is missing the
     case this feature exists for. */
  const asError = error as { name?: unknown; message?: unknown } | null;
  const name = typeof asError?.name === 'string' ? asError.name : '';
  const message = typeof asError?.message === 'string' ? asError.message : '';

  if (name === 'RequestTimeout') return true;

  /* Narrow on purpose. A loose match on "network" or "connection" swallowed
     real refusals — `Failed to delete file from storage: connection refused by
     R2` is the server answering, and treating it as no-network told the user
     their file was deleted while it sat in the bucket. What is matched here is
     the shape fetch itself uses when the request never left the device. */
  return /^(TypeError: )?(Failed to fetch|NetworkError|Load failed|Network request failed)/i.test(
    message
  );
}

const DB_NAME = 'cloud-storage-mutations';
const DB_VERSION = 1;
const STORE = 'pending';

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
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the mutation queue'));
  });
}

/**
 * One IndexedDB request, as a promise that settles when the data is really
 * there.
 *
 * On `transaction.oncomplete`, not on `request.onsuccess`: the request
 * succeeding only means the write was accepted, and the transaction can still
 * be in flight. Resolving early means the next read — the one that counts what
 * is queued — can open its own transaction first and answer with the state
 * from before the write.
 */
function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));

        let result: T;
        request.onsuccess = () => {
          result = request.result;
        };
        request.onerror = () => reject(request.error ?? new Error('Mutation queue request failed'));

        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error('Mutation queue transaction aborted'));
        };
      })
  );
}

export interface MutationStore {
  add(op: PendingOp): Promise<QueuedMutation>;
  list(): Promise<QueuedMutation[]>;
  save(entry: QueuedMutation): Promise<void>;
  remove(id: string): Promise<void>;
}

/**
 * IndexedDB rather than memory, for the obvious reason: the tab that made the
 * change offline is the tab most likely to be closed before the network comes
 * back.
 */
export const mutationStore: MutationStore = {
  async add(op) {
    const entry: QueuedMutation = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      op,
      createdAt: Date.now(),
      attempts: 0,
    };
    await run('readwrite', (store) => store.put(entry));
    return entry;
  },

  async list() {
    try {
      const all = await run<QueuedMutation[]>('readonly', (store) => store.getAll());
      return all.sort((a, b) => a.createdAt - b.createdAt);
    } catch {
      return [];
    }
  },

  async save(entry) {
    await run('readwrite', (store) => store.put(entry));
  },

  async remove(id) {
    try {
      await run('readwrite', (store) => store.delete(id));
    } catch {
      /* nothing depends on the deletion succeeding */
    }
  },
};

export interface FlushResult {
  sent: number;
  /** Given up on: the server answered, and the answer will not change. */
  failed: number;
  /** Which ones, and why — so the interface can say what was lost rather than
   *  letting the banner disappear as though everything went through. */
  discarded: QueuedMutation[];
  /** Still queued, because the network went away again. */
  remaining: number;
}

/**
 * Sends what is waiting, oldest first.
 *
 * Stops at the first failure that looks like no network — there is no point
 * walking the rest of the queue into the same wall, and the order matters.
 * A failure the server actually answered is counted, retried a few times
 * across flushes, and then dropped so it cannot block everything behind it.
 */
export async function flushQueue(
  perform: (op: PendingOp) => Promise<void>,
  store: MutationStore = mutationStore
): Promise<FlushResult> {
  const all = await store.list();
  const queued = coalesce(all);
  const discarded: QueuedMutation[] = [];

  /* The entries coalescing threw away have to leave the store, not just the
     run. Left behind they are sent on the next flush — and a rename that a
     later rename replaced would then travel to the server *after* it, putting
     the old name back on the file. */
  const keeping = new Set(queued.map((entry) => entry.id));
  for (const entry of all) {
    if (!keeping.has(entry.id)) await store.remove(entry.id);
  }

  let sent = 0;
  let failed = 0;

  for (const entry of queued) {
    try {
      await perform(entry.op);
      await store.remove(entry.id);
      sent += 1;
    } catch (error) {
      /* Two ways to stop without blaming the change: no network, and nobody
         signed in. Neither reached the server, so neither spends an attempt. */
      if (error instanceof NotSignedIn || looksOffline(error)) {
        return { sent, failed, discarded, remaining: queued.length - sent - failed };
      }

      const attempts = entry.attempts + 1;
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (attempts >= MAX_ATTEMPTS) {
        await store.remove(entry.id);
        discarded.push({ ...entry, attempts, lastError: message });
        failed += 1;
      } else {
        await store.save({ ...entry, attempts, lastError: message });
      }
    }
  }

  const rest = await store.list();
  return { sent, failed, discarded, remaining: rest.length };
}
