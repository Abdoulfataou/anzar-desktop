/**
 * useOffline Hook
 * Custom React hook for monitoring network connectivity
 * Detects offline status and slow connections (important for African context)
 */

import { useEffect, useState, useCallback } from 'react';
import { NetworkStatus } from '@/types';

/**
 * Return type for useOffline hook
 */
export interface UseOfflineReturn {
  /** Whether device is online */
  isOnline: boolean;

  /** Whether connection is slow */
  isSlowConnection: boolean;

  /** Network status details */
  networkStatus: NetworkStatus;

  /** Effective connection type */
  effectiveType?: 'slow-2g' | '2g' | '3g' | '4g' | '5g';

  /** Estimated download bandwidth in Mbps */
  downlink?: number;

  /** Round trip time in milliseconds */
  rtt?: number;
}

/**
 * Threshold for considering connection "slow"
 * Used for bandwidth saver mode optimization
 */
const SLOW_CONNECTION_THRESHOLD = 0.5; // Mbps — only flag truly slow connections

/**
 * useOffline Hook
 * Monitor network connectivity status
 *
 * Useful for:
 * - Disabling features when offline
 * - Enabling bandwidth saver mode on slow connections
 * - African context with variable connectivity
 *
 * @example
 * ```typescript
 * const { isOnline, isSlowConnection } = useOffline();
 *
 * return (
 *   <div>
 *     {!isOnline && <p>Vous êtes hors ligne</p>}
 *     {isSlowConnection && <p>Connexion lente détectée</p>}
 *   </div>
 * );
 * ```
 */
export function useOffline(): UseOfflineReturn {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    isSlowConnection: false,
  });

  /**
   * Check current network status using Navigator.connection API
   */
  const updateNetworkStatus = useCallback(() => {
    if (typeof navigator === 'undefined') return;

    const connection =
      (navigator as any).connection ||
      (navigator as any).mozConnection ||
      (navigator as any).webkitConnection;

    const isOnline = navigator.onLine;
    let isSlowConnection = false;
    let effectiveType: 'slow-2g' | '2g' | '3g' | '4g' | '5g' | undefined;
    let downlink: number | undefined;
    let rtt: number | undefined;

    if (connection) {
      effectiveType = connection.effectiveType;
      downlink = connection.downlink;
      rtt = connection.rtt;

      // Consider connection slow if:
      // 1. Effective type is 2g, 3g, or slow-2g, OR
      // 2. Downlink is below threshold
      // Only flag truly slow connections — '3g' in Tauri WebView is often
      // a false positive on desktop, so we only check 'slow-2g' / '2g' or very low downlink
      isSlowConnection =
        effectiveType === 'slow-2g' ||
        effectiveType === '2g' ||
        (downlink !== undefined && downlink > 0 && downlink < SLOW_CONNECTION_THRESHOLD);
    } else {
      // Fallback: use online status as indicator
      isSlowConnection = false;
    }

    setIsOnline(isOnline);
    setNetworkStatus({
      isOnline,
      isSlowConnection,
      effectiveType,
      downlink,
      rtt,
    });
  }, []);

  /**
   * Set up event listeners for online/offline and connection changes
   */
  useEffect(() => {
    // Check initial status
    updateNetworkStatus();

    // Listen for online/offline events
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);

    // Listen for connection type changes (if supported)
    const connection =
      (navigator as any).connection ||
      (navigator as any).mozConnection ||
      (navigator as any).webkitConnection;

    if (connection) {
      connection.addEventListener('change', updateNetworkStatus);

      return () => {
        window.removeEventListener('online', updateNetworkStatus);
        window.removeEventListener('offline', updateNetworkStatus);
        connection.removeEventListener('change', updateNetworkStatus);
      };
    }

    return () => {
      window.removeEventListener('online', updateNetworkStatus);
      window.removeEventListener('offline', updateNetworkStatus);
    };
  }, [updateNetworkStatus]);

  return {
    isOnline,
    isSlowConnection: networkStatus.isSlowConnection,
    networkStatus,
    effectiveType: networkStatus.effectiveType,
    downlink: networkStatus.downlink,
    rtt: networkStatus.rtt,
  };
}

/**
 * Hook that returns connection quality as a percentage
 * Useful for adjusting quality/resolution dynamically
 *
 * @returns Quality percentage (0-100)
 *
 * @example
 * ```typescript
 * const quality = useConnectionQuality();
 * // Returns 100 for 4g/5g, 50 for 3g, 25 for 2g, 0 for offline
 * ```
 */
export function useConnectionQuality(): number {
  const { isOnline, effectiveType } = useOffline();

  if (!isOnline) return 0;

  switch (effectiveType) {
    case '5g':
      return 100;
    case '4g':
      return 100;
    case '3g':
      return 50;
    case '2g':
      return 25;
    case 'slow-2g':
      return 10;
    default:
      return 100; // Assume good connection if type unknown
  }
}

/**
 * Hook to check if should enable bandwidth saver mode
 * Useful for African context with limited bandwidth
 *
 * @returns Whether bandwidth saver mode should be enabled
 *
 * @example
 * ```typescript
 * const shouldSaveBandwidth = useBandwidthSaver();
 * if (shouldSaveBandwidth) {
 *   // Load low-quality images, disable auto-play, etc.
 * }
 * ```
 */
export function useBandwidthSaver(): boolean {
  const { isSlowConnection, downlink } = useOffline();

  // Enable bandwidth saver if:
  // 1. Connection is slow, OR
  // 2. Downlink is below 1 Mbps
  return isSlowConnection || (downlink !== undefined && downlink < 1);
}
