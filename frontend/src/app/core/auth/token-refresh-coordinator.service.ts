import { Injectable, inject } from '@angular/core';
import { HttpRequest, HttpHandlerFn, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, BehaviorSubject, throwError } from 'rxjs';
import { filter, take, switchMap, catchError, finalize } from 'rxjs/operators';
import { AuthService } from './auth.service';

/**
 * TokenRefreshCoordinator
 * Synchronizes concurrent 401 responses to ensure that when N requests fail simultaneously
 * due to an expired token, exactly ONE refresh request is dispatched, and all N requests
 * are replayed once the new token is acquired.
 */
@Injectable({
  providedIn: 'root'
})
export class TokenRefreshCoordinator {
  private readonly authService = inject(AuthService);

  private isRefreshing = false;
  private readonly refreshTokenSubject = new BehaviorSubject<string | null>(null);

  handle401Error(
    req: HttpRequest<unknown>,
    next: HttpHandlerFn
  ): Observable<HttpEvent<unknown>> {
    if (!this.isRefreshing) {
      this.isRefreshing = true;
      this.refreshTokenSubject.next(null);

      return this.authService.refreshTokens().pipe(
        switchMap((authRes) => {
          this.refreshTokenSubject.next(authRes.accessToken);
          return next(this.addToken(req, authRes.accessToken));
        }),
        catchError((err: HttpErrorResponse | Error) => {
          this.refreshTokenSubject.next(null);
          this.authService.logout();
          return throwError(() => err);
        }),
        finalize(() => {
          this.isRefreshing = false;
        })
      );
    } else {
      // Refresh already in progress: wait for new token and replay
      return this.refreshTokenSubject.pipe(
        filter((token): token is string => token !== null),
        take(1),
        switchMap((token) => next(this.addToken(req, token)))
      );
    }
  }

  addToken(req: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
    return req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }
}

