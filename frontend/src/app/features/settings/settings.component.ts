import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

export interface UserPreferences {
  defaultHistoryMinutes: number;
  enableSoundAlerts: boolean;
  maxIncidentsRetention: number;
  highContrastMode: boolean;
  themePreference: 'dark' | 'midnight';
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="settings-layout">
      <div class="settings-card">
        <header class="settings-header">
          <div class="header-top">
            <a routerLink="/" class="btn-back">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
              <span>Back to Fleet</span>
            </a>
            <span class="badge-form-style">Template-Driven Form</span>
          </div>
          <h1 class="settings-title">Console Settings</h1>
          <p class="settings-subtitle">Manage client preferences and operational notification defaults.</p>
        </header>

        @if (savedNotification()) {
          <div class="alert-success" role="alert">
            ✓ Preferences saved successfully!
          </div>
        }

        <!-- Template-Driven Form Demonstration -->
        <form #settingsForm="ngForm" (ngSubmit)="onSaveSettings(settingsForm)" novalidate>
          <div class="form-group">
            <label for="theme" class="form-label">Theme Palette</label>
            <select
              id="theme"
              name="themePreference"
              [(ngModel)]="preferences.themePreference"
              class="form-control"
              required
            >
              <option value="dark">Dark Ops (Default)</option>
              <option value="midnight">Midnight Black</option>
            </select>
          </div>

          <div class="form-group">
            <label for="historyMinutes" class="form-label">Default History Window (Minutes)</label>
            <input
              id="historyMinutes"
              type="number"
              name="defaultHistoryMinutes"
              [(ngModel)]="preferences.defaultHistoryMinutes"
              #histMin="ngModel"
              class="form-control"
              [class.is-invalid]="histMin.invalid && histMin.touched"
              min="1"
              max="60"
              required
            />
            @if (histMin.invalid && histMin.touched) {
              <div class="invalid-feedback">
                Please enter a window duration between 1 and 60 minutes.
              </div>
            }
          </div>

          <div class="form-group">
            <label for="maxIncidents" class="form-label">Max Incident Stream Buffer</label>
            <input
              id="maxIncidents"
              type="number"
              name="maxIncidentsRetention"
              [(ngModel)]="preferences.maxIncidentsRetention"
              #maxInc="ngModel"
              class="form-control"
              [class.is-invalid]="maxInc.invalid && maxInc.touched"
              min="10"
              max="500"
              required
            />
            @if (maxInc.invalid && maxInc.touched) {
              <div class="invalid-feedback">
                Retention must be between 10 and 500 incidents.
              </div>
            }
          </div>

          <div class="checkbox-group">
            <label class="checkbox-label">
              <input
                type="checkbox"
                name="enableSoundAlerts"
                [(ngModel)]="preferences.enableSoundAlerts"
              />
              <span>Enable audio chirp when critical incidents fire</span>
            </label>
          </div>

          <div class="checkbox-group">
            <label class="checkbox-label">
              <input
                type="checkbox"
                name="highContrastMode"
                [(ngModel)]="preferences.highContrastMode"
              />
              <span>High-contrast grid borders for sunlight view</span>
            </label>
          </div>

          <div class="form-actions">
            <button
              type="submit"
              class="btn-save"
              [disabled]="settingsForm.invalid"
            >
              Save Preferences
            </button>
          </div>
        </form>
      </div>
    </div>
  `,
  styles: [`
    .settings-layout {
      min-height: 100vh;
      background-color: var(--bg-app);
      color: var(--text-main);
      padding: 2.5rem 1.5rem;
      display: flex;
      justify-content: center;
    }

    .settings-card {
      width: 100%;
      max-width: 640px;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 14px;
      padding: 2.5rem;
    }

    .settings-header {
      margin-bottom: 2rem;

      .header-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.75rem;

        .btn-back {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          color: var(--text-muted);
          text-decoration: none;
          font-size: 0.85rem;
          &:hover { color: #fff; }
        }

        .badge-form-style {
          font-size: 0.7rem;
          background: rgba(168, 85, 247, 0.15);
          color: #c084fc;
          border: 1px solid rgba(168, 85, 247, 0.3);
          padding: 0.2rem 0.5rem;
          border-radius: 9999px;
          font-weight: 600;
        }
      }

      .settings-title {
        font-size: 1.5rem;
        font-weight: 700;
        margin: 0;
      }

      .settings-subtitle {
        font-size: 0.85rem;
        color: var(--text-muted);
        margin-top: 0.35rem;
      }
    }

    .alert-success {
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #6ee7b7;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      margin-bottom: 1.5rem;
      font-size: 0.85rem;
    }

    .form-group {
      margin-bottom: 1.25rem;

      .form-label {
        display: block;
        font-size: 0.85rem;
        font-weight: 500;
        color: #cbd5e1;
        margin-bottom: 0.4rem;
      }

      .form-control {
        width: 100%;
        box-sizing: border-box;
        padding: 0.65rem 0.85rem;
        background: rgba(15, 23, 42, 0.6);
        border: 1px solid #334155;
        border-radius: 8px;
        color: #fff;
        font-size: 0.9rem;
        outline: none;
        &:focus {
          border-color: var(--border-focus);
        }
        &.is-invalid {
          border-color: #ef4444;
        }
      }

      .invalid-feedback {
        color: #f87171;
        font-size: 0.8rem;
        margin-top: 0.35rem;
      }
    }

    .checkbox-group {
      margin-bottom: 1rem;

      .checkbox-label {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        font-size: 0.875rem;
        color: #cbd5e1;
        cursor: pointer;

        input[type="checkbox"] {
          width: 16px;
          height: 16px;
          cursor: pointer;
        }
      }
    }

    .form-actions {
      margin-top: 2rem;
      padding-top: 1.25rem;
      border-top: 1px solid var(--border-subtle);
      display: flex;
      justify-content: flex-end;

      .btn-save {
        padding: 0.65rem 1.5rem;
        background: #0284c7;
        color: #fff;
        border: none;
        border-radius: 6px;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease;

        &:hover:not(:disabled) { background: #0ea5e9; }
        &:disabled { opacity: 0.6; cursor: not-allowed; }
      }
    }
  `]
})
export class SettingsComponent {
  readonly savedNotification = signal<boolean>(false);

  preferences: UserPreferences = {
    defaultHistoryMinutes: 15,
    enableSoundAlerts: false,
    maxIncidentsRetention: 50,
    highContrastMode: false,
    themePreference: 'dark'
  };

  onSaveSettings(form: { valid?: boolean | null }): void {
    if (!form.valid) return;
    this.savedNotification.set(true);
    setTimeout(() => {
      this.savedNotification.set(false);
    }, 3000);
  }
}

