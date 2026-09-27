/**
 * Reads a URL into memory, refusing anything over a ceiling.
 *
 * Shared by the indexer and by the Workers AI backend, because both had the
 * same job and only one of them was doing it: the size on a `files` row is
 * written by the browser, so it is a claim, not a measurement, and the two
 * paths that hand an image to a model were taking it on trust.
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
  if (claimed > maxBytes) throw new Error('file is too large to describe');

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error('file is too large to describe');

  return bytes;
}
