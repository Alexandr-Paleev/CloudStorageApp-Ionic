import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EMBEDDING_DIMENSIONS, MAX_VISION_BYTES } from '../../core/src/ai';
import { describeFile, embed, parseCaption } from './cloudflare-ai';

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

describe('describeFile, on an image', () => {
  it('refuses a picture too big to send as an array of numbers', async () => {
    /* This model's schema takes the bytes as JSON numbers, so a large image
       costs several times its own size in memory. The size on the `files` row
       is written by the browser, so it cannot be the thing that stops it. */
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => String(MAX_VISION_BYTES * 2) },
        arrayBuffer: async () => new ArrayBuffer(8),
      })
    );

    await expect(
      describeFile('huge.png', {
        kind: 'image',
        url: 'https://cdn.test/huge.png',
        mediaType: 'image/png',
      })
    ).rejects.toThrow(/too large/);
  });
});

describe('describeFile, on a text file', () => {
  it('fences the name and the contents, and reads the answer leniently', async () => {
    // The branch every .txt and .svg takes, and the one that puts the file's
    // own words in front of a model.
    answers({ success: true, result: { response: 'A shopping list.\nTags: list, groceries' } });

    const result = await describeFile('list.txt', { kind: 'text', text: 'milk, bread' });

    expect(result).toMatchObject({ summary: 'A shopping list.', tags: ['list', 'groceries'] });

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const sent = (JSON.parse(String(init.body)) as { messages: { content: string }[] }).messages[1]!
      .content;
    expect(sent).toContain('--- file name ---');
    expect(sent).toContain('list.txt');
    expect(sent).toContain('--- file contents ---');
    expect(sent).toContain('milk, bread');
  });
});
