import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const { initialize, send, envMock } = vi.hoisted(() => ({
  initialize: vi.fn(),
  send: vi.fn(),
  envMock: { VITE_GA4_MEASUREMENT_ID: 'G-TEST000000' as string | undefined },
}));

vi.mock('react-ga4', () => ({ default: { initialize, send, event: vi.fn() } }));
vi.mock('../env', () => ({ env: envMock }));

/* The module remembers that GA4 has started, as a page does: each test loads
   it afresh. */
async function load() {
  vi.resetModules();
  return import('./useAnalytics');
}

const pageViews = () => send.mock.calls.map(([fields]) => fields.page);

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('DEV', false);
  envMock.VITE_GA4_MEASUREMENT_ID = 'G-TEST000000';
  window.history.replaceState(null, '', '/dashboard');
});

describe('initializeGA4', () => {
  it('leaves page views to the app', async () => {
    (await load()).initializeGA4();

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledWith('G-TEST000000', {
      gtagOptions: { send_page_view: false },
    });
  });

  it('reports the page it starts on, by its path', async () => {
    (await load()).initializeGA4();

    expect(pageViews()).toEqual(['/dashboard']);
  });

  it('starts once, however often it is asked', async () => {
    const { initializeGA4 } = await load();
    initializeGA4();
    initializeGA4();

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(pageViews()).toEqual(['/dashboard']);
  });

  it('starts nothing outside production, or without a measurement ID', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubEnv('DEV', true);
    (await load()).initializeGA4();

    vi.stubEnv('DEV', false);
    envMock.VITE_GA4_MEASUREMENT_ID = undefined;
    (await load()).initializeGA4();

    expect(initialize).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends nothing when a blocker breaks GA4, and does not throw', async () => {
    initialize.mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    const { initializeGA4 } = await load();

    expect(() => initializeGA4()).not.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("the app's page view", () => {
  it('goes nowhere before GA4 has started, and by its path after', async () => {
    const { initializeGA4, useAnalytics } = await load();
    const { result } = renderHook(() => useAnalytics());

    result.current.trackPageView('/pricing');
    expect(send).not.toHaveBeenCalled();

    initializeGA4();
    result.current.trackPageView('/pricing');
    expect(pageViews()).toEqual(['/dashboard', '/pricing']);
  });
});
