import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { StreamService } from '../../../core/stream/stream.service';
import { APP_CONFIG } from '../../../core/config/app.config.constants';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
  selector: 'app-chaos-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chaos-panel.component.html',
  styleUrls: ['./chaos-panel.component.scss']
})
export class ChaosPanelComponent {
  private readonly http = inject(HttpClient);
  readonly streamService = inject(StreamService);
  private readonly notificationService = inject(NotificationService);

  readonly isOpen = signal(false);

  toggleOpen(): void {
    this.isOpen.update(v => !v);
  }

  triggerDrill(payload: Record<string, unknown>): void {
    this.http.post(`${APP_CONFIG.api.baseUrl}/chaos`, payload).subscribe({
      next: () => {
        const keys = Object.keys(payload).map(k => `${k}=${payload[k]}`).join(', ');
        this.notificationService.show('Chaos Triggered', `Active switch: ${keys}`, 'warning');
      },
      error: (err) => {
        this.notificationService.show('Chaos Trigger Failed', err.message, 'critical');
      }
    });
  }

  resetAllChaos(): void {
    this.http.delete(`${APP_CONFIG.api.baseUrl}/chaos`).subscribe({
      next: () => {
        this.notificationService.show('Chaos Reset', 'All switches restored to healthy defaults', 'success');
      }
    });
  }
}

