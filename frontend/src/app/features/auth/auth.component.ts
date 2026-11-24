// =============================================================================
// features/auth/auth.component.ts — Login & Register Components
// =============================================================================
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router, Routes } from '@angular/router';
import { AuthService } from '../../core/services/services';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  styleUrls: ['./auth.component.scss'],
  template: `
<div class="auth-page">
  <div class="auth-bg-decor">
    <div class="auth-orb-top"></div>
    <div class="auth-orb-bottom"></div>
  </div>

  <div class="auth-card slide-up">
    <div class="auth-header">
      <div class="auth-brand-icon">
        <span>dns</span>
      </div>
      <h1>Welcome back</h1>
      <p>Sign in to SMaRT Platform</p>
    </div>

    <div class="form-group">
      <label class="form-label">Email address</label>
      <input
        type="email"
        class="form-control auth-input"
        [(ngModel)]="email"
        placeholder="your&#64;email.com"
        (keyup.enter)="login()" />
    </div>

    <div class="form-group">
      <label class="form-label auth-label-row">
        <span>Password</span>
        <button type="button" class="auth-forgot-btn" (click)="toggleForgotHelp()">
          Forgot password?
        </button>
      </label>
      <div class="auth-pw-wrap">
        <input
          [type]="showPwd ? 'text' : 'password'"
          class="form-control auth-input auth-input-pw"
          [(ngModel)]="password"
          placeholder="••••••••"
          (keyup.enter)="login()" />
        <button
          type="button"
          class="auth-pw-eye"
          (click)="showPwd = !showPwd"
          aria-label="Toggle password visibility">
          {{ showPwd ? 'visibility_off' : 'visibility' }}
        </button>
      </div>

      <div class="auth-forgot-notice" *ngIf="showForgotHelp">
        <span class="mat-ic">info</span>
        <span>
          Self-service email reset is disabled on private deployments. Please contact your platform administrator to reset your credentials or use My Profile once signed in.
        </span>
      </div>
    </div>

    <div class="auth-error" *ngIf="error">
      <span>error</span>
      {{ error }}
    </div>

    <button class="btn btn-primary w-full auth-submit" (click)="login()" [disabled]="loading">
      <div class="spinner auth-spinner" *ngIf="loading"></div>
      {{ loading ? 'Signing in…' : 'Sign In' }}
    </button>

    <p class="auth-footer">
      Don't have an account?
      <a routerLink="/auth/register">Create account</a>
    </p>
  </div>
</div>
  `
})
export class LoginComponent {
  email = '';
  password = '';
  error = '';
  loading = false;
  showPwd = false;
  showForgotHelp = false;

  constructor(private auth: AuthService, private router: Router) {}

  toggleForgotHelp(): void {
    this.showForgotHelp = !this.showForgotHelp;
  }

  login(): void {
    if (!this.email || !this.password) {
      this.error = 'Please fill in all fields';
      return;
    }
    this.loading = true;
    this.error = '';
    this.auth.login({ email: this.email, password: this.password }).subscribe({
      next: () => {
        this.loading = false;
        this.router.navigate(['/dashboard']).catch(() => {
          this.error = 'Login succeeded but navigation failed. Reload the page.';
        });
      },
      error: (err) => {
        this.loading = false;
        const validationMessage = Array.isArray(err?.error?.errors) && err.error.errors.length
          ? String(err.error.errors[0].message || '')
          : '';
        this.error = validationMessage || err?.error?.message || 'Invalid email or password';
      }
    });
  }
}

