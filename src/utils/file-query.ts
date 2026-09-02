/**
 * What the dashboard asks the database for.
 *
 * The list is paginated fifteen at a time, which is why none of this can be
 * done in the browser: filtering the page you happen to have loaded finds a
 * file only if it was already on screen, and sorting it reorders fifteen rows
 * out of a hundred. Every option here becomes part of the query.
 */

export type SortField = 'created_at' | 'name' | 'size';
export type SortDirection = 'asc' | 'desc';
export type TypeGroup = 'all' | 'images' | 'documents' | 'other';

export interface FileQuery {
  folderId?: string | null;
  page?: number;
  pageSize?: number;
  /** Matched against the file name, case-insensitively, anywhere in it. */
  search?: string;
  sort?: SortField;
  direction?: SortDirection;
  group?: TypeGroup;
}

export const DEFAULT_SORT: SortField = 'created_at';
export const DEFAULT_DIRECTION: SortDirection = 'desc';

/** The orderings offered, and how to say them in a menu. */
export const SORT_OPTIONS: { field: SortField; direction: SortDirection; label: string }[] = [
  { field: 'created_at', direction: 'desc', label: 'Newest first' },
  { field: 'created_at', direction: 'asc', label: 'Oldest first' },
  { field: 'name', direction: 'asc', label: 'Name A–Z' },
  { field: 'name', direction: 'desc', label: 'Name Z–A' },
  { field: 'size', direction: 'desc', label: 'Largest first' },
  { field: 'size', direction: 'asc', label: 'Smallest first' },
];

export const TYPE_GROUPS: { value: TypeGroup; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'images', label: 'Images' },
  { value: 'documents', label: 'Documents' },
  { value: 'other', label: 'Other' },
];

/** MIME prefixes that make a file a document rather than something else. */
export const DOCUMENT_PREFIXES = ['application/', 'text/'];
export const IMAGE_PREFIX = 'image/';

/**
 * Escapes a search term for `ilike`.
 *
 * `%` and `_` are wildcards in SQL patterns, so a file named `report_final.pdf`
 * searched for verbatim would also match `reportXfinal.pdf` — and someone
 * looking for a `50%` in a name would match everything. The backslash has to go
 * first, or it would escape the escapes added after it.
 */
export function escapeLike(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/[%_]/g, (char) => `\\${char}`);
}

/** A term worth sending: whitespace alone is not a search. */
export function isSearching(query: FileQuery): boolean {
  return !!query.search && query.search.trim().length > 0;
}

/**
 * Whether a query should stay inside the folder the user is looking at.
 *
 * It should not, while searching. Someone who types a name is looking for a
 * file, not for a file in this particular folder — and a search that quietly
 * excluded the other folders would answer "nothing found" about a file that is
 * plainly there. The dashboard says which mode it is in rather than leaving
 * that to be inferred.
 */
export function scopedToFolder(query: FileQuery): boolean {
  return !isSearching(query);
}
