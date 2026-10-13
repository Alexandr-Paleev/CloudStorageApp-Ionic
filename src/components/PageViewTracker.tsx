import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { startCollectorsOnABareAddress } from '../analytics/collectors';
import { useAnalytics } from '../hooks/useAnalytics';

/**
 * Tells Google Analytics which page is on screen, and is one of the two
 * places that start it. Must be inside the router. It renders nothing.
 *
 * A page is reported by its path and by nothing else. It used to be reported
 * with its query string, and an OAuth callback's code reached Google that
 * way, as the path of a page view. Decision 0015.
 */
export const PageViewTracker: React.FC = () => {
  const location = useLocation();
  const { trackPageView } = useAnalytics();

  /* Before the page view below, so that the first page seen on a bare
     address is counted. The collectors are not started on an address that
     has a query string or a fragment, and a change of route is one of the
     moments it may have lost them: `analytics/collectors.ts`. */
  useEffect(() => {
    startCollectorsOnABareAddress(location);
  }, [location]);

  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname, trackPageView]);

  return null;
};
