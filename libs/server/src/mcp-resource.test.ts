import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RESOURCE_METADATA_PATH,
  authorizationServer,
  mcpChallenge,
  protectedResourceMetadata,
} from './mcp-resource';

const rewrites = (
  JSON.parse(readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8')) as {
    rewrites: { source: string; destination: string }[];
  }
).rewrites;

/**
 * Where Vercel sends a path: the first rewrite whose source matches. Each
 * source here is a literal path or one group of regular expression, which is
 * all vercel.json holds, and is matched whole.
 */
function rewrittenTo(path: string): string | undefined {
  return rewrites.find(({ source }) => new RegExp(`^${source}$`).test(path))?.destination;
}

describe('vercel.json, for an assistant (ADR 0020)', () => {
  it('sends /mcp and its metadata to the AI function', () => {
    expect(rewrittenTo('/mcp')).toBe('/api/ai/mcp');
    expect(rewrittenTo(RESOURCE_METADATA_PATH)).toBe('/api/ai/resource');
    expect(rewrittenTo('/.well-known/oauth-protected-resource')).toBe('/api/ai/resource');
  });

  it('answers any other /.well-known/ path 404, not with the app', () => {
    // A client that looks for an authorization server here, as 2025-03-26
    // clients did, must be told there is none: the app's page with a 200
    // is a document it cannot read.
    for (const path of [
      '/.well-known/oauth-authorization-server',
      '/.well-known/openid-configuration',
      '/.well-known/oauth-protected-resource/elsewhere',
    ]) {
      expect(rewrittenTo(path)).toBeUndefined();
    }
  });

  it('still sends the app its routes', () => {
    expect(rewrittenTo('/dashboard')).toBe('/index.html');
    expect(rewrittenTo('/oauth/consent')).toBe('/index.html');
  });
});

describe('the protected resource metadata', () => {
  it('names the resource at the host asked, and the project’s issuer', () => {
    expect(protectedResourceMetadata('app.example', 'https://project.supabase.co//')).toEqual({
      resource: 'https://app.example/mcp',
      authorization_servers: ['https://project.supabase.co/auth/v1'],
      bearer_methods_supported: ['header'],
      scopes_supported: ['email'],
      resource_name: 'Cloud Storage',
    });
    expect(authorizationServer('https://project.supabase.co')).toBe(
      'https://project.supabase.co/auth/v1'
    );
  });

  it('is where the challenge points', () => {
    expect(mcpChallenge('app.example', false)).toContain(
      `resource_metadata="https://app.example${RESOURCE_METADATA_PATH}"`
    );
  });
});
