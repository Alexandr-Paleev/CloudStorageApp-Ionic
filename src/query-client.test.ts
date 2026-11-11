import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MutationObserver } from '@tanstack/react-query';

const { track } = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('./hooks/useAnalytics', () => ({
  trackApiErrorStandalone: (...args: unknown[]) => track(...args),
}));

import { createQueryClient } from './query-client';
import { NameRuleError } from './schemas/file.schema';

beforeEach(() => {
  track.mockClear();
});

describe('what Google Analytics is told of a failure', () => {
  /* A default onError is replaced by a mutation's own, and the mutations
     that say their failure themselves were never reported. */
  it('hears of a mutation that fails, even one that handles it itself', async () => {
    const own = vi.fn();
    const observer = new MutationObserver(createQueryClient(), {
      mutationFn: () => Promise.reject(new Error('Failed to delete folder')),
      onError: own,
    });

    await observer.mutate(undefined).catch(() => undefined);

    expect(own).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith({
      error_message: 'Failed to delete folder',
      query_key: undefined,
    });
  });

  /* TanStack Query 5 has no onError for queries in defaultOptions, and a
     listing or a search that failed reached nobody. */
  it('hears of a query that fails, by its name and nothing else of its key', async () => {
    await createQueryClient()
      .fetchQuery({
        queryKey: ['smart-search', 'user-1', 'tax return 2025'],
        queryFn: () => Promise.reject(new Error('Too many searches. Try again in a minute.')),
        retry: false,
      })
      .catch(() => undefined);

    expect(track).toHaveBeenCalledWith({
      error_message: 'Too many searches. Try again in a minute.',
      query_key: 'smart-search',
    });
    expect(JSON.stringify(track.mock.calls)).not.toContain('tax return');
    expect(JSON.stringify(track.mock.calls)).not.toContain('user-1');
  });

  /* A pause, a Drive not connected, a name the rules refuse: what the person
     did or chose. Counted as failures, they would be most of the metric. */
  it.each([
    ['a pause', new DOMException('The upload was paused', 'AbortError')],
    ['a paused upload', Object.assign(new Error('Paused'), { name: 'UploadPausedError' })],
    [
      'a Drive not connected',
      Object.assign(new Error('Connect'), { name: 'GoogleDriveAuthError' }),
    ],
    ['a file too large', Object.assign(new Error('Too large'), { name: 'FileTooLargeError' })],
    ['a name the rules refuse', new NameRuleError('Invalid file or folder name')],
    ['a queue waiting to sign in', Object.assign(new Error('Later'), { name: 'NotSignedIn' })],
  ])('leaves out %s', async (_what, error) => {
    const observer = new MutationObserver(createQueryClient(), {
      mutationFn: () => Promise.reject(error),
    });

    await observer.mutate(undefined).catch(() => undefined);

    expect(track).not.toHaveBeenCalled();
  });

  it('still hears of a request that did not answer in time', async () => {
    const observer = new MutationObserver(createQueryClient(), {
      mutationFn: () =>
        Promise.reject(Object.assign(new Error('Timed out'), { name: 'RequestTimeout' })),
    });

    await observer.mutate(undefined).catch(() => undefined);

    expect(track).toHaveBeenCalledWith({ error_message: 'Timed out', query_key: undefined });
  });
});
