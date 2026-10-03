import { describe, it, expect } from 'vitest';
import {
  MAX_SUMMARY_CHARS,
  cloudinaryUrlIsOwned,
  MAX_TAGS,
  MAX_TAG_CHARS,
  clampSummary,
  embeddingInput,
  normalizeTags,
  planFor,
  toVectorLiteral,
  type IndexableFile,
} from './ai';

function file(overrides: Partial<IndexableFile> = {}): IndexableFile {
  return {
    name: 'photo.jpg',
    type: 'image/jpeg',
    size: 1024,
    storage_type: 'cloudinary',
    ...overrides,
  };
}

describe('planFor', () => {
  it('sends an image as an image', () => {
    expect(planFor(file())).toEqual({ kind: 'image' });
  });

  it('reads the type case-insensitively', () => {
    // The browser is not the only writer of this column — rows exist with the
    // type as the OS reported it.
    expect(planFor(file({ type: 'IMAGE/JPEG' }))).toEqual({ kind: 'image' });
  });

  it('sends an SVG as text', () => {
    // An SVG is an image to the browser and a document to everything else;
    // what describes it is its markup, not a rendering of it.
    expect(planFor(file({ name: 'logo.svg', type: 'image/svg+xml' }))).toEqual({ kind: 'text' });
  });

  it.each([
    ['application/pdf', 'pdf'],
    ['text/plain', 'text'],
    ['text/markdown', 'text'],
    ['application/json', 'text'],
  ])('plans %s as %s', (type, kind) => {
    expect(planFor(file({ type }))).toEqual({ kind });
  });

  it('skips a type it cannot read, and says so', () => {
    const plan = planFor(file({ name: 'archive.zip', type: 'application/zip' }));
    expect(plan).toMatchObject({ kind: 'skip' });
    expect(plan).toHaveProperty('reason', expect.stringContaining('application/zip'));
  });

  it('skips a file whose type the browser could not work out', () => {
    const plan = planFor(file({ type: '' }));
    expect(plan).toMatchObject({ kind: 'skip', reason: expect.stringContaining('unknown type') });
  });

  it.each(['googledrive', 'dropbox'])('skips %s, whose bytes are not ours to read', (provider) => {
    const plan = planFor(file({ storage_type: provider }));
    expect(plan).toMatchObject({ kind: 'skip', reason: expect.stringContaining('own cloud') });
  });

  it('checks the provider before the type', () => {
    // A photograph in someone's Drive is still unreachable, and answering
    // "image" here would send the indexer off to fetch a URL that expired
    // when the OAuth session did.
    expect(planFor(file({ storage_type: 'googledrive', type: 'image/png' }))).toMatchObject({
      kind: 'skip',
    });
  });

  it('skips a file too large to hold in a function', () => {
    const plan = planFor(file({ size: 64 * 1024 * 1024 }));
    expect(plan).toMatchObject({ kind: 'skip', reason: expect.stringContaining('too large') });
  });
});

describe('clampSummary', () => {
  it('collapses the whitespace a model leaves behind', () => {
    expect(clampSummary('  A hotel   invoice.\n\nPrague. ')).toBe('A hotel invoice. Prague.');
  });

  it('leaves a sentence that fits alone', () => {
    expect(clampSummary('A hotel invoice from Prague.')).toBe('A hotel invoice from Prague.');
  });

  it('cuts an over-long summary at a word boundary', () => {
    const long = `${'word '.repeat(200)}end`;
    const clamped = clampSummary(long);

    expect(clamped.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
    // The column would reject the original outright, and half a word is noise
    // both on screen and in the vector.
    expect(clamped.endsWith('word')).toBe(true);
  });

  it('takes a hard cut when there is no word boundary to find', () => {
    const clamped = clampSummary('x'.repeat(MAX_SUMMARY_CHARS + 50));
    expect(clamped).toHaveLength(MAX_SUMMARY_CHARS);
  });
});

describe('normalizeTags', () => {
  it('lowercases, trims and de-duplicates', () => {
    // "Invoice" and "invoice" in one list is the same word twice, and the
    // vector tilts towards whatever the model repeated.
    expect(normalizeTags([' Invoice ', 'invoice', 'Hotel'])).toEqual(['invoice', 'hotel']);
  });

  it('drops anything that is not a string', () => {
    expect(normalizeTags(['hotel', 42, null, { tag: 'no' }, 'prague'])).toEqual([
      'hotel',
      'prague',
    ]);
  });

  it('stops at the number the column accepts', () => {
    const many = Array.from({ length: 40 }, (_, i) => `tag-${i}`);
    expect(normalizeTags(many)).toHaveLength(MAX_TAGS);
  });

  it('truncates a tag that is really a sentence', () => {
    const [tag] = normalizeTags(['a'.repeat(100)]);
    expect(tag).toHaveLength(MAX_TAG_CHARS);
  });

  it('answers an empty list when the model returned no array at all', () => {
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags('hotel, prague')).toEqual([]);
  });
});

describe('embeddingInput', () => {
  it('leads with the name the user chose', () => {
    // The one part of the row a person wrote themselves: holiday-prague.jpg
    // carries intent no description of the pixels recovers.
    const input = embeddingInput({ name: 'holiday-prague.jpg' }, 'Two people on a bridge.', [
      'prague',
      'bridge',
    ]);

    expect(input.split('\n')).toEqual([
      'holiday-prague.jpg',
      'Two people on a bridge.',
      'prague, bridge',
    ]);
  });

  it('leaves out the tag line when there are no tags', () => {
    expect(embeddingInput({ name: 'a.txt' }, 'A note.', [])).toBe('a.txt\nA note.');
  });
});

describe('cloudinaryUrlIsOwned', () => {
  const uid = '11111111-1111-1111-1111-111111111111';
  const good = `https://res.cloudinary.com/demo/image/upload/v1/users/${uid}/holiday.jpg`;

  it('accepts a delivery URL from our own cloud, in the caller’s folder', () => {
    expect(cloudinaryUrlIsOwned(good, uid)).toBe(true);
  });

  it.each([
    ['another account’s folder', `https://res.cloudinary.com/demo/image/upload/users/2222/x.jpg`],
    ['another host entirely', `https://evil.example/image/upload/users/${uid}/x.jpg`],
    ['a host that merely ends in ours', `https://res.cloudinary.com.evil.example/users/${uid}/x`],
    ['plain http', `http://res.cloudinary.com/demo/image/upload/users/${uid}/x.jpg`],
    ['an internal address', 'http://169.254.169.254/latest/meta-data/'],
    ['not a URL at all', 'users/' + uid + '/x.jpg'],
  ])('refuses %s', (_label, url) => {
    expect(cloudinaryUrlIsOwned(url, uid)).toBe(false);
  });
});

describe('toVectorLiteral', () => {
  it('writes the format pgvector parses, with no spaces', () => {
    expect(toVectorLiteral([0.1, -0.2, 3])).toBe('[0.1,-0.2,3]');
  });
});
