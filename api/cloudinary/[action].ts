import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../../libs/server/src/vercel';
import { authenticateUser, AuthError } from '../../libs/server/src/auth';
import { readQuota, quotaRejection } from '../../libs/server/src/quota';
import {
  CLOUDINARY_DELETE_LIMIT,
  CLOUDINARY_IP_LIMIT,
  CLOUDINARY_SIGN_LIMIT,
  RateLimiter,
  clientIp,
  tooManyRequests,
} from '../../libs/server/src/rate-limit';
import { applyCors } from '../../libs/server/src/cors';
import { ownerPrefix, ownsStoredPath } from '../../libs/core/src/stored-path';
import { report } from '../../libs/server/src/report';
import {
  QuotaExceeded,
  UnknownFolder,
  readUploadDescription,
  recordUpload,
} from '../../libs/server/src/record-upload';

/**
 * Three actions, one serverless function: /api/cloudinary/sign,
 * /api/cloudinary/confirm and /api/cloudinary/delete.
 *
 * They share a file because Vercel turns every file under api/ into its own
 * function and the Hobby plan allows twelve — which this repository already
 * has. A dynamic segment costs nothing and keeps signing uploads from needing
 * a thirteenth. See resolveHandler() in vite-plugin-dev-api.mts for the dev
 * server's side of the same routing.
 */

/**
 * A limit per address and one per account, as on /api/r2/presign-upload —
 * this is the same act on the provider most of this account's files go to.
 *
 * Signing and deleting are counted apart because they are not the same shape of
 * work: signing authorizes bytes that count against the quota, while deleting
 * gives bytes back and is the thing a person does in a run of ten. Both of
 * them reach outside this deployment, which is what the address limit in
 * front of the token check is really protecting.
 */
const byAddress = new RateLimiter(CLOUDINARY_IP_LIMIT);
const bySigningUser = new RateLimiter(CLOUDINARY_SIGN_LIMIT);
/* Its own counter at the signing limit: every upload is signed once and
   confirmed once, and one shared counter would halve what an account may
   upload in a minute. */
const byConfirmingUser = new RateLimiter(CLOUDINARY_SIGN_LIMIT);
const byDeletingUser = new RateLimiter(CLOUDINARY_DELETE_LIMIT);

/**
 * Images go to Cloudinary's image endpoint; everything else is `raw`.
 *
 * Not `auto`. Auto decides for itself, and the decision has to be one that
 * CloudinaryProvider.delete can reproduce months later from the stored row —
 * it is the difference between deleting the asset and leaving it in the
 * account forever, uncounted. Images keep no extension in their public_id,
 * raw assets do, and both sides now split on the same question.
 */
function resourceTypeFor(fileName: string, contentType?: string): 'raw' | 'image' {
  // A ternary, not `??`: the browser sends '' — not undefined — when it cannot
  // work out a type, and '' is a string, so `??` never reached the filename.
  // A holiday.jpg picked up from a drive that reports no MIME type was being
  // signed for the raw endpoint.
  const isImage = contentType
    ? contentType.startsWith('image/')
    : /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(fileName);

  return isImage ? 'image' : 'raw';
}

/**
 * The name of a new asset: random, so that nobody else picks it. A raw file
 * keeps its extension, as the names Cloudinary gives raw files do (seen on
 * production): it is what the file is delivered as.
 */
function publicIdFor(fileName: string, resourceType: 'raw' | 'image'): string {
  const id = randomUUID().replace(/-/g, '');
  const extension = /\.([a-z0-9]{1,10})$/i.exec(fileName)?.[1]?.toLowerCase();
  return resourceType === 'raw' && extension ? `${id}.${extension}` : id;
}

function configureCloudinary(cloudinary: { config: (options: Record<string, string>) => void }) {
  // Server-side names only: a VITE_ prefixed fallback would be inlined into
  // the public client bundle by Vite.
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
    api_key: process.env.CLOUDINARY_API_KEY || '',
    api_secret: process.env.CLOUDINARY_API_SECRET || '',
  });
}

