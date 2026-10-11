import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StreamService } from '../../../core/stream/stream.service';

@Component({
  selector: 'app-connection-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="connection-badge"
      [ngClass]="badgeClass"
      role="status"
      aria-live="polite"
      [attr.aria-label]="'Connection status: ' + streamService.statusLabel()"
    >
      <span class="indicator-dot" aria-hidden="true"></span>
      <span class="status-text">{{ streamService.statusLabel() }}</span>

      @if (streamService.malformedEventCount() > 0) {
        <span class="metric-pill" title="Malformed frames dropped cleanly">
          Bad: {{ streamService.malformedEventCount() }}
        </span>
      }
      @if (streamService.gapRecoveriesCount() > 0) {
        <span class="metric-pill" title="Gaps filled via replay">
          Gaps: {{ streamService.gapRecoveriesCount() }}
        </span>
      }
    </div>
  `,
  styles: [`
    .connection-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 500;
      transition: all 0.25s ease;
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .indicator-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: #94a3b8;
    }

    /* Live WebSocket (Green Pulse) */
    .badge-live-ws {
      border-color: rgba(16, 185, 129, 0.4);
      background: rgba(16, 185, 129, 0.1);
      color: #34d399;
      .indicator-dot {
        background-color: #10b981;
        box-shadow: 0 0 8px #10b981;
      }
    }

    /* Live SSE (Cyan Pulse) */
    .badge-live-sse {
      border-color: rgba(6, 182, 212, 0.4);
      background: rgba(6, 182, 212, 0.1);
      color: #22d3ee;
      .indicator-dot {
        background-color: #06b6d4;
        box-shadow: 0 0 8px #06b6d4;
      }
    }

    /* Polling (Amber) */
    .badge-polling {
      border-color: rgba(245, 158, 11, 0.4);
      background: rgba(245, 158, 11, 0.1);
      color: #fbbf24;
      .indicator-dot {
        background-color: #f59e0b;
      }
    }

    /* Reconnecting (Warning Amber/Orange Pulse) */
    .badge-reconnecting {
      border-color: rgba(249, 115, 22, 0.4);
      background: rgba(249, 115, 22, 0.1);
      color: #fb923c;
      .indicator-dot {
        background-color: #f97316;
        animation: blink 1s ease-in-out infinite alternate;
      }
    }

    /* Offline (Red) */
    .badge-offline {
      border-color: rgba(239, 68, 68, 0.4);
      background: rgba(239, 68, 68, 0.1);
      color: #f87171;
      .indicator-dot {
        background-color: #ef4444;
      }
    }

    /* Stale Data */
    .badge-stale {
      border-color: rgba(234, 179, 8, 0.4);
      background: rgba(234, 179, 8, 0.1);
      color: #facc15;
      .indicator-dot {
        background-color: #eab308;
      }
    }

    .metric-pill {
      font-size: 0.7rem;
      background: rgba(0, 0, 0, 0.3);
      padding: 0.1rem 0.4rem;
      border-radius: 4px;
      color: #94a3b8;
    }

    @keyframes blink {
      from { opacity: 0.3; }
      to { opacity: 1; }
    }
  `]
})
export class ConnectionBadgeComponent {
  readonly streamService = inject(StreamService);

  get badgeClass(): string {
    const label = this.streamService.statusLabel();
    if (label.includes('WebSocket')) return 'badge-live-ws';
    if (label.includes('SSE')) return 'badge-live-sse';
    if (label.includes('Polling')) return 'badge-polling';
    if (label.includes('Reconnecting')) return 'badge-reconnecting';
    if (label.includes('Offline')) return 'badge-offline';
    if (label.includes('Stale')) return 'badge-stale';
    return '';
  }
}

