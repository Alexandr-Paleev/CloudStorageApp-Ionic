import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DIRECTION,
  DEFAULT_SORT,
  SORT_OPTIONS,
  escapeLike,
  isSearching,
  scopedToFolder,
} from './file-query';

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
      field: SORT_OPTIONS[0].field,
      direction: SORT_OPTIONS[0].direction,
    });
  });

  it('names each one exactly once', () => {
    const keys = SORT_OPTIONS.map((o) => `${o.field}:${o.direction}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