/**
 * Authorizes one upload into the caller's own folder.
 *
 * Replaces an unsigned upload preset. That preset let anything with the cloud
 * name — which ships in the client bundle — write into this account without
 * an account here at all, and it meant the quota was checked nowhere on the
 * path production actually uses for images.
 */
async function signUpload(req: VercelRequest, res: VercelResponse, userId: string): Promise<void> {
  const { fileName, size, contentType } = req.body as {
    fileName?: string;
    size?: number;
    contentType?: string;
  };

  if (!fileName) {
    res.status(400).json({ message: 'fileName is required' });
    return;
  }

  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
    res.status(400).json({ message: 'size (in bytes) is required' });
    return;
  }

  const rejection = quotaRejection(await readQuota(userId), size);
  if (rejection) {
    res.status(413).json({ message: rejection });
    return;
  }

  const secret = process.env.CLOUDINARY_API_SECRET;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!secret || !apiKey || !cloudName) {
    // 501, not 500: the client cannot see the server's variables, so
    // isConfigured() still routes images here on a half-configured
    // deployment. A 500 would be retried twice on the way to the same answer.
    res.status(501).json({ message: 'Cloudinary is not configured on the server' });
    return;
  }

  const cloudinary = (await import('cloudinary')).v2;
  configureCloudinary(cloudinary);

  // The name is chosen here and signed, with overwrite off. Left to Cloudinary,
  // every upload got a name of its own, so one signature, good for an hour,
  // took as many files as were sent with it: two different files, measured on
  // production on 2026-10-23. Named here, a second upload with the signature
  // finds the first and keeps it, so one quota check buys one file, and no
  // upload can land on top of an asset that already exists. The folder is
  // what binds the asset to its owner — /api/cloudinary/delete checks exactly
  // this prefix before destroying anything.
  const timestamp = Math.round(Date.now() / 1000);
  const resourceType = resourceTypeFor(fileName, contentType);
  const params = {
    // The owner's prefix as Cloudinary wants a folder: without the slash.
    folder: ownerPrefix('cloudinary', userId).replace(/\/$/, ''),
    public_id: publicIdFor(fileName, resourceType),
    overwrite: false,
    tags: `user_${userId}`,
    timestamp,
  };

  res.status(200).json({
    ...params,
    cloudName,
    // Public by design: it travels with every signed browser upload. The
    // secret never leaves this function.
    apiKey,
    signature: cloudinary.utils.api_sign_request(params, secret),
    resourceType,
  });
}

/**
 * Records an upload Cloudinary holds, with the size Cloudinary reports.
 *
 * The row used to be written by the browser, and the quota trigger counted
 * the size it named: an account could store 40 MB and record a kilobyte. The
 * signature does not bind the size, so nothing before this point knows what
 * arrived. Since migration 020 the browser may not insert a Cloudinary row;
 * this asks Cloudinary's Admin API for the asset and writes the row with the
 * service role. One Admin API request per upload, of the 500 an hour the free
 * plan allows; the Upload API, which `sign` and `delete` use, has no such
 * limit. See docs/decisions/0017-the-server-weighs-an-upload.md.
 *
 * Whatever is not recorded is destroyed: an asset over the quota, in a folder
 * that is not there, or that could not be weighed, would otherwise stay in
 * the account uncounted, and the browser is about to be told it failed.
 */
