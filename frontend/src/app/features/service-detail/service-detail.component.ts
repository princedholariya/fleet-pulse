import { Component, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Subscription, switchMap, tap } from 'rxjs';
import { APP_CONFIG } from '../../core/config/app.config.constants';
import { MetricHistoryPoint, MetricHistoryResponse, MetricEvent } from '../../core/models/metric.model';
import { StreamService } from '../../core/stream/stream.service';
import { FleetService, EnrichedServiceItem } from '../../core/services/fleet.service';
import { LiveChartComponent, ChartDataPoint } from '../../shared/components/chart/live-chart.component';
import { ConnectionBadgeComponent } from '../../shared/components/connection-badge/connection-badge.component';
import { downsampleLTTB } from '../../core/utils/lttb';

@Component({
  selector: 'app-service-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, LiveChartComponent, ConnectionBadgeComponent],
  templateUrl: './service-detail.component.html',
  styleUrls: ['./service-detail.component.scss']
})
export class ServiceDetailComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  readonly streamService = inject(StreamService);
  private readonly fleetService = inject(FleetService);

  readonly serviceId = signal<string>('');
  readonly serviceInfo = signal<EnrichedServiceItem | null>(null);
  readonly selectedMinutes = signal<number>(15);
  readonly isLoading = signal<boolean>(true);

  // Raw accumulated history points for this service
  private rawHistoryPoints: MetricHistoryPoint[] = [];

  // Downsampled points signals for the 3 charts (guaranteed <= 300 points)
  readonly p95ChartPoints = signal<ChartDataPoint[]>([]);
  readonly errRateChartPoints = signal<ChartDataPoint[]>([]);
  readonly rpsChartPoints = signal<ChartDataPoint[]>([]);

  private paramSub: Subscription | null = null;
  private streamSub: Subscription | null = null;

  ngOnInit(): void {
    this.streamService.start();

    // Fast switching protection: route param changes immediately purge existing state
    this.paramSub = this.route.paramMap.pipe(
      tap((params) => {
        const id = params.get('id');
        if (!id) return;

        // Immediate reset to guarantee never showing previous service's data
        this.resetStateForNewService(id);
      }),
      switchMap((params) => {
        const id = params.get('id')!;
        return this.loadHistory(id, this.selectedMinutes());
      })
    ).subscribe({
      next: (response) => {
        this.rawHistoryPoints = response.points || [];
        this.updateChartsWithReduction();
        this.isLoading.set(false);
        this.listenToLiveStream();
      },
      error: (err) => {
        console.error('Failed to load service telemetry history:', err);
        this.isLoading.set(false);
      }
    });
  }

  private resetStateForNewService(id: string): void {
    this.serviceId.set(id);
    this.isLoading.set(true);
    this.rawHistoryPoints = [];
    this.p95ChartPoints.set([]);
    this.errRateChartPoints.set([]);
    this.rpsChartPoints.set([]);
    this.streamSub?.unsubscribe();
    this.streamSub = null;

    const info = this.fleetService.getServiceById(id);
    if (info) {
      this.serviceInfo.set(info);
    }
  }

  private loadHistory(id: string, minutes: number) {
    return this.http.get<MetricHistoryResponse>(
      `${APP_CONFIG.api.baseUrl}/metrics/history?serviceId=${encodeURIComponent(id)}&minutes=${minutes}`
    );
  }

  changeTimeRange(minutes: number): void {
    if (this.selectedMinutes() === minutes) return;
    this.selectedMinutes.set(minutes);
    this.isLoading.set(true);

    this.loadHistory(this.serviceId(), minutes).subscribe({
      next: (response) => {
        this.rawHistoryPoints = response.points || [];
        this.updateChartsWithReduction();
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      }
    });
  }

  private listenToLiveStream(): void {
    this.streamSub?.unsubscribe();
    this.streamSub = this.streamService.metricEvents$.subscribe((metric: MetricEvent) => {
      // Filter strictly for current serviceId
      if (metric.serviceId !== this.serviceId()) return;

      const newPoint: MetricHistoryPoint = {
        ts: metric.ts,
        p95: metric.p95,
        errRate: metric.errRate,
        rps: metric.rps
      };

      this.rawHistoryPoints.push(newPoint);

      // Prune points outside window
      const cutoff = Date.now() - (this.selectedMinutes() * 60 * 1000);
      while (this.rawHistoryPoints.length > 0 && this.rawHistoryPoints[0].ts < cutoff) {
        this.rawHistoryPoints.shift();
      }

      this.updateChartsWithReduction();
    });
  }

  private updateChartsWithReduction(): void {
    // Apply LTTB reduction down to max 300 points
    const maxThreshold = APP_CONFIG.charts.maxPointsPerSeries;
    const reduced = downsampleLTTB(this.rawHistoryPoints, maxThreshold);

    this.p95ChartPoints.set(reduced.map(p => ({ x: p.ts, y: p.p95 })));
    this.errRateChartPoints.set(reduced.map(p => ({ x: p.ts, y: p.errRate })));
    this.rpsChartPoints.set(reduced.map(p => ({ x: p.ts, y: p.rps })));
  }

  goBack(): void {
    this.router.navigate(['/']);
  }

  ngOnDestroy(): void {
    this.paramSub?.unsubscribe();
    this.streamSub?.unsubscribe();
  }
}

