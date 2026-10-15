/**
 * Runs `task` once the page has loaded and the browser has a moment to spare.
 *
 * For the scripts the visitor is not waiting for: Google Analytics, Hotjar
 * and Sentry. Started at once, they downloaded and ran while the page was
 * still fetching what it needed to draw anything. On a phone, in production,
 * Lighthouse counted 0.2 s of processor time for Google Analytics alone
 * before the login page had drawn its largest element (2026-10-15).
 *
 * The load event, because before it the page's own files are still arriving
 * and an idle moment can fall between two of them. Then an idle callback, so
 * the work competes with nothing on screen; its timeout is the ceiling for a
 * page that never goes idle, and a timer stands in for the Safari versions
 * that have no requestIdleCallback.
 */
export function whenLoadedAndIdle(task: () => void, timeoutMs = 4000): void {
  const whenIdle = () => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => task(), { timeout: timeoutMs });
    } else {
      setTimeout(task, Math.min(timeoutMs, 2000));
    }
  };

  if (document.readyState === 'complete') whenIdle();
  else window.addEventListener('load', whenIdle, { once: true });
}
