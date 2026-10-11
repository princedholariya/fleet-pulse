import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ApiErrorResponse } from '../../core/models/auth.model';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly isPending = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly loginForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(4)]]
  });

  fillDemo(email: string): void {
    this.loginForm.patchValue({
      email,
      password: 'pulse123'
    });
    this.errorMessage.set(null);
  }

  onSubmit(): void {
    if (this.loginForm.invalid || this.isPending()) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isPending.set(true);
    this.errorMessage.set(null);

    const { email, password } = this.loginForm.getRawValue();

    this.authService.login({ email: email!, password: password! }).subscribe({
      next: () => {
        this.isPending.set(false);
        const returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/';
        this.router.navigateByUrl(returnUrl);
      },
      error: (err: { error?: ApiErrorResponse['error']; message?: string }) => {
        this.isPending.set(false);
        const msg = err.error?.message || err.message || 'Login failed. Please check your credentials.';
        this.errorMessage.set(msg);
      }
    });
  }
}

