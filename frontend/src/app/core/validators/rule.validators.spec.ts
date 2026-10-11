import { FormControl, FormGroup, ValidationErrors } from '@angular/forms';
import { of, Observable } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import {
  warningThresholdLowerThanCriticalValidator,
  metricThresholdValidator,
  uniqueRuleNameValidator
} from './rule.validators';

describe('Custom Rule Validators (Unit Test)', () => {
  describe('warningThresholdLowerThanCriticalValidator (Cross-Field)', () => {
    it('returns error when warningThreshold is greater than or equal to critical threshold', () => {
      const validator = warningThresholdLowerThanCriticalValidator();
      const group = new FormGroup({
        threshold: new FormControl(500),
        warningThreshold: new FormControl(600)
      });

      const result = validator(group);
      expect(result).toEqual({
        warningMustBeLower: { warning: 600, critical: 500 }
      });
    });

    it('returns null when warningThreshold is strictly lower than critical threshold', () => {
      const validator = warningThresholdLowerThanCriticalValidator();
      const group = new FormGroup({
        threshold: new FormControl(500),
        warningThreshold: new FormControl(400)
      });

      const result = validator(group);
      expect(result).toBeNull();
    });

    it('returns null when warningThreshold is omitted', () => {
      const validator = warningThresholdLowerThanCriticalValidator();
      const group = new FormGroup({
        threshold: new FormControl(500),
        warningThreshold: new FormControl(null)
      });

      const result = validator(group);
      expect(result).toBeNull();
    });
  });

  describe('metricThresholdValidator (Dynamic Ranges)', () => {
    it('validates errRate percentage is between 0 and 100', () => {
      const validator = metricThresholdValidator();

      const invalidGroupHigh = new FormGroup({
        metric: new FormControl('errRate'),
        threshold: new FormControl(105)
      });
      expect(validator(invalidGroupHigh)).toEqual({
        percentageRange: { min: 0, max: 100, actual: 105 }
      });

      const invalidGroupLow = new FormGroup({
        metric: new FormControl('errRate'),
        threshold: new FormControl(-5)
      });
      expect(validator(invalidGroupLow)).toEqual({
        percentageRange: { min: 0, max: 100, actual: -5 }
      });

      const validGroup = new FormGroup({
        metric: new FormControl('errRate'),
        threshold: new FormControl(2.5)
      });
      expect(validator(validGroup)).toBeNull();
    });

    it('validates latency p95 and throughput rps are non-negative', () => {
      const validator = metricThresholdValidator();
      const invalidGroup = new FormGroup({
        metric: new FormControl('p95'),
        threshold: new FormControl(-10)
      });
      expect(validator(invalidGroup)).toEqual({
        nonNegative: { actual: -10 }
      });
    });
  });

  describe('uniqueRuleNameValidator (Async Validator)', () => {
    it('returns nameTaken error when server reports name is unavailable', async () => {
      const httpSpy = {
        get: vi.fn().mockReturnValue(of({ available: false }))
      } as unknown as HttpClient;

      const control = new FormControl('Existing Rule Name');
      const asyncValidator = uniqueRuleNameValidator(httpSpy);

      await new Promise<void>((resolve) => {
        const obs = asyncValidator(control) as Observable<ValidationErrors | null>;
        obs.subscribe((res: ValidationErrors | null) => {
          expect(res).toEqual({ nameTaken: true });
          resolve();
        });
      });
    });

    it('returns null when server reports name is available', async () => {
      const httpSpy = {
        get: vi.fn().mockReturnValue(of({ available: true }))
      } as unknown as HttpClient;

      const control = new FormControl('Brand New Unique Rule');
      const asyncValidator = uniqueRuleNameValidator(httpSpy);

      await new Promise<void>((resolve) => {
        const obs = asyncValidator(control) as Observable<ValidationErrors | null>;
        obs.subscribe((res: ValidationErrors | null) => {
          expect(res).toBeNull();
          resolve();
        });
      });
    });
  });
});
