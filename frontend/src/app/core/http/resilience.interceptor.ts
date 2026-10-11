import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, timer } from 'rxjs';
import { retry, timeout, catchError } from 'rxjs/operators';
import { APP_CONFIG } from '../config/app.config.constants';

/**
 * R3 HTTP Resilience Interceptor
 * - Enforces 10-second timeout on all requests
 * - Retries GET requests on network errors, 502, 503, 504, 429 up to 3 times
 * - Honors Retry-After header on 429
 * - Retries POST ONLY if Idempotency-Key header is present
 * - Never retries other 4xx errors
 */
export const resilienceInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  return next(req).pipe(
    timeout(APP_CONFIG.api.requestTimeoutMs),
    retry({
      count: APP_CONFIG.api.maxRetries,
      delay: (error: unknown, retryCount: number) => {
        // Only retry valid HttpErrorResponse or network failure (status === 0)
        if (!(error instanceof HttpErrorResponse)) {
          return throwError(() => error);
        }

        const isNetworkError = error.status === 0;
        const isRetryableStatus = (APP_CONFIG.api.retryableStatusCodes as readonly number[]).includes(error.status);
        const hasIdempotencyKey = req.headers.has('Idempotency-Key');

        // Disallow retry on non-retryable 4xx
        if (error.status >= 400 && error.status < 500 && error.status !== 429) {
          return throwError(() => error);
        }

        // Only retry GET, or POST with Idempotency-Key
        const isMethodRetryable = req.method === 'GET' || (req.method === 'POST' && hasIdempotencyKey);
        if (!isMethodRetryable) {
          return throwError(() => error);
        }

        // If error is not network error and not in retryable status codes, abort retry
        if (!isNetworkError && !isRetryableStatus) {
          return throwError(() => error);
        }

        // Honor Retry-After header if present on 429
        let delayMs = APP_CONFIG.api.retryDelayBaseMs * Math.pow(2, retryCount - 1);
        if (error.status === 429) {
          const retryAfter = error.headers.get('Retry-After');
          if (retryAfter) {
            const seconds = parseInt(retryAfter, 10);
            if (!isNaN(seconds)) {
              delayMs = seconds * 1000;
            }
          }
        }

        return timer(delayMs);
      }
    }),
    catchError((error: unknown) => {
      return throwError(() => error);
    })
  );
};

