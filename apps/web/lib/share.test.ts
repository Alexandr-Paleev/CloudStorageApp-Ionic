import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* The address of the app is this site's to know, and not this test's. */
vi.mock('./site', () => ({ APP_ORIGIN: 'https://app.example' }));

import { describeLink, forgetDescriptions } from './share';

/* As long as a real one, and nothing else of one. A string that looks drawn
   at random is what the scan for leaked credentials takes for a key. */
const TOKEN = 'a'.repeat(43);
const FILE = { name: 'report.pdf', size: 1024, type: 'application/pdf' };
const MINUTE = 60_000;

const asked = vi.fn<typeof fetch>();

/** A new answer for each request: the body of one can be read once. */
function answering(status: number, body?: unknown) {
  asked.mockImplementation(
    async () => new Response(body === undefined ? null : JSON.stringify(body), { status })
  );
}

beforeEach(() => {
  forgetDescriptions();
  asked.mockReset();
  vi.stubGlobal('fetch', asked);
  /* The clock and nothing else: a promise still has to resolve. */
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('describing a share link', () => {
  it('says what the link holds, from what the functions say about it', async () => {
    answering(200, FILE);

    expect(await describeLink(TOKEN)).toEqual({ state: 'described', file: FILE });
  });

  /* Opening a link signs an address for the file. A page rendered on a
     server is rendered for every bot that unfurls the link, so the render
     must never be what opens it. */
  it('asks for a description, and never for the link to be opened', async () => {
    answering(200, FILE);
    await describeLink(TOKEN);

    expect(asked).toHaveBeenCalledTimes(1);
    expect(String(asked.mock.calls[0]?.[0])).toBe(
      `https://app.example/api/share?token=${TOKEN}&describe`
    );
  });

  it('keeps out of the cache Next has for fetch, which would outlive a revoked link', async () => {
    answering(200, FILE);
    await describeLink(TOKEN);

    expect(asked.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' });
  });

  it('reads a link that was never issued, or whose file is gone, as missing', async () => {
    answering(404, { message: 'This link does not exist' });

    expect(await describeLink(TOKEN)).toEqual({ state: 'missing' });
  });

  it.each(['This link has been revoked', 'This link has expired'])(
    'says in the functions’ own words that it has ended: %s',
    async (message) => {
      answering(410, { message });

      expect(await describeLink(TOKEN)).toEqual({ state: 'ended', message });
    }
  );

  it('has a sentence of its own for an ended link the functions said nothing about', async () => {
    answering(410);

    expect(await describeLink(TOKEN)).toEqual({
      state: 'ended',
      message: 'This link no longer opens',
    });
  });

  it.each([
    ['is refused for asking too often', 429, { message: 'Too many requests' }],
    ['is answered with an error', 500, { message: 'Internal server error' }],
    ['is answered with something that is not a file', 200, { message: 'hello' }],
    ['is answered with a file that has no name', 200, { size: 3, type: 'text/plain' }],
    ['is answered with nothing it can read', 200, undefined],
  ])('has no description when it %s', async (_what, status, body) => {
    answering(status, body);

    expect(await describeLink(TOKEN)).toEqual({ state: 'unanswered' });
  });

  it('has no description when nobody answers in time', async () => {
    asked.mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError'));

    expect(await describeLink(TOKEN)).toEqual({ state: 'unanswered' });
  });

  /* The row is written by a browser, so what the functions pass on is
     whatever was stored. */
  it('cuts a name no app would have written, and survives a size that is not one', async () => {
    answering(200, { name: 'n'.repeat(5000), size: 'large', type: null });

    const description = await describeLink(TOKEN);

    expect(description.state).toBe('described');
    if (description.state !== 'described') return;
    expect(description.file.name).toHaveLength(255);
    expect(description.file.name.endsWith('…')).toBe(true);
    expect(description.file.size).toBe(0);
    expect(description.file.type).toBe('');
  });
});

describe('what could not be a token', () => {
  it.each([
    ['nothing', ''],
    ['a path', 'a/b'],
    ['a way out of the folder', '..'],
    ['a file name', 'favicon.ico'],
    ['words', 'not a token'],
    ['another alphabet', 'токен'],
    ['a great many characters', 'a'.repeat(129)],
  ])('is answered here, without asking anyone: %s', async (_what, token) => {
    answering(200, FILE);

    expect(await describeLink(token)).toEqual({ state: 'missing' });
    expect(asked).not.toHaveBeenCalled();
  });

  it('is not decided by length: a token of another size is the functions’ to answer', async () => {
    answering(404);
    await describeLink('short');

    expect(asked).toHaveBeenCalledTimes(1);
  });
});

/* To the functions this site is one address, and they allow an address 120
   requests a minute. */
describe('how long an answer is kept', () => {
  it('asks once for a link however many times it is opened within the minute', async () => {
    answering(200, FILE);

    await describeLink(TOKEN);
    vi.setSystemTime(Date.now() + MINUTE - 1);
    await describeLink(TOKEN);

    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('gives the page and its metadata, which ask at once, one request', async () => {
    answering(200, FILE);

    const [page, metadata] = await Promise.all([describeLink(TOKEN), describeLink(TOKEN)]);

    expect(page).toEqual(metadata);
    expect(asked).toHaveBeenCalledTimes(1);
  });

  /* The promise the page makes about a link its owner took back. Nothing
     older than a minute is shown, not even once while a new answer is on
     its way. */
  it('stops describing a revoked link within the minute, and shows nothing stale', async () => {
    answering(200, FILE);
    expect((await describeLink(TOKEN)).state).toBe('described');

    answering(410, { message: 'This link has been revoked' });
    vi.setSystemTime(Date.now() + MINUTE);

    expect(await describeLink(TOKEN)).toEqual({
      state: 'ended',
      message: 'This link has been revoked',
    });
  });

  it('keeps an ended link’s answer too, so a dead link passed round costs one request', async () => {
    answering(410, { message: 'This link has expired' });

    await describeLink(TOKEN);
    await describeLink(TOKEN);

    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('does not keep an answer that was no answer', async () => {
    answering(500);
    expect((await describeLink(TOKEN)).state).toBe('unanswered');

    answering(200, FILE);
    expect((await describeLink(TOKEN)).state).toBe('described');
    expect(asked).toHaveBeenCalledTimes(2);
  });

  it('keeps one answer for each link, and not one for all', async () => {
    answering(200, FILE);

    await describeLink('first-link');
    await describeLink('second-link');

    expect(asked).toHaveBeenCalledTimes(2);
  });

  /* Whoever walks made-up tokens gets an answer for each, and each would
     otherwise stay in memory. */
  it('lets the oldest answer go once it holds five hundred', async () => {
    answering(404);

    for (let i = 0; i <= 500; i++) await describeLink(`made-up-${i}`);
    expect(asked).toHaveBeenCalledTimes(501);

    await describeLink('made-up-500');
    expect(asked).toHaveBeenCalledTimes(501);

    await describeLink('made-up-0');
    expect(asked).toHaveBeenCalledTimes(502);
  });
});