async function confirmUpload(req: VercelRequest, res: VercelResponse, userId: string) {
  const { publicId, resourceType } = req.body as { publicId?: string; resourceType?: string };

  if (!publicId) {
    res.status(400).json({ message: 'publicId is required' });
    return;
  }
  // The two `sign` hands out. The value names the endpoint the asset is asked
  // for, and the one it is destroyed through if it is not kept.
  if (resourceType !== 'image' && resourceType !== 'raw') {
    res.status(400).json({ message: 'resourceType must be image or raw' });
    return;
  }
  const read = readUploadDescription(req.body);
  if ('problem' in read) {
    res.status(400).json({ message: read.problem });
    return;
  }
  if (!ownsAsset(userId, publicId)) {
    res.status(403).json({ message: 'Access denied' });
    return;
  }
  if (
    !process.env.CLOUDINARY_API_SECRET ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_CLOUD_NAME
  ) {
    res.status(501).json({ message: 'Cloudinary is not configured on the server' });
    return;
  }

  const cloudinary = (await import('cloudinary')).v2;
  configureCloudinary(cloudinary);
  const discard = () => cloudinary.uploader.destroy(publicId, { resource_type: resourceType });

  let asset: { bytes: number; secure_url: string };
  try {
    asset = await cloudinary.api.resource(publicId, { resource_type: resourceType });
  } catch (error) {
    // The SDK rejects with Cloudinary's answer, not an Error.
    const status = (error as { error?: { http_code?: number } })?.error?.http_code;
    if (status === 404) {
      res.status(404).json({ message: 'Cloudinary holds no such upload' });
      return;
    }
    if (status === 420 || status === 429) {
      // The hour's Admin API requests are spent. An asset that cannot be
      // weighed is not recorded, so it is not kept either.
      await discard();
      res
        .status(503)
        .json({ message: 'The upload could not be checked right now. Try again later.' });
      return;
    }
    throw error;
  }

  try {
    const row = await recordUpload({
      userId,
      description: read.description,
      size: asset.bytes,
      downloadUrl: asset.secure_url,
      storagePath: publicId,
      storageType: 'cloudinary',
    });
    res.status(201).json(row);
  } catch (error) {
    await discard();
    if (error instanceof QuotaExceeded) {
      res.status(413).json({
        message: quotaRejection(await readQuota(userId), asset.bytes) ?? error.message,
      });
      return;
    }
    if (error instanceof UnknownFolder) {
      res.status(400).json({ message: error.message });
      return;
    }
    throw error;
  }
}

/**
 * Whether the asset sits in the caller's own folder — and the folder alone
 * decides.
 *
 * `signUpload` puts every upload under `users/<id>/`, and on this account the
 * folder becomes part of the public_id: the unsigned uploads before it sent the
 * same `folder` parameter, and all ten of their rows carry the prefix (checked
 * against production on 2026-09-29). CloudinaryProvider strips the extension
 * from image public_ids before calling this endpoint, which a prefix does not
 * notice.
 *
 * There used to be a second way in, for accounts on dynamic folders: a
 * public_id that matched one of the caller's `files` rows. Those rows were
 * written by the browser — RLS decides whose row it is, never what it says —
 * so a caller could store another account's public_id in a row of their own
 * and delete that account's asset with it. Nor is a public_id a secret: one is
 * in every delivery URL, shared links included. An account on dynamic folders
 * now gets a 403 it can see, rather than everyone getting a way to delete what
 * they do not own.
 *
 * The prefix, and why its trailing slash matters, is `libs/core/src/stored-path.ts`.
 */
