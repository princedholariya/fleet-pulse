import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * RoleGuard
 * Strictly enforces that viewers cannot reach /rules.
 * Route itself enforces this, not just UI visibility.
 */
export const roleGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const requiredRole = route.data?.['role'] as string | undefined;

  if (!authService.isAuthenticated()) {
    authService.setReturnUrl(state.url);
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }

  if (requiredRole && !authService.hasRole(requiredRole as 'operator' | 'viewer')) {
    // Viewer trying to access operator-only route: redirect to dashboard
    return router.createUrlTree(['/']);
  }

  return true;
};

