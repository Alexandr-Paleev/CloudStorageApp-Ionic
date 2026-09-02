import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authenticateUser, AuthError } from '../../lib/auth';
import { getS3Client, getR2BucketName } from '../../lib/r2';
import { sanitizeFileName } from '../../lib/filename';
import { readQuota, quotaRejection } from '../../lib/quota';
import { MAX_PARTS, MAX_PARTS_PER_BATCH } from '../../lib/multipart';
import {
  PRESIGN_IP_LIMIT,
  PRESIGN_LIMIT,
  R2_PART_SIGN_LIMIT,
  RateLimiter,
  clientIp,
  tooManyRequests,
} from '../../lib/rate-limit';

/**
 * Everything R2, behind one serverless function.
 *
 *   POST /api/r2/presign-upload       one PUT for a small file
 *   POST /api/r2/presign-download     a short-lived GET
 *   POST /api/r2/delete               remove an object
 *   POST /api/r2/multipart-create     begin a resumable upload
 *   POST /api/r2/multipart-sign       URLs for a batch of parts
 *   POST /api/r2/multipart-complete   assemble the parts into the object
 *   POST /api/r2/multipart-abort      give up and release what was stored
 *
 * These were three files until multipart needed four more routes and the Hobby
 * plan's twelve functions were already spoken for. The paths are unchanged:
 * /api/r2/delete resolves to this file through the dynamic segment exactly as
 * it used to resolve to delete.ts, so nothing on the client moved.
 * See docs/decisions/0008-two-actions-one-function.md for the same trade in the
 * Cloudinary route.
 */

const DEFAULT_DOWNLOAD_TTL = 3600;

/** Part URLs outlive a slow connection but not a stolen laptop. Six hours is
 *  long enough that a resumed upload rarely has to re-sign what it already
 *  holds, and short enough to be worthless later. */
const PART_URL_TTL = 6 * 3600;

const byAddress = new RateLimiter(PRESIGN_IP_LIMIT);
const byUploadingUser = new RateLimiter(PRESIGN_LIMIT);
const byPartSigningUser = new RateLimiter(R2_PART_SIGN_LIMIT);

/**
 * Every object this app writes lives under the uploader's own prefix, and this
 * is the only thing standing between a caller and someone else's file. The
 * trailing slash is load-bearing: without it `users/user-1` would authorise
 * `users/user-10/`.
 */
function ownsKey(userId: string, key: string): boolean {
  return key.startsWith(`users/${userId}/`);
}

function bad(res: VercelResponse, message: string) {
  return res.status(400).json({ message });
}

async function presignUpload(req: VercelRequest, res: VercelResponse, userId: string) {
  const { fileName, contentType, size } = req.body as {
    fileName?: string;
    contentType?: string;
    size?: number;
  };

  if (!fileName) return bad(res, 'fileName is required');
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
    return bad(res, 'size (in bytes) is required');
  }

  if (!byUploadingUser.allow(userId)) {
    return tooManyRequests(
      res,
      byUploadingUser.retryAfterSeconds(userId),
      'Too many upload requests. Try again in a minute.'
    );
  }

  // Refuse before the bytes travel. This is not the last line of defence —
  // that is the trigger on public.files, which also covers the providers
  // that upload straight from the browser and never reach this handler.
  const rejection = quotaRejection(await readQuota(userId), size);
  if (rejection) return res.status(413).json({ message: rejection });

  const key = `users/${userId}/${Date.now()}_${sanitizeFileName(fileName)}`;

  const command = new PutObjectCommand({
    Bucket: getR2BucketName(),
    Key: key,
    ContentType: contentType || 'application/octet-stream',
    // Lands in X-Amz-SignedHeaders, so the approved size cannot be exceeded
    // after the URL has been handed out.
    ContentLength: size,
  });

  const uploadUrl = await getSignedUrl(getS3Client(), command, { expiresIn: DEFAULT_DOWNLOAD_TTL });
  return res.status(200).json({ uploadUrl, key });
}

async function presignDownload(req: VercelRequest, res: VercelResponse, userId: string) {
  const { key, expiresIn } = req.body as { key?: string; expiresIn?: number };

  if (!key) return bad(res, 'key is required');
  if (!ownsKey(userId, key)) return res.status(403).json({ message: 'Access denied' });

  const command = new GetObjectCommand({ Bucket: getR2BucketName(), Key: key });
  const url = await getSignedUrl(getS3Client(), command, {
    expiresIn: expiresIn || DEFAULT_DOWNLOAD_TTL,
  });

  return res.status(200).json({ url });
}

async function deleteObject(req: VercelRequest, res: VercelResponse, userId: string) {
  const { key } = req.body as { key?: string };

  if (!key) return bad(res, 'key is required');
  if (!ownsKey(userId, key)) return res.status(403).json({ message: 'Access denied' });

  await getS3Client().send(new DeleteObjectCommand({ Bucket: getR2BucketName(), Key: key }));
  return res.status(200).json({ success: true });
}

/**
 * Opens a multipart upload and hands back the id the parts will be attached to.
 *
 * The quota is checked here and nowhere else in the lifecycle: this is the
 * moment the size is known and nothing has been stored yet. Parts uploaded
 * afterwards are not weighed — the handler never sees them — which is the same
 * boundary the single-PUT path has, and the reason the trigger on public.files
 * exists (docs/decisions/0004-quota-lives-in-the-database.md).
 */
