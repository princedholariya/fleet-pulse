import { Injectable, signal } from '@angular/core';

export interface ToastMessage {
  id: string;
  title: string;
  message: string;
  type: 'critical' | 'warning' | 'info' | 'success';
  timestamp: number;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  readonly toasts = signal<ToastMessage[]>([]);

  show(title: string, message: string, type: ToastMessage['type'] = 'info', durationMs = 5000): void {
    const toast: ToastMessage = {
      id: `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      title,
      message,
      type,
      timestamp: Date.now()
    };

    this.toasts.update(list => [toast, ...list].slice(0, 5));

    if (durationMs > 0) {
      setTimeout(() => {
        this.dismiss(toast.id);
      }, durationMs);
    }
  }

  dismiss(id: string): void {
    this.toasts.update(list => list.filter(t => t.id !== id));
  }
}

