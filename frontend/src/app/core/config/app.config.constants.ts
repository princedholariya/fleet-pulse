/**
 * Centralized Application Configuration & Constants
 * Eliminates scattered magic numbers throughout the codebase.
 */
export const APP_CONFIG = {
  api: {
    baseUrl: 'http://localhost:4000',
    secondaryUrl: 'http://localhost:4001',
    requestTimeoutMs: 10000,
    maxRetries: 3,
    retryDelayBaseMs: 1000,
    retryableStatusCodes: [502, 503, 504, 429] as const,
  },
  stream: {
    wsUrl: 'ws://localhost:4000/stream',
    sseUrl: 'http://localhost:4000/stream/sse',
    pollingUrl: 'http://localhost:4000/metrics/snapshot',
    pollingIntervalMs: 2000,
    connectTimeoutMs: 5000,
    consecutiveFailuresBeforeFallback: 3,
    climbBackIntervalMs: 30000,
    reconnectBackoffMaxMs: 30000,
    reconnectBackoffBaseMs: 1000,
    reconnectJitterPct: 0.25,
    heartbeatIntervalMs: 5000,
    missedPingsBeforeDead: 2, // 2 missed pings (10s) = dead
    staleDataThresholdMs: 10000, // Data > 10s is marked stale
    reorderBufferMs: 1000, // Buffer out-of-order events up to 1 second
  },
  charts: {
    maxPointsPerSeries: 300,
    historyDefaultMinutes: 15,
  },
  table: {
    itemSizePx: 48,
    viewportBufferSize: 10,
    statusFlashDurationMs: 600,
  }
} as const;

