import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EMBEDDING_DIMENSIONS } from './ai';
import { embed, parseCaption } from './cloudflare-ai';

const VECTOR = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.01);

function answers(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
      text: async () => JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  process.env.CLOUDFLARE_AI_TOKEN = 'cf-test';
  process.env.CLOUDFLARE_ACCOUNT_ID = 'abc123';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseCaption', () => {
  it('reads the sentence and the tags out of two lines of prose', () => {
    // No structured output on this backend, so the answer is read rather than
    // trusted.
    expect(parseCaption('A hotel invoice from Prague.\nTags: invoice, hotel, prague')).toEqual({
      summary: 'A hotel invoice from Prague.',
      tags: ['invoice', 'hotel', 'prague'],
    });
  });

  it('keeps the sentence when the model forgot the tags', () => {
    expect(parseCaption('A photograph of two people.')).toEqual({
      summary: 'A photograph of two people.',
      tags: [],
    });
  });

  it('never lets the tag line end up in the sentence', () => {
    const { summary } = parseCaption('Tags: a, b\nA scanned receipt.');
    expect(summary).toBe('A scanned receipt.');
  });
});

describe('embed', () => {
  it('returns the vector Workers AI produced', async () => {
    answers({ success: true, result: { data: [VECTOR] } });
    await expect(embed('hotel invoice')).resolves.toEqual(VECTOR);
  });

  it('refuses a width the column cannot hold', async () => {
    answers({ success: true, result: { data: [[0.1, 0.2]] } });
    await expect(embed('x')).rejects.toThrow(/2 dimensions/);
  });

  it('treats a 200 with success:false as the failure it is', async () => {
    // The REST API wraps everything, and a refusal arrives looking like an
    // answer to anything that only checks the status code.
    answers({ success: false, errors: [{ message: 'daily limit reached' }] });
    await expect(embed('x')).rejects.toThrow(/daily limit reached/);
  });
});
