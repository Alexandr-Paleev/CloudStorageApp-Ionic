import { describe, it, expect } from 'vitest';
import { withRetry } from './retry.utils';
import { HttpError, isRetriableError } from './http.utils';

describe('withRetry', () => {
  it('keeps trying until the call succeeds', async () => {
    let calls = 0;

    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('flaky');
        return 'ok';
      },
      { maxRetries: 3, initialDelay: 0 }
    );

    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('surfaces the last error once the attempts run out', async () => {
    let calls = 0;

    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error('always down');
        },
        { maxRetries: 2, initialDelay: 0 }
      )
    ).rejects.toThrow('always down');

    expect(calls).toBe(3);
  });

  /**
   * A quota rejection is final. Before shouldRetry existed, an upload past the
   * storage limit was retried three times with backoff, so the user waited
   * seconds for an answer the server already had.
   */
  it('fails fast when shouldRetry rejects the error', async () => {
    let calls = 0;

    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new HttpError('Storage limit exceeded', 413);
        },
        { maxRetries: 3, initialDelay: 0, shouldRetry: isRetriableError }
      )
    ).rejects.toThrow('Storage limit exceeded');

    expect(calls).toBe(1);
  });

  it('still retries a server error under the same predicate', async () => {
    let calls = 0;

    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new HttpError('Bad gateway', 502);
        },
        { maxRetries: 2, initialDelay: 0, shouldRetry: isRetriableError }
      )
    ).rejects.toThrow('Bad gateway');

    expect(calls).toBe(3);
  });
});