// =============================================================================
// RegisterComponent
// =============================================================================
@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  styleUrls: ['./auth.component.scss'],
  template: `
<div class="auth-page">
  <div class="auth-bg-decor">
    <div class="auth-orb-top"></div>
    <div class="auth-orb-bottom"></div>
  </div>

  <div class="auth-card auth-card-wide slide-up">
    <div class="auth-header">
      <div class="auth-brand-icon">
        <span>person_add</span>
      </div>
      <h1>Create your account</h1>
      <p>Join the SMaRT Platform</p>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">First Name *</label>
        <input class="form-control" [(ngModel)]="form.first_name" placeholder="John" />
      </div>
      <div class="form-group">
        <label class="form-label">Last Name *</label>
        <input class="form-control" [(ngModel)]="form.last_name" placeholder="Doe" />
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Username *</label>
      <input class="form-control" [(ngModel)]="form.username" placeholder="johndoe" />
    </div>

    <div class="form-group">
      <label class="form-label">Email address *</label>
      <input type="email" class="form-control" [(ngModel)]="form.email" placeholder="john&#64;company.com" />
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Department</label>
        <input class="form-control" [(ngModel)]="form.department" placeholder="IT / DevOps" />
      </div>
      <div class="form-group">
        <label class="form-label">Job Title</label>
        <input class="form-control" [(ngModel)]="form.job_title" placeholder="Sr. Engineer" />
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Password *</label>
      <div class="auth-pw-wrap">
        <input
          [type]="showPwd ? 'text' : 'password'"
          class="form-control auth-input auth-input-pw"
          [(ngModel)]="form.password"
          placeholder="Min. 8 characters" />
        <button
          type="button"
          class="auth-pw-eye"
          (click)="showPwd = !showPwd"
          aria-label="Toggle password visibility">
          {{ showPwd ? 'visibility_off' : 'visibility' }}
        </button>
      </div>

      <div class="reg-strength-wrap" *ngIf="form.password">
        <div class="reg-bars">
          <span class="reg-bar" [class.filled]="pwScore >= 1" [ngClass]="pwStrengthTone"></span>
          <span class="reg-bar" [class.filled]="pwScore >= 2" [ngClass]="pwStrengthTone"></span>
          <span class="reg-bar" [class.filled]="pwScore >= 3" [ngClass]="pwStrengthTone"></span>
          <span class="reg-bar" [class.filled]="pwScore >= 4" [ngClass]="pwStrengthTone"></span>
        </div>
        <span class="reg-strength-text" [ngClass]="pwStrengthTone">{{ pwStrengthLabel }}</span>
      </div>

      <div class="reg-checks">
        <span class="reg-check" [class.met]="pwHasMinLen">
          <span>{{ pwHasMinLen ? 'check_circle' : 'radio_button_unchecked' }}</span> 8+ chars
        </span>
        <span class="reg-check" [class.met]="pwHasUpper">
          <span>{{ pwHasUpper ? 'check_circle' : 'radio_button_unchecked' }}</span> Uppercase
        </span>
        <span class="reg-check" [class.met]="pwHasLower">
          <span>{{ pwHasLower ? 'check_circle' : 'radio_button_unchecked' }}</span> Lowercase
        </span>
        <span class="reg-check" [class.met]="pwHasNumber">
          <span>{{ pwHasNumber ? 'check_circle' : 'radio_button_unchecked' }}</span> Number
        </span>
      </div>
    </div>

    <div class="auth-error" *ngIf="error">
      <span>error</span>
      {{ error }}
    </div>

    <button class="btn btn-primary w-full auth-submit" (click)="register()" [disabled]="loading">
      <div class="spinner auth-spinner" *ngIf="loading"></div>
      {{ loading ? 'Creating account…' : 'Create Account' }}
    </button>

    <p class="auth-footer">
      Already have an account?
      <a routerLink="/auth/login">Sign in</a>
    </p>
  </div>
</div>
  `
})
export class RegisterComponent {
  form = { first_name: '', last_name: '', username: '', email: '', password: '', department: '', job_title: '' };
  error = '';
  loading = false;
  showPwd = false;

  constructor(private auth: AuthService, private router: Router) {}

  get pwHasMinLen(): boolean { return this.form.password.length >= 8; }
  get pwHasUpper(): boolean { return /[A-Z]/.test(this.form.password); }
  get pwHasLower(): boolean { return /[a-z]/.test(this.form.password); }
  get pwHasNumber(): boolean { return /\d/.test(this.form.password); }

  get pwScore(): number {
    let s = 0;
    if (this.pwHasMinLen) s++;
    if (this.pwHasUpper) s++;
    if (this.pwHasLower) s++;
    if (this.pwHasNumber) s++;
    return s;
  }

  get pwStrengthLabel(): string {
    if (!this.form.password) return '';
    if (this.pwScore <= 1) return 'Weak';
    if (this.pwScore === 2) return 'Fair';
    if (this.pwScore === 3) return 'Good';
    return 'Strong';
  }

  get pwStrengthTone(): string {
    if (!this.form.password) return 'tone-neutral';
    if (this.pwScore <= 1) return 'tone-danger';
    if (this.pwScore === 2) return 'tone-warning';
    if (this.pwScore === 3) return 'tone-info';
    return 'tone-success';
  }

  register(): void {
    const { first_name, last_name, username, email, password } = this.form;
    if (!first_name || !last_name || !username || !email || !password) {
      this.error = 'Please fill in all required fields';
      return;
    }
    if (password.length < 8) {
      this.error = 'Password must be at least 8 characters';
      return;
    }
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      this.error = 'Password must include uppercase, lowercase, and a number';
      return;
    }

    this.loading = true;
    this.error = '';
    this.auth.register(this.form).subscribe({
      next: () => {
        this.loading = false;
        this.router.navigate(['/dashboard']).catch(() => {
          this.error = 'Account created but navigation failed. Reload the page.';
        });
      },
      error: (err) => {
        this.loading = false;
        const validationMessage = Array.isArray(err?.error?.errors) && err.error.errors.length
          ? String(err.error.errors[0].message || '')
          : '';
        this.error = validationMessage || err?.error?.message || 'Registration failed';
      }
    });
  }
}

export const AUTH_ROUTES: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  { path: '', redirectTo: 'login', pathMatch: 'full' }
];
