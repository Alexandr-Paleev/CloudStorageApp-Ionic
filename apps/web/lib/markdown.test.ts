import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseInline, parseMarkdown } from './markdown';

const read = (file: string) => readFileSync(new URL(`../content/${file}`, import.meta.url), 'utf8');

const DOCUMENTS = {
  'privacy-policy.md': read('privacy-policy.md'),
  'terms-of-service.md': read('terms-of-service.md'),
};

describe('parseInline', () => {
  it('finds bold, emphasis, code and links, and leaves the rest as text', () => {
    expect(parseInline('Use **4242** or `code`, *not* [this](https://example.com).')).toEqual([
      { kind: 'text', text: 'Use ' },
      { kind: 'strong', text: '4242' },
      { kind: 'text', text: ' or ' },
      { kind: 'code', text: 'code' },
      { kind: 'text', text: ', ' },
      { kind: 'emphasis', text: 'not' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'this', href: 'https://example.com' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('reads a whole line of emphasis as emphasis and not as a bullet', () => {
    expect(parseMarkdown('*By using this Service, you acknowledge it.*')).toEqual([
      {
        kind: 'paragraph',
        content: [{ kind: 'emphasis', text: 'By using this Service, you acknowledge it.' }],
      },
    ]);
  });
});

describe('parseMarkdown', () => {
  it('reads headings by their level, and four levels of them', () => {
    expect(parseMarkdown('# One\n#### Four\n##### Five')).toEqual([
      { kind: 'heading', level: 1, content: [{ kind: 'text', text: 'One' }] },
      { kind: 'heading', level: 4, content: [{ kind: 'text', text: 'Four' }] },
      { kind: 'paragraph', content: [{ kind: 'text', text: '##### Five' }] },
    ]);
  });

  it('gathers consecutive bullets into one list and ends it at the next line', () => {
    expect(parseMarkdown('- one\n* two\nafter')).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two' }]],
      },
      { kind: 'paragraph', content: [{ kind: 'text', text: 'after' }] },
    ]);
  });

  it('keeps numbered steps as a numbered list, apart from the bullets beside them', () => {
    const blocks = parseMarkdown('- a\n1. first\n2. second\n- b');
    expect(
      blocks.map((block) =>
        block.kind === 'list' ? [block.ordered, block.items.length] : block.kind
      )
    ).toEqual([
      [false, 1],
      [true, 2],
      [false, 1],
    ]);
  });

  it('reads a rule, and skips blank lines', () => {
    expect(parseMarkdown('above\n\n---\n\nbelow').map((block) => block.kind)).toEqual([
      'paragraph',
      'rule',
      'paragraph',
    ]);
  });
});

/* The reader knows a few constructs and the documents are written by hand.
   This is where a table, a quotation or a fifth level of heading is refused,
   rather than printed with its punctuation on a page about people's rights. */
describe.each(Object.entries(DOCUMENTS))('%s', (_file, markdown) => {
  const blocks = parseMarkdown(markdown);
  const inlines = blocks.flatMap((block) =>
    block.kind === 'rule' ? [] : block.kind === 'list' ? block.items.flat() : block.content
  );

  it('uses nothing the reader does not know', () => {
    const unknown = markdown
      .split('\n')
      .filter((line) => /^\||^>|^#{5,}\s|^\s+[-*]\s|^\s+\d+\.\s|!\[|^```|<\/?[a-z]/.test(line));
    expect(unknown).toEqual([]);
  });

  it('opens with its one title', () => {
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 });
    expect(blocks.filter((block) => block.kind === 'heading' && block.level === 1)).toHaveLength(1);
  });

  /* What the reader does not know it hands over as text, punctuation and
     all. Underscores for emphasis, a struck word and a link by reference
     are the ones nothing above refuses. */
  it('leaves no markdown punctuation in the text it hands over', () => {
    const leftovers = inlines.filter(
      (inline) =>
        inline.kind === 'text' &&
        /\*\*|\]\(|\]\[|`|~~|(^|\s)[*_]+\S|\S[*_]+([\s.,;:!?)]|$)/.test(inline.text)
    );
    expect(leftovers).toEqual([]);
  });

  it('links only to pages, to its sibling document, or by mail', () => {
    const hrefs = inlines.flatMap((inline) => (inline.kind === 'link' ? [inline.href] : []));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/^(https:\/\/|mailto:|\.\/(privacy-policy|terms-of-service)\.md$)/);
    }
  });
});
