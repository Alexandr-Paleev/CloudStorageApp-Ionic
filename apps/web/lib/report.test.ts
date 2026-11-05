import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { shareLinkUrl } from '@cloud-storage/core/share-link';
import { reportAddress } from './report';
import { CONTACT_EMAIL } from './site';

/* As long as a real one, and nothing else of one. A string that looks drawn
   at random is what the scan for leaked credentials takes for a key. */
const TOKEN = 'a'.repeat(43);

const document = (name: string) =>
  readFileSync(new URL(`../content/${name}`, import.meta.url), 'utf8');

describe('reportAddress', () => {
  it('writes to the address the terms and the privacy policy give', () => {
    expect(document('terms-of-service.md')).toContain(`mailto:${CONTACT_EMAIL}`);
    expect(document('privacy-policy.md')).toContain(`mailto:${CONTACT_EMAIL}`);

    const letter = new URL(reportAddress(TOKEN));
    expect(letter.protocol).toBe('mailto:');
    expect(letter.pathname).toBe(CONTACT_EMAIL);
  });

  /* The token is the one thing that finds the file: it is stored only as
     its hash. */
  it('carries the link, as the functions issued it', () => {
    const letter = new URL(reportAddress(TOKEN));
    expect(letter.searchParams.get('subject')).toBe('A shared file to look at');
    expect(letter.searchParams.get('body')).toContain(`Link: ${shareLinkUrl(TOKEN)}\n`);
  });

  /* The terms tell a reader where reports go, and the page says how. */
  it('is what the terms describe', () => {
    expect(document('terms-of-service.md')).toContain('**Report this file**');
  });
});
