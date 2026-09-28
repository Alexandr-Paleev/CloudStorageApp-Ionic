import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, ProviderNotConfigured } from './ai';
import { embed } from './embeddings';

const VECTOR = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i / EMBEDDING_DIMENSIONS);

function answerWith(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  process.env.VOYAGE_API_KEY = 'test-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('embed', () => {
  it('refuses to guess when the deployment has no key', async () => {
    delete process.env.VOYAGE_API_KEY;
    // Its own class, because the route answers 501 rather than 500 — the
    // client cannot see the server's variables.
    await expect(embed('anything', 'query')).rejects.toBeInstanceOf(ProviderNotConfigured);
  });

  it('asks for the model and the side of the search it is embedding', async () => {
    const fetchMock = answerWith({ data: [{ embedding: VECTOR }] });

    await embed('hotel invoice', 'query');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      input: ['hotel invoice'],
      model: EMBEDDING_MODEL,
      // Voyage prepends a different instruction per side; embedding a query
      // as a document is a different question than the one being asked.
      input_type: 'query',
    });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
  });

  it('returns the vector', async () => {
    answerWith({ data: [{ embedding: VECTOR }] });
    await expect(embed('hotel invoice', 'document')).resolves.toEqual(VECTOR);
  });

  it('reports the status when the provider refuses', async () => {
    answerWith('{"detail":"quota exceeded"}', { ok: false, status: 429 });
    await expect(embed('x', 'query')).rejects.toThrow(/429.*quota exceeded/);
  });

  it('rejects a payload with no embedding in it', async () => {
    answerWith({ data: [] });
    await expect(embed('x', 'query')).rejects.toThrow(/no embedding/);
  });

  it('names both numbers when the width does not match the column', async () => {
    // The symptom otherwise is a Postgres type error on insert, three calls
    // later, that mentions neither the model nor the migration.
    answerWith({ data: [{ embedding: [0.1, 0.2, 0.3] }] });

    await expect(embed('x', 'document')).rejects.toThrow(
      new RegExp(`3 dimensions.*${EMBEDDING_DIMENSIONS}`)
    );
  });
});
