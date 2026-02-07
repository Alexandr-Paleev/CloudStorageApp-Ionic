/**
 * Options for the retry mechanism
 */
export interface RetryOptions {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  onRetry?: (error: unknown, attempt: number) => void;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
};

/**
 * Executes an async function with retries and exponential backoff
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> => {
  const { maxRetries, initialDelay, maxDelay, onRetry } = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  let lastError: unknown;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries) {
        break;
      }

      if (onRetry) {
        onRetry(error, attempt + 1);
      }

      // Wait before next attempt
      await new Promise((resolve) => setTimeout(resolve, delay));

      // Exponential backoff
      delay = Math.min(delay * 2, maxDelay);
      console.warn(`Retry attempt ${attempt + 1} failed. Retrying in ${delay}ms...`, error);
    }
  }

  throw lastError;
};
