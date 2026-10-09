import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMarkdown, type Block, type Inline } from './markdown';

/**
 * The two legal documents, and the pages they are.
 *
 * The documents are markdown, in `content/`, and they are the only copy.
 * The app used to render them itself and carried two more copies as static
 * HTML; one of those fell behind and nobody noticed for a month.
 */
export const LEGAL = {
  privacy: {
    file: 'privacy-policy.md',
    path: '/privacy',
    title: 'Privacy Policy',
    description:
      'What Cloud Storage collects, where it is stored, who else it is shared with, how long ' +
      'it is kept, and how to have it deleted.',
  },
  terms: {
    file: 'terms-of-service.md',
    path: '/terms',
    title: 'Terms of Service',
    description:
      'The terms for using Cloud Storage: accounts, acceptable use, what happens to content, ' +
      'availability, termination and liability.',
  },
} as const;

export type LegalDocument = keyof typeof LEGAL;

/* The documents point at each other by file name, which is a working link on
   GitHub and a dead one on a page. Here a file name becomes its page. */
const PAGE_OF_FILE: Record<string, string> = Object.fromEntries(
  Object.values(LEGAL).map(({ file, path }) => [`./${file}`, path])
);

/**
 * Read at build time: the pages are prerendered, so nothing reads these
 * files when a visitor asks. The path starts at the site's folder, which is
 * where npm runs the site's scripts, on Vercel as much as here.
 */
export function readLegalDocument(document: LegalDocument): Block[] {
  const markdown = readFileSync(join(process.cwd(), 'content', LEGAL[document].file), 'utf8');

  return parseMarkdown(markdown).map((block) => {
    if (block.kind === 'rule') return block;
    if (block.kind === 'list') return { ...block, items: block.items.map(toPages) };
    return { ...block, content: toPages(block.content) };
  });
}

function toPages(content: Inline[]): Inline[] {
  return content.map((inline) =>
    inline.kind === 'link' ? { ...inline, href: PAGE_OF_FILE[inline.href] ?? inline.href } : inline
  );
}
