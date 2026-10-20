import { useEffect } from 'react';
import { useLocation } from 'react-router';

/**
 * Given to an Ionic alert or action sheet as `htmlAttributes`, so that what it
 * draws is left out of what Hotjar records. Ionic draws both in the page's own
 * DOM, under their element, and that is where the attribute goes.
 *
 * It hides text and pictures, and no attribute but a few Hotjar knows
 * (src/test/hotjar.ts). So the owner's words must not reach an overlay as a
 * string prop either: @ionic/react writes every one onto the element as an
 * attribute as well. Set on the element as a property, they are only drawn.
 */
export const HIDDEN_FROM_HOTJAR = { 'data-hj-suppress': '' } as const;

/**
 * Initialize Hotjar tracking script, in a production build only, as Google
 * Analytics is. A development server with an id in its .env used to send its
 * own sessions to Hotjar as if they were visitors'.
 */
export function initHotjar() {
  if (!import.meta.env.PROD) return;

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
