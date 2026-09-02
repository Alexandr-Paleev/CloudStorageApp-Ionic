import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMultipartUploader, UploadPausedError } from './multipart.upload';
import type { PendingUpload, UploadStore } from './upload-store';
import { planParts } from '../../lib/multipart';
import { HttpError } from '../utils/http.utils';

const MiB = 1024 * 1024;

/** A file big enough to be cut into parts, cheap enough to hold in a test. */
function bigFile(size = 20 * MiB, name = 'movie.mp4'): File {
  return new File([new Uint8Array(size)], name, { type: 'video/mp4' });
}

/** The store, in memory — the same contract, none of the IndexedDB. */
function fakeStore() {
  const records = new Map<string, PendingUpload>();
  const saves: PendingUpload[] = [];

  const store: UploadStore = {
    async save(record) {
      records.set(record.key, record);
      saves.push(record);
    },
    async get(key) {
      return records.get(key);
    },
    async list() {
      return [...records.values()];
    },
    async remove(key) {
      records.delete(key);
    },
  };

  return { store, records, saves };
}

function setup(overrides: { putPart?: ReturnType<typeof vi.fn> } = {}) {
  const { store, records, saves } = fakeStore();

  const api = vi.fn(async (action: string, body: unknown) => {
    if (action === 'multipart-create') {
      return { key: 'users/user-1/1700000000_movie.mp4', uploadId: 'upload-1' };
    }
    if (action === 'multipart-sign') {
      const { partNumbers } = body as { partNumbers: number[] };
      return {
        urls: partNumbers.map((n) => ({ partNumber: n, url: `https://r2.test/part/${n}` })),
      };
    }
    return {};
  });

  const putPart =
    overrides.putPart ?? vi.fn(async (url: string) => `"etag-${url.split('/').pop()}"`);

  return {
    uploader: createMultipartUploader({ api, putPart, store }),
    api,
    putPart,
    records,
    saves,
  };
}

