import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { choose, overlays, type Overlay } from '../test/overlays';

/* What the hook says about the worker. The hook reads vite-plugin-pwa's
   virtual module, which exists only in a build or the dev server, and the
   plugin's own half, calling onNeedRefresh when a new worker waits, happens
   only in the 'prompt' mode vite.config.mts sets and in a browser with a
   worker. So the hook is what is replaced here. */
const worker = vi.hoisted(() => ({
  waiting: false,
  close: vi.fn(),
  updateServiceWorker: vi.fn(),
}));

vi.mock('../hooks/usePWAUpdate', () => ({
  usePWAUpdate: () => ({
    needRefresh: worker.waiting,
    offlineReady: false,
    updateServiceWorker: worker.updateServiceWorker,
    close: worker.close,
  }),
}));

import { PWAUpdatePrompt } from './PWAUpdatePrompt';

function theToast(): Overlay {
  const [toast] = overlays('ion-toast');
  if (!toast) throw new Error('No toast on the page');
  return toast;
}

beforeEach(() => {
  worker.waiting = false;
  vi.clearAllMocks();
});

describe('the toast for a new version', () => {
  it('is not there while no new version waits', () => {
    render(<PWAUpdatePrompt />);

    expect(overlays('ion-toast')).toHaveLength(0);
  });

  it('says a new version is there, and Update lets it take over', () => {
    worker.waiting = true;
    render(<PWAUpdatePrompt />);
    const toast = theToast();

    expect(toast.isOpen).toBe(true);
    expect(toast.message).toBe('New version available!');
    choose(toast, 'Update');
    expect(worker.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('Later puts it away and leaves the version waiting', () => {
    worker.waiting = true;
    render(<PWAUpdatePrompt />);

    choose(theToast(), 'Later');
    expect(worker.close).toHaveBeenCalledTimes(1);
    expect(worker.updateServiceWorker).not.toHaveBeenCalled();
  });
});
