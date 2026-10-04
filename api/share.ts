import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateUser, AuthError, supabase } from '../lib/auth';
import { getAppUrl } from '../lib/app-url';
import {
  generateShareToken,
  hashShareToken,
  resolveExpiry,
  shareUnusableReason,
  shareUrl,
} from '../lib/share';
import {
  RateLimiter,
  SHARE_CREATE_LIMIT,
  SHARE_IP_LIMIT,
  clientIp,
  tooManyRequests,
} from '../lib/rate-limit';
import { applyCors } from '../lib/cors';
import { isSafeHttpUrl } from '../lib/safe-url';
import { signOwnedPath } from '../lib/sign-owned-path';

/**
 * Public share links.
 *
 * One file rather than three: Vercel turns every module under api/ into its own
 * serverless function and the Hobby plan allows twelve.
 *
 *   POST   /api/share            create a link for a file the caller owns
 *   GET    /api/share?token=...  open a link — no authentication, by design
 *   DELETE /api/share?id=...     revoke one of the caller's links
 *
 * The token is never stored, only its SHA-256. Lookup therefore happens here,
 * with the service-role key: shared_links has no policy the client could use.
 */

const SIGNED_URL_TTL = 3600;

/**
 * Two limits, because the route has two kinds of caller.
 *
 * `byAddress` covers every method and runs before anything else, including the
 * token check, so an anonymous caller cannot make this route do work — a hash,
 * a lookup, a signature — by asking repeatedly. `byUser` covers creation only,
 * and is keyed on the account rather than the address: a share link is minted
 * by a person who is signed in, and counting those against an address would
 * charge one office visitor for what their colleagues did.
 *
 * Revocation is deliberately outside `byUser`. It is the owner's emergency
 * brake for a link that got out, and refusing it protects nothing — the link
 * stays live for exactly as long as the refusal lasts. It still counts against
 * the address, which is what bounds the cost of a loop.
 */
const byAddress = new RateLimiter(SHARE_IP_LIMIT);
const byUser = new RateLimiter(SHARE_CREATE_LIMIT);

interface FileRow {
  id: string;
  name: string;
  size: number;
  type: string;
  storage_path: string;
  storage_type: string;
  download_url: string;
  user_id: string;
}

/**
 * A URL the recipient's browser can fetch.
 *
 * R2 and Supabase Storage keep private objects and need a signature; the other
 * providers already store a delivery URL that works on its own.
 */
async function downloadUrlFor(file: FileRow): Promise<string> {
  /* Signed only if the path is the owner's — the row's user_id, since RLS will
     not let an account write a row under anyone else's. Every recipient has read
     the path in the signed URL they were handed, so without that check a revoked
     or expired link could be replaced by a fresh one on a row of their own. */
  const signed = await signOwnedPath(file, file.user_id, SIGNED_URL_TTL);
  if (signed) return signed;

  /* The only value on this path the owner controls directly. RLS lets an
     account write anything into its own row, `FileMetadataSchema` stopped
     checking the shape years ago, and there is no constraint on the column —
     so a `javascript:` URL written here and then shared is script running on
     this origin in the recipient's session. Refused rather than sanitised:
     there is no legitimate stored value this rejects. */
  if (!isSafeHttpUrl(file.download_url)) {
    throw new Error('The stored location for this file is not a usable URL');
  }

  return file.download_url;
}

