import { Injectable, inject, signal, DestroyRef } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, Subscription, tap, catchError, throwError } from 'rxjs';
import { APP_CONFIG } from '../config/app.config.constants';
import { AlertRule, IncidentAlert, RuleCondition } from '../models/rule.model';
import { MetricEvent } from '../models/metric.model';
import { StreamService } from '../stream/stream.service';
import { NotificationService } from './notification.service';

@Injectable({
  providedIn: 'root'
})
export class RulesService {
  private readonly http = inject(HttpClient);
  private readonly streamService = inject(StreamService);
  private readonly notificationService = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  // Reactive State Signals
  readonly rules = signal<AlertRule[]>([]);
  readonly incidents = signal<IncidentAlert[]>([]);
  readonly isLoading = signal<boolean>(false);

  // Deduplication tracker: Set<"ruleId:serviceId:metric">
  private readonly activeIncidents = new Set<string>();

  private streamSub: Subscription | null = null;

  constructor() {
    this.startEvaluationEngine();

    this.destroyRef.onDestroy(() => {
      this.streamSub?.unsubscribe();
    });
  }

  loadRules(): Observable<AlertRule[]> {
    this.isLoading.set(true);
    return this.http.get<AlertRule[]>(`${APP_CONFIG.api.baseUrl}/rules`).pipe(
      tap((data) => {
        this.rules.set(data || []);
        this.isLoading.set(false);
      }),
      catchError((err) => {
        this.isLoading.set(false);
        return throwError(() => err);
      })
    );
  }

  // Optimistic Save with Rollback on Rejection
  saveRuleOptimistically(rule: AlertRule): Observable<AlertRule> {
    const previousRules = [...this.rules()];
    const idempotencyKey = `rule-save-${Date.now()}-${Math.random().toString(36).substring(2)}`;
    const headers = new HttpHeaders({
      'Idempotency-Key': idempotencyKey
    });

    const isUpdate = !!rule.id;
    const optimisticRule: AlertRule = {
      ...rule,
      id: rule.id || `temp-${Date.now()}`,
      updatedAt: Date.now()
    };

    // 1. Optimistic UI update
    if (isUpdate) {
      this.rules.set(previousRules.map(r => r.id === rule.id ? optimisticRule : r));
    } else {
      this.rules.set([optimisticRule, ...previousRules]);
    }

    // 2. Perform HTTP save
    const req$ = isUpdate
      ? this.http.put<AlertRule>(`${APP_CONFIG.api.baseUrl}/rules/${rule.id}`, rule)
      : this.http.post<AlertRule>(`${APP_CONFIG.api.baseUrl}/rules`, rule, { headers });

    return req$.pipe(
      tap((savedRule) => {
        // Replace temp optimistic rule with real server-returned rule
        this.rules.set(this.rules().map(r => r.id === optimisticRule.id ? savedRule : r));
      }),
      catchError((err) => {
        // Rollback immediately to previous state if rejected
        this.rules.set(previousRules);
        return throwError(() => err);
      })
    );
  }

  deleteRule(ruleId: string): Observable<void> {
    const previousRules = [...this.rules()];
    this.rules.set(previousRules.filter(r => r.id !== ruleId));

    return this.http.delete<void>(`${APP_CONFIG.api.baseUrl}/rules/${ruleId}`).pipe(
      catchError((err) => {
        this.rules.set(previousRules);
        return throwError(() => err);
      })
    );
  }

  // In-Browser Real-Time Evaluation Engine against Live Stream
  private startEvaluationEngine(): void {
    this.streamSub?.unsubscribe();
    this.streamSub = this.streamService.metricEvents$.subscribe((metric: MetricEvent) => {
      this.evaluateMetricAgainstRules(metric);
    });
  }

  evaluateMetricAgainstRules(metric: MetricEvent): void {
    const activeRules = this.rules();

    for (const rule of activeRules) {
      if (!rule.conditions) continue;

      for (const cond of rule.conditions) {
        if (this.doesConditionFire(cond, metric)) {
          const incidentKey = `${rule.id || rule.name}:${metric.serviceId}:${cond.metric}`;

          // Critical requirement: The same incident must not fire twice
          if (!this.activeIncidents.has(incidentKey)) {
            this.activeIncidents.add(incidentKey);

            const incident: IncidentAlert = {
              id: `inc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              ruleId: rule.id || 'unknown',
              ruleName: rule.name,
              serviceId: metric.serviceId,
              metric: cond.metric,
              currentValue: cond.metric === 'p95' ? metric.p95 : (cond.metric === 'errRate' ? metric.errRate : metric.rps),
              threshold: cond.threshold,
              triggeredAt: Date.now()
            };

            this.incidents.update(list => [incident, ...list].slice(0, 50));

            // Raise notification alert (Requirement D.8)
            this.notificationService.show(
              `Alert: ${rule.name}`,
              `Threshold violation on ${metric.serviceId} (${cond.metric}: ${incident.currentValue})`,
              'critical'
            );
          }
        }
      }
    }
  }

  private doesConditionFire(cond: RuleCondition, metric: MetricEvent): boolean {
    let actualValue = 0;
    if (cond.metric === 'p95') actualValue = metric.p95;
    else if (cond.metric === 'errRate') actualValue = metric.errRate;
    else if (cond.metric === 'rps') actualValue = metric.rps;

    switch (cond.operator) {
      case '>': return actualValue > cond.threshold;
      case '>=': return actualValue >= cond.threshold;
      case '<': return actualValue < cond.threshold;
      case '<=': return actualValue <= cond.threshold;
      default: return false;
    }
  }

  dismissIncident(id: string): void {
    this.incidents.update(list => list.filter(i => i.id !== id));
  }
}

