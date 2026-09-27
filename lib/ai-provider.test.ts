import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderNotConfigured } from './ai';
import { activeBackend } from './ai-provider';
import { CF_EMBEDDING_MODEL } from './cloudflare-ai';

const KEYS = [
  'ANTHROPIC_API_KEY',
  'VOYAGE_API_KEY',
  'CLOUDFLARE_AI_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'R2_ENDPOINT',
];

beforeEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe('activeBackend', () => {
  it('uses Claude and Voyage when the deployment paid for them', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.VOYAGE_API_KEY = 'pa-test';

    expect(activeBackend().embeddingModel).toBe('voyage-4');
  });

  it('falls back to the free path when only Cloudflare is configured', () => {
    process.env.CLOUDFLARE_AI_TOKEN = 'cf-test';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'abc123';

    expect(activeBackend().embeddingModel).toBe(CF_EMBEDDING_MODEL);
  });

  it('takes the account id off the R2 endpoint rather than asking for it twice', () => {
    process.env.CLOUDFLARE_AI_TOKEN = 'cf-test';
    process.env.R2_ENDPOINT = 'https://deadbeef1234.r2.cloudflarestorage.com';

    expect(activeBackend().embeddingModel).toBe(CF_EMBEDDING_MODEL);
  });

  it('says what is missing when nothing is configured', () => {
    // The route turns this into a 501, and the searchbar into a sentence the
    // person can act on.
    expect(() => activeBackend()).toThrow(ProviderNotConfigured);
  });

  it('admits that the free backend cannot read a PDF', () => {
    process.env.CLOUDFLARE_AI_TOKEN = 'cf-test';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'abc123';
    const backend = activeBackend();

    expect(backend.supports('image')).toBe(true);
    expect(backend.supports('text')).toBe(true);
    expect(backend.supports('pdf')).toBe(false);
  });
});
