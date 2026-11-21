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

  /* It refused PDFs until toMarkdown could read their text on the same
     account (ADR 0019); its model still cannot take one as it is. */
  it('reads a PDF on the free backend as its text', () => {
    process.env.CLOUDFLARE_AI_TOKEN = 'cf-test';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'abc123';
    const backend = activeBackend();

    expect(['image', 'text', 'pdf'].map((kind) => backend.supports(kind as 'pdf'))).toEqual([
      true,
      true,
      true,
    ]);
    expect(backend.readsPdf).toBe(false);
    // It sends a picture as bytes, and Workers AI takes no more than this.
    expect(backend.maxImageBytes).toBe(3 * 1024 * 1024);
  });

  it('hands Claude a PDF as it is', () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.VOYAGE_API_KEY = 'v';
    expect(activeBackend().readsPdf).toBe(true);
  });
});
