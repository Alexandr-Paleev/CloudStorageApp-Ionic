import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProviderNotConfigured } from '../../core/src/ai';
import { pdfText, readableText } from './to-markdown';

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

  it('says it is not configured, and asks nobody, without an account', async () => {
    const fetchMock = answers({});
    delete process.env.CLOUDFLARE_AI_TOKEN;

    await expect(pdfText(Buffer.from('%PDF'), 'a.pdf')).rejects.toBeInstanceOf(
      ProviderNotConfigured
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
