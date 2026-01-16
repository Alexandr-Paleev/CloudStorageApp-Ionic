import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * PWA Update Prompt Component
 * Shows notification when app update is available
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
