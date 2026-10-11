import { Component, inject, OnInit, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { FleetService, EnrichedServiceItem } from '../../core/services/fleet.service';
import { StreamService } from '../../core/stream/stream.service';
import { AuthService } from '../../core/auth/auth.service';
import { ConnectionBadgeComponent } from '../../shared/components/connection-badge/connection-badge.component';
import { ChaosPanelComponent } from '../../shared/components/chaos-panel/chaos-panel.component';

export type SortField = 'id' | 'name' | 'team' | 'status' | 'p95' | 'errRate' | 'rps';
export type SortDirection = 'asc' | 'desc';

@Component({
  selector: 'app-fleet-table',
  standalone: true,
  imports: [CommonModule, FormsModule, ScrollingModule, ConnectionBadgeComponent, ChaosPanelComponent],
  templateUrl: './fleet-table.component.html',
  styleUrls: ['./fleet-table.component.scss']
})
export class FleetTableComponent implements OnInit {
  readonly fleetService = inject(FleetService);
  readonly streamService = inject(StreamService);
  readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  // Filter & Sort State Signals
  readonly searchQuery = signal<string>('');
  readonly statusFilter = signal<string>('all');
  readonly sortField = signal<SortField>('id');
  readonly sortDirection = signal<SortDirection>('asc');

  // Computed filtered and sorted microservices
  readonly displayedServices = computed<EnrichedServiceItem[]>(() => {
    const list = this.fleetService.servicesList();
    const query = this.searchQuery().toLowerCase().trim();
    const filter = this.statusFilter();
    const field = this.sortField();
    const dir = this.sortDirection();

    // 1. Filter
    let filtered = list;
    if (filter !== 'all') {
      filtered = filtered.filter(s => s.status === filter);
    }
    if (query) {
      filtered = filtered.filter(s =>
        s.name.toLowerCase().includes(query) ||
        s.id.toLowerCase().includes(query) ||
        s.team.toLowerCase().includes(query)
      );
    }

    // 2. Sort
    return [...filtered].sort((a, b) => {
      const valA = a[field];
      const valB = b[field];

      if (typeof valA === 'string' && typeof valB === 'string') {
        const comp = valA.localeCompare(valB);
        return dir === 'asc' ? comp : -comp;
      }

      const numA = Number(valA);
      const numB = Number(valB);
      if (numA < numB) return dir === 'asc' ? -1 : 1;
      if (numA > numB) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  });

  readonly stats = computed(() => {
    const list = this.fleetService.servicesList();
    const healthy = list.filter(s => s.status === 'healthy').length;
    const degraded = list.filter(s => s.status === 'degraded').length;
    const down = list.filter(s => s.status === 'down').length;
    return { total: list.length, healthy, degraded, down };
  });

  constructor() {
    // Sync URL query params with state changes
    effect(() => {
      const q = this.searchQuery();
      const status = this.statusFilter();
      const sort = this.sortField();
      const dir = this.sortDirection();

      // Only navigate if initialized
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          q: q || null,
          status: status !== 'all' ? status : null,
          sort: sort !== 'id' ? sort : null,
          dir: dir !== 'asc' ? dir : null
        },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    });
  }

  ngOnInit(): void {
    // Initialize from URL params
    const params = this.route.snapshot.queryParams;
    if (params['q']) this.searchQuery.set(params['q']);
    if (params['status']) this.statusFilter.set(params['status']);
    if (params['sort']) this.sortField.set(params['sort'] as SortField);
    if (params['dir']) this.sortDirection.set(params['dir'] as SortDirection);

    this.fleetService.loadInitialFleet();
    this.streamService.start();
  }

  setSort(field: SortField): void {
    if (this.sortField() === field) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortField.set(field);
      this.sortDirection.set('asc');
    }
  }

  openService(serviceId: string): void {
    this.router.navigate(['/services', serviceId]);
  }

  trackById(index: number, item: EnrichedServiceItem): string {
    return item.id;
  }

  logout(): void {
    this.streamService.stop();
    this.authService.logout();
  }
}
