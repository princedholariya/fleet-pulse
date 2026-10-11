import { TestBed } from '@angular/core/testing';
import { HttpRequest, HttpHandlerFn, HttpResponse, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { of, throwError, defer } from 'rxjs';
import { resilienceInterceptor } from './resilience.interceptor';

describe('R3 HTTP Resilience Interceptor (Unit Test)', () => {
  it('Retries GET request on retryable error 503 up to 3 attempts', async () => {
    let callCount = 0;
    const req = new HttpRequest('GET', 'http://localhost:4000/services');

    const next: HttpHandlerFn = () => defer(() => {
      callCount++;
      if (callCount < 3) {
        return throwError(() => new HttpErrorResponse({ status: 503, statusText: 'Service Unavailable' }));
      }
      return of(new HttpResponse({ status: 200, body: [{ id: 'svc-0001' }] }));
    });

    const runInterceptor = () => TestBed.runInInjectionContext(() => resilienceInterceptor(req, next));

    await new Promise<void>((resolve, reject) => {
      runInterceptor().subscribe({
        next: (res) => {
          expect(res).toBeTruthy();
          expect(callCount).toBe(3); // Initial attempt + 2 retries
          resolve();
        },
        error: reject
      });
    });
  }, 15000);

  it('Never retries non-retryable 4xx errors (e.g. 400 bad_request or 404 not_found)', async () => {
    let callCount = 0;
    const req = new HttpRequest('GET', 'http://localhost:4000/rules/r-999');

    const next: HttpHandlerFn = () => {
      callCount++;
      return throwError(() => new HttpErrorResponse({ status: 404, statusText: 'Not Found' }));
    };

    const runInterceptor = () => TestBed.runInInjectionContext(() => resilienceInterceptor(req, next));

    await new Promise<void>((resolve) => {
      runInterceptor().subscribe({
        error: (err) => {
          expect(err.status).toBe(404);
          expect(callCount).toBe(1); // Failed immediately without retry
          resolve();
        }
      });
    });
  });

  it('Never retries POST requests without an Idempotency-Key', async () => {
    let callCount = 0;
    const req = new HttpRequest('POST', 'http://localhost:4000/rules', { name: 'Test' });

    const next: HttpHandlerFn = () => {
      callCount++;
      return throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Internal Error' }));
    };

    const runInterceptor = () => TestBed.runInInjectionContext(() => resilienceInterceptor(req, next));

    await new Promise<void>((resolve) => {
      runInterceptor().subscribe({
        error: (err) => {
          expect(err.status).toBe(500);
          expect(callCount).toBe(1); // Non-idempotent POST is never retried!
          resolve();
        }
      });
    });
  });

  it('Retries POST when Idempotency-Key header is present', async () => {
    let callCount = 0;
    const headers = new HttpHeaders().set('Idempotency-Key', 'unique-key-123');
    const req = new HttpRequest('POST', 'http://localhost:4000/rules', { name: 'Test' }, {
      headers
    });

    const next: HttpHandlerFn = () => defer(() => {
      callCount++;
      if (callCount < 2) {
        return throwError(() => new HttpErrorResponse({ status: 502, statusText: 'Bad Gateway' }));
      }
      return of(new HttpResponse({ status: 201, body: { id: 'r-1' } }));
    });

    const runInterceptor = () => TestBed.runInInjectionContext(() => resilienceInterceptor(req, next));

    await new Promise<void>((resolve, reject) => {
      runInterceptor().subscribe({
        next: (res) => {
          expect(res).toBeTruthy();
          expect(callCount).toBe(2); // Retried safely because of idempotency key
          resolve();
        },
        error: reject
      });
    });
  }, 15000);
});
