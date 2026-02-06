import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAnalytics } from '../hooks/useAnalytics';

/**
 * Component that automatically tracks page views on route changes
 * Must be placed inside a Router component (BrowserRouter, etc.)
 *
 * This is a renderless component - it returns null and only handles side effects
 */
export const PageViewTracker: React.FC = () => {
  const location = useLocation();
  const { trackPageView } = useAnalytics();

  useEffect(() => {
    // Track page view whenever location changes
    // Combines pathname and search params for full URL tracking
    const fullPath = location.pathname + location.search;
    trackPageView(fullPath);
  }, [location.pathname, location.search, trackPageView]);

  return null;
};
