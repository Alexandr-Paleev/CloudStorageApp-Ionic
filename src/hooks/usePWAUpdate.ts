import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Whether a new version of the app is installed and waiting, and the way to
 * let it take over: `updateServiceWorker` tells the waiting worker to skip
 * the wait, and the plugin reloads the tab once it controls the page.
 *
 * `needRefresh` turns true only with `registerType: 'prompt'` in
 * vite.config.mts. With 'autoUpdate' the plugin never calls onNeedRefresh,
 * and PWAUpdatePrompt, the one reader of this hook, never showed.
 */
export const usePWAUpdate = () => {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({});

  const close = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  return {
    needRefresh,
    offlineReady,
    updateServiceWorker,
    close,
  };
};
