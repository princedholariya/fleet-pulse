import { Component, Input, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface ChartDataPoint {
  x: number; // timestamp
  y: number; // metric value
}

@Component({
  selector: 'app-live-chart',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chart-wrapper">
      <div class="chart-header">
        <div class="chart-title-area">
          <span class="chart-title">{{ title }}</span>
          <span class="chart-unit">{{ unit }}</span>
        </div>
        <div class="chart-current-value" [style.color]="strokeColor">
          {{ latestValue() !== null ? (latestValue() | number:'1.0-2') + ' ' + unit : '—' }}
        </div>
      </div>

      @if (hasError()) {
        <div class="chart-error-panel" role="alert">
          <p class="error-msg">⚠️ Unable to render telemetry chart</p>
          <button type="button" class="btn-retry" (click)="retry()">Retry Rendering</button>
        </div>
      } @else if (points().length === 0) {
        <div class="chart-loading-panel">
          <span class="spinner"></span>
          <span>Loading telemetry series...</span>
        </div>
      } @else {
        <svg
          class="chart-svg"
          viewBox="0 0 600 200"
          preserveAspectRatio="none"
          role="img"
          [attr.aria-label]="title + ' live chart'"
        >
          <defs>
            <linearGradient [id]="gradientId" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" [attr.stop-color]="strokeColor" stop-opacity="0.35" />
              <stop offset="100%" [attr.stop-color]="strokeColor" stop-opacity="0.0" />
            </linearGradient>
          </defs>

          <!-- Horizontal Grid Lines -->
          <line x1="0" y1="20" x2="600" y2="20" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3 3" />
          <line x1="0" y1="100" x2="600" y2="100" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3 3" />
          <line x1="0" y1="180" x2="600" y2="180" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3 3" />

          <!-- Fill Area -->
          <polygon [attr.points]="areaPath()" [attr.fill]="'url(#' + gradientId + ')'" />

          <!-- Stroke Path -->
          <polyline
            [attr.points]="polylinePoints()"
            fill="none"
            [attr.stroke]="strokeColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>

        <div class="chart-footer">
          <span class="y-label min-label">{{ minValue() | number:'1.0-1' }}</span>
          <span class="point-count">{{ points().length }} points (LTTB reduced)</span>
          <span class="y-label max-label">{{ maxValue() | number:'1.0-1' }}</span>
        </div>
      }
    </div>
  `,
  styles: [`
    .chart-wrapper {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      padding: 1rem 1.25rem;
      display: flex;
      flex-direction: column;
      height: 260px;
    }

    .chart-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 0.75rem;

      .chart-title {
        font-size: 0.9rem;
        font-weight: 600;
        color: #f1f5f9;
        margin-right: 0.5rem;
      }

      .chart-unit {
        font-size: 0.75rem;
        color: var(--text-dim);
      }

      .chart-current-value {
        font-size: 1.25rem;
        font-weight: 700;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
    }

    .chart-svg {
      flex: 1;
      width: 100%;
      height: 100%;
      overflow: visible;
    }

    .chart-footer {
      display: flex;
      justify-content: space-between;
      font-size: 0.7rem;
      color: var(--text-dim);
      margin-top: 0.5rem;
      font-family: ui-monospace, monospace;
    }

    .chart-error-panel, .chart-loading-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      color: var(--text-muted);
      font-size: 0.85rem;
    }

    .chart-error-panel {
      background: rgba(239, 68, 68, 0.05);
      border-radius: 8px;
      .error-msg { margin: 0; color: #fca5a5; }
    }

    .btn-retry {
      padding: 0.35rem 0.75rem;
      font-size: 0.8rem;
      font-weight: 500;
      color: #fff;
      background: #334155;
      border: 1px solid #475569;
      border-radius: 6px;
      cursor: pointer;
      &:hover { background: #475569; }
    }

    .spinner {
      width: 24px;
      height: 24px;
      border: 2px solid rgba(255, 255, 255, 0.15);
      border-top-color: #38bdf8;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `]
})
export class LiveChartComponent {
  @Input() title = 'Metric Series';
  @Input() unit = '';
  @Input() strokeColor = '#38bdf8';
  @Input() gradientId = 'grad-' + Math.random().toString(36).substring(2);

  readonly points = signal<ChartDataPoint[]>([]);
  readonly hasError = signal<boolean>(false);

  @Input() set data(value: ChartDataPoint[]) {
    try {
      if (!Array.isArray(value)) {
        this.hasError.set(true);
        return;
      }
      this.hasError.set(false);
      this.points.set(value);
    } catch {
      this.hasError.set(true);
    }
  }

  readonly latestValue = computed<number | null>(() => {
    const pts = this.points();
    if (pts.length === 0) return null;
    return pts[pts.length - 1].y;
  });

  readonly minValue = computed<number>(() => {
    const pts = this.points();
    if (pts.length === 0) return 0;
    return Math.min(...pts.map(p => p.y));
  });

  readonly maxValue = computed<number>(() => {
    const pts = this.points();
    if (pts.length === 0) return 100;
    const max = Math.max(...pts.map(p => p.y));
    return max === this.minValue() ? max + 10 : max;
  });

  readonly polylinePoints = computed<string>(() => {
    const pts = this.points();
    if (pts.length < 2) return '';

    const min = this.minValue();
    const max = this.maxValue();
    const range = max - min || 1;

    const width = 600;
    const height = 180;
    const padding = 10;

    return pts.map((p, idx) => {
      const x = (idx / (pts.length - 1)) * width;
      const normalizedY = (p.y - min) / range;
      const y = height - (normalizedY * (height - 2 * padding)) - padding;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  });

  readonly areaPath = computed<string>(() => {
    const line = this.polylinePoints();
    if (!line) return '';
    return `0,200 ${line} 600,200`;
  });

  retry(): void {
    this.hasError.set(false);
  }
}

