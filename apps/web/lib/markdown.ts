/**
 * Reads the legal documents, which are markdown, into something a page can
 * render.
 *
 * Small on purpose. The two documents use headings, bullets, numbered steps,
 * rules, bold, emphasis and links, and nothing else. A markdown library
 * would be a dependency, and a parser of everything markdown allows, for
 * a few hundred lines of text that seldom change. A test reads both
 * documents and fails on a construct this does not know, so the day one of
 * them gains a table is the day somebody finds out here and not on the
 * page.
 *
 * This is the reader the app had in `src/pages/Legal.tsx`, moved when the
 * documents did. It reads what that one read, code spans included, which
 * neither document uses today, and two things that one did not:
 * `*emphasis*`, which the terms end on and the app printed with its
 * asterisks, and numbered lists, which it printed as three paragraphs.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'emphasis'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; content: Inline[] }
  | { kind: 'paragraph'; content: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'rule' };

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
const LINK = /^\[([^\]]+)\]\(([^)]+)\)$/;
const BULLET = /^\s*[-*]\s+/;
const NUMBERED = /^\s*\d+\.\s+/;
const HEADING = /^(#{1,4})\s+(.*)$/;
const RULE = /^---+$/;

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];

  for (const part of text.split(INLINE)) {
    if (!part) continue;

    const link = part.match(LINK);
    const linkText = link?.[1];
    const href = link?.[2];

    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      parts.push({ kind: 'strong', text: part.slice(2, -2) });
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      parts.push({ kind: 'emphasis', text: part.slice(1, -1) });
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      parts.push({ kind: 'code', text: part.slice(1, -1) });
    } else if (linkText !== undefined && href !== undefined) {
      parts.push({ kind: 'link', text: linkText, href });
    } else {
      parts.push({ kind: 'text', text: part });
    }
  }

  return parts;
}

export function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = [];
  let list: { ordered: boolean; items: Inline[][] } | null = null;

  const closeList = () => {
    if (list) blocks.push({ kind: 'list', ...list });
    list = null;
  };

  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trimEnd();

    const ordered = NUMBERED.test(line);
    if (ordered || BULLET.test(line)) {
      /* A numbered line after bullets is a new list, and the other way round. */
      if (list && list.ordered !== ordered) closeList();
      list ??= { ordered, items: [] };
      list.items.push(parseInline(line.replace(ordered ? NUMBERED : BULLET, '')));
      continue;
    }
    closeList();

    if (!line.trim()) continue;

    if (RULE.test(line.trim())) {
      blocks.push({ kind: 'rule' });
      continue;
    }

    const heading = line.match(HEADING);
    const hashes = heading?.[1];
    const headingText = heading?.[2];
    /* Both groups are checked, rather than the match as a whole, for the
       compiler: with unchecked indexes neither is known to be there. */
    if (hashes !== undefined && headingText !== undefined) {
      blocks.push({
        kind: 'heading',
        level: hashes.length as 1 | 2 | 3 | 4,
        content: parseInline(headingText),
      });
      continue;
    }

    blocks.push({ kind: 'paragraph', content: parseInline(line) });
  }

  closeList();
  return blocks;
}
