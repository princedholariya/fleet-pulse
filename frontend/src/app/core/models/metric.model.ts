export type ServiceStatus = 'healthy' | 'degraded' | 'down';

export interface Microservice {
  id: string;
  name: string;
  team: string;
  status: ServiceStatus;
}

export interface MetricEvent {
  type: 'metric';
  offset: number;
  serviceId: string;
  seq: number;
  ts: number;
  p95: number;
  errRate: number;
  rps: number;
  status: ServiceStatus;
}

export interface MetricSnapshot {
  offset: number;
  ts: number;
  metrics: MetricEvent[];
}

export interface MetricHistoryPoint {
  ts: number;
  p95: number;
  errRate: number;
  rps: number;
}

export interface MetricHistoryResponse {
  serviceId: string;
  points: MetricHistoryPoint[];
}

export interface MetricReplayResponse {
  events: MetricEvent[];
  offset: number;
}

export interface PingEvent {
  type: 'ping';
  ts: number;
}

export type StreamEvent = MetricEvent | PingEvent;

