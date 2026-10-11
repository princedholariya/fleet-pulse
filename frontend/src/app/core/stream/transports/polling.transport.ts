import { Observable } from 'rxjs';
import { StreamTransport, TransportType } from './stream-transport.interface';
import { APP_CONFIG } from '../../config/app.config.constants';
import { StreamEvent, MetricSnapshot } from '../../models/metric.model';

export class PollingTransport implements StreamTransport {
  readonly type: TransportType = 'polling';
  private timerId: ReturnType<typeof setInterval> | null = null;
  private isExplicitDisconnect = false;

  connect(token: string): Observable<string | StreamEvent> {
    this.isExplicitDisconnect = false;

    return new Observable<string | StreamEvent>((subscriber) => {
      const poll = async () => {
        if (this.isExplicitDisconnect) return;

        try {
          const res = await fetch(APP_CONFIG.stream.pollingUrl, {
            headers: {
              Authorization: `Bearer ${token}`
            }
          });

          if (!res.ok) {
            if (res.status === 401) {
              subscriber.error(new Error('AUTH_FAILED'));
              return;
            }
            throw new Error(`HTTP Polling failed with status ${res.status}`);
          }

          const snapshot: MetricSnapshot = await res.json();
          // Emit a ping for heartbeat
          subscriber.next({ type: 'ping', ts: snapshot.ts });

          // Emit each metric event from snapshot
          if (Array.isArray(snapshot.metrics)) {
            for (const metric of snapshot.metrics) {
              subscriber.next(metric);
            }
          }
        } catch (error) {
          if (!this.isExplicitDisconnect) {
            subscriber.error(error);
          }
        }
      };

      // Immediate first poll
      poll();
      // Repeating poll every 2s
      this.timerId = setInterval(poll, APP_CONFIG.stream.pollingIntervalMs);

      return () => {
        this.disconnect();
      };
    });
  }

  disconnect(): void {
    this.isExplicitDisconnect = true;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  async probe(token: string): Promise<boolean> {
    try {
      const res = await fetch(APP_CONFIG.stream.pollingUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

