/**
 * The largest file each provider takes in one upload, where the provider has a
 * limit this app can reach.
 *
 * Asked before a byte travels. Nothing asked before: a 12 MB photo went to
 * Cloudinary in full and was refused at the end, and a 60 MB PDF went to
 * Supabase Storage the same way, each after the whole wait.
 *
 * Here and not in libs/core: only the browser reads it.
 */
export const UPLOAD_LIMITS: Readonly<Record<string, number>> = {
  /* Cloudinary's free plan takes an image, and a raw file, of up to 10 MB
     (its support answers). The app sends it no video. A paid plan raises
     the limit, and this with it. */
  cloudinary: 10 * 1024 * 1024,
  /* The most Supabase's free plan accepts, and what migrations/018 sets the
     bucket to. A test holds the two together. */
  supabase_storage: 50 * 1024 * 1024,
  /* What `/2/files/upload` takes, the endpoint dropbox.service.ts sends to.
     More needs an upload session, which it does not open. */
  dropbox: 150 * 1024 * 1024,
};

/* R2 takes a multipart upload of up to 5 TB. Drive takes up to 5 TB too:
   Google suggests a resumable upload above 5 MB rather than the multipart
   one googledrive.service.ts sends, and refuses neither. Neither has an
   entry, so neither refuses a file here. */
export function fitsProvider(provider: string, size: number): boolean {
  const limit = UPLOAD_LIMITS[provider];
  return limit === undefined || size <= limit;
}

/** Thrown before an upload starts, for a file no provider it may go to takes. */
export class FileTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileTooLargeError';
  }
}
