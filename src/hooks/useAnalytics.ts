import { useCallback, useRef } from 'react';
import ReactGA from 'react-ga4';
import { Capacitor } from '@capacitor/core';
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

/** Track whether Hotjar has been initialized */
let hotjarInitialized = false;

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
 * Initialize GA4 tracking
 * Only runs in production mode
 * Should be called once at app startup in main.tsx
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
    ReactGA.initialize(measurementId, {
      gaOptions: {
        // Anonymize IP for GDPR compliance
        anonymize_ip: true,
      },
    });
    ga4Initialized = true;
  });
}

/**
 * Initialize Hotjar tracking
 * Only runs on web platform (not native Capacitor apps)
 * Should be called once at app startup
 */
export function initializeHotjar(): void {
  if (hotjarInitialized) return;

  // Only load Hotjar on web, not on native mobile apps
  if (Capacitor.isNativePlatform()) {
    if (import.meta.env.DEV) {
      console.info('[Analytics] Hotjar skipped - running on native platform');
    }
    return;
  }

  // Only load in production
  if (import.meta.env.DEV) {
    console.info('[Analytics] Hotjar skipped - not in production mode');
    return;
  }

  const siteId = env.VITE_HOTJAR_SITE_ID;
  const version = env.VITE_HOTJAR_VERSION;

  if (!siteId) {
    return;
  }

  safeAnalyticsCall(() => {
    // Hotjar tracking code - using type assertions for the Hotjar global
    interface HotjarWindow extends Window {
      hj?: ((...args: unknown[]) => void) & { q?: unknown[] };
      _hjSettings?: { hjid: number; hjsv: number };
    }

    const hjWindow = window as HotjarWindow;
    const hjId = parseInt(siteId, 10);

    hjWindow.hj =
      hjWindow.hj ||
      function (...args: unknown[]) {
        (hjWindow.hj!.q = hjWindow.hj!.q || []).push(args);
      };
    hjWindow._hjSettings = { hjid: hjId, hjsv: version };

    const head = document.getElementsByTagName('head')[0];
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://static.hotjar.com/c/hotjar-${hjId}.js?sv=${version}`;
    head.appendChild(script);

    hotjarInitialized = true;
  });
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
  // Use refs to maintain stable function references
  const trackPageViewRef = useRef(trackPageView);
  trackPageViewRef.current = trackPageView;

  /**
   * Track page view
   */
  const handleTrackPageView = useCallback((path: string, title?: string) => {
    trackPageViewRef.current(path, title);
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
