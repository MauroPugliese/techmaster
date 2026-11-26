// =============================================================================
// task-detail-drawer.component.ts — 2-Column Task Detail, Subtasks & @Mentions
// =============================================================================
import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, OnDestroy,
  ChangeDetectionStrategy, ChangeDetectorRef, ViewChild, ElementRef, HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { ApiService, ToastService, UiCustomizationService, UiSectionPreferences } from '../../../../core/services/services';
import {
  IntervalType, Priority, Simulator, Task, TaskAssignee, TaskComment, TaskStatus, User
} from '../../../../core/models/interfaces';
import { DateTimePickerComponent } from '../../../../shared/components/datetime-picker/datetime-picker.component';
import { DropdownComponent, DropdownOptionComponent } from '../../../../shared/components/dropdown/dropdown.component';
import {
  CommentSegment,
  HoursProgress,
  formatRelativeTime,
  getAvatarColor,
  getDoneSubtasks,
  getHoursProgress,
  getInitials,
  getPriorityBadge,
  getUserDisplayName,
  parseCommentSegments
} from '../../task-helpers';

@Component({
  selector: 'app-task-detail-drawer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DateTimePickerComponent,
    DropdownComponent,
    DropdownOptionComponent
  ],
  templateUrl: './task-detail-drawer.component.html',
  styleUrls: ['./task-detail-drawer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TaskDetailDrawerComponent implements OnChanges, OnDestroy {
  @Input() open = false;
  @Input() task: Task | null = null;
  @Input() defaultStatus: TaskStatus = 'TODO';
  @Input() defaultInterval: IntervalType = 'ONCE';
  @Input() defaultTitle = '';
  @Input() assignees: TaskAssignee[] = [];
  @Input() simulators: Simulator[] = [];
  @Input() allTasks: Task[] = [];
  @Input() currentUser: User | null = null;
  @Input() uiPrefs: UiSectionPreferences | null = null;
  @Input() saving = false;

  @Output() close       = new EventEmitter<void>();
  @Output() save        = new EventEmitter<{ id: number | null; payload: any }>();
  @Output() deleteTask  = new EventEmitter<Task>();
  @Output() taskMutated = new EventEmitter<Task>();

  @ViewChild('commentBox') commentBoxRef?: ElementRef<HTMLTextAreaElement>;

  private destroy$ = new Subject<void>();

  form: any = this.createEmptyForm();
  tagsList: string[] = [];
  tagDraft = '';

  subtasksList: Task[] = [];
  newSubtaskTitle = '';
  addingSubtask = false;

  comments: TaskComment[] = [];
  loadingComments = false;
  commentText = '';
  postingComment = false;

  // @mention autocomplete state
  mentionQuery: string | null = null;
  mentionStartIndex = -1;
  mentionCandidates: TaskAssignee[] = [];
  mentionIndex = 0;

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private uiCustomization: UiCustomizationService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    const openedNow = !!changes['open']?.currentValue && !changes['open']?.previousValue;
    const prevTaskId = changes['task']?.previousValue?.id ?? null;
    const nextTaskId = changes['task']?.currentValue?.id ?? null;
    const switchedTask = this.open && !!changes['task'] && prevTaskId !== nextTaskId;

    if (openedNow || switchedTask || (this.open && !this.task && (changes['defaultStatus'] || changes['defaultTitle']))) {
      this.syncFormFromInput();
    }
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEsc(event: KeyboardEvent): void {
    if (!this.open) return;
    if (this.mentionCandidates.length) {
      event.stopPropagation();
      this.clearMentions();
      return;
    }
    this.close.emit();
  }

  get parentTaskOptions(): Task[] {
    const currentId = this.task?.id;
    return this.allTasks.filter(t => t.id !== currentId);
  }

  get formHoursProgress(): HoursProgress {
    return getHoursProgress({
      estimated_hours: this.form.estimated_hours,
      actual_hours: this.form.actual_hours
    });
  }

  get doneSubtasksCount(): number {
    return this.subtasksList.filter(s => s.status === 'DONE').length;
  }

  private syncFormFromInput(): void {
    this.clearMentions();
    this.tagDraft = '';
    this.newSubtaskTitle = '';
    this.commentText = '';

    if (this.task) {
      this.form = {
        title:           this.task.title || '',
        description:     this.task.description || '',
        interval_type:   this.task.interval_type || 'ONCE',
        status:          this.task.status || 'TODO',
        priority:        this.task.priority || 'MEDIUM',
        simulator_id:    this.task.simulator_id ?? this.task.simulator?.id ?? null,
        assigned_to:     this.task.assigned_to ?? this.task.assignee?.id ?? null,
        estimated_hours: this.task.estimated_hours ?? null,
        actual_hours:    this.task.actual_hours ?? null,
        due_date:        this.task.due_date ? new Date(this.task.due_date) : null,
        parent_id:       this.task.parent_id ?? null
      };
      this.tagsList     = [...(this.task.tags || [])];
      this.subtasksList = [...(this.task.subtasks || [])];
      this.loadComments(this.task.id);
    } else {
      this.form = this.createEmptyForm();
      this.tagsList     = [];
      this.subtasksList = [];
      this.comments     = [];
    }
    this.cdr.markForCheck();
  }

  private createEmptyForm(): any {
    return {
      title:           this.defaultTitle || '',
      description:     '',
      interval_type:   this.defaultInterval || 'ONCE',
      status:          this.defaultStatus || 'TODO',
      priority:        'MEDIUM' as Priority,
      simulator_id:    null,
      assigned_to:     null,
      estimated_hours: null,
      actual_hours:    null,
      due_date:        null,
      parent_id:       null
    };
  }

  assignToMe(): void {
    if (!this.currentUser?.id) return;
    this.form = { ...this.form, assigned_to: this.currentUser.id };
  }

  quickCreateParentTask(rawTitle: string): void {
    const title = rawTitle.trim();
    if (!title) return;
    this.api.post<any>('/tasks', {
      title,
      interval_type: 'ONCE',
      status: 'TODO',
      priority: 'MEDIUM'
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        const created: Task = res?.data;
        if (created) {
          this.allTasks = [created, ...this.allTasks];
          this.form = { ...this.form, parent_id: created.id };
          this.toast.success(`Parent task "${created.title}" created.`);
          this.cdr.markForCheck();
        }
      },
      error: (e: any) => this.toast.error(e?.error?.message || 'Unable to create parent task.')
    });
  }

  quickCreateSimulator(rawLabel: string): void {
    const label = rawLabel.trim();
    if (!label) return;
    const cleanCode = label.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 16) || `SIM-${Date.now().toString().slice(-4)}`;
    this.api.post<any>('/simulators', {
      code: cleanCode,
      name: label,
      bay_code: cleanCode.slice(0, 12),
      station_kind: 'FFS_BAY',
      status: 'READY'
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        const created: Simulator = res?.data;
        if (created) {
          this.simulators = [...this.simulators, created];
          this.form = { ...this.form, simulator_id: created.id };
          this.toast.success(`Simulator "${created.name}" created.`);
          this.cdr.markForCheck();
        }
      },
      error: (e: any) => this.toast.error(e?.error?.message || 'Unable to create simulator bay.')
    });
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('drawer-backdrop')) {
      this.close.emit();
    }
  }

  submitForm(): void {
    if (this.showFormField('title') && !String(this.form.title || '').trim()) return;
    this.commitTagDraft();

    const payload = {
      title:           String(this.form.title || '').trim(),
      description:     this.form.description ? String(this.form.description).trim() : null,
      interval_type:   this.form.interval_type,
      status:          this.form.status,
      priority:        this.form.priority,
      simulator_id:    this.form.simulator_id ? Number(this.form.simulator_id) : null,
      assigned_to:     this.form.assigned_to || null,
      estimated_hours: this.form.estimated_hours === '' ? null : this.form.estimated_hours,
      actual_hours:    this.form.actual_hours === '' ? null : this.form.actual_hours,
      due_date:        this.form.due_date || null,
      parent_id:       this.form.parent_id || null,
      tags:            [...this.tagsList]
    };

    this.save.emit({ id: this.task ? this.task.id : null, payload });
  }

  // ── Tags editor ────────────────────────────────────────────────────────────
  onTagKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      this.commitTagDraft();
    } else if (event.key === 'Backspace' && !this.tagDraft && this.tagsList.length) {
      this.tagsList = this.tagsList.slice(0, -1);
    }
  }

  commitTagDraft(): void {
    const clean = this.tagDraft.replace(/,/g, '').trim().slice(0, 40);
    this.tagDraft = '';
    if (!clean) return;
    if (!this.tagsList.includes(clean) && this.tagsList.length < 20) {
      this.tagsList = [...this.tagsList, clean];
    }
  }

  removeTag(index: number): void {
    this.tagsList = this.tagsList.filter((_, i) => i !== index);
  }

  // ── Interactive subtasks ───────────────────────────────────────────────────
  addSubtask(): void {
    if (!this.task || this.addingSubtask) return;
    const title = this.newSubtaskTitle.trim();
    if (!title) return;

    this.addingSubtask = true;
    this.cdr.markForCheck();

    this.api.post<any>('/tasks', {
      title,
      parent_id:     this.task.id,
      interval_type: 'ONCE',
      status:        'TODO',
      priority:      'MEDIUM'
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: res => {
        const created: Task = res.data;
        this.subtasksList = [...this.subtasksList, created];
        this.newSubtaskTitle = '';
        this.addingSubtask = false;
        this.emitMutatedTask();
        this.cdr.markForCheck();
      },
      error: (e: any) => {
        this.addingSubtask = false;
        this.toast.error(e?.error?.message || 'Failed to add subtask.');
        this.cdr.markForCheck();
      }
    });
  }

  toggleSubtask(sub: Task): void {
    if (!this.task) return;
    const prevStatus = sub.status;
    const nextStatus: TaskStatus = sub.status === 'DONE' ? 'TODO' : 'DONE';

    this.subtasksList = this.subtasksList.map(s =>
      s.id === sub.id ? { ...s, status: nextStatus } : s
    );
    this.emitMutatedTask();

    this.api.put<any>(`/tasks/${sub.id}`, { status: nextStatus })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        error: (e: any) => {
          this.subtasksList = this.subtasksList.map(s =>
            s.id === sub.id ? { ...s, status: prevStatus } : s
          );
          this.emitMutatedTask();
          this.toast.error(e?.error?.message || 'Failed to update subtask.');
          this.cdr.markForCheck();
        }
      });
  }

  deleteSubtask(sub: Task): void {
    if (!this.task) return;
    const prev = this.subtasksList;
    this.subtasksList = this.subtasksList.filter(s => s.id !== sub.id);
    this.emitMutatedTask();

    this.api.delete<any>(`/tasks/${sub.id}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        error: (e: any) => {
          this.subtasksList = prev;
          this.emitMutatedTask();
          this.toast.error(e?.error?.message || 'Failed to delete subtask.');
          this.cdr.markForCheck();
        }
      });
  }

  // ── Comments & @mentions ───────────────────────────────────────────────────
  private loadComments(taskId: number): void {
    this.loadingComments = true;
    this.api.get<any>(`/tasks/${taskId}/comments`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          if (this.task?.id === taskId) {
            this.comments = res.data || [];
            this.loadingComments = false;
            this.cdr.markForCheck();
          }
        },
        error: () => {
          this.loadingComments = false;
          this.cdr.markForCheck();
        }
      });
  }

  onCommentInput(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    const caret = el.selectionStart ?? this.commentText.length;
    const beforeCaret = this.commentText.slice(0, caret);
    const match = /(?:^|[\s([{"'])@([a-zA-Z0-9_.-]*)$/.exec(beforeCaret);

    if (!match) {
      this.clearMentions();
      return;
    }

    const query = match[1].toLowerCase();
    this.mentionQuery = query;
    this.mentionStartIndex = caret - match[1].length - 1;
    this.mentionCandidates = this.assignees
      .filter(u =>
        u.username.toLowerCase().includes(query) ||
        `${u.first_name} ${u.last_name}`.toLowerCase().includes(query)
      )
      .slice(0, 6);
    this.mentionIndex = 0;
  }

  onCommentKeydown(event: KeyboardEvent): void {
    if (this.mentionCandidates.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.mentionIndex = (this.mentionIndex + 1) % this.mentionCandidates.length;
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.mentionIndex = (this.mentionIndex - 1 + this.mentionCandidates.length) % this.mentionCandidates.length;
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        this.insertMention(this.mentionCandidates[this.mentionIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.clearMentions();
        return;
      }
    }

    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      this.postComment();
    }
  }

  insertMention(user: TaskAssignee): void {
    if (!user) return;
    const el = this.commentBoxRef?.nativeElement;
    const caret = el?.selectionStart ?? this.commentText.length;
    const start = this.mentionStartIndex >= 0 ? this.mentionStartIndex : caret;
    const prefix = this.commentText.slice(0, start);
    const suffix = this.commentText.slice(caret);
    const inserted = `@${user.username} `;

    this.commentText = prefix + inserted + suffix;
    this.clearMentions();
    this.cdr.markForCheck();

    setTimeout(() => {
      if (!el) return;
      const nextPos = prefix.length + inserted.length;
      el.focus();
      el.setSelectionRange(nextPos, nextPos);
    }, 0);
  }

  postComment(): void {
    if (!this.task || this.postingComment) return;
    const content = this.commentText.trim();
    if (!content) return;

    this.postingComment = true;
    this.clearMentions();
    this.cdr.markForCheck();

    this.api.post<any>(`/tasks/${this.task.id}/comments`, { content })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.comments = [...this.comments, res.data];
          this.commentText = '';
          this.postingComment = false;
          this.emitMutatedTask();
          this.cdr.markForCheck();
        },
        error: (e: any) => {
          this.postingComment = false;
          this.toast.error(e?.error?.message || 'Failed to post comment.');
          this.cdr.markForCheck();
        }
      });
  }

  canDeleteComment(c: TaskComment): boolean {
    if (!this.currentUser) return false;
    const role = this.currentUser.role?.name;
    return c.user_id === this.currentUser.id || role === 'admin' || role === 'manager';
  }

  removeComment(comment: TaskComment): void {
    if (!this.task) return;
    const prev = this.comments;
    this.comments = this.comments.filter(c => c.id !== comment.id);
    this.emitMutatedTask();

    this.api.delete<any>(`/tasks/${this.task.id}/comments/${comment.id}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        error: (e: any) => {
          this.comments = prev;
          this.emitMutatedTask();
          this.toast.error(e?.error?.message || 'Failed to delete comment.');
          this.cdr.markForCheck();
        }
      });
  }

  private clearMentions(): void {
    this.mentionQuery = null;
    this.mentionStartIndex = -1;
    this.mentionCandidates = [];
    this.mentionIndex = 0;
  }

  private emitMutatedTask(): void {
    if (!this.task) return;
    this.taskMutated.emit({
      ...this.task,
      subtasks: [...this.subtasksList],
      comments_count: this.comments.length
    });
  }

  commentSegments(text: string): CommentSegment[] {
    return parseCommentSegments(text);
  }

  showFormField(fieldKey: string): boolean {
    return this.uiCustomization.isVisible(this.uiPrefs, 'form', fieldKey, true);
  }

  fieldLabel(scope: 'table' | 'form', fieldKey: string, fallback: string): string {
    return this.uiCustomization.getLabel(this.uiPrefs, scope, fieldKey, fallback);
  }

  readonly initials        = getInitials;
  readonly avatarColor     = getAvatarColor;
  readonly userName        = getUserDisplayName;
  readonly priorityBadge   = getPriorityBadge;
  readonly doneSubtasks    = getDoneSubtasks;
  readonly relativeTime    = formatRelativeTime;

  trackById = (_: number, item: { id: number }) => item.id;

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
