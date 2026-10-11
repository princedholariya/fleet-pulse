import { AbstractControl, ValidationErrors, ValidatorFn, AsyncValidatorFn } from '@angular/forms';
import { Observable, of, timer } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';
import { APP_CONFIG } from '../config/app.config.constants';

/**
 * Cross-Field Custom Validator:
 * Validates that the condition's warningThreshold is strictly lower than the critical threshold.
 */
export function warningThresholdLowerThanCriticalValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const threshold = control.get('threshold')?.value;
    const warningThreshold = control.get('warningThreshold')?.value;

    if (warningThreshold !== null && warningThreshold !== undefined && warningThreshold !== '' &&
        threshold !== null && threshold !== undefined && threshold !== '') {
      const numThresh = Number(threshold);
      const numWarn = Number(warningThreshold);

      if (numWarn >= numThresh) {
        return { warningMustBeLower: { warning: numWarn, critical: numThresh } };
      }
    }

    return null;
  };
}

/**
 * Dynamic Field Validator for Metric Threshold Ranges:
 * - errRate must be a percentage between 0 and 100
 * - p95 & rps must be non-negative numbers
 */
export function metricThresholdValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const metric = control.get('metric')?.value;
    const threshold = control.get('threshold')?.value;

    if (threshold === null || threshold === undefined || threshold === '') {
      return null;
    }

    const val = Number(threshold);
    if (isNaN(val)) {
      return { invalidNumber: true };
    }

    if (metric === 'errRate' && (val < 0 || val > 100)) {
      return { percentageRange: { min: 0, max: 100, actual: val } };
    }

    if ((metric === 'p95' || metric === 'rps') && val < 0) {
      return { nonNegative: { actual: val } };
    }

    return null;
  };
}

/**
 * Async Validator:
 * Checks rule name uniqueness against /rules/check-name while typing (with 300ms debounce).
 */
export function uniqueRuleNameValidator(http: HttpClient, excludeId?: string): AsyncValidatorFn {
  return (control: AbstractControl): Observable<ValidationErrors | null> => {
    const val = control.value;
    if (!val || typeof val !== 'string' || !val.trim()) {
      return of(null);
    }

    return timer(300).pipe(
      switchMap(() => {
        let url = `${APP_CONFIG.api.baseUrl}/rules/check-name?name=${encodeURIComponent(val.trim())}`;
        if (excludeId) {
          url += `&excludeId=${encodeURIComponent(excludeId)}`;
        }
        return http.get<{ available: boolean }>(url);
      }),
      map((res) => {
        return res.available ? null : { nameTaken: true };
      }),
      catchError(() => of(null)) // Do not block if check endpoint fails
    );
  };
}

