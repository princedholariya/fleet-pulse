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
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
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
