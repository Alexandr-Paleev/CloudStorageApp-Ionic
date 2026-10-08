import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchBytes } from './fetch-bytes';

function answers(body: string, headers: Record<string, string> = {}, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 404,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    })
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchBytes', () => {
  it('returns what it read', async () => {
    answers('hello', { 'content-length': '5' });
    expect((await fetchBytes('https://example.test/f', 1024)).toString()).toBe('hello');
  });

  it('refuses before reading when the length says too much', async () => {
    answers('x'.repeat(10), { 'content-length': '999999' });
    await expect(fetchBytes('https://example.test/f', 100)).rejects.toThrow(/too large/);
  });

  it('refuses after reading when the length lied', async () => {
    // A Content-Length is a claim. So is `files.size`, which is what this
    // ceiling exists to stop trusting.
    answers('x'.repeat(500), {});
    await expect(fetchBytes('https://example.test/f', 100)).rejects.toThrow(/too large/);
  });

  it('reports a refusal by the far end', async () => {
    answers('', {}, false);
    await expect(fetchBytes('https://example.test/f', 100)).rejects.toThrow(/404/);
  });
});
