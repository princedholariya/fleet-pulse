import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { RulesService } from '../../core/services/rules.service';
import { AuthService } from '../../core/auth/auth.service';
import { StreamService } from '../../core/stream/stream.service';
import { ConnectionBadgeComponent } from '../../shared/components/connection-badge/connection-badge.component';

@Component({
  selector: 'app-rule-list',
  standalone: true,
  imports: [CommonModule, RouterModule, ConnectionBadgeComponent],
  templateUrl: './rule-list.component.html',
  styleUrls: ['./rule-list.component.scss']
})
export class RuleListComponent implements OnInit {
  readonly rulesService = inject(RulesService);
  readonly authService = inject(AuthService);
  readonly streamService = inject(StreamService);

  ngOnInit(): void {
    this.rulesService.loadRules().subscribe();
    this.streamService.start();
  }

  deleteRule(id: string): void {
    if (confirm('Are you sure you want to delete this alert rule?')) {
      this.rulesService.deleteRule(id).subscribe({
        error: (err) => {
          alert(err.error?.message || 'Failed to delete rule. Rollback applied.');
        }
      });
    }
  }

  dismissIncident(id: string): void {
    this.rulesService.dismissIncident(id);
  }
}

