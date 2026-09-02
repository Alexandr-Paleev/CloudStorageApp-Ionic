import { MAX_PARTS_PER_BATCH, partRange, planParts, type PartPlan } from '../../lib/multipart';
import { HttpError } from '../utils/http.utils';
import { withRetry } from '../utils/retry.utils';
import type { CompletedPart, PendingUpload, UploadStore } from './upload-store';

/**
 * A large file, uploaded in parts, resumable.
 *
 * The shape of the thing: the server opens a multipart upload and signs URLs
 * for batches of parts; the browser PUTs each part and keeps the ETag R2
 * answers with; when every part has an ETag the server assembles them. What
 * makes it resumable is that the ETags are written to IndexedDB as they
 * arrive, so a reload — or a closed laptop, or a train entering a tunnel —
 * leaves a record that says exactly which parts are already in the bucket.
 *
 * Everything that touches the outside world arrives as a dependency. Not for
 * purity: the interesting behaviour here is what happens when a part fails,
 * when a URL has expired, and when the user pauses halfway, and none of that
 * is reachable in a test that needs a real network.
 */

export interface PartUploadOptions {
  signal?: AbortSignal;
  onProgress?: (loadedBytes: number) => void;
}

export interface MultipartDeps {
  /** POST to /api/r2/<action>, returning the parsed body. */
  api: (action: string, body: unknown) => Promise<Record<string, unknown>>;
  /** PUT one part, resolving to the ETag R2 returned for it. */
  putPart: (url: string, body: Blob, options: PartUploadOptions) => Promise<string>;
  store: UploadStore;
}

