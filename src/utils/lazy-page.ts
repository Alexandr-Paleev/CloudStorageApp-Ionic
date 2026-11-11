import { lazy, type LazyExoticComponent } from 'react';

/**
 * A page that is loaded when it is first opened, and that survives a deploy.
 *
 * Every page but Login is a chunk of its own, under a name that carries a
 * hash, and a deploy replaces them all. A tab opened before the deploy still
 * asks for the old names, and they are gone: the import fails, and the error
 * boundary said "Something went wrong" over a page that had only moved. That
 * was any navigation to a page the tab had not opened yet, and every merge to
 * `main` deploys. A tab the service worker controls is spared, because the
 * old chunks are in its precache until a new version takes over. A private
 * window and the browsers inside other apps have no worker.
 *
 * So a page that cannot be loaded reloads the tab, and the new HTML names the
 * new chunks. Until the reload replaces the page, the import never settles,
 * and Suspense keeps the spinner up rather than the error boundary. That
 * boundary reports what it catches to Sentry, and a deploy is not an error.
 *
 * Vite's own answer is a listener for `vite:preloadError` that cancels the
 * event and reloads. Cancelled, the import resolves to nothing, and React
 * throws reading `default` off it: the boundary, and a report, still come
 * first. And that event fires for imports that run in the background too:
 * Sentry's, started once the browser is idle, goes through the same helper.
 * A reload there would come out of nowhere and take whatever was being typed
 * with it. A page is opened by the person, who expects it to load.
 */
export function lazyPage<M extends PageModule>(
  load: () => Promise<M>,
  reload: () => void = () => window.location.reload()
): LazyExoticComponent<M['default']> {
  return lazy(() =>
    load().catch((error: unknown) => {
      if (reloadForAMissingPage(THIS_BUILD, reload)) return new Promise<never>(() => {});
      throw error;
    })
  );
}

/** What `lazy` takes a page module to be. */
type PageModule = Awaited<ReturnType<Parameters<typeof lazy>[0]>>;

/** Where a tab notes the build it reloaded from. */
export const RELOADED_FROM = 'reloaded-for-a-missing-page';

/**
 * The build this tab is running: the address of the chunk this module was
 * bundled into. A build renames every chunk whose content changed, and the
 * entry names all the others, so a deploy that moved any page renamed it.
 */
const THIS_BUILD = import.meta.url;

/**
 * Reloads the tab for a page it could not load, and says whether it did.
 *
 * Once for each build. A page still missing after the reload is missing from
 * the deployment, not from an old tab, and a second reload would be the
 * first of a loop. A deploy after that renames the build, so a tab that is
 * left open across several gets one reload for each. Nothing in the timing
 * decides it, which a slow connection could stretch past any window chosen.
 *
 * No reload offline either, where it would put the browser's own error page
 * in place of the app, or where the note cannot be written: without it,
 * nothing would stop a loop.
 */
export function reloadForAMissingPage(
  build: string = THIS_BUILD,
  reload: () => void = () => window.location.reload()
): boolean {
  if (navigator.onLine === false) return false;

  try {
    if (sessionStorage.getItem(RELOADED_FROM) === build) return false;
    sessionStorage.setItem(RELOADED_FROM, build);
  } catch {
    return false;
  }

  reload();
  return true;
}
