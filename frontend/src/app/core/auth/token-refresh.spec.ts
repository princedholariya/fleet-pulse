import { TestBed } from '@angular/core/testing';
import { HttpRequest, HttpHandlerFn, HttpResponse, HttpErrorResponse } from '@angular/common/http';
import { of, throwError, forkJoin } from 'rxjs';
import { TokenRefreshCoordinator } from './token-refresh-coordinator.service';
import { AuthService } from './auth.service';
import { AuthResponse } from '../models/auth.model';

describe('TokenRefreshCoordinator (Unit Test)', () => {
  let coordinator: TokenRefreshCoordinator;
  let authServiceSpy: {
    refreshTokens: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    authServiceSpy = {
      refreshTokens: vi.fn(),
      logout: vi.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        TokenRefreshCoordinator,
        { provide: AuthService, useValue: authServiceSpy }
      ]
    });

    coordinator = TestBed.inject(TokenRefreshCoordinator);
  });

  it('Requirement: 10 parallel rejected requests produce exactly one refresh call', async () => {
    const mockAuthResponse: AuthResponse = {
      accessToken: 'new_access_token_123',
      refreshToken: 'new_refresh_token_456',
      expiresIn: 60,
      user: { id: 'u-1', email: 'operator@pulse.dev', role: 'operator' }
    };

    // Spy returns single delayed refresh observable
    authServiceSpy.refreshTokens.mockReturnValue(of(mockAuthResponse));

    let handlerCalls = 0;
    const replayedHeaders: (string | null)[] = [];

    const mockNext: HttpHandlerFn = (req: HttpRequest<unknown>) => {
      handlerCalls++;
      replayedHeaders.push(req.headers.get('Authorization'));
      return of(new HttpResponse({ status: 200, body: { success: true } }));
    };

    // Create 10 parallel rejected requests hitting handle401Error concurrently
    const parallelRequests = Array.from({ length: 10 }).map((_, index) => {
      const dummyReq = new HttpRequest('GET', `http://localhost:4000/data/${index}`);
      return coordinator.handle401Error(dummyReq, mockNext);
    });

    // Execute all 10 concurrently
    await new Promise<void>((resolve, reject) => {
      forkJoin(parallelRequests).subscribe({
        next: (results) => {
          expect(results.length).toBe(10);
          resolve();
        },
        error: reject
      });
    });

    // 1. Exactly ONE call went out to refresh
    expect(authServiceSpy.refreshTokens).toHaveBeenCalledTimes(1);

    // 2. All 10 requests were replayed
    expect(handlerCalls).toBe(10);

    // 3. All 10 replayed requests carried the newly refreshed access token
    replayedHeaders.forEach((authHeader) => {
      expect(authHeader).toBe('Bearer new_access_token_123');
    });
  });

  it('Failed refresh stops requests and triggers clean logout', async () => {
    authServiceSpy.refreshTokens.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 401, statusText: 'refresh_invalid' }))
    );

    const dummyReq = new HttpRequest('GET', 'http://localhost:4000/data');
    const mockNext: HttpHandlerFn = () => of(new HttpResponse({ status: 200 }));

    await new Promise<void>((resolve) => {
      coordinator.handle401Error(dummyReq, mockNext).subscribe({
        error: (err) => {
          expect(err).toBeTruthy();
          expect(authServiceSpy.logout).toHaveBeenCalled();
          resolve();
        }
      });
    });
  });
});

