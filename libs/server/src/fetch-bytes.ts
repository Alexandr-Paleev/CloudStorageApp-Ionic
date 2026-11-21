/** A file over the ceiling it was read against: a reason not to index it,
 *  not a failure of the server. */
export class FileTooLarge extends Error {
  constructor(readonly maxBytes: number) {
    super('file is too large to describe');
    this.name = 'FileTooLarge';
  }
}

/**
 * Reads a URL into memory, refusing anything over a ceiling.
 *
 * Shared by the indexer and by the Workers AI backend, because both had the
 * same job and only one of them was doing it. The size on a `files` row was
 * the browser's claim until migration 020 made it the provider's, and a row
 * written before then, or by a provider this does not weigh, can still be
 * wrong: the bytes that arrive are the measurement.
 *
 * Checked twice. `Content-Length` is also only a claim — it can be absent, or
 * wrong — so the bytes are counted again once they have arrived. That is late
 * enough to have spent the bandwidth and early enough to not spend the memory
 * on whatever the caller meant to do with them next.
 */
export async function fetchBytes(
  url: string,
  maxBytes: number,
  timeoutMs = 20_000
): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Could not read the file: ${response.status}`);

  const claimed = Number(response.headers.get('content-length') ?? 0);
  if (claimed > maxBytes) throw new FileTooLarge(maxBytes);

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new FileTooLarge(maxBytes);

  return bytes;
}
