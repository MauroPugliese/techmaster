// =============================================================================
// features/auth/login.component.ts
// =============================================================================
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../../core/services/services';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
            background:linear-gradient(135deg,#0A1628 0%,#1565C0 100%);padding:20px;position:relative;overflow:hidden">

  <div style="position:absolute;inset:0;pointer-events:none;overflow:hidden">
    <div style="position:absolute;top:-120px;right:-120px;width:500px;height:500px;border-radius:50%;
                background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07)"></div>
    <div style="position:absolute;bottom:-100px;left:-100px;width:400px;height:400px;border-radius:50%;
                background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05)"></div>
  </div>

  <div style="background:#fff;border-radius:24px;padding:48px;width:100%;max-width:440px;
              box-shadow:0 40px 80px rgba(0,0,0,0.4);position:relative;z-index:1" class="slide-up">

    <div style="text-align:center;margin-bottom:36px">
      <div style="width:56px;height:56px;background:#1565C0;border-radius:16px;
                  display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
        <span style="font-family:'Material Icons Round';font-style:normal;font-size:28px;color:#fff">dns</span>
      </div>
      <h1 style="font-size:1.6rem;margin-bottom:6px;font-weight:800">Welcome back</h1>
      <p style="color:#6B7280;font-size:0.9rem">Sign in to TechManager Platform</p>
    </div>

    <div class="form-group">
      <label class="form-label">Email address</label>
      <input type="email" class="form-control" [(ngModel)]="email" placeholder="your@email.com"
             style="padding:12px 16px" (keyup.enter)="login()">
    </div>

    <div class="form-group">
      <label class="form-label" style="display:flex;justify-content:space-between">
        Password
        <a href="#" style="color:#1565C0;font-weight:500;font-size:0.82rem">Forgot password?</a>
      </label>
      <div style="position:relative">
        <input [type]="showPwd ? 'text' : 'password'" class="form-control"
               [(ngModel)]="password" placeholder="••••••••"
               style="padding:12px 16px;padding-right:48px" (keyup.enter)="login()">
        <button type="button" (click)="showPwd=!showPwd"
                style="position:absolute;right:12px;top:50%;transform:translateY(-50%);
                       background:none;border:none;cursor:pointer;color:#9CA3AF;font-family:'Material Icons Round';font-style:normal;font-size:20px">
          {{showPwd ? 'visibility_off' : 'visibility'}}
        </button>
      </div>
    </div>

    <div *ngIf="error"
         style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;
                padding:10px 14px;font-size:0.875rem;color:#DC2626;margin-bottom:16px;
                display:flex;align-items:center;gap:8px">
      <span style="font-family:'Material Icons Round';font-style:normal;font-size:18px">error</span>
      {{error}}
    </div>

    <button class="btn btn-primary w-full" style="padding:13px;font-size:1rem" (click)="login()" [disabled]="loading">
      <div class="spinner" *ngIf="loading" style="width:18px;height:18px;border-width:2px;border-top-color:#fff"></div>
      {{loading ? 'Signing in…' : 'Sign In'}}
    </button>

    <p style="text-align:center;margin-top:24px;font-size:0.875rem;color:#6B7280">
      Don't have an account?
      <a routerLink="/auth/register" style="color:#1565C0;font-weight:600;margin-left:4px">Create account</a>
    </p>
  </div>
</div>
  `
})
export class LoginComponent {
  email    = '';
  password = '';
  error    = '';
  loading  = false;
  showPwd  = false;

  constructor(private auth: AuthService, private router: Router) {}

  login(): void {
    if (!this.email || !this.password) { this.error = 'Please fill in all fields'; return; }
    this.loading = true;
    this.error   = '';
    this.auth.login({ email: this.email, password: this.password }).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: (err) => {
        this.loading = false;
        this.error   = err?.error?.message || 'Invalid email or password';
      }
    });
  }
}

// =============================================================================
// features/auth/register.component.ts
// =============================================================================
@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
            background:linear-gradient(135deg,#0A1628 0%,#1565C0 100%);padding:20px">
  <div style="background:#fff;border-radius:24px;padding:48px;width:100%;max-width:520px;
              box-shadow:0 40px 80px rgba(0,0,0,0.4)" class="slide-up">

    <div style="text-align:center;margin-bottom:32px">
      <div style="width:56px;height:56px;background:#1565C0;border-radius:16px;
                  display:flex;align-items:center;justify-content:center;margin:0 auto 14px">
        <span style="font-family:'Material Icons Round';font-style:normal;font-size:28px;color:#fff">person_add</span>
      </div>
      <h1 style="font-size:1.5rem;font-weight:800;margin-bottom:4px">Create your account</h1>
      <p style="color:#6B7280;font-size:0.9rem">Join the TechManager Platform</p>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">First Name *</label>
        <input class="form-control" [(ngModel)]="form.first_name" placeholder="John">
      </div>
      <div class="form-group">
        <label class="form-label">Last Name *</label>
        <input class="form-control" [(ngModel)]="form.last_name" placeholder="Doe">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Username *</label>
      <input class="form-control" [(ngModel)]="form.username" placeholder="johndoe">
    </div>
    <div class="form-group">
      <label class="form-label">Email address *</label>
      <input type="email" class="form-control" [(ngModel)]="form.email" placeholder="john@company.com">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Department</label>
        <input class="form-control" [(ngModel)]="form.department" placeholder="IT / DevOps">
      </div>
      <div class="form-group">
        <label class="form-label">Job Title</label>
        <input class="form-control" [(ngModel)]="form.job_title" placeholder="Sr. Engineer">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Password *</label>
      <input type="password" class="form-control" [(ngModel)]="form.password" placeholder="Min. 8 characters">
    </div>

    <div *ngIf="error" style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;
                               padding:10px 14px;font-size:0.875rem;color:#DC2626;margin-bottom:16px">
      {{error}}
    </div>

    <button class="btn btn-primary w-full" style="padding:13px;font-size:1rem" (click)="register()" [disabled]="loading">
      <div class="spinner" *ngIf="loading" style="width:18px;height:18px;border-width:2px;border-top-color:#fff"></div>
      {{loading ? 'Creating account…' : 'Create Account'}}
    </button>

    <p style="text-align:center;margin-top:20px;font-size:0.875rem;color:#6B7280">
      Already have an account?
      <a routerLink="/auth/login" style="color:#1565C0;font-weight:600;margin-left:4px">Sign in</a>
    </p>
  </div>
</div>
  `
})
export class RegisterComponent {
  form    = { first_name:'', last_name:'', username:'', email:'', password:'', department:'', job_title:'' };
  error   = '';
  loading = false;

  constructor(private auth: AuthService, private router: Router) {}

  register(): void {
    const { first_name, last_name, username, email, password } = this.form;
    if (!first_name || !last_name || !username || !email || !password) {
      this.error = 'Please fill in all required fields'; return;
    }
    if (password.length < 8) { this.error = 'Password must be at least 8 characters'; return; }

    this.loading = true; this.error = '';
    this.auth.register(this.form).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: (err) => { this.loading = false; this.error = err?.error?.message || 'Registration failed'; }
    });
  }
}

// =============================================================================
// features/auth/auth.routes.ts
// =============================================================================
import { Routes } from '@angular/router';
export const AUTH_ROUTES: Routes = [
  { path: 'login',    component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  { path: '',         redirectTo: 'login', pathMatch: 'full' }
];
