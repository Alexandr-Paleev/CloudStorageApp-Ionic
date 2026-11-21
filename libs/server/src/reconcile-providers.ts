import type { SupabaseClient } from '@supabase/supabase-js';
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { v2 as cloudinary } from 'cloudinary';
import { configureCloudinaryAdmin, r2Configured } from './erase-providers';
import { getS3Client, getR2BucketName } from './r2';
import type {
  BucketFinding,
  ListedStore,
  QuotaDrift,
  RecordedRow,
  ReconcileDeps,
  StoredObject,
} from './reconcile';

/**
 * What the nightly reconciliation (`reconcile.ts`) reads and changes, as this
 * deployment has it: the `files` rows, the Storage bucket through the
 * functions of migrations/021, and Cloudinary and R2 where configured.
 */

const BUCKET = 'files';

/** Every account's objects in Cloudinary and R2 are under `users/<id>/`
 *  (`ownerPrefix` in libs/core/src/stored-path.ts). Nothing outside it is
 *  listed, so nothing outside it can be removed. */
const APP_PREFIX = 'users/';

/** A page of rows; PostgREST answers at most 1000 by default. */
const ROW_PAGE = 1000;

/** Cloudinary's delete_resources takes at most 100 ids. */
const CLOUDINARY_DELETE_BATCH = 100;

/** One S3 delete request takes at most 1000 keys. */
const S3_DELETE_BATCH = 1000;

/** Storage's remove is a request body of paths; kept to a modest size. */
const BUCKET_REMOVE_BATCH = 100;

async function rowsOf(
  supabase: SupabaseClient,
  provider: 'cloudinary' | 'r2'
): Promise<RecordedRow[]> {
  const rows: RecordedRow[] = [];
  for (let from = 0; ; from += ROW_PAGE) {
    const { data, error } = await supabase
      .from('files')
      .select('id, storage_path, size, created_at')
      .eq('storage_type', provider)
      .order('id')
      .range(from, from + ROW_PAGE - 1);
    if (error) throw new Error(`Could not read the ${provider} rows: ${error.message}`);

    const page = (data ?? []) as {
      id: string;
      storage_path: string;
      size: number;
      created_at: string;
    }[];
    for (const row of page) {
      rows.push({
        id: row.id,
        path: row.storage_path,
        size: Number(row.size),
        createdAt: new Date(row.created_at),
      });
    }
    if (page.length < ROW_PAGE) return rows;
  }
}

/**
 * Images, raw files and videos are separate namespaces in Cloudinary, and the
 * app's uploads can arrive as any of the three (see `eraseCloudinary`). A page
 * of the Admin API holds 500, and each page is one of its 500 requests an hour.
 */
const cloudinaryStore: ListedStore = {
  async list() {
    const objects: StoredObject[] = [];
    for (const resource_type of ['image', 'raw', 'video'] as const) {
      let next_cursor: string | undefined;
      do {
        const page = (await cloudinary.api.resources({
          type: 'upload',
          prefix: APP_PREFIX,
          resource_type,
          max_results: 500,
          next_cursor,
        })) as {
          resources: { public_id: string; bytes: number; created_at: string }[];
          next_cursor?: string;
        };
        for (const asset of page.resources) {
          objects.push({
            path: asset.public_id,
            size: asset.bytes,
            createdAt: new Date(asset.created_at),
            resourceType: resource_type,
          });
        }
        next_cursor = page.next_cursor;
      } while (next_cursor);
    }
    return objects;
  },

  async remove(objects) {
    for (const resource_type of ['image', 'raw', 'video']) {
      const ids = objects.filter((o) => o.resourceType === resource_type).map((o) => o.path);
      for (let i = 0; i < ids.length; i += CLOUDINARY_DELETE_BATCH) {
        await cloudinary.api.delete_resources(ids.slice(i, i + CLOUDINARY_DELETE_BATCH), {
          resource_type,
          type: 'upload',
        });
      }
    }
  },
};

const r2Store: ListedStore = {
  async list() {
    const client = getS3Client();
    const Bucket = getR2BucketName();
    const objects: StoredObject[] = [];
    let ContinuationToken: string | undefined;
    do {
      const page = await client.send(
        new ListObjectsV2Command({ Bucket, Prefix: APP_PREFIX, ContinuationToken })
      );
      for (const object of page.Contents ?? []) {
        if (!object.Key) continue;
        objects.push({
          path: object.Key,
          size: object.Size ?? 0,
          createdAt: object.LastModified ?? new Date(),
        });
      }
      ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);
    return objects;
  },

  async remove(objects) {
    const client = getS3Client();
    const Bucket = getR2BucketName();
    for (let i = 0; i < objects.length; i += S3_DELETE_BATCH) {
      const answer = await client.send(
        new DeleteObjectsCommand({
          Bucket,
          Delete: {
            Objects: objects.slice(i, i + S3_DELETE_BATCH).map((o) => ({ Key: o.path })),
            Quiet: true,
          },
        })
      );
      /* Quiet answers with the keys that failed and nothing else. */
      if (answer.Errors?.length) {
        throw new Error(`R2 did not remove ${answer.Errors.length} objects`);
      }
    }
  },
};

export function reconcileDeps(supabase: SupabaseClient): ReconcileDeps {
  const deps: ReconcileDeps = {
    rows: (provider) => rowsOf(supabase, provider),

    async storageBucket(createdBefore) {
      const { data, error } = await supabase.rpc('reconcile_storage_bucket', {
        p_created_before: createdBefore.toISOString(),
      });
      if (error) throw new Error(`Could not compare the Storage bucket: ${error.message}`);
      return ((data ?? []) as BucketFinding[]).map((finding) => ({
        ...finding,
        recorded: finding.recorded === null ? null : Number(finding.recorded),
        actual: finding.actual === null ? null : Number(finding.actual),
      }));
    },

    async removeFromBucket(paths) {
      for (let i = 0; i < paths.length; i += BUCKET_REMOVE_BATCH) {
        const { error } = await supabase.storage
          .from(BUCKET)
          .remove(paths.slice(i, i + BUCKET_REMOVE_BATCH));
        if (error) throw new Error(`Storage did not remove the objects: ${error.message}`);
      }
    },

    /* Conditional on the size it had when it was read: a row the owner
       deleted meanwhile, or one corrected twice, is left alone. */
    async resize(fileId, from, to) {
      const { data, error } = await supabase
        .from('files')
        .update({ size: to })
        .eq('id', fileId)
        .eq('size', from)
        .select('id');
      if (error) throw new Error(`Could not correct a row's size: ${error.message}`);
      return (data ?? []).length === 1;
    },

    async recount(apply) {
      const { data, error } = await supabase.rpc('reconcile_bytes_used', { p_apply: apply });
      if (error) throw new Error(`Could not recount bytes_used: ${error.message}`);
      return (data ?? []) as QuotaDrift[];
    },
  };

  if (configureCloudinaryAdmin()) deps.cloudinary = cloudinaryStore;
  if (r2Configured()) deps.r2 = r2Store;
  return deps;
}
