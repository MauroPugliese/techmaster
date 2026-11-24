import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  AuthService,
  ApiService,
  ToastService,
  ConfirmService
} from '../../core/services/services';
import { User } from '../../core/models/interfaces';

interface SessionRow {
  id: number;
  created_at: string;
  expires_at: string;
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProfileComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  currentUser: User | null = null;
  avatarLoadError = false;

  // Profile form
  firstName = '';
  lastName = '';
  department = '';
  jobTitle = '';
  phone = '';
  avatarUrl = '';
  savingProfile = false;

  // Password form
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  showCurrentPw = false;
  showNewPw = false;
  showConfirmPw = false;
  savingPassword = false;

  // Active sessions
  sessions: SessionRow[] = [];
  loadingSessions = false;
  revokingSessions = false;

  constructor(
    private auth: AuthService,
    private api: ApiService,
    private toast: ToastService,
    private confirm: ConfirmService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.auth.currentUser$.pipe(takeUntil(this.destroy$)).subscribe((user) => {
      if (!user) return;
      this.currentUser = user;
      this.syncFormFromUser(user);
      this.cdr.markForCheck();
    });

    this.loadSessions();
  }

  private syncFormFromUser(user: User): void {
    this.firstName = user.first_name || '';
    this.lastName = user.last_name || '';
    this.department = user.department || '';
    this.jobTitle = user.job_title || '';
    this.phone = user.phone || '';
    this.avatarUrl = user.avatar_url || '';
    this.avatarLoadError = false;
  }

  get fullName(): string {
    return `${this.firstName || this.currentUser?.first_name || ''} ${this.lastName || this.currentUser?.last_name || ''}`.trim()
      || this.currentUser?.username
      || 'User';
  }

  get initials(): string {
    const f = (this.firstName || this.currentUser?.first_name || this.currentUser?.username || '?')[0] || '?';
    const l = (this.lastName || this.currentUser?.last_name || '')[0] || '';
    return `${f}${l}`.toUpperCase();
  }

  get pwHasMinLen(): boolean {
    return this.newPassword.length >= 8;
  }

  get pwHasUpper(): boolean {
    return /[A-Z]/.test(this.newPassword);
  }

  get pwHasLower(): boolean {
    return /[a-z]/.test(this.newPassword);
  }

  get pwHasNumber(): boolean {
    return /\d/.test(this.newPassword);
  }

  get pwScore(): number {
    let s = 0;
    if (this.pwHasMinLen) s++;
    if (this.pwHasUpper) s++;
    if (this.pwHasLower) s++;
    if (this.pwHasNumber) s++;
    return s;
  }

  get pwStrengthLabel(): string {
    if (!this.newPassword) return 'Enter a new password';
    if (this.pwScore <= 1) return 'Weak';
    if (this.pwScore === 2) return 'Fair';
    if (this.pwScore === 3) return 'Almost there';
    return 'Strong';
  }

  get pwStrengthClass(): string {
    if (!this.newPassword) return 'tone-neutral';
    if (this.pwScore <= 1) return 'tone-danger';
    if (this.pwScore === 2) return 'tone-warning';
    if (this.pwScore === 3) return 'tone-info';
    return 'tone-success';
  }

  get passwordsMatch(): boolean {
    return Boolean(this.newPassword) && this.newPassword === this.confirmPassword;
  }

  get canSubmitPassword(): boolean {
    return Boolean(
      this.currentPassword &&
      this.pwHasMinLen &&
      this.pwHasUpper &&
      this.pwHasLower &&
      this.pwHasNumber &&
      this.passwordsMatch &&
      !this.savingPassword
    );
  }

  onAvatarUrlChange(): void {
    this.avatarLoadError = false;
  }

  saveProfile(): void {
    if (this.savingProfile) return;
    const trimmedFirst = this.firstName.trim();
    const trimmedLast = this.lastName.trim();
    if (!trimmedFirst || !trimmedLast) {
      this.toast.warning('First name and last name are required.', 'Validation');
      return;
    }

    this.savingProfile = true;
    this.cdr.markForCheck();

    const payload: Record<string, string> = {
      first_name: trimmedFirst,
      last_name: trimmedLast,
      department: this.department.trim(),
      job_title: this.jobTitle.trim(),
      phone: this.phone.trim(),
      avatar_url: this.avatarUrl.trim()
    };

    this.auth.updateProfile(payload).subscribe({
      next: () => {
        this.savingProfile = false;
        this.toast.success('Your profile information has been updated.');
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.savingProfile = false;
        const msg = err?.error?.errors?.[0]?.msg || err?.error?.message || 'Unable to update profile.';
        this.toast.error(msg, 'Update Failed');
        this.cdr.markForCheck();
      }
    });
  }

  updatePassword(): void {
    if (!this.canSubmitPassword) return;
    this.savingPassword = true;
    this.cdr.markForCheck();

    this.auth.updateProfile({
      current_password: this.currentPassword,
      new_password: this.newPassword
    } as any).subscribe({
      next: () => {
        this.savingPassword = false;
        this.currentPassword = '';
        this.newPassword = '';
        this.confirmPassword = '';
        this.toast.success('Password updated successfully.');
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.savingPassword = false;
        const msg = err?.error?.errors?.[0]?.msg || err?.error?.message || 'Unable to update password.';
        this.toast.error(msg, 'Password Error');
        this.cdr.markForCheck();
      }
    });
  }

  loadSessions(): void {
    this.loadingSessions = true;
    this.cdr.markForCheck();

    this.api.get<any>('/auth/sessions').subscribe({
      next: (res) => {
        this.loadingSessions = false;
        this.sessions = res?.data?.sessions || [];
        this.cdr.markForCheck();
      },
      error: () => {
        this.loadingSessions = false;
        this.sessions = [];
        this.cdr.markForCheck();
      }
    });
  }

  async revokeAllSessions(): Promise<void> {
    if (this.revokingSessions) return;
    const countLabel = this.sessions.length
      ? `${this.sessions.length} active refresh session${this.sessions.length === 1 ? '' : 's'}`
      : 'all active sessions';

    const confirmed = await this.confirm.confirm(
      `This will revoke ${countLabel} across every device and sign you out now.`,
      'Sign Out All Devices',
      true
    );
    if (!confirmed) return;

    this.revokingSessions = true;
    this.cdr.markForCheck();

    this.api.post<any>('/auth/revoke-sessions', {}).subscribe({
      next: () => {
        this.revokingSessions = false;
        this.toast.info('All sessions revoked. Signing out…');
        this.auth.logout();
      },
      error: (err) => {
        this.revokingSessions = false;
        this.toast.error(err?.error?.message || 'Failed to revoke active sessions.');
        this.cdr.markForCheck();
      }
    });
  }

  trackBySessionId(_: number, row: SessionRow): number {
    return row.id;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
