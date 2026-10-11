import { Observable } from 'rxjs';
import { StreamTransport, TransportType } from './stream-transport.interface';
import { APP_CONFIG } from '../../config/app.config.constants';
import { StreamEvent } from '../../models/metric.model';

export class WebSocketTransport implements StreamTransport {
  readonly type: TransportType = 'websocket';
  private ws: WebSocket | null = null;
  private isExplicitDisconnect = false;

  connect(token: string): Observable<string | StreamEvent> {
    this.isExplicitDisconnect = false;

    return new Observable<string | StreamEvent>((subscriber) => {
      const url = `${APP_CONFIG.stream.wsUrl}?access_token=${encodeURIComponent(token)}`;
      this.ws = new WebSocket(url);

      const connectTimeoutTimer = setTimeout(() => {
        if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
          this.ws.close();
          subscriber.error(new Error('WebSocket connection timed out (exceeded 5s)'));
        }
      }, APP_CONFIG.stream.connectTimeoutMs);

      this.ws.onopen = () => {
        clearTimeout(connectTimeoutTimer);
      };

      this.ws.onmessage = (event: MessageEvent) => {
        subscriber.next(event.data);
      };

      this.ws.onerror = (error) => {
        clearTimeout(connectTimeoutTimer);
        if (!this.isExplicitDisconnect) {
          subscriber.error(error);
        }
      };

      this.ws.onclose = (event: CloseEvent) => {
        clearTimeout(connectTimeoutTimer);
        if (!this.isExplicitDisconnect) {
          if (event.code === 4401) {
            subscriber.error(new Error('AUTH_FAILED'));
          } else {
            subscriber.error(new Error(`WebSocket closed unexpectedly with code ${event.code}`));
          }
        } else {
          subscriber.complete();
        }
      };

      return () => {
        this.disconnect();
      };
    });
  }

  disconnect(): void {
    this.isExplicitDisconnect = true;
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  probe(token: string): Promise<boolean> {
    return new Promise((resolve) => {
      const url = `${APP_CONFIG.stream.wsUrl}?access_token=${encodeURIComponent(token)}`;
      let testWs: WebSocket | null = null;
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          testWs?.close();
          resolve(false);
        }
      }, 3000);

      try {
        testWs = new WebSocket(url);
        testWs.onopen = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            testWs?.close();
            resolve(true);
          }
        };
        testWs.onerror = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
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