async function createLink(req: VercelRequest, res: VercelResponse) {
  const userId = await authenticateUser(req);

  // After authentication, so the limit belongs to the account rather than to
  // whoever shares its address.
  if (!byUser.allow(userId)) {
    return tooManyRequests(
      res,
      byUser.retryAfterSeconds(userId),
      'Too many share links created. Try again in a minute.'
    );
  }

  const { fileId, expiresInDays } = req.body as { fileId?: string; expiresInDays?: number };

  if (!fileId) {
    return res.status(400).json({ message: 'fileId is required' });
  }

  // Ownership is checked here rather than trusted from the client: this route
  // mints a credential that bypasses authentication entirely.
  const { data: files, error: fileError } = await supabase
    .from('files')
    .select('id, storage_type')
    .eq('id', fileId)
    .eq('user_id', userId)
    .limit(1);

  if (fileError) throw new Error(`Failed to read file: ${fileError.message}`);
  if (!files || files.length === 0) {
    return res.status(404).json({ message: 'File not found' });
  }

  /* What a Drive file stores is Drive's own viewer, reached with the owner's
     grant. Anyone else who opens it is asked to request access, so a link
     minted here would look like a share and open nothing. The file page does
     not offer one, and this route does not make one for a caller who asks
     anyway. 422: the request is well-formed, and this file cannot be shared
     this way. */
  if ((files[0] as { storage_type?: string }).storage_type === 'googledrive') {
    return res
      .status(422)
      .json({ message: 'A file in Google Drive is shared from Google Drive itself' });
  }

  const token = generateShareToken();
  const expiresAt = resolveExpiry(expiresInDays);

  const { error } = await supabase.from('shared_links').insert({
    file_id: fileId,
    created_by: userId,
    token_hash: hashShareToken(token),
    expires_at: expiresAt.toISOString(),
  });

  if (error) throw new Error(`Failed to create share link: ${error.message}`);

  // The only time the plaintext token exists outside the recipient's URL.
  return res.status(201).json({
    url: shareUrl(getAppUrl(req), token),
    expiresAt: expiresAt.toISOString(),
  });
}

async function openLink(req: VercelRequest, res: VercelResponse) {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!token) {
    return res.status(400).json({ message: 'token is required' });
  }

  const { data: links, error } = await supabase
    .from('shared_links')
    .select('file_id, expires_at, revoked_at')
    .eq('token_hash', hashShareToken(token))
    .limit(1);

  if (error) throw new Error(`Failed to read share link: ${error.message}`);

  const link = (links || [])[0] as
    { file_id: string; expires_at: string | null; revoked_at: string | null } | undefined;

  // One answer for "no such link", "revoked" and "expired" would be friendlier
  // to guessers; one answer for all three is friendlier to the owner. The token
  // is unguessable, so say which it is.
  if (!link) return res.status(404).json({ message: 'This link does not exist' });

  const unusable = shareUnusableReason(link);
  if (unusable === 'revoked') {
    return res.status(410).json({ message: 'This link has been revoked' });
  }
  if (unusable === 'expired') {
    return res.status(410).json({ message: 'This link has expired' });
  }

  const { data: files, error: fileError } = await supabase
    .from('files')
    .select('id, name, size, type, storage_path, storage_type, download_url, user_id')
    .eq('id', link.file_id)
    .limit(1);

  if (fileError) throw new Error(`Failed to read file: ${fileError.message}`);

  const file = (files || [])[0] as FileRow | undefined;
  if (!file) return res.status(404).json({ message: 'The shared file no longer exists' });

  // Deliberately narrow: the recipient gets the file, not the owner's identity
  // or anything else stored alongside it.
  return res.status(200).json({
    name: file.name,
    size: file.size,
    type: file.type,
    downloadUrl: await downloadUrlFor(file),
  });
}

async function revokeLink(req: VercelRequest, res: VercelResponse) {
  const userId = await authenticateUser(req);
  const id = typeof req.query.id === 'string' ? req.query.id : '';

  if (!id) {
    return res.status(400).json({ message: 'id is required' });
  }

  // Revoked rather than deleted: the row is the evidence that a link existed.
  const { data, error } = await supabase
    .from('shared_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('created_by', userId)
    .select('id');

  if (error) throw new Error(`Failed to revoke share link: ${error.message}`);
  if (!data || data.length === 0) {
    return res.status(404).json({ message: 'Share link not found' });
  }

  return res.status(200).json({ revoked: true });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  /* Before anything else: a preflight from the native shell carries no
     Authorization header, and everything below expects one. */
  if (applyCors(req, res)) return;

  const ip = clientIp(req.headers, req.socket?.remoteAddress);
  if (!byAddress.allow(ip)) {
    return tooManyRequests(
      res,
      byAddress.retryAfterSeconds(ip),
      'Too many requests. Try again in a minute.'
    );
  }

  try {
    switch (req.method) {
      case 'POST':
        return await createLink(req, res);
      case 'GET':
        return await openLink(req, res);
      case 'DELETE':
        return await revokeLink(req, res);
      default:
        return res.status(405).json({ message: 'Method not allowed' });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Share error:', error);
    return res.status(error instanceof AuthError ? 401 : 500).json({ message });
  }
}
