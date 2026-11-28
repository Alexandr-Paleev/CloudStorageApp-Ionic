import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProviderNotConfigured } from '../../core/src/ai';
import { pdfText, readableText, withoutTags } from './to-markdown';

/* What toMarkdown answered for a PDF printed from a Russian lease, cut short:
   the probe of 2026-11-21 (ADR 0019), with the metadata section it sends
   unless asked not to. */
const WITH_METADATA = [
  '# d01.pdf',
  '## Metadata',
  '- PDFFormatVersion=1.4',
  '- Creator=Chromium',
  '',
  '',
  '',
  '## Contents',
  '### Page 1',
  'ДОГОВОР АРЕНДЫ КВАРТИРЫ № 14/2026',
  'Ежемесячная арендная плата составляет 950',
  '(девятьсот пятьдесят) евро.',
  '### Page 2',
  'Залог: 1900 евро.',
].join('\n');

/* What toMarkdown answered for each of the four CVs: a title and no page. */
const EMPTY = '# cv.pdf\n## Contents\n';

/* The shape of a Canva export's catalog and tree, cut to what matters. */
const TAGGED = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /MarkInfo << /Marked true >> ' +
    '/StructTreeRoot 9 0 R >>\nendobj\n9 0 obj\n<< /Type /StructTreeRoot /K [] >>\nendobj\n',
  'latin1'
);

describe('withoutTags', () => {
  it('renames every structure tree, and nothing moves', () => {
    const copy = withoutTags(TAGGED)!;
    expect(copy.length).toBe(TAGGED.length);
    expect(copy.includes('/StructTreeRoot')).toBe(false);
    expect(copy.toString('latin1')).toBe(
      TAGGED.toString('latin1').split('/StructTreeRoot').join('/StructTreeNone')
    );
  });

  it('leaves the bytes it was given alone', () => {
    const before = Buffer.from(TAGGED);
    withoutTags(TAGGED);
    expect(TAGGED).toEqual(before);
  });

  it('has nothing to give for a PDF with no tree', () => {
    expect(withoutTags(Buffer.from('%PDF-1.4\n<< /Type /Catalog >>'))).toBeNull();
  });
});

function answers(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 403,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  process.env.CLOUDFLARE_AI_TOKEN = 'cf-test';
  process.env.CLOUDFLARE_ACCOUNT_ID = 'abc123';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CLOUDFLARE_AI_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
});

describe('readableText', () => {
  it('keeps the pages and nothing about the file', () => {
    expect(readableText(WITH_METADATA)).toBe(
      [
        'ДОГОВОР АРЕНДЫ КВАРТИРЫ № 14/2026',
        'Ежемесячная арендная плата составляет 950',
        '(девятьсот пятьдесят) евро.',
        '',
        '',
        'Залог: 1900 евро.',
      ].join('\n')
    );
  });

  /* The cut ends a paragraph at a blank line, and toMarkdown gives none: a
     page heading is the one paragraph break a PDF's text arrives with. */
  it('turns each page heading into a paragraph break', () => {
    expect(readableText('## Contents\n### Page 1\nOne.\n### Page 2\nTwo.')).toBe('One.\n\n\nTwo.');
  });

  it('drops the title and the metadata when there is no contents heading', () => {
    expect(readableText('# a.pdf\n## Metadata\n- Creator=x\n\nThe text.')).toBe('The text.');
  });

  it('gives nothing for a PDF with no text', () => {
    expect(readableText('# scan.pdf\n## Contents\n### Page 1\n')).toBe('');
  });

  it('reads Windows line endings', () => {
    expect(readableText('## Contents\r\n### Page 1\r\nOne.')).toBe('One.');
  });
});

