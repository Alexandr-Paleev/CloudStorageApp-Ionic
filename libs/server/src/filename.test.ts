import { describe, it, expect } from 'vitest';
import { sanitizeFileName } from './filename';

describe('sanitizeFileName', () => {
  it('keeps letters from any alphabet', () => {
    expect(sanitizeFileName('Отчёт за квартал.pdf')).toBe('Отчёт за квартал.pdf');
    expect(sanitizeFileName('日本語.txt')).toBe('日本語.txt');
    expect(sanitizeFileName('résumé.doc')).toBe('résumé.doc');
  });

  it('keeps the punctuation people actually use in file names', () => {
    expect(sanitizeFileName('photo (1).JPG')).toBe('photo (1).JPG');
    expect(sanitizeFileName('report-2026_final.pdf')).toBe('report-2026_final.pdf');
  });

  it('drops any directory part, so a key cannot escape the user prefix', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('/absolute/path/file.txt')).toBe('file.txt');
  });

  it('replaces characters that would be ambiguous in a URL', () => {
    expect(sanitizeFileName('re:port?v=1.pdf')).toBe('re_port_v_1.pdf');
  });

  it('falls back to a placeholder when nothing is left', () => {
    expect(sanitizeFileName('')).toBe('unnamed');
    expect(sanitizeFileName('/')).toBe('unnamed');
  });
});
