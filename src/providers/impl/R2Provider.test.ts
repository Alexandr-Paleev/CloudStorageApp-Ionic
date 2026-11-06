import { describe, it, expect, vi } from 'vitest';
import { R2Provider } from './R2Provider';

vi.mock('../../services/r2.service', () => ({ default: { isConfigured: () => true } }));

const MB = 1024 * 1024;

describe('R2Provider.resumes', () => {
  /* Its parts stay in the bucket, and a record says which ones they are. A
     single PUT keeps nothing to come back to. */
  it('continues a file large enough to go up in parts, and no other', () => {
    const r2 = new R2Provider();

    expect(r2.resumes({ size: 64 * MB } as File)).toBe(true);
    expect(r2.resumes({ size: 1 * MB } as File)).toBe(false);
  });
});
