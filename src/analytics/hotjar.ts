import { useEffect } from 'react';
import { useLocation } from 'react-router';

/**
 * Initialize Hotjar tracking script
 */
export function initHotjar() {
  const id = Number(import.meta.env.VITE_HOTJAR_SITE_ID);
  const v = Number(import.meta.env.VITE_HOTJAR_VERSION ?? 6);

  if (!id || Number.isNaN(id)) return;

  // Avoid double init
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any)._hjSettings?.hjid === id) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any)._hjSettings = { hjid: id, hjsv: v };

  const head = document.head || document.getElementsByTagName('head')[0];
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://static.hotjar.com/c/hotjar-${id}.js?sv=${v}`;
  head.appendChild(script);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).hj =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).hj ||
    function () {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, prefer-rest-params
      ((window as any).hj.q = (window as any).hj.q || []).push(arguments);
    };
}

/**
 * Tells Hotjar that the page changed, in an app that changes pages without
 * loading one. It is told the path, and not the query string: see
 * `collectors.ts` for what a query string has carried here.
 */
export function useHotjarStateChange() {
  const location = useLocation();

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).hj?.('stateChange', location.pathname);
  }, [location.pathname]);
}
