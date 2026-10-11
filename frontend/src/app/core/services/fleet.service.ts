import { Injectable, inject, signal, DestroyRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { APP_CONFIG } from '../config/app.config.constants';
import { Microservice, MetricEvent, ServiceStatus } from '../models/metric.model';
import { StreamService } from '../stream/stream.service';

export interface EnrichedServiceItem extends Microservice {
  p95: number;
  errRate: number;
  rps: number;
  lastUpdatedTs: number;
  statusFlash?: ServiceStatus;
  statusFlashTimeout?: ReturnType<typeof setTimeout>;
}

@Injectable({
  providedIn: 'root'
})
export class FleetService {
  private readonly http = inject(HttpClient);
  private readonly streamService = inject(StreamService);
  private readonly destroyRef = inject(DestroyRef);

  // Map of serviceId -> EnrichedServiceItem for O(1) in-place lookups
  private readonly serviceMap = new Map<string, EnrichedServiceItem>();

  // Reactive Signal of all services list
  readonly servicesList = signal<EnrichedServiceItem[]>([]);
  readonly isInitialLoading = signal<boolean>(true);

  // Batching buffer to sustain 2,000 events/sec at 60 FPS
  private pendingUpdates = new Map<string, MetricEvent>();
  private rafScheduled = false;
  private streamSub: Subscription | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.streamSub?.unsubscribe();
      if (this.rafScheduled) {
        cancelAnimationFrame(this.rafId);
      }
    });
  }

  private rafId = 0;

  loadInitialFleet(): void {
    this.isInitialLoading.set(true);

    // 1. Fetch all 2,000 services
    this.http.get<Microservice[]>(`${APP_CONFIG.api.baseUrl}/services`).subscribe({
      next: (services) => {
        // 2. Fetch latest snapshot to populate metrics
        this.http.get<{ metrics: MetricEvent[] }>(`${APP_CONFIG.api.baseUrl}/metrics/snapshot`).subscribe({
          next: (snapshot) => {
            const metricsByService = new Map<string, MetricEvent>();
            if (Array.isArray(snapshot?.metrics)) {
              for (const m of snapshot.metrics) {
                metricsByService.set(m.serviceId, m);
              }
            }

            this.serviceMap.clear();
            const initialItems: EnrichedServiceItem[] = services.map((s) => {
              const metric = metricsByService.get(s.id);
              const enriched: EnrichedServiceItem = {
                ...s,
                p95: metric?.p95 ?? 80,
                errRate: metric?.errRate ?? 0.1,
                rps: metric?.rps ?? 1000,
                lastUpdatedTs: metric?.ts ?? Date.now(),
                status: metric?.status ?? s.status
              };
              this.serviceMap.set(s.id, enriched);
              return enriched;
            });

            this.servicesList.set(initialItems);
            this.isInitialLoading.set(false);

            // Subscribe to live stream updates
            this.listenToStream();
          },
          error: () => {
            // Fallback if snapshot fails
            this.isInitialLoading.set(false);
            this.listenToStream();
          }
        });
      },
      error: (err) => {
        console.error('Failed to load fleet services:', err);
        this.isInitialLoading.set(false);
      }
    });
  }

  private listenToStream(): void {
    this.streamSub?.unsubscribe();
    this.streamSub = this.streamService.metricEvents$.subscribe((metric) => {
      this.queueMetricUpdate(metric);
    });
  }

  // High-performance batching: coalesces updates per frame
  private queueMetricUpdate(metric: MetricEvent): void {
    this.pendingUpdates.set(metric.serviceId, metric);

    if (!this.rafScheduled) {
      this.rafScheduled = true;
      this.rafId = requestAnimationFrame(() => {
        this.flushPendingUpdates();
      });
    }
  }

  private flushPendingUpdates(): void {
    this.rafScheduled = false;
    if (this.pendingUpdates.size === 0) return;

    let hasChanges = false;

    for (const [serviceId, metric] of this.pendingUpdates.entries()) {
      const existing = this.serviceMap.get(serviceId);
      if (existing) {
        const previousStatus = existing.status;
        existing.p95 = metric.p95;
        existing.errRate = metric.errRate;
        existing.rps = metric.rps;
        existing.lastUpdatedTs = metric.ts;
        existing.status = metric.status;

        // Flash status cell if status changed
        if (previousStatus !== metric.status) {
          existing.statusFlash = metric.status;
          if (existing.statusFlashTimeout) {
            clearTimeout(existing.statusFlashTimeout);
          }
          existing.statusFlashTimeout = setTimeout(() => {
            existing.statusFlash = undefined;
          }, APP_CONFIG.table.statusFlashDurationMs);
        }

        hasChanges = true;
      }
    }

    this.pendingUpdates.clear();

    if (hasChanges) {
      // Trigger signal update with shallow copy of the existing array
      this.servicesList.set([...this.servicesList()]);
    }
  }

  getServiceById(id: string): EnrichedServiceItem | undefined {
    return this.serviceMap.get(id);
  }
}