export interface StartOptions {
  file: File;
  folderId?: string | null;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/** How many parts are in flight at once. Three saturates an ordinary
 *  connection without making the progress bar lurch, and keeps the memory
 *  cost to three slices rather than the whole file. */
const CONCURRENCY = 3;

/** A paused upload is not a failed one, and the difference matters to
 *  everything upstream: storage.service retries failures. */
export class UploadPausedError extends Error {
  constructor() {
    super('Upload paused');
    this.name = 'UploadPausedError';
  }
}

function isAbort(error: unknown): boolean {
  return (
    error instanceof UploadPausedError ||
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

/**
 * A presigned part URL that has run out.
 *
 * Worth telling apart from every other 403: the upload is fine, the paperwork
 * is stale, and the fix is to ask for new URLs rather than to give up. This is
 * the normal ending for an upload that was paused overnight.
 */
function isExpiredUrl(error: unknown): boolean {
  return error instanceof HttpError && error.status === 403;
}

export function createMultipartUploader(deps: MultipartDeps) {
  const { api, putPart, store } = deps;

  /** Part numbers still missing from a record, in order. */
  function remainingParts(record: PendingUpload): number[] {
    const done = new Set(record.completed.map((p) => p.partNumber));
    const all = Array.from({ length: record.partCount }, (_, i) => i + 1);
    return all.filter((n) => !done.has(n));
  }

  function bytesDone(record: PendingUpload, plan: PartPlan): number {
    return record.completed.reduce((sum, part) => {
      const { start, end } = partRange(part.partNumber, plan, record.size);
      return sum + (end - start);
    }, 0);
  }

  async function signBatch(record: PendingUpload, partNumbers: number[]) {
    const body = await api('multipart-sign', {
      key: record.key,
      uploadId: record.uploadId,
      partNumbers,
    });
    return body.urls as { partNumber: number; url: string }[];
  }

  /**
   * Uploads the parts a record is still missing.
   *
   * Batched because signing is a request of its own: a hundred parts cost one
   * round trip of paperwork instead of a hundred.
   */
  async function uploadRemaining(
    record: PendingUpload,
    options: { onProgress?: (percent: number) => void; signal?: AbortSignal }
  ): Promise<PendingUpload> {
    const plan: PartPlan = { partSize: record.partSize, partCount: record.partCount };
    let current = record;

    /* Bytes from parts finished in an earlier session count as progress —
       resuming at 0% would be a lie the user can see. */
    let settled = bytesDone(current, plan);
    const inFlight = new Map<number, number>();

    const report = () => {
      if (!options.onProgress) return;
      const live = [...inFlight.values()].reduce((a, b) => a + b, 0);
      const percent = Math.min(100, ((settled + live) / current.size) * 100);
      options.onProgress(percent);
    };

    report();

    const pending = remainingParts(current);

    for (let offset = 0; offset < pending.length; offset += MAX_PARTS_PER_BATCH) {
      const batch = pending.slice(offset, offset + MAX_PARTS_PER_BATCH);
      let urls = await signBatch(current, batch);

      /* A worker pool rather than Promise.all over the batch: a hundred
         simultaneous PUTs of eight megabytes each is not faster, it is a
         memory spike and a stalled connection. */
      const queue = [...urls];
      const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (queue.length > 0) {
          if (options.signal?.aborted) throw new UploadPausedError();

          const next = queue.shift();
          if (!next) return;

          const { start, end } = partRange(next.partNumber, plan, current.size);
          const blob = current.file.slice(start, end);

          const etag = await withRetry(
            async () => {
              try {
                return await putPart(next.url, blob, {
                  signal: options.signal,
                  onProgress: (loaded) => {
                    inFlight.set(next.partNumber, loaded);
                    report();
                  },
                });
              } catch (error) {
                if (isExpiredUrl(error) && !options.signal?.aborted) {
                  // Re-sign this one part and try it again with a fresh URL.
                  // Cheaper than failing the upload and asking the user to
                  // start a file they have already sent most of.
                  const [fresh] = await signBatch(current, [next.partNumber]);
                  next.url = fresh.url;
                }
                throw error;
              }
            },
            {
              maxRetries: 3,
              initialDelay: 500,
              maxDelay: 4000,
              shouldRetry: (error) => !isAbort(error),
            }
          );

          inFlight.delete(next.partNumber);
          settled += end - start;

          current = {
            ...current,
            completed: [...current.completed, { partNumber: next.partNumber, etag }],
          };
          // Written after every part, not at the end of the batch: the crash
          // this feature exists for does not wait for a batch boundary.
          await store.save(current);
          report();
        }
      });

      await Promise.all(workers);
      urls = [];
    }

    return current;
  }

  return {
    /** Part numbers still missing — exposed for the UI's "12 of 40 parts" line. */
    remainingParts,

    /**
     * Opens an upload and runs it to completion.
     *
     * The record exists in IndexedDB before the first part goes up, so an
     * upload interrupted at 1% is as resumable as one interrupted at 99%.
     */
    async start({ file, folderId = null, onProgress, signal }: StartOptions): Promise<string> {
      const plan = planParts(file.size);

      const created = await api('multipart-create', {
        fileName: file.name,
        contentType: file.type,
        size: file.size,
      });

      const record: PendingUpload = {
        key: created.key as string,
        uploadId: created.uploadId as string,
        fileName: file.name,
        size: file.size,
        contentType: file.type,
        partSize: plan.partSize,
        partCount: plan.partCount,
        completed: [],
        file,
        folderId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await store.save(record);
      return this.run(record, { onProgress, signal });
    },

    /**
     * Carries a record to completion, whether it was just created or found in
     * IndexedDB an hour later.
     */
    async run(
      record: PendingUpload,
      options: { onProgress?: (percent: number) => void; signal?: AbortSignal } = {}
    ): Promise<string> {
      const finished = await uploadRemaining(record, options);

      await api('multipart-complete', {
        key: finished.key,
        uploadId: finished.uploadId,
        parts: finished.completed
          .slice()
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((p: CompletedPart) => ({ partNumber: p.partNumber, etag: p.etag })),
      });

      await store.remove(finished.key);
      return finished.key;
    },

    /** Gives up on an upload and releases the parts R2 is holding. */
    async abort(record: Pick<PendingUpload, 'key' | 'uploadId'>): Promise<void> {
      try {
        await api('multipart-abort', { key: record.key, uploadId: record.uploadId });
      } finally {
        // Even if the abort call failed, the record is no use to anyone: R2
        // sweeps orphaned parts on its own, and a record the user cannot
        // resume is worse than none.
        await store.remove(record.key);
      }
    },
  };
}

export type MultipartUploader = ReturnType<typeof createMultipartUploader>;
