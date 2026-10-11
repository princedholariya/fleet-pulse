import { downsampleLTTB } from './lttb';
import { MetricHistoryPoint, MetricEvent } from '../models/metric.model';
import { RulesService } from '../services/rules.service';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { StreamService } from '../stream/stream.service';

describe('Data Reduction & Rule Evaluation (Unit Test)', () => {
  describe('LTTB Downsampling Algorithm', () => {
    it('reduces 900 high-frequency points down to exactly 300 points', () => {
      const rawPoints: MetricHistoryPoint[] = [];
      const now = Date.now();

      for (let i = 0; i < 900; i++) {
        rawPoints.push({
          ts: now + (i * 1000),
          p95: 50 + Math.sin(i / 10) * 30,
          errRate: 0.1,
          rps: 1200
        });
      }

      // Add prominent latency spike at index 450
      rawPoints[450].p95 = 950;

      const reduced = downsampleLTTB(rawPoints, 300);

      expect(reduced.length).toBeLessThanOrEqual(300);
      expect(reduced[0].ts).toBe(rawPoints[0].ts);
      expect(reduced[reduced.length - 1].ts).toBe(rawPoints[rawPoints.length - 1].ts);

      // Verify the critical latency spike was preserved by LTTB
      const hasSpike = reduced.some(p => p.p95 >= 900);
      expect(hasSpike).toBe(true);
    });

    it('returns original points untouched if below or equal to threshold', () => {
      const smallData: MetricHistoryPoint[] = [
        { ts: 1000, p95: 50, errRate: 0, rps: 100 },
        { ts: 2000, p95: 60, errRate: 0, rps: 100 }
      ];
      const result = downsampleLTTB(smallData, 300);
      expect(result.length).toBe(2);
    });
  });

  describe('Rule Evaluation Engine', () => {
    let rulesService: RulesService;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          RulesService,
          { provide: HttpClient, useValue: { get: vi.fn().mockReturnValue(of([])), post: vi.fn(), put: vi.fn(), delete: vi.fn() } },
          { provide: StreamService, useValue: { metricEvents$: of() } }
        ]
      });

      rulesService = TestBed.inject(RulesService);
    });

    it('fires an incident when condition threshold is exceeded and deduplicates subsequent occurrences', () => {
      // Configure test rule
      rulesService.rules.set([
        {
          id: 'r-test',
          name: 'Critical Latency Spike',
          conditions: [
            { metric: 'p95', operator: '>', threshold: 500, durationSec: 30 }
          ]
        }
      ]);

      const violatingMetric: MetricEvent = {
        type: 'metric',
        offset: 1001,
        serviceId: 'svc-0412',
        seq: 1,
        ts: Date.now(),
        p95: 750, // > 500 threshold
        errRate: 0.1,
        rps: 1200,
        status: 'healthy'
      };

      // 1. First evaluation: should fire incident
      rulesService.evaluateMetricAgainstRules(violatingMetric);
      expect(rulesService.incidents().length).toBe(1);
      expect(rulesService.incidents()[0].serviceId).toBe('svc-0412');
      expect(rulesService.incidents()[0].currentValue).toBe(750);

      // 2. Second evaluation with same service and metric: MUST NOT fire duplicate incident!
      rulesService.evaluateMetricAgainstRules(violatingMetric);
      expect(rulesService.incidents().length).toBe(1); // Still exactly 1!
    });
  });
});