describe('pdfText', () => {
  it('sends the PDF to toMarkdown on the account, without its metadata, and reads the pages', async () => {
    const fetchMock = answers({
      success: true,
      result: [{ name: 'lease.pdf', format: 'markdown', data: WITH_METADATA }],
    });

    const text = await pdfText(Buffer.from('%PDF'), 'lease.pdf');

    expect(text.startsWith('ДОГОВОР АРЕНДЫ')).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/abc123/ai/tomarkdown');
    expect(init.headers).toEqual({ Authorization: 'Bearer cf-test' });
    const form = init.body as FormData;
    expect(JSON.parse(form.get('conversionOptions') as string)).toEqual({
      pdf: { metadata: false },
    });
    const file = form.get('files') as File;
    expect([file.name, file.type, file.size]).toEqual(['lease.pdf', 'application/pdf', 4]);
  });

  it('calls the file a PDF whatever it was named', async () => {
    const fetchMock = answers({ success: true, result: [{ format: 'markdown', data: '' }] });

    await pdfText(Buffer.from('%PDF'), 'Договор аренды');

    const form = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect((form.get('files') as File).name).toBe('Договор аренды.pdf');
  });

  it('says what Cloudflare said when the request fails', async () => {
    answers({ errors: [{ message: 'Authentication error' }] }, false);
    await expect(pdfText(Buffer.from('%PDF'), 'a.pdf')).rejects.toThrow(
      /toMarkdown answered 403: .*Authentication error/
    );
  });

  it('fails on an answer that says it failed', async () => {
    answers({ success: false, errors: [{ message: 'no such account' }] });
    await expect(pdfText(Buffer.from('%PDF'), 'a.pdf')).rejects.toThrow(/no such account/);
  });

  it('fails on a file it could not read', async () => {
    answers({ success: true, result: [{ format: 'error', error: 'corrupt file' }] });
    await expect(pdfText(Buffer.from('%PDF'), 'a.pdf')).rejects.toThrow(/corrupt file/);
  });

  /* Four CVs on production came back empty with their structure tree and
     whole without it (2026-11-28, ADR 0019). */
  it('asks once more without the structure tree when a tagged PDF gives no text', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, result: [{ format: 'markdown', data: EMPTY }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: [{ format: 'markdown', data: WITH_METADATA }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const text = await pdfText(TAGGED, 'cv.pdf');

    expect(text.startsWith('ДОГОВОР АРЕНДЫ')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sent = await Promise.all(
      fetchMock.mock.calls.map(async ([, init]) =>
        Buffer.from(
          await (((init as RequestInit).body as FormData).get('files') as File).arrayBuffer()
        )
      )
    );
    expect(sent[0]).toEqual(TAGGED);
    expect(sent[1]).toEqual(withoutTags(TAGGED));
    // One timeout for both tries, so two of them cannot outlast the function.
    const [first, second] = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).signal);
    expect(second).toBe(first);
  });

  /* On main the first empty answer was a skip with its reason; a second try
     that fails must not turn it into a failed file. */
  it.each([
    ['fails on the copy', { ok: true, json: async () => ({ success: false, errors: [] }) }],
    ['answers 500', { ok: false, status: 500, text: async () => 'oops' }],
  ])('keeps the first empty answer when the second try %s', async (_, second) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, result: [{ format: 'markdown', data: EMPTY }] }),
      })
      .mockResolvedValueOnce(second);
    vi.stubGlobal('fetch', fetchMock);

    expect(await pdfText(TAGGED, 'cv.pdf')).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the first empty answer when the timeout runs out on the second try', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, result: [{ format: 'markdown', data: EMPTY }] }),
      })
      .mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'));
    vi.stubGlobal('fetch', fetchMock);

    expect(await pdfText(TAGGED, 'cv.pdf')).toBe('');
  });

  it('still fails when the first try fails, and asks nothing more', async () => {
    const fetchMock = answers({ errors: [{ message: 'Authentication error' }] }, false);

    await expect(pdfText(TAGGED, 'cv.pdf')).rejects.toThrow(/answered 403/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks once when the PDF has no structure tree, and gives nothing', async () => {
    const fetchMock = answers({ success: true, result: [{ format: 'markdown', data: EMPTY }] });

    expect(await pdfText(Buffer.from('%PDF-1.4 a scan'), 'scan.pdf')).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks once when the tagged PDF gives its text', async () => {
    const fetchMock = answers({
      success: true,
      result: [{ format: 'markdown', data: WITH_METADATA }],
    });

    await pdfText(TAGGED, 'cv.pdf');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives nothing when neither try finds text', async () => {
    const fetchMock = answers({ success: true, result: [{ format: 'markdown', data: EMPTY }] });

    expect(await pdfText(TAGGED, 'scan.pdf')).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('says it is not configured, and asks nobody, without an account', async () => {
    const fetchMock = answers({});
    delete process.env.CLOUDFLARE_AI_TOKEN;

    await expect(pdfText(Buffer.from('%PDF'), 'a.pdf')).rejects.toBeInstanceOf(
      ProviderNotConfigured
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
