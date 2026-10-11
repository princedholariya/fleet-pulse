import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { StreamService } from './stream.service';
import { AuthService } from '../auth/auth.service';
import { MetricEvent } from '../models/metric.model';

describe('Stream Resilience & Sequence Handling (Unit Test)', () => {
  let streamService: StreamService;
  let authServiceSpy: { getAccessToken: ReturnType<typeof vi.fn> };
  let httpSpy: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    authServiceSpy = {
      getAccessToken: vi.fn().mockReturnValue('mock-token-123')
    };

    httpSpy = {
      get: vi.fn().mockReturnValue(of({ events: [], offset: 100 }))
    };

    TestBed.configureTestingModule({
      providers: [
        StreamService,
        { provide: AuthService, useValue: authServiceSpy },
        { provide: HttpClient, useValue: httpSpy }
      ]
    });

    streamService = TestBed.inject(StreamService);
  });

  afterEach(() => {
    streamService.stop();
  });

  it('Transport Fallback: switches to SSE after 3 consecutive WebSocket failures, then to Polling after 3 SSE failures', () => {
    expect(streamService.currentTransport()).toBe('websocket');

    // Simulate 3 WS failures
    (streamService as any).handleTransportFailure(new Error('WS Fail 1'));
    expect(streamService.currentTransport()).toBe('websocket');

    (streamService as any).handleTransportFailure(new Error('WS Fail 2'));
    expect(streamService.currentTransport()).toBe('websocket');

    (streamService as any).handleTransportFailure(new Error('WS Fail 3'));
    // Fell back to SSE!
    expect(streamService.currentTransport()).toBe('sse');

    // Simulate 3 SSE failures
    (streamService as any).handleTransportFailure(new Error('SSE Fail 1'));
    (streamService as any).handleTransportFailure(new Error('SSE Fail 2'));
    (streamService as any).handleTransportFailure(new Error('SSE Fail 3'));
    // Fell back to polling!
    expect(streamService.currentTransport()).toBe('polling');
  });

  it('Climbing back up: switches back to WebSocket when higher transport probe succeeds', () => {
    streamService.currentTransport.set('polling');
    expect(streamService.currentTransport()).toBe('polling');

    // Manually trigger climb back to websocket
    streamService.switchTransport('websocket');
    expect(streamService.currentTransport()).toBe('websocket');
  });

  it('Sequence Handling: drops duplicates and applies out-of-order events correctly', async () => {
    const emittedEvents: MetricEvent[] = [];
    const sub = streamService.metricEvents$.subscribe(evt => emittedEvents.push(evt));

    const event1: MetricEvent = {
      type: 'metric',
      offset: 100,
      serviceId: 'svc-0001',
      seq: 1,
      ts: Date.now(),
      p95: 50,
      errRate: 0.1,
      rps: 1000,
      status: 'healthy'
    };

    const duplicateEvent1 = { ...event1 };

    const event2OutOfOrder: MetricEvent = {
      type: 'metric',
      offset: 102, // Arrives before 101!
      serviceId: 'svc-0002',
      seq: 1,
      ts: Date.now(),
      p95: 60,
      errRate: 0.1,
      rps: 1100,
      status: 'healthy'
    };

    const event3InOrder: MetricEvent = {
      type: 'metric',
      offset: 101, // Missing middle event arriving slightly delayed
      serviceId: 'svc-0003',
      seq: 1,
      ts: Date.now(),
      p95: 70,
      errRate: 0.1,
      rps: 1200,
      status: 'healthy'
    };

    // Feed event 1
    (streamService as any).processIncomingMessage(JSON.stringify(event1));
    // Feed duplicate event 1
    (streamService as any).processIncomingMessage(JSON.stringify(duplicateEvent1));
    // Feed event 2 (offset 102)
    (streamService as any).processIncomingMessage(JSON.stringify(event2OutOfOrder));
    // Feed event 3 (offset 101)
    (streamService as any).processIncomingMessage(JSON.stringify(event3InOrder));

    // Allow reorder buffer flush
    await new Promise(r => setTimeout(r, 120));

    // 1. Duplicate should NOT be emitted
    const offset100Count = emittedEvents.filter(e => e.offset === 100).length;
    expect(offset100Count).toBe(1);

    // 2. Events should be emitted in sorted ascending offset order (100, 101, 102)
    const offsets = emittedEvents.map(e => e.offset);
    expect(offsets).toEqual([100, 101, 102]);

    sub.unsubscribe();
  });

  it('Malformed events: bad JSON or missing fields are counted and logged, never crashing the stream', () => {
    expect(streamService.malformedEventCount()).toBe(0);

    // Feed malformed JSON
    (streamService as any).processIncomingMessage('{ bad json: ...');
    expect(streamService.malformedEventCount()).toBe(1);

    // Feed missing required fields
    (streamService as any).processIncomingMessage(JSON.stringify({ type: 'metric', offset: 999 }));
    expect(streamService.malformedEventCount()).toBe(2);
  });
});

