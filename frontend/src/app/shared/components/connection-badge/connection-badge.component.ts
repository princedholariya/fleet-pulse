import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StreamService } from '../../../core/stream/stream.service';

@Component({
  selector: 'app-connection-badge',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './connection-badge.component.html',
  styleUrls: ['./connection-badge.component.scss']
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