async function multipartCreate(req: VercelRequest, res: VercelResponse, userId: string) {
  const { fileName, contentType, size } = req.body as {
    fileName?: string;
    contentType?: string;
    size?: number;
  };

  if (!fileName) return bad(res, 'fileName is required');
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return bad(res, 'size (in bytes) is required');
  }

  if (!byUploadingUser.allow(userId)) {
    return tooManyRequests(
      res,
      byUploadingUser.retryAfterSeconds(userId),
      'Too many upload requests. Try again in a minute.'
    );
  }

  const rejection = quotaRejection(await readQuota(userId), size);
  if (rejection) return res.status(413).json({ message: rejection });

  const key = `users/${userId}/${Date.now()}_${sanitizeFileName(fileName)}`;

  const created = await getS3Client().send(
    new CreateMultipartUploadCommand({
      Bucket: getR2BucketName(),
      Key: key,
      ContentType: contentType || 'application/octet-stream',
    })
  );

  if (!created.UploadId) {
    throw new Error('R2 did not return an upload id');
  }

  return res.status(201).json({ key, uploadId: created.UploadId });
}

/**
 * Signs a batch of part URLs.
 *
 * A batch rather than one part per request, because a resumed upload needs URLs
 * for everything it has not finished yet and a request per part would spend the
 * rate limit on bookkeeping. A batch rather than all of them at creation,
 * because an upload paused overnight comes back to URLs that have expired —
 * asking again is one round trip, and re-signing is free.
 */
async function multipartSign(req: VercelRequest, res: VercelResponse, userId: string) {
  const { key, uploadId, partNumbers } = req.body as {
    key?: string;
    uploadId?: string;
    partNumbers?: unknown;
  };

  if (!key || !uploadId) return bad(res, 'key and uploadId are required');
  if (!ownsKey(userId, key)) return res.status(403).json({ message: 'Access denied' });

  if (!Array.isArray(partNumbers) || partNumbers.length === 0) {
    return bad(res, 'partNumbers must be a non-empty array');
  }
  if (partNumbers.length > MAX_PARTS_PER_BATCH) {
    return bad(res, `partNumbers must hold at most ${MAX_PARTS_PER_BATCH} entries`);
  }
  if (
    !partNumbers.every(
      (n) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_PARTS
    )
  ) {
    return bad(res, `every part number must be an integer between 1 and ${MAX_PARTS}`);
  }

  if (!byPartSigningUser.allow(userId)) {
    return tooManyRequests(
      res,
      byPartSigningUser.retryAfterSeconds(userId),
      'Too many upload requests. Try again in a minute.'
    );
  }

  const client = getS3Client();
  const bucket = getR2BucketName();

  const urls = await Promise.all(
    (partNumbers as number[]).map(async (partNumber) => ({
      partNumber,
      url: await getSignedUrl(
        client,
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: PART_URL_TTL }
      ),
    }))
  );

  return res.status(200).json({ urls });
}

/**
 * Assembles the parts.
 *
 * The ETags come from the browser, which read them off each part's response.
 * R2 verifies them: a wrong or missing tag fails the completion rather than
 * producing a half-assembled object.
 */
async function multipartComplete(req: VercelRequest, res: VercelResponse, userId: string) {
  const { key, uploadId, parts } = req.body as {
    key?: string;
    uploadId?: string;
    parts?: { partNumber?: number; etag?: string }[];
  };

  if (!key || !uploadId) return bad(res, 'key and uploadId are required');
  if (!ownsKey(userId, key)) return res.status(403).json({ message: 'Access denied' });
  if (!Array.isArray(parts) || parts.length === 0) {
    return bad(res, 'parts must be a non-empty array');
  }

  const ordered = [...parts].sort((a, b) => (a.partNumber || 0) - (b.partNumber || 0));

  if (!ordered.every((p) => typeof p.partNumber === 'number' && typeof p.etag === 'string')) {
    return bad(res, 'every part needs a partNumber and an etag');
  }

  await getS3Client().send(
    new CompleteMultipartUploadCommand({
      Bucket: getR2BucketName(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: ordered.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
      },
    })
  );

  return res.status(200).json({ key });
}

/**
 * Gives up on an upload and releases the parts already stored.
 *
 * Deliberately outside the per-account rate limit, for the reason revoking a
 * share link is: refusing this protects nothing and leaves the parts sitting in
 * the bucket, billable, until the lifecycle rule sweeps them.
 */
async function multipartAbort(req: VercelRequest, res: VercelResponse, userId: string) {
  const { key, uploadId } = req.body as { key?: string; uploadId?: string };

  if (!key || !uploadId) return bad(res, 'key and uploadId are required');
  if (!ownsKey(userId, key)) return res.status(403).json({ message: 'Access denied' });

  await getS3Client().send(
    new AbortMultipartUploadCommand({
      Bucket: getR2BucketName(),
      Key: key,
      UploadId: uploadId,
    })
  );

  return res.status(200).json({ aborted: true });
}

const ACTIONS: Record<
  string,
  (req: VercelRequest, res: VercelResponse, userId: string) => Promise<unknown>
> = {
  'presign-upload': presignUpload,
  'presign-download': presignDownload,
  delete: deleteObject,
  'multipart-create': multipartCreate,
  'multipart-sign': multipartSign,
  'multipart-complete': multipartComplete,
  'multipart-abort': multipartAbort,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const ip = clientIp(req.headers, req.socket?.remoteAddress);
  if (!byAddress.allow(ip)) {
    return tooManyRequests(
      res,
      byAddress.retryAfterSeconds(ip),
      'Too many requests. Try again in a minute.'
    );
  }

  const name = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
  const action = ACTIONS[name ?? ''];

  if (!action) {
    return res.status(404).json({ message: `Unknown action "${name ?? ''}"` });
  }

  try {
    const userId = await authenticateUser(req);
    return await action(req, res, userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error(`R2 ${name} error:`, error);
    return res.status(error instanceof AuthError ? 401 : 500).json({ message });
  }
}