/** The record an interrupted upload leaves behind. */
function interrupted(file: File, completed: { partNumber: number; etag: string }[]): PendingUpload {
  const plan = planParts(file.size);
  return {
    key: 'users/user-1/1700000000_movie.mp4',
    uploadId: 'upload-1',
    fileName: file.name,
    size: file.size,
    contentType: file.type,
    partSize: plan.partSize,
    partCount: plan.partCount,
    completed,
    file,
    folderId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a whole upload', () => {
  it('sends every part and assembles them in order', async () => {
    const { uploader, api, putPart } = setup();
    const file = bigFile();

    const key = await uploader.start({ file });

    expect(key).toBe('users/user-1/1700000000_movie.mp4');
    expect(putPart).toHaveBeenCalledTimes(planParts(file.size).partCount);

    const complete = api.mock.calls.find(([action]) => action === 'multipart-complete');
    const { parts } = complete![1] as { parts: { partNumber: number; etag: string }[] };
    expect(parts.map((p) => p.partNumber)).toEqual([1, 2, 3]);
    expect(parts.every((p) => p.etag.startsWith('"etag-'))).toBe(true);
  });

  it('slices the file so the parts add up to it exactly', async () => {
    const sent: number[] = [];
    const putPart = vi.fn(async (_url: string, blob: Blob) => {
      sent.push(blob.size);
      return '"etag"';
    });
    const file = bigFile(20 * MiB);

    await setup({ putPart }).uploader.start({ file });

    expect(sent.reduce((a, b) => a + b, 0)).toBe(file.size);
  });

  it('records the upload before the first part goes anywhere', async () => {
    // An upload interrupted at 1% has to be as resumable as one interrupted at
    // 99%, which means the record cannot wait for the first part to land.
    const order: string[] = [];
    const putPart = vi.fn(async () => {
      order.push('part');
      return '"etag"';
    });
    const { uploader, saves } = setup({ putPart });
    const originalPush = saves.push.bind(saves);
    saves.push = (...args) => {
      order.push('save');
      return originalPush(...args);
    };

    await uploader.start({ file: bigFile() });

    expect(order[0]).toBe('save');
  });

  it('writes an ETag to the store as each part lands, not at the end', async () => {
    const { uploader, saves } = setup();
    await uploader.start({ file: bigFile() });

    // One save for the new record, then one per part.
    const withParts = saves.filter((r) => r.completed.length > 0);
    expect(withParts.map((r) => r.completed.length)).toEqual([1, 2, 3]);
  });

  it('clears the record once the object exists', async () => {
    const { uploader, records } = setup();
    await uploader.start({ file: bigFile() });
    expect(records.size).toBe(0);
  });

  it('reports progress from zero to a hundred', async () => {
    const seen: number[] = [];
    const { uploader } = setup();
    await uploader.start({ file: bigFile(), onProgress: (p) => seen.push(p) });

    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(100);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it('signs parts in one request rather than one request per part', async () => {
    const { uploader, api } = setup();
    await uploader.start({ file: bigFile() });

    const signCalls = api.mock.calls.filter(([action]) => action === 'multipart-sign');
    expect(signCalls).toHaveLength(1);
    expect((signCalls[0][1] as { partNumbers: number[] }).partNumbers).toEqual([1, 2, 3]);
  });
});

describe('resuming', () => {
  it('sends only the parts that are missing', async () => {
    const { uploader, putPart } = setup();
    const file = bigFile();
    const record = interrupted(file, [{ partNumber: 1, etag: '"a"' }]);

    await uploader.run(record);

    expect(putPart).toHaveBeenCalledTimes(2);
  });

  it('asks for URLs only for those parts', async () => {
    const { uploader, api } = setup();
    const record = interrupted(bigFile(), [{ partNumber: 2, etag: '"b"' }]);

    await uploader.run(record);

    const sign = api.mock.calls.find(([action]) => action === 'multipart-sign');
    expect((sign![1] as { partNumbers: number[] }).partNumbers).toEqual([1, 3]);
  });

  it('starts the progress bar where the upload actually is', async () => {
    // Resuming a nearly finished upload at 0% is a lie the user can see.
    const seen: number[] = [];
    const { uploader } = setup();
    const record = interrupted(bigFile(), [
      { partNumber: 1, etag: '"a"' },
      { partNumber: 2, etag: '"b"' },
    ]);

    await uploader.run(record, { onProgress: (p) => seen.push(p) });

    expect(seen[0]).toBeGreaterThan(50);
  });

  it('completes with the parts from both sessions', async () => {
    const { uploader, api } = setup();
    const record = interrupted(bigFile(), [{ partNumber: 2, etag: '"from-before"' }]);

    await uploader.run(record);

    const complete = api.mock.calls.find(([action]) => action === 'multipart-complete');
    const { parts } = complete![1] as { parts: { partNumber: number; etag: string }[] };
    expect(parts.map((p) => p.partNumber)).toEqual([1, 2, 3]);
    expect(parts.find((p) => p.partNumber === 2)!.etag).toBe('"from-before"');
  });
});

describe('when a part does not go through', () => {
  it('retries it', async () => {
    let failures = 0;
    const putPart = vi.fn(async () => {
      if (failures++ === 0) throw new Error('connection reset');
      return '"etag"';
    });
    const { uploader } = setup({ putPart });

    await uploader.start({ file: bigFile() });

    expect(putPart.mock.calls.length).toBe(4); // three parts, one of them twice
  });

  it('asks for a fresh URL when the signed one has expired', async () => {
    // The normal ending for an upload paused overnight: the parts are fine,
    // the signatures are not.
    let expired = false;
    const putPart = vi.fn(async (url: string) => {
      if (!expired && url.endsWith('/1')) {
        expired = true;
        throw new HttpError('Request has expired', 403);
      }
      return '"etag"';
    });
    const { uploader, api } = setup({ putPart });

    await uploader.start({ file: bigFile() });

    const signCalls = api.mock.calls.filter(([action]) => action === 'multipart-sign');
    expect(signCalls).toHaveLength(2);
    expect((signCalls[1][1] as { partNumbers: number[] }).partNumbers).toEqual([1]);
  });

  it('gives up after enough failures rather than looping', async () => {
    const putPart = vi.fn(async () => {
      throw new Error('connection reset');
    });
    const { uploader } = setup({ putPart });

    await expect(uploader.start({ file: bigFile() })).rejects.toThrow('connection reset');
  });
});

describe('pausing', () => {
  it('stops, and keeps what has already landed', async () => {
    const controller = new AbortController();
    const putPart = vi.fn(async (url: string) => {
      if (url.endsWith('/2')) controller.abort();
      return `"etag-${url.split('/').pop()}"`;
    });
    const { uploader, records } = setup({ putPart });

    await expect(
      uploader.start({ file: bigFile(), signal: controller.signal })
    ).rejects.toBeInstanceOf(UploadPausedError);

    const [record] = [...records.values()];
    expect(record.completed.length).toBeGreaterThan(0);
    expect(record.completed.length).toBeLessThan(record.partCount);
  });

  it('does not retry a part that was paused', async () => {
    const controller = new AbortController();
    controller.abort();
    const putPart = vi.fn(async () => '"etag"');
    const { uploader } = setup({ putPart });

    await expect(
      uploader.start({ file: bigFile(), signal: controller.signal })
    ).rejects.toBeInstanceOf(UploadPausedError);
    expect(putPart).not.toHaveBeenCalled();
  });

  it('leaves a record a later session can pick up', async () => {
    const controller = new AbortController();
    const putPart = vi.fn(async (url: string) => {
      if (url.endsWith('/2')) controller.abort();
      return `"etag-${url.split('/').pop()}"`;
    });
    const first = setup({ putPart });

    await expect(
      first.uploader.start({ file: bigFile(), signal: controller.signal })
    ).rejects.toBeInstanceOf(UploadPausedError);

    const [paused] = [...first.records.values()];
    const second = setup();
    await second.uploader.run(paused);

    const complete = second.api.mock.calls.find(([action]) => action === 'multipart-complete');
    const { parts } = complete![1] as { parts: unknown[] };
    expect(parts).toHaveLength(paused.partCount);
  });
});

describe('abandoning an upload', () => {
  it('tells R2 to release the parts and forgets the record', async () => {
    const { uploader, api, records } = setup();
    const record = interrupted(bigFile(), [{ partNumber: 1, etag: '"a"' }]);
    await uploader.run(record).catch(() => undefined);

    records.set(record.key, record);
    await uploader.abort(record);

    expect(api).toHaveBeenCalledWith('multipart-abort', {
      key: record.key,
      uploadId: record.uploadId,
    });
    expect(records.has(record.key)).toBe(false);
  });

  it('forgets the record even when the abort call fails', async () => {
    // A record nobody can resume is worse than none, and R2 sweeps orphaned
    // parts on its own.
    const { records } = setup();
    const record = interrupted(bigFile(), []);
    records.set(record.key, record);

    const failing = createMultipartUploader({
      api: vi.fn(async () => {
        throw new Error('network down');
      }),
      putPart: vi.fn(),
      store: {
        save: async () => undefined,
        get: async () => undefined,
        list: async () => [],
        remove: async (key: string) => {
          records.delete(key);
        },
      },
    });

    await expect(failing.abort(record)).rejects.toThrow('network down');
    expect(records.has(record.key)).toBe(false);
  });
});
