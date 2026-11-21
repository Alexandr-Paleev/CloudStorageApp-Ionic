import { ProviderNotConfigured } from '../../core/src/ai';
import { cloudflareAccountId } from './cloudflare-ai';

/**
 * The text of a PDF, read by Cloudflare's `toMarkdown`
 * (docs/decisions/0019).
 *
 * Nothing on the free path could read a PDF before this ([0016]): Workers AI
 * has no model that takes one, and a description from the name alone would be
 * a confident sentence about nothing. `toMarkdown` reads the text layer of a
 * PDF on the account the free path already runs under, is free for PDFs, and
 * needs no package of ours. On four PDFs made from the eval's documents, in
 * Russian, Spanish and English, every one of 19 quotes came back word for word.
 * A scan, a PDF that is a picture of a page, has no text layer, and it is not
 * documented to read one: its text comes back empty.
 *
 * What comes back is Markdown about the file as well as the file: a heading
 * with its name, a section of metadata unless asked not to send it, and a
 * heading for every page. `readableText` keeps the pages and turns each page
 * heading into a paragraph break, so a piece never runs across two pages
 * without a break the cut can see.
 */

const TIMEOUT_MS = 30_000;

/** Asked not to send the metadata section; `readableText` drops it anyway. */
const CONVERSION_OPTIONS = JSON.stringify({ pdf: { metadata: false } });

const PAGE_HEADING = /^#{1,6}[ \t]+Page[ \t]+\d+[ \t]*$/gm;

/** The text of the pages of what `toMarkdown` gave for a PDF. */
export function readableText(markdown: string): string {
  let text = markdown.replace(/\r\n/g, '\n');
  const contents = text.search(/^## Contents[ \t]*$/m);
  if (contents >= 0) {
    text = text.slice(contents).replace(/^## Contents[ \t]*\n?/, '');
  } else {
    // No contents heading: drop the title and a metadata section if either is there.
    text = text
      .replace(/^# [^\n]*\n/, '')
      .replace(/^## Metadata[ \t]*\n(?:- [^\n]*\n|[ \t]*\n)*/m, '');
  }
  return text.replace(PAGE_HEADING, '\n').trim();
}

/**
 * The text of a PDF's pages, or an empty string when it has none to give.
 *
 * Throws when the deployment has no Cloudflare account to ask
 * (`ProviderNotConfigured`), and when the request fails, with the start of
 * what Cloudflare said.
 */
export async function pdfText(bytes: Buffer, name: string): Promise<string> {
  const token = process.env.CLOUDFLARE_AI_TOKEN;
  const account = cloudflareAccountId();
  if (!token || !account) {
    throw new ProviderNotConfigured(
      'Reading a PDF needs CLOUDFLARE_AI_TOKEN and an account id (CLOUDFLARE_ACCOUNT_ID or R2_ENDPOINT)'
    );
  }

  const form = new FormData();
  /* The name is only a label in the answer; ".pdf" is what tells the
     converter what it was given, whatever the file was called. */
  form.append(
    'files',
    new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
    `${name.replace(/\.pdf$/i, '')}.pdf`
  );
  form.append('conversionOptions', CONVERSION_OPTIONS);

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/tomarkdown`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
  );

  if (!response.ok) {
    const text = (await response.text().catch(() => '')).slice(0, 200);
    throw new Error(`toMarkdown answered ${response.status}${text ? `: ${text}` : ''}`);
  }

  const payload = (await response.json()) as {
    success?: boolean;
    errors?: { message?: string }[];
    result?: { format?: string; data?: string; error?: string }[];
  };
  if (payload.success === false) {
    throw new Error(
      `toMarkdown refused the file: ${payload.errors?.[0]?.message ?? 'no reason given'}`
    );
  }

  const item = payload.result?.[0];
  if (!item) throw new Error('toMarkdown returned nothing for the file');
  if (item.format === 'error')
    throw new Error(`toMarkdown could not read the file: ${item.error ?? 'no reason given'}`);
  return readableText(item.data ?? '');
}
