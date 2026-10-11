import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { APP_CONFIG } from '../config/app.config.constants';
import { User, AuthResponse, LoginCredentials, UserRole } from '../models/auth.model';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  // In-memory token storage (strict requirement: never kept in localStorage)
  private inMemoryAccessToken: string | null = null;
  private inMemoryRefreshToken: string | null = null;

  // Modern Angular Signals for reactive state
  readonly currentUser = signal<User | null>(null);
  readonly isAuthenticated = computed(() => !!this.currentUser());
  readonly isOperator = computed(() => this.currentUser()?.role === 'operator');

  private returnUrl = '/';

  getAccessToken(): string | null {
    return this.inMemoryAccessToken;
  }

  getRefreshToken(): string | null {
    return this.inMemoryRefreshToken;
  }

  setReturnUrl(url: string): void {
    if (url && !url.includes('/login')) {
      this.returnUrl = url;
    }
  }

  getReturnUrl(): string {
    return this.returnUrl;
  }

  login(credentials: LoginCredentials): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${APP_CONFIG.api.baseUrl}/auth/login`, credentials).pipe(
      tap((res) => {
        this.setSession(res);
      })
    );
  }

  refreshTokens(): Observable<AuthResponse> {
    const refreshToken = this.inMemoryRefreshToken;
    if (!refreshToken) {
      return throwError(() => new Error('No refresh token available'));
    }

    return this.http.post<AuthResponse>(`${APP_CONFIG.api.baseUrl}/auth/refresh`, { refreshToken }).pipe(
      tap((res) => {
        this.setSession(res);
      }),
      catchError((err) => {
        this.logout(this.router.url);
        return throwError(() => err);
      })
    );
  }

  private setSession(authRes: AuthResponse): void {
    this.inMemoryAccessToken = authRes.accessToken;
    this.inMemoryRefreshToken = authRes.refreshToken;
    this.currentUser.set(authRes.user);
  }

  logout(redirectReturnUrl?: string): void {
    if (redirectReturnUrl) {
      this.setReturnUrl(redirectReturnUrl);
    }
    this.inMemoryAccessToken = null;
    this.inMemoryRefreshToken = null;
    this.currentUser.set(null);

    // Redirect to login with returnUrl
    const queryParams = this.returnUrl && this.returnUrl !== '/' ? { returnUrl: this.returnUrl } : {};
    this.router.navigate(['/login'], { queryParams });
  }

  hasRole(role: UserRole): boolean {
    return this.currentUser()?.role === role;
  }
}

