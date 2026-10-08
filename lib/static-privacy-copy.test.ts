import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * public/privacy-policy.html is a second copy of PRIVACY_POLICY.md, the
 * document the app renders at /privacy. Nothing kept the two in step, and the
 * copy fell behind. When semantic search arrived, the markdown gained a
 * section on what indexing a file sends to a model provider and a line in the
 * list of who data is shared with. The static page was served without either
 * from 4.7.0 until 2026-10-08.
 *
 * So this reads both, and requires every block of the markdown to be on the
 * page word for word: each heading, paragraph and list item, with the markup
 * taken off. The page may say more, and does: it has a link back to the app.
 * It may not say less, or say it differently.
 *
 * The copy goes away in step 4 of decision 0014, and this file with it. The
 * terms are not compared. Their static copy is six sections shorter than the
 * markdown, and which of the two is right has not been decided.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** So that a wrapped paragraph and one long line compare equal. */
const squeeze = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The headings, paragraphs and list items of the markdown, as plain text. */
function blocksOfMarkdown(markdown: string): string[] {
  const blocks: string[] = [];
  let paragraph: string[] = [];
  const endParagraph = () => {
    if (paragraph.length > 0) blocks.push(paragraph.join(' '));
    paragraph = [];
  };

  for (const line of markdown.split('\n')) {
    const text = line.trim();
    if (text === '' || /^-{3,}$/.test(text)) {
      endParagraph();
    } else if (/^(#{1,6}|-) /.test(text)) {
      endParagraph();
      blocks.push(text.replace(/^(#{1,6}|-) +/, ''));
    } else {
      paragraph.push(text);
    }
  }
  endParagraph();

  return blocks.map((block) =>
    squeeze(
      block
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
    )
  );
}

/** The same blocks of the page: whatever sits in a heading, a paragraph or a list item. */
function blocksOfPage(html: string): string[] {
  const blocks = html.match(/<(h[1-6]|p|li)[\s>][\s\S]*?<\/\1>/g) ?? [];
  return blocks.map((block) => squeeze(block.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '')));
}

describe('the static copy of the privacy policy', () => {
  const markdown = blocksOfMarkdown(read('../PRIVACY_POLICY.md'));
  const page = new Set(blocksOfPage(read('../public/privacy-policy.html')));

  it('says everything the markdown says, word for word', () => {
    expect(markdown.filter((block) => !page.has(block))).toEqual([]);
  });

  // The control: two empty lists would agree with each other.
  it('is compared on the whole document', () => {
    expect(markdown.length).toBeGreaterThan(50);
    expect(page.size).toBeGreaterThan(50);
  });
});
