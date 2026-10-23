import { useCallback } from 'react';
import ReactGA from 'react-ga4';

import { env } from '../env';
import type {
  UploadFileEvent,
  DeleteFileEvent,
  ShareFileEvent,
  ApiErrorEvent,
  CreateFolderEvent,
  DeleteFolderEvent,
  RenameFileEvent,
} from '../types/analytics.types';

/** Track whether GA4 has been initialized */
let ga4Initialized = false;

/**
 * Safely execute analytics calls - prevents crashes from ad-blockers
 */
function safeAnalyticsCall<T>(fn: () => T, fallback?: T): T | undefined {
  try {
    return fn();
  } catch (error) {
    // Silently fail - analytics should never crash the app
    if (import.meta.env.DEV) {
      console.warn('[Analytics] Call failed (possibly blocked):', error);
    }
    return fallback;
  }
}

/**
 * Starts GA4, in production only, and reports the page it starts on. Called
 * by `analytics/collectors.ts` once the visitor has said yes and the address
 * is bare (decision 0015).
 *
 * GA4 sends no page view of its own. Left to itself it sends one as it
 * starts and another on every change of the history, and beside
 * PageViewTracker's that counted each move between pages twice. The app
 * sends one per page: this one, for the page GA4 starts on, whose report
 * from PageViewTracker came before GA4 was running and went nowhere, and
 * PageViewTracker's on every change of route after it.
 */
export function initializeGA4(): void {
  if (ga4Initialized) return;

  // Only load in production
  if (import.meta.env.DEV) {
    console.info('[Analytics] GA4 skipped - not in production mode');
    return;
  }

  const measurementId = env.VITE_GA4_MEASUREMENT_ID;
  if (!measurementId) {
    return;
  }

  safeAnalyticsCall(() => {
    // No `anonymize_ip`: that was Universal Analytics. GA4 does not log or
    // store IP addresses, and the option reached it with every event as a
    // parameter of its own.
    ReactGA.initialize(measurementId, { gtagOptions: { send_page_view: false } });
    ga4Initialized = true;
  });

  trackPageView(window.location.pathname);
}

/**
 * Track a page view in GA4
 */
function trackPageView(path: string, title?: string): void {
  if (!ga4Initialized) return;

  safeAnalyticsCall(() => {
    ReactGA.send({
      hitType: 'pageview',
      page: path,
      title: title || document.title,
    });
  });
}

/**
 * Track a custom event in GA4
 */
function trackEvent(eventName: string, params: Record<string, unknown>): void {
  if (!ga4Initialized) return;

  safeAnalyticsCall(() => {
    ReactGA.event(eventName, params);
  });
}

/**
 * Custom hook for analytics tracking
 * Provides type-safe methods for tracking various events
 */
export function useAnalytics() {
  /**
   * Track page view
   *
   * The ref that used to sit here — assigned on every render to keep a
   * "stable function reference" — was guarding nothing: `trackPageView` is
   * declared at module scope and has one identity for the life of the module.
   * Writing a ref during render is the thing React asks you not to do, and it
   * bought a level of indirection over a constant. The other seven trackers in
   * this hook call `trackEvent` directly; this one now matches them.
   */
  const handleTrackPageView = useCallback((path: string, title?: string) => {
    trackPageView(path, title);
  }, []);

  /**
   * Track file upload event
   */
  const trackFileUpload = useCallback((params: UploadFileEvent) => {
    trackEvent('upload_file', {
      file_type: params.file_type,
      file_size: params.file_size,
      storage_provider: params.storage_provider,
      folder_id: params.folder_id,
    });
  }, []);

  /**
   * Track file delete event
   */
  const trackFileDelete = useCallback((params: DeleteFileEvent) => {
    trackEvent('delete_file', {
      file_id: params.file_id,
      file_type: params.file_type,
      file_size: params.file_size,
    });
  }, []);

  /**
   * Track file share event
   */
  const trackFileShare = useCallback((params: ShareFileEvent) => {
    trackEvent('share_file', {
      file_id: params.file_id,
      share_method: params.share_method,
    });
  }, []);

  /**
   * Track API error event
   */
  const trackApiError = useCallback((params: ApiErrorEvent) => {
    trackEvent('api_error', {
      error_message: params.error_message,
      endpoint: params.endpoint,
      query_key: params.query_key,
    });
  }, []);

  /**
   * Track folder creation event
   */
  const trackFolderCreate = useCallback((params: CreateFolderEvent) => {
    trackEvent('create_folder', {
      parent_id: params.parent_id,
    });
  }, []);

  /**
   * Track folder deletion event
   */
  const trackFolderDelete = useCallback((params: DeleteFolderEvent) => {
    trackEvent('delete_folder', {
      folder_id: params.folder_id,
    });
  }, []);

  /**
   * Track file rename event
   */
  const trackFileRename = useCallback((params: RenameFileEvent) => {
    trackEvent('rename_file', {
      file_id: params.file_id,
    });
  }, []);

  return {
    trackPageView: handleTrackPageView,
    trackFileUpload,
    trackFileDelete,
    trackFileShare,
    trackApiError,
    trackFolderCreate,
    trackFolderDelete,
    trackFileRename,
  };
}

/**
 * Standalone function to track API errors from TanStack Query
 * Can be used outside of React components (e.g., in QueryClient configuration)
 */
export function trackApiErrorStandalone(params: ApiErrorEvent): void {
  if (!ga4Initialized) return;

  safeAnalyticsCall(() => {
    ReactGA.event('api_error', {
      error_message: params.error_message,
      endpoint: params.endpoint,
      query_key: params.query_key,
    });
  });
}
