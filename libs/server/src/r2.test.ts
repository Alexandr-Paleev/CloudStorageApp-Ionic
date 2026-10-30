import { describe, it, expect, beforeAll } from 'vitest';
import { PutObjectCommand, UploadPartCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getS3Client } from './r2';

/**
 * What a presigned upload address asks R2 to check.
 *
 * The routes' own tests replace the presigner, so nothing there sees the
 * address the SDK actually builds. This signs with the client the routes use
 * and made-up keys: presigning is arithmetic, and nothing here reaches the
 * network. Before the client turned checksums off, both addresses carried
 * `x-amz-checksum-crc32=AAAAAA==` — the CRC32 of an empty body, signed before
 * the browser had sent a byte.
 */

beforeAll(() => {
  process.env.R2_ENDPOINT = 'https://account.r2.cloudflarestorage.com';
  process.env.R2_ACCESS_KEY_ID = 'test-id';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
});

/** The names in a signed address's query, lowercased. */
function queryNames(url: string): string[] {
  return [...new URL(url).searchParams.keys()].map((name) => name.toLowerCase());
}

describe('a presigned R2 upload', () => {
  it('asks for no checksum of a whole file', async () => {
    const url = await getSignedUrl(
      getS3Client(),
      new PutObjectCommand({
        Bucket: 'files',
        Key: 'users/u1/1_a.bin',
        ContentType: 'application/octet-stream',
        ContentLength: 5,
      }),
      { expiresIn: 60 }
    );

    expect(queryNames(url)).toContain('x-amz-signature');
    expect(queryNames(url).filter((name) => name.includes('checksum'))).toEqual([]);
  });

  it('asks for no checksum of one part of a big file', async () => {
    const url = await getSignedUrl(
      getS3Client(),
      new UploadPartCommand({
        Bucket: 'files',
        Key: 'users/u1/1_a.bin',
        UploadId: 'upload-1',
        PartNumber: 1,
      }),
      { expiresIn: 60 }
    );

    expect(queryNames(url)).toContain('x-amz-signature');
    expect(queryNames(url).filter((name) => name.includes('checksum'))).toEqual([]);
  });
});
