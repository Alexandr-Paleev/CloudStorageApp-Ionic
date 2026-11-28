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
 * So does a tagged PDF whose structure tree does not lead to its text, though
 * the text is there: four CVs on production, three of them exported from
 * Canva (2026-11-28). The same bytes with the tree's name changed came
 * back whole, 3,262 to 3,663 characters each, and with nothing changed came
 * back empty. Such a PDF is asked once more without its tree (`withoutTags`).
 * Only on an empty answer: a tree that works shapes the text better, one
 * Canva CV read 2,544 characters with its tree and 2,321 without.
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

const TREE = Buffer.from('/StructTreeRoot', 'latin1');
/** As long as the name it replaces, so no offset in the file moves. */
const NO_TREE = Buffer.from('/StructTreeNone', 'latin1');

/**
 * A copy of a PDF with no structure tree a reader can find, or null when the
 * bytes name none.
 *
 * Every `/StructTreeRoot` is renamed, the catalog's key and the tree's type
 * alike; a name of the same length keeps the cross-reference table true. A
 * catalog inside a compressed object stream is not seen, and gets no second
 * try. Only the copy sent to be read changes; the stored file does not.
 */
export function withoutTags(bytes: Buffer): Buffer | null {
  let at = bytes.indexOf(TREE);
  if (at < 0) return null;
  const copy = Buffer.from(bytes);
  while (at >= 0) {
    NO_TREE.copy(copy, at);
    at = copy.indexOf(TREE, at + TREE.length);
  }
  return copy;
}

/**
 * The text of a PDF's pages, or an empty string when it has none to give.
 *
 * Throws when the deployment has no Cloudflare account to ask
 * (`ProviderNotConfigured`), and when a request fails, with the start of
 * what Cloudflare said. Both tries share one timeout.
 */
export async function pdfText(bytes: Buffer, name: string): Promise<string> {
  const token = process.env.CLOUDFLARE_AI_TOKEN;
  const account = cloudflareAccountId();
  if (!token || !account) {
    throw new ProviderNotConfigured(
      'Reading a PDF needs CLOUDFLARE_AI_TOKEN and an account id (CLOUDFLARE_ACCOUNT_ID or R2_ENDPOINT)'
    );
  }

  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const text = await convert(bytes, name, token, account, signal);
  if (text) return text;
  const untagged = withoutTags(bytes);
  return untagged ? convert(untagged, name, token, account, signal) : text;
}

async function convert(
  bytes: Buffer,
  name: string,
  token: string,
  account: string,
  signal: AbortSignal
): Promise<string> {
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
      signal,
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
