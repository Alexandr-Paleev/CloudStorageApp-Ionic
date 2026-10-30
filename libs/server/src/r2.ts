import { S3Client } from '@aws-sdk/client-s3';

let _client: S3Client | null = null;

export function getR2BucketName(): string {
  const name = process.env.R2_BUCKET_NAME;
  if (!name) throw new Error('R2_BUCKET_NAME is not configured');
  return name;
}

export function getS3Client(): S3Client {
  if (_client) return _client;

  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'R2 credentials are not configured (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)'
    );
  }

  _client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    /* Since 3.729 the SDK puts a CRC32 of the body into every PutObject and
       UploadPart, and a presigned one is signed before there is a body: the
       address carried `x-amz-checksum-crc32=AAAAAA==`, the CRC32 of nothing,
       and the file the browser sends to it cannot match that. Every upload
       here is presigned. Off unless an operation requires one, which is how
       the SDK behaved before. */
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  return _client;
}
