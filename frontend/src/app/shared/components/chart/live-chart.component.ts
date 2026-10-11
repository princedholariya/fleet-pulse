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
  templateUrl: './live-chart.component.html',
  styleUrls: ['./live-chart.component.scss']
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
