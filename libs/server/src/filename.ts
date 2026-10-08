import path from 'path';

/**
 * Turns a user-supplied file name into something safe to use as an object key.
 * Strips any directory part first, so "../../etc/passwd" cannot escape the
 * user's prefix, then replaces characters that have meaning in a URL or key.
 */
export function sanitizeFileName(name: string): string {
  const base = path.basename(name);
  // Letters and digits from any alphabet are kept — \w would turn "Отчёт.pdf"
  // into "______.pdf"
  return base.replace(/[^\p{L}\p{N}._\-() ]/gu, '_') || 'unnamed';
}
