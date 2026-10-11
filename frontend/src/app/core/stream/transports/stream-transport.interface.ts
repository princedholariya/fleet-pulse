import { Observable } from 'rxjs';
import { StreamEvent } from '../../models/metric.model';

export type TransportType = 'websocket' | 'sse' | 'polling';

export interface StreamTransport {
  readonly type: TransportType;
  /**
   * Connect to the stream using the provided access token.
   * Emits raw string or pre-parsed StreamEvent objects.
   */
  connect(token: string): Observable<string | StreamEvent>;
  /**
   * Disconnect and clean up resources immediately.
   */
  disconnect(): void;
  /**
   * Probe if the transport is currently available (used for climb-back).
   */
  probe(token: string): Promise<boolean>;
}

