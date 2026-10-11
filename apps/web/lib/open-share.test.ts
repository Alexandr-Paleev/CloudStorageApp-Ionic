import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askForAddress } from './open-share';

const FROM = 'https://app.example/api/share?token=abc';
const FILE = { name: 'report.pdf', size: 1024, type: 'application/pdf' };

const asked = vi.fn<typeof fetch>();

function answering(status: number, body?: unknown) {
  asked.mockImplementation(
    async () => new Response(body === undefined ? null : JSON.stringify(body), { status })
  );
}

beforeEach(() => {
  asked.mockReset();
  vi.stubGlobal('fetch', asked);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('asking for the file, from the visitor’s browser', () => {
  it('gives the address the functions signed', async () => {
    answering(200, { ...FILE, downloadUrl: 'https://files.example/report.pdf?signature=1' });

    expect(await askForAddress(FROM)).toEqual({
      outcome: 'address',
      url: 'https://files.example/report.pdf?signature=1',
    });
  });

  /* A request with a header of its own is preflighted, and the functions
     answer this site's preflight with nothing. A plain GET is all a reader
     of the route is given, so that is all this may send. */
  it('sends a plain GET, which is never asked about first', async () => {
    answering(200, { ...FILE, downloadUrl: 'https://files.example/report.pdf' });
    await askForAddress(FROM);

    expect(asked.mock.calls).toEqual([[FROM]]);
  });

  /* The page was rendered from a description that is kept for a minute. The
     owner may have taken the link back since. */
  it.each([
    [410, 'This link has been revoked'],
    [410, 'This link has expired'],
    [404, 'The shared file no longer exists'],
  ])('says a link has ended in the functions’ own words: %i, %s', async (status, message) => {
    answering(status, { message });

    expect(await askForAddress(FROM)).toEqual({ outcome: 'ended', message });
  });

  it('has a sentence of its own for an ended link the functions said nothing about', async () => {
    answering(410);

    expect(await askForAddress(FROM)).toEqual({
      outcome: 'ended',
      message: 'This link no longer opens',
    });
  });

  it.each([
    [429, 'Too many requests. Try again in a minute.'],
    [500, 'The stored location for this file is not a usable URL'],
  ])('says what went wrong when asking again may work: %i', async (status, message) => {
    answering(status, { message });

    expect(await askForAddress(FROM)).toEqual({ outcome: 'failed', message });
  });

  it('has a sentence of its own for an error the functions did not explain', async () => {
    answering(502);

    expect(await askForAddress(FROM)).toEqual({
      outcome: 'failed',
      message: 'The file could not be opened. Try again in a moment.',
    });
  });

  it('says so when the functions cannot be reached at all', async () => {
    asked.mockRejectedValue(new TypeError('Failed to fetch'));

    const opening = await askForAddress(FROM);

    expect(opening.outcome).toBe('failed');
    expect(opening).toHaveProperty('message', expect.stringMatching(/reach the server/));
  });

  /* `location.assign` runs a `javascript:` address as script on the page it
     is called from. The functions refuse to hand one out, and this is the
     second place it is asked, the last where the value is still text. */
  it.each([
    ['a script', 'javascript:alert(document.domain)'],
    ['a script with a tab in its scheme', 'java\tscript:alert(1)'],
    ['a data address', 'data:text/html,<script>alert(1)</script>'],
    ['an address relative to this site', '/files/report.pdf'],
    ['no address', undefined],
    ['something that is not text', { href: 'https://files.example/report.pdf' }],
  ])('goes nowhere when it is handed %s', async (_what, downloadUrl) => {
    answering(200, { ...FILE, downloadUrl });

    const opening = await askForAddress(FROM);

    expect(opening.outcome).toBe('ended');
    expect(opening).not.toHaveProperty('url');
  });
});
