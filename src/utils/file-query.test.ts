import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DIRECTION,
  DEFAULT_SORT,
  SORT_OPTIONS,
  escapeLike,
  inTypeGroup,
  isSearching,
  scopedToFolder,
} from './file-query';

describe('inTypeGroup', () => {
  it.each([
    ['image/png', 'images', true],
    ['IMAGE/JPEG', 'images', true],
    ['text/plain', 'images', false],
    ['application/pdf', 'documents', true],
    ['text/markdown', 'documents', true],
    ['image/png', 'documents', false],
    ['video/mp4', 'other', true],
    ['', 'other', true],
    ['text/plain', 'other', false],
    ['image/png', 'other', false],
    ['video/mp4', 'all', true],
  ] as const)('%s in %s: %s', (type, group, expected) => {
    // The rule the SQL in supabase.service.ts applies to the paginated list.
    expect(inTypeGroup(type, group)).toBe(expected);
  });
});

describe('escapeLike', () => {
  it.each([
    ['report', 'report'],
    // Both are SQL wildcards: unescaped, report_final also matches reportXfinal.
    ['report_final', 'report\\_final'],
    ['50% done', '50\\% done'],
    // The backslash goes first, or it escapes the escapes added after it.
    ['back\\slash', 'back\\\\slash'],
    ['100%_of_it', '100\\%\\_of\\_it'],
  ])('%s -> %s', (input, expected) => {
    expect(escapeLike(input)).toBe(expected);
  });
});

describe('isSearching', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['   ', false],
    ['a', true],
  ])('%s -> %s', (search, expected) => {
    expect(isSearching({ search })).toBe(expected);
  });
});

describe('scopedToFolder', () => {
  it('stays in the folder while there is nothing to search for', () => {
    expect(scopedToFolder({ folderId: 'f1' })).toBe(true);
  });

  it('leaves the folder as soon as there is', () => {
    // Someone typing a name is looking for a file, not for a file in this
    // particular folder — and answering "nothing found" about a file that is
    // plainly there is worse than widening the search.
    expect(scopedToFolder({ folderId: 'f1', search: 'invoice' })).toBe(false);
  });
});

describe('the orderings offered', () => {
  it('starts on the one the list used before any of this existed', () => {
    expect({ field: DEFAULT_SORT, direction: DEFAULT_DIRECTION }).toEqual({
      field: SORT_OPTIONS[0]!.field,
      direction: SORT_OPTIONS[0]!.direction,
    });
  });

  it('names each one exactly once', () => {
    const keys = SORT_OPTIONS.map((o) => `${o.field}:${o.direction}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
