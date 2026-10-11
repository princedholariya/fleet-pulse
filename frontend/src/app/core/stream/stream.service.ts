import { Injectable, inject, signal, computed, DestroyRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subject, Subscription } from 'rxjs';
import { APP_CONFIG } from '../config/app.config.constants';
import { AuthService } from '../auth/auth.service';
import { StreamEvent, MetricEvent, MetricReplayResponse, MetricSnapshot } from '../models/metric.model';
import { StreamTransport, TransportType } from './transports/stream-transport.interface';
import { WebSocketTransport } from './transports/websocket.transport';
import { SseTransport } from './transports/sse.transport';
import { PollingTransport } from './transports/polling.transport';

export type ConnectionState = 'live' | 'reconnecting' | 'offline' | 'idle';

@Injectable({
  providedIn: 'root'
})
export class StreamService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  // Available Transport implementations (pluggable architecture)
  private readonly transports: Record<TransportType, StreamTransport> = {
    websocket: new WebSocketTransport(),
    sse: new SseTransport(),
    polling: new PollingTransport()
  };

  // State Signals
  readonly currentTransport = signal<TransportType>('websocket');
  readonly connectionState = signal<ConnectionState>('idle');
  readonly reconnectCountdownSec = signal<number>(0);
  readonly isBrowserOffline = signal<boolean>(typeof navigator !== 'undefined' ? !navigator.onLine : false);
  readonly lastEventTime = signal<number>(Date.now());
  readonly isStale = signal<boolean>(false);
  readonly tickerSec = signal<number>(0);
  readonly malformedEventCount = signal<number>(0);
  readonly gapRecoveriesCount = signal<number>(0);

  // Formatted status string for toolbar
  readonly statusLabel = computed<string>(() => {
    if (this.isBrowserOffline()) {
      return 'Offline';
    }

    const state = this.connectionState();
    if (state === 'reconnecting') {
      const sec = this.reconnectCountdownSec();
      return `Reconnecting in ${sec} s`;
    }

    if (this.isStale()) {
      this.tickerSec(); // Reactive subscription to 1s tick
      const elapsed = Math.max(10, Math.round((Date.now() - this.lastEventTime()) / 1000));
      return `Stale: last event ${elapsed} s ago`;
    }

    const transport = this.currentTransport();
    if (transport === 'websocket') return 'Live (WebSocket)';
    if (transport === 'sse') return 'Live (SSE)';
    return 'Polling';
  });

  // Public Event Streams
  private readonly metricEventSubject = new Subject<MetricEvent>();
  readonly metricEvents$ = this.metricEventSubject.asObservable();

  // Internal Management Variables
  private activeSubscription: Subscription | null = null;
  private consecutiveFailures = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private climbBackTimer: ReturnType<typeof setInterval> | null = null;
  private staleCheckTimer: ReturnType<typeof setInterval> | null = null;

  private lastHeartbeatPingTs = Date.now();
  private lastProcessedOffset = 0;
  private seenOffsets = new Set<number>();
  private readonly recentOffsetsWindow: number[] = [];
  private readonly maxSeenOffsetsWindow = 10000;

  // 1-second out-of-order reorder buffer
  private reorderBuffer: MetricEvent[] = [];
  private reorderFlushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.initBrowserNetworkListeners();
    this.startHeartbeatWatcher();
    this.startStaleChecker();
    this.startClimbBackWatcher();

    this.destroyRef.onDestroy(() => {
      this.stop();
    });
  }

  start(): void {
    const token = this.authService.getAccessToken();
    if (!token) return;

    if (this.isBrowserOffline()) {
      this.connectionState.set('offline');
      return;
    }

    this.connectCurrentTransport();
  }

  stop(): void {
    this.clearAllTimers();
    this.activeSubscription?.unsubscribe();
    this.activeSubscription = null;
    this.transports[this.currentTransport()].disconnect();
    this.connectionState.set('idle');
  }

  private connectCurrentTransport(): void {
    const token = this.authService.getAccessToken();
    if (!token) {
      this.connectionState.set('idle');
      return;
    }

    this.activeSubscription?.unsubscribe();
    const transport = this.transports[this.currentTransport()];

    this.lastHeartbeatPingTs = Date.now();

    this.activeSubscription = transport.connect(token).subscribe({
      next: (rawMessage) => {
        this.consecutiveFailures = 0;
        this.reconnectAttempt = 0;
        this.connectionState.set('live');
        this.processIncomingMessage(rawMessage);
      },
      error: (err) => {
        this.handleTransportFailure(err);
      },
      complete: () => {
        this.handleTransportFailure(new Error('Stream completed unexpectedly'));
      }
    });
  }

  private handleTransportFailure(error: unknown): void {
    console.warn(`[StreamService] Error on ${this.currentTransport()}:`, error);

    this.activeSubscription?.unsubscribe();
    this.activeSubscription = null;
    this.transports[this.currentTransport()].disconnect();

    if (this.isBrowserOffline()) {
      this.connectionState.set('offline');
      return;
    }

    this.consecutiveFailures++;

    // Fallback logic
    if (this.currentTransport() === 'websocket') {
      if (this.consecutiveFailures >= APP_CONFIG.stream.consecutiveFailuresBeforeFallback) {
        console.info('[StreamService] WebSocket failed 3 times. Falling back to SSE.');
        this.currentTransport.set('sse');
        this.consecutiveFailures = 0;
      }
    } else if (this.currentTransport() === 'sse') {
      if (this.consecutiveFailures >= APP_CONFIG.stream.consecutiveFailuresBeforeFallback) {
        console.info('[StreamService] SSE failed 3 times. Falling back to HTTP Polling.');
        this.currentTransport.set('polling');
        this.consecutiveFailures = 0;
      }
    }

    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.connectionState.set('reconnecting');
    this.reconnectAttempt++;

    // Exponential backoff with jitter up to 30s
    const baseDelay = APP_CONFIG.stream.reconnectBackoffBaseMs * Math.pow(2, Math.min(this.reconnectAttempt - 1, 5));
    const cappedDelay = Math.min(baseDelay, APP_CONFIG.stream.reconnectBackoffMaxMs);
    const jitter = cappedDelay * APP_CONFIG.stream.reconnectJitterPct * (Math.random() * 2 - 1);
    const delayMs = Math.max(1000, Math.round(cappedDelay + jitter));

    let remainingSeconds = Math.ceil(delayMs / 1000);
    this.reconnectCountdownSec.set(remainingSeconds);

    if (this.countdownInterval) clearInterval(this.countdownInterval);
    this.countdownInterval = setInterval(() => {
      remainingSeconds--;
      if (remainingSeconds <= 0) {
        if (this.countdownInterval) clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }
      this.reconnectCountdownSec.set(Math.max(0, remainingSeconds));
    }, 1000);

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.countdownInterval) clearInterval(this.countdownInterval);
      this.countdownInterval = null;
      this.connectCurrentTransport();
    }, delayMs);
  }

  // Periodic Probe to Climb Back Up to Higher Transports
  private startClimbBackWatcher(): void {
    this.climbBackTimer = setInterval(async () => {
      const current = this.currentTransport();
      const token = this.authService.getAccessToken();
      if (!token || current === 'websocket' || this.isBrowserOffline()) return;

      if (current === 'sse') {
        const canUseWs = await this.transports.websocket.probe(token);
        if (canUseWs) {
          console.info('[StreamService] WebSocket probe succeeded! Climbing back up to WebSocket.');
          this.switchTransport('websocket');
        }
      } else if (current === 'polling') {
        // Try WebSocket first, then SSE
        const canUseWs = await this.transports.websocket.probe(token);
        if (canUseWs) {
          console.info('[StreamService] WebSocket probe succeeded! Climbing back up to WebSocket.');
          this.switchTransport('websocket');
        } else {
          const canUseSse = await this.transports.sse.probe(token);
          if (canUseSse) {
            console.info('[StreamService] SSE probe succeeded! Climbing back up to SSE.');
            this.switchTransport('sse');
          }
        }
      }
    }, APP_CONFIG.stream.climbBackIntervalMs);
  }

  switchTransport(newTransport: TransportType): void {
    if (this.currentTransport() === newTransport) return;
    this.stop();
    this.currentTransport.set(newTransport);
    this.consecutiveFailures = 0;
    this.reconnectAttempt = 0;
    this.connectCurrentTransport();
  }

  // Inbound Payload Processing with Malformed Protection & Heartbeat
  private processIncomingMessage(raw: string | StreamEvent): void {
    let event: StreamEvent;

    if (typeof raw === 'string') {
      try {
        event = JSON.parse(raw);
      } catch {
        this.malformedEventCount.update(c => c + 1);
        return; // Malformed JSON dropped cleanly without crashing stream
      }
    } else {
      event = raw;
    }

    if (!event || typeof event !== 'object' || !('type' in event)) {
      this.malformedEventCount.update(c => c + 1);
      return;
    }

    // Heartbeat ping handling
    if (event.type === 'ping') {
      this.lastHeartbeatPingTs = Date.now();
      return;
    }

    if (event.type === 'metric') {
      // Validate essential required fields
      if (!event.serviceId || typeof event.seq !== 'number' || typeof event.offset !== 'number' || !event.status) {
        this.malformedEventCount.update(c => c + 1);
        return;
      }

      this.lastEventTime.set(Date.now());
      this.isStale.set(false);
      this.handleMetricEventIntegrity(event);
    }
  }

  // Data Integrity Pipeline (Deduplication, 1-second Reorder Buffer & Gap Detection)
  private handleMetricEventIntegrity(event: MetricEvent): void {
    // 1. Deduplication check
    if (this.seenOffsets.has(event.offset)) {
      return; // Duplicate dropped cleanly
    }

    this.seenOffsets.add(event.offset);
    this.recentOffsetsWindow.push(event.offset);
    if (this.recentOffsetsWindow.length > this.maxSeenOffsetsWindow) {
      const removed = this.recentOffsetsWindow.shift();
      if (removed !== undefined) {
        this.seenOffsets.delete(removed);
      }
    }

    // 2. Add to 1-second out-of-order buffer
    this.reorderBuffer.push(event);

    if (!this.reorderFlushTimer) {
      this.reorderFlushTimer = setTimeout(() => {
        this.flushReorderBuffer();
      }, 50); // Flush frequently while keeping ordered window
    }
  }

  private flushReorderBuffer(): void {
    this.reorderFlushTimer = null;
    if (this.reorderBuffer.length === 0) return;

    // Sort buffer by offset ascending
    this.reorderBuffer.sort((a, b) => a.offset - b.offset);

    const now = Date.now();
    const remaining: MetricEvent[] = [];

    for (const evt of this.reorderBuffer) {
      if (this.lastProcessedOffset === 0) {
        this.lastProcessedOffset = evt.offset;
        this.metricEventSubject.next(evt);
        continue;
      }

      // Check for stream gap
      if (this.lastProcessedOffset > 0 && evt.offset > this.lastProcessedOffset + 1) {
        // Gap detected! Trigger replay
        this.recoverGap(this.lastProcessedOffset);
      }

      // If event is in sequence, or buffered for > 1000ms, dispatch
      const age = now - evt.ts;
      if (evt.offset <= this.lastProcessedOffset + 1 || age >= APP_CONFIG.stream.reorderBufferMs) {
        this.lastProcessedOffset = Math.max(this.lastProcessedOffset, evt.offset);
        this.metricEventSubject.next(evt);
      } else {
        remaining.push(evt);
      }
    }

    this.reorderBuffer = remaining;

    if (this.reorderBuffer.length > 0) {
      this.reorderFlushTimer = setTimeout(() => this.flushReorderBuffer(), 50);
    }
  }

  // Gap Recovery Protocol (R2.3)
  private recoverGap(sinceOffset: number): void {
    this.gapRecoveriesCount.update(c => c + 1);
    console.info(`[StreamService] Gap detected above offset ${sinceOffset}. Invoking /metrics/replay...`);

    this.http.get<MetricReplayResponse>(`${APP_CONFIG.api.baseUrl}/metrics/replay?since=${sinceOffset}`).subscribe({
      next: (replay) => {
        if (replay && Array.isArray(replay.events)) {
          for (const evt of replay.events) {
            if (!this.seenOffsets.has(evt.offset)) {
              this.seenOffsets.add(evt.offset);
              this.metricEventSubject.next(evt);
              this.lastProcessedOffset = Math.max(this.lastProcessedOffset, evt.offset);
            }
          }
        }
      },
      error: (err) => {
        // If 410 replay_too_old, reload full snapshot
        if (err.status === 410) {
          console.warn('[StreamService] Replay buffer expired (410). Fetching complete snapshot...');
          this.reloadFullSnapshot();
        }
      }
    });
  }

  reloadFullSnapshot(): void {
    this.http.get<MetricSnapshot>(`${APP_CONFIG.api.baseUrl}/metrics/snapshot`).subscribe({
      next: (snapshot) => {
        if (snapshot && Array.isArray(snapshot.metrics)) {
          this.lastProcessedOffset = snapshot.offset;
          for (const metric of snapshot.metrics) {
            this.seenOffsets.add(metric.offset);
            this.metricEventSubject.next(metric);
          }
        }
      }
    });
  }

  // Heartbeat Checker (5s ping, 2 missed pings = 10s -> dead connection)
  private startHeartbeatWatcher(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.connectionState() !== 'live') return;

      const elapsed = Date.now() - this.lastHeartbeatPingTs;
      if (elapsed > APP_CONFIG.stream.heartbeatIntervalMs * APP_CONFIG.stream.missedPingsBeforeDead) {
        console.warn(`[StreamService] Two missed pings detected (${elapsed}ms). Flagging connection dead.`);
        this.handleTransportFailure(new Error('Heartbeat dead (2 missed pings)'));
      }
    }, 2500);
  }

  // Stale Data Checker (Data older than 10s marked stale)
  private startStaleChecker(): void {
    this.staleCheckTimer = setInterval(() => {
      this.tickerSec.update(t => t + 1);
      const elapsed = Date.now() - this.lastEventTime();
      if (elapsed > APP_CONFIG.stream.staleDataThresholdMs) {
        this.isStale.set(true);
      } else {
        this.isStale.set(false);
      }
    }, 1000);
  }

  // Browser Online/Offline Event Listeners
  private initBrowserNetworkListeners(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('online', () => {
      console.info('[StreamService] Browser came online.');
      this.isBrowserOffline.set(false);
      this.scheduleReconnect();
    });

    window.addEventListener('offline', () => {
      console.warn('[StreamService] Browser went offline.');
      this.isBrowserOffline.set(true);
      this.stop();
      this.connectionState.set('offline');
    });
  }

  private clearAllTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.countdownInterval) clearInterval(this.countdownInterval);
    if (this.reorderFlushTimer) clearTimeout(this.reorderFlushTimer);
    this.reconnectTimer = null;
    this.countdownInterval = null;
    this.reorderFlushTimer = null;
  }
}

