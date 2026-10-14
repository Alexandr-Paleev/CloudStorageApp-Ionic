import { ReactElement, ReactNode } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

/**
 * A client that fails fast. The app retries queries three times with backoff,
 * which in a test only turns an assertion failure into a timeout.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

/**
 * The provider a hook of this app assumes, around a client the test keeps.
 *
 * Nothing in it is collected. A test puts entries in the cache, has the hook
 * do something, and reads back which of them it marked stale. Under the
 * `gcTime: 0` above, an entry that nothing is watching is gone before it can
 * be read.
 */
export function withQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, wrapper };
}

type Options = Omit<RenderOptions, 'wrapper'> & {
  route?: string;
  queryClient?: QueryClient;
};

/** Renders inside the two providers every page of this app assumes. */
export function renderWithProviders(ui: ReactElement, options: Options = {}) {
  const { route = '/', queryClient = createTestQueryClient(), ...rest } = options;

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );

  return { queryClient, ...render(ui, { wrapper: Wrapper, ...rest }) };
}
