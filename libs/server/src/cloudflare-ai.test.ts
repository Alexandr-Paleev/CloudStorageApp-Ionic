import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EMBEDDING_DIMENSIONS, MAX_VISION_BYTES } from '../../core/src/ai';
import { describeFile, embed, embedMany, parseCaption } from './cloudflare-ai';

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
  it('refuses a picture too big to send in a request body', async () => {
    /* The bytes go into the JSON body as base64, so a large image costs more
       than its own size in memory. The size on the `files` row is written by
       the browser, so it cannot be the thing that stops it. */
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

describe('describeFile, on a picture', () => {
  it('sends the picture as a data URI to a model Cloudflare still serves', async () => {
    // llava-1.5-7b, the model before, answers 410 since Cloudflare retired it
    // on 2026-11-20; its schema took the bytes as an array of numbers.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => '3' },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: { response: 'A white cloud on a blue gradient.\nTags: cloud, logo, blue' },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await describeFile('logo.png', {
      kind: 'image',
      url: 'https://cdn.test/logo.png',
      mediaType: 'image/png',
    });

    expect(result).toEqual({
      summary: 'A white cloud on a blue gradient.',
      tags: ['cloud', 'logo', 'blue'],
      model: '@cf/mistralai/mistral-small-3.1-24b-instruct',
    });
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toMatch(/\/ai\/run\/@cf\/mistralai\/mistral-small-3\.1-24b-instruct$/);
    const body = JSON.parse(String(init.body)) as {
      messages: { content: { type: string; image_url?: { url: string } }[] }[];
    };
    const parts = body.messages[1]!.content;
    expect(parts.find((part) => part.type === 'image_url')?.image_url?.url).toBe(
      'data:image/png;base64,AQID'
    );
    expect(body).not.toHaveProperty('image');
  });

  it('puts only a plain image type into the data URI', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => '1' },
        arrayBuffer: async () => new Uint8Array([0]).buffer,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, result: { response: 'A picture.' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await describeFile('x.png', {
      kind: 'image',
      url: 'https://cdn.test/x.png',
      mediaType: 'image/png;base64,QUFB,text/html',
    });

    const body = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body)) as {
      messages: { content: { image_url?: { url: string } }[] }[];
    };
    expect(
      body.messages[1]!.content[1]!.image_url!.url.startsWith('data:image/png;base64,AA')
    ).toBe(true);
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

describe('embedMany', () => {
  function workersAi() {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const { text } = JSON.parse(String(init.body)) as { text: string[] };
      const data = text.map((t) => VECTOR.map((v, i) => (i === 0 ? Number(t) : v)));
      return { ok: true, status: 200, json: async () => ({ success: true, result: { data } }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('sends the texts a hundred at a time and keeps their order', async () => {
    const fetchMock = workersAi();
    const texts = Array.from({ length: 150 }, (_, n) => String(n));

    const vectors = await embedMany(texts);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sizes = fetchMock.mock.calls.map(
      ([, init]) =>
        (JSON.parse(String((init as RequestInit).body)) as { text: string[] }).text.length
    );
    expect(sizes).toEqual([100, 50]);
    expect(vectors.map((v) => v[0])).toEqual(texts.map(Number));
  });

  it('refuses an answer with fewer vectors than texts', async () => {
    answers({ success: true, result: { data: [VECTOR] } });
    await expect(embedMany(['a', 'b'])).rejects.toThrow(
      'Workers AI returned 1 embeddings for 2 texts'
    );
  });
});
