import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { whenLoadedAndIdle } from './when-loaded';

const idle: { callbacks: (() => void)[]; timeouts: (number | undefined)[] } = {
  callbacks: [],
  timeouts: [],
};

function setReadyState(state: DocumentReadyState) {
  Object.defineProperty(document, 'readyState', { value: state, configurable: true });
}

beforeEach(() => {
  idle.callbacks = [];
  idle.timeouts = [];
  vi.stubGlobal('requestIdleCallback', (callback: () => void, options?: { timeout?: number }) => {
    idle.callbacks.push(callback);
    idle.timeouts.push(options?.timeout);
    return idle.callbacks.length;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setReadyState('complete');
});

describe('whenLoadedAndIdle', () => {
  it('waits for the load event, and then for an idle moment', () => {
    setReadyState('loading');
    const task = vi.fn();

    whenLoadedAndIdle(task);
    expect(idle.callbacks).toHaveLength(0);

    window.dispatchEvent(new Event('load'));
    expect(idle.callbacks).toHaveLength(1);
    expect(task).not.toHaveBeenCalled();

    idle.callbacks[0]!();
    expect(task).toHaveBeenCalledOnce();
  });

  /* An idle moment can fall between two of the page's own files, so one
     before the load event is not the one this waits for. */
  it('is not started by an idle moment before the page has loaded', () => {
    setReadyState('interactive');
    whenLoadedAndIdle(vi.fn());
    expect(idle.callbacks).toHaveLength(0);

    window.dispatchEvent(new Event('load'));
    expect(idle.callbacks).toHaveLength(1);
  });

  it('waits only for an idle moment when the page has already loaded', () => {
    setReadyState('complete');
    const task = vi.fn();

    whenLoadedAndIdle(task);
    expect(idle.callbacks).toHaveLength(1);

    idle.callbacks[0]!();
    expect(task).toHaveBeenCalledOnce();
  });

  it('gives a page that never goes idle a ceiling', () => {
    whenLoadedAndIdle(vi.fn(), 4000);
    expect(idle.timeouts).toEqual([4000]);
  });

  it('runs once, however many loads the window hears', () => {
    setReadyState('loading');
    whenLoadedAndIdle(vi.fn());

    window.dispatchEvent(new Event('load'));
    window.dispatchEvent(new Event('load'));
    expect(idle.callbacks).toHaveLength(1);
  });

  it('falls back to a timer where there is no requestIdleCallback', () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    vi.useFakeTimers();
    const task = vi.fn();

    whenLoadedAndIdle(task);
    vi.advanceTimersByTime(1999);
    expect(task).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledOnce();
  });
});
