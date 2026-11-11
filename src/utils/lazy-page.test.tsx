import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Suspense, type ComponentType } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../observability/sentry', () => ({ captureException: vi.fn() }));

import ErrorBoundary from '../components/ErrorBoundary';
import * as Sentry from '../observability/sentry';
import { RELOADED_FROM, lazyPage, reloadForAMissingPage } from './lazy-page';

/** A page's chunk, as the browser finds it after a deploy renamed it. */
const removedByADeploy = (): Promise<{ default: ComponentType }> =>
  Promise.reject(
    new TypeError(
      'Failed to fetch dynamically imported module: https://app.example/assets/Dashboard-deadbeef.js'
    )
  );

function open(Page: ComponentType) {
  render(
    <ErrorBoundary>
      <Suspense fallback={<p>Loading</p>}>
        <Page />
      </Suspense>
    </ErrorBoundary>
  );
}

/** Long enough for a rejected import to reach React, and for React to act on it. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('a page whose chunk a deploy removed', () => {
  it('reloads the tab, and keeps the spinner up until the reload lands', async () => {
    const reload = vi.fn();
    open(lazyPage(removedByADeploy, reload));
    await settle();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Loading')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('is left to the error boundary when the reload did not bring it back', async () => {
    // The reload before this one, from the same build.
    reloadForAMissingPage(undefined, () => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    open(lazyPage(removedByADeploy, reload));

    expect(await screen.findByText('Something went wrong')).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('renders as it always did when its chunk is there', async () => {
    const reload = vi.fn();
    open(lazyPage(() => Promise.resolve({ default: () => <p>The page</p> }), reload));

    expect(await screen.findByText('The page')).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RELOADED_FROM)).toBeNull();
  });
});

describe('reloadForAMissingPage', () => {
  it('reloads once for each build, so a tab left open across two deploys gets two', () => {
    const reload = vi.fn();

    expect(reloadForAMissingPage('build-1', reload)).toBe(true);
    expect(reloadForAMissingPage('build-1', reload)).toBe(false);
    expect(reloadForAMissingPage('build-2', reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('does not reload offline, where the browser would show its own error page', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const reload = vi.fn();

    expect(reloadForAMissingPage('build-1', reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload where it cannot note that it did, since nothing would stop a loop', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    const reload = vi.fn();

    expect(reloadForAMissingPage('build-1', reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

/**
 * The server's half. A chunk that is not there used to be answered with the
 * app shell, 200 and text/html, because the rewrite to index.html took every
 * address but /api/. The browser refuses that as a module all the same, so
 * the reload above does not depend on it. But the header rule for assets/
 * marks the answer immutable for a year, Vercel's CDN served it from cache
 * on the second request, and a rollback that brought the chunk back would
 * have found the shell kept under its name.
 */
describe('what vercel.json does with a file of the build that is not there', () => {
  const { rewrites = [] } = JSON.parse(readFileSync(resolve('vercel.json'), 'utf8')) as {
    rewrites?: { source: string; destination: string }[];
  };

  /* Vercel reads a source as a path-to-regexp pattern. This one is a single
     regular-expression group, which means the same as a RegExp held to the
     whole path. */
  const handedTheShell = (path: string) =>
    rewrites.some(
      ({ source, destination }) =>
        destination === '/index.html' && new RegExp(`^${source}$`).test(path)
    );

  it('has one rewrite to the shell, or this test reads the wrong thing', () => {
    expect(rewrites.filter(({ destination }) => destination === '/index.html')).toHaveLength(1);
  });

  it('leaves a missing chunk, stylesheet or font to be a 404', () => {
    expect(handedTheShell('/assets/Dashboard-deadbeef.js')).toBe(false);
    expect(handedTheShell('/assets/index-deadbeef.css')).toBe(false);
    expect(handedTheShell('/fonts/inter-v20-latin-700.woff2')).toBe(false);
  });

  it('still hands the shell to every address of the app, and none to the functions', () => {
    for (const path of ['/', '/dashboard', '/upload', '/file/42', '/pricing', '/assetsy']) {
      expect(handedTheShell(path), path).toBe(true);
    }
    expect(handedTheShell('/api/share')).toBe(false);
  });
});