function ownsAsset(userId: string, publicId: string): boolean {
  return ownsStoredPath({ storage_type: 'cloudinary', storage_path: publicId }, userId);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  /* Before anything else: a preflight from the native shell carries no
     Authorization header, and everything below expects one. */
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  const ip = clientIp(req.headers, req.socket?.remoteAddress);
  if (!byAddress.allow(ip)) {
    tooManyRequests(
      res,
      byAddress.retryAfterSeconds(ip),
      'Too many requests. Try again in a minute.'
    );
    return;
  }

  const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
  /* What a report says the failure was in: one of the three actions, or the
     function for a segment that is neither. */
  const route =
    action === 'sign' || action === 'confirm' || action === 'delete'
      ? `cloudinary/${action}`
      : 'cloudinary';

  try {
    const userId = await authenticateUser(req);

    if (action === 'sign') {
      if (!bySigningUser.allow(userId)) {
        tooManyRequests(
          res,
          bySigningUser.retryAfterSeconds(userId),
          'Too many upload requests. Try again in a minute.'
        );
        return;
      }
      await signUpload(req, res, userId);
      return;
    }
    if (action === 'confirm') {
      if (!byConfirmingUser.allow(userId)) {
        tooManyRequests(
          res,
          byConfirmingUser.retryAfterSeconds(userId),
          'Too many upload requests. Try again in a minute.'
        );
        return;
      }
      await confirmUpload(req, res, userId);
      return;
    }
    if (action !== 'delete') {
      res.status(404).json({ message: `Unknown action "${action ?? ''}"` });
      return;
    }

    // After the action is known, so an unknown segment cannot eat into the limit
    // of the one it was misspelled from.
    if (!byDeletingUser.allow(userId)) {
      tooManyRequests(
        res,
        byDeletingUser.retryAfterSeconds(userId),
        'Too many deletions. Try again in a minute.'
      );
      return;
    }

    const { publicId, resourceType } = req.body as { publicId?: string; resourceType?: string };

    if (!publicId) {
      res.status(400).json({ message: 'publicId is required' });
      return;
    }

    if (!ownsAsset(userId, publicId)) {
      res.status(403).json({ message: 'Access denied' });
      return;
    }

    // Whitelisted, not taken as given: this value is interpolated into the
    // path Cloudinary is called on, and an unrecognised one would also skew
    // the not-found fallback below.
    const RESOURCE_TYPES = ['image', 'raw', 'video'];
    if (resourceType && !RESOURCE_TYPES.includes(resourceType)) {
      res.status(400).json({ message: `Unsupported resourceType "${resourceType}"` });
      return;
    }

    // Only now, with every refusal behind it: loading and configuring the SDK
    // is the expensive part of this branch, and a 400 or 403 needs neither.
    const cloudinary = (await import('cloudinary')).v2;
    configureCloudinary(cloudinary);

    const options = { resource_type: resourceType || 'image' };

    let result = await cloudinary.uploader.destroy(publicId, options);

    // The stored row is the only record of which endpoint an asset went to,
    // and rows written before signing existed went through `auto`, which chose
    // for itself. So a miss is retried against the other endpoint — in both
    // directions, since the caller now names 'raw' explicitly.
    if (result.result === 'not found') {
      const fallback = options.resource_type === 'raw' ? 'image' : 'raw';
      result = await cloudinary.uploader.destroy(publicId, { resource_type: fallback });
    }

    if (result.result === 'ok' || result.result === 'not found') {
      res.status(200).json({
        success: true,
        message:
          result.result === 'not found'
            ? 'File not found (may already be deleted)'
            : 'Deleted successfully',
        details: result,
      });
      return;
    } else {
      console.error(`[Cloudinary] Deletion failed:`, result);
      await report(new Error(`Cloudinary did not delete an asset: ${result.result}`), {
        route: 'cloudinary/delete',
        userId,
      });
      res.status(500).json({
        message: `Failed to delete file from Cloudinary: ${result.result}`,
        details: result,
      });
      return;
    }
  } catch (error) {
    // Shared by every action, so it says neither "upload" nor "delete". The
    // key is `message` throughout: httpErrorFrom() on the client reads that
    // one, and a mismatch turned every failure here — an expired session, a
    // missing migration — into a bare "Failed to authorize the upload".
    console.error('[cloudinary]', error);
    if (!(error instanceof AuthError)) await report(error, { route });
    res.status(error instanceof AuthError ? 401 : 500).json({
      message: error instanceof Error ? error.message : 'Unknown server error',
    });
    return;
  }
}
