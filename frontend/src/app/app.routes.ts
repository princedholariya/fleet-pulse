import { Routes } from '@angular/router';
import { LoginComponent } from './features/auth/login.component';
import { FleetTableComponent } from './features/fleet/fleet-table.component';
import { authGuard } from './core/auth/auth.guard';
import { roleGuard } from './core/auth/role.guard';
import { pendingChangesGuard } from './core/guards/pending-changes.guard';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginComponent
  },
  {
    path: '',
    component: FleetTableComponent,
    canActivate: [authGuard]
  },
  {
    path: 'services/:id',
    loadComponent: () =>
      import('./features/service-detail/service-detail.component').then(m => m.ServiceDetailComponent),
    canActivate: [authGuard]
  },
  {
    path: 'rules',
    loadComponent: () =>
      import('./features/rules/rule-list.component').then(m => m.RuleListComponent),
    canActivate: [authGuard, roleGuard],
    data: { role: 'operator' }
  },
  {
    path: 'rules/new',
    loadComponent: () =>
      import('./features/rules/rule-form.component').then(m => m.RuleFormComponent),
    canActivate: [authGuard, roleGuard],
    canDeactivate: [pendingChangesGuard],
    data: { role: 'operator' }
  },
  {
    path: 'rules/:id/edit',
    loadComponent: () =>
      import('./features/rules/rule-form.component').then(m => m.RuleFormComponent),
    canActivate: [authGuard, roleGuard],
    canDeactivate: [pendingChangesGuard],
    data: { role: 'operator' }
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./features/settings/settings.component').then(m => m.SettingsComponent),
    canActivate: [authGuard]
  },
  {
    path: '**',
    redirectTo: ''
  }
];
