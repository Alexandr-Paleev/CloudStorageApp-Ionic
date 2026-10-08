import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderNotConfigured } from '../../core/src/ai';
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
    process.env.R2_ENDPOINT = `https://${'a1b2c3d4'.repeat(4)}.r2.cloudflarestorage.com`;

    expect(activeBackend().embeddingModel).toBe(CF_EMBEDDING_MODEL);
  });

  it('accepts the jurisdiction label an endpoint may carry', () => {
    process.env.CLOUDFLARE_AI_TOKEN = 'cf-test';
    process.env.R2_ENDPOINT = `https://${'a1b2c3d4'.repeat(4)}.eu.r2.cloudflarestorage.com/`;

    expect(activeBackend().embeddingModel).toBe(CF_EMBEDDING_MODEL);
  });

  it('refuses a domain that merely starts like an R2 endpoint', () => {
    /* Without the anchor at the end this matched, and the first label of
       somebody else's domain became the account every model call was billed
       to. CodeQL flagged exactly this on PR #108. */
    process.env.CLOUDFLARE_AI_TOKEN = 'cf-test';
    process.env.R2_ENDPOINT = `https://${'a1b2c3d4'.repeat(4)}.r2.cloudflarestorage.com.example.com`;

    expect(() => activeBackend()).toThrow(ProviderNotConfigured);
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
