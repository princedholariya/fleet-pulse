import { Observable } from 'rxjs';
import { StreamTransport, TransportType } from './stream-transport.interface';
import { APP_CONFIG } from '../../config/app.config.constants';
import { StreamEvent } from '../../models/metric.model';

export class SseTransport implements StreamTransport {
  readonly type: TransportType = 'sse';
  private eventSource: EventSource | null = null;
  private isExplicitDisconnect = false;

  connect(token: string): Observable<string | StreamEvent> {
    this.isExplicitDisconnect = false;

    return new Observable<string | StreamEvent>((subscriber) => {
      const url = `${APP_CONFIG.stream.sseUrl}?access_token=${encodeURIComponent(token)}`;
      this.eventSource = new EventSource(url);

      const connectTimeoutTimer = setTimeout(() => {
        if (this.eventSource && this.eventSource.readyState !== EventSource.OPEN) {
          this.disconnect();
          subscriber.error(new Error('SSE connection timed out (exceeded 5s)'));
        }
      }, APP_CONFIG.stream.connectTimeoutMs);

      this.eventSource.onopen = () => {
        clearTimeout(connectTimeoutTimer);
      };

      // Listen for metric events
      this.eventSource.addEventListener('metric', (event: MessageEvent) => {
        subscriber.next(event.data);
      });

      // Listen for ping events
      this.eventSource.addEventListener('ping', (event: MessageEvent) => {
        subscriber.next(event.data);
      });

      this.eventSource.onerror = (error) => {
        clearTimeout(connectTimeoutTimer);
        if (!this.isExplicitDisconnect) {
          subscriber.error(error);
        }
      };

      return () => {
        this.disconnect();
      };
    });
  }

  disconnect(): void {
    this.isExplicitDisconnect = true;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  probe(token: string): Promise<boolean> {
    return new Promise((resolve) => {
      const url = `${APP_CONFIG.stream.sseUrl}?access_token=${encodeURIComponent(token)}`;
      let testEs: EventSource | null = null;
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          testEs?.close();
          resolve(false);
        }
      }, 3000);

      try {
        testEs = new EventSource(url);
        testEs.onopen = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            testEs?.close();
            resolve(true);
          }
        };
        testEs.onerror = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            testEs?.close();
            resolve(false);
          }
        };
      } catch {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(false);
        }
      }
    });
  }
}

