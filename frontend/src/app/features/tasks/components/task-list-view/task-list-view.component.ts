// =============================================================================
// task-list-view.component.ts — Full-Width Task Table with Inline Edits & Bulk Bar
// =============================================================================
import {
  Component, Input, Output, EventEmitter, OnChanges, SimpleChanges,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Priority, Task, TaskAssignee, TaskStatus } from '../../../../core/models/interfaces';
import { AuthService } from '../../../../core/services/auth.service';
import { DropdownComponent, DropdownOptionComponent } from '../../../../shared/components/dropdown/dropdown.component';
import {
  SortKey,
  daysUntilDue,
  formatDueLabel,
  getAvatarColor,
  getDoneSubtasks,
  getHoursProgress,
  getInitials,
  getPriorityColor,
  getStatusColor,
  getUserDisplayName,
  isTaskOverdue
} from '../../task-helpers';

export type BulkActionType = 'status' | 'priority' | 'assign' | 'delete';

export interface BulkTaskCommand {
  ids: number[];
  action: BulkActionType;
  value?: any;
}

@Component({
  selector: 'app-task-list-view',
  standalone: true,
  imports: [CommonModule, FormsModule, DropdownComponent, DropdownOptionComponent],
  templateUrl: './task-list-view.component.html',
  styleUrls: ['./task-list-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TaskListViewComponent implements OnChanges {
  @Input() tasks: Task[] = [];
  @Input() assignees: TaskAssignee[] = [];
  @Input() sortKey: SortKey = 'due';
  @Input() sortAsc = true;
  @Input() busyBulk = false;

  @Output() taskClick    = new EventEmitter<Task>();
  @Output() sortChange   = new EventEmitter<SortKey>();
  @Output() inlineUpdate = new EventEmitter<{ task: Task; patch: Partial<Task> }>();
  @Output() duplicate    = new EventEmitter<Task>();
  @Output() remove       = new EventEmitter<Task>();
  @Output() bulkAction   = new EventEmitter<BulkTaskCommand>();

  selectedIds = new Set<number>();
  bulkStatusVal = '';
  bulkPriorityVal = '';
  bulkAssignVal = '';

  constructor(public auth: AuthService) {}

  readonly statusOptions: Array<{ value: TaskStatus; label: string }> = [
    { value: 'TODO',        label: 'To Do' },
    { value: 'IN_PROGRESS', label: 'In Progress' },
    { value: 'REVIEW',      label: 'In Review' },
    { value: 'DONE',        label: 'Done' },
    { value: 'OVERDUE',     label: 'Overdue' },
    { value: 'CANCELLED',   label: 'Cancelled' }
  ];

  readonly priorityOptions: Array<{ value: Priority; label: string }> = [
    { value: 'CRITICAL', label: 'Critical' },
    { value: 'HIGH',     label: 'High' },
    { value: 'MEDIUM',   label: 'Medium' },
    { value: 'LOW',      label: 'Low' }
  ];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['tasks']) {
      const visible = new Set(this.tasks.map(t => t.id));
      const next = new Set<number>();
      this.selectedIds.forEach(id => {
        if (visible.has(id)) next.add(id);
      });
      this.selectedIds = next;
    }
  }

  get selectedCount(): number { return this.selectedIds.size; }
  get allSelected(): boolean   { return this.tasks.length > 0 && this.selectedIds.size === this.tasks.length; }
  get someSelected(): boolean  { return this.selectedIds.size > 0 && this.selectedIds.size < this.tasks.length; }

  toggleSelectAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedIds = checked ? new Set(this.tasks.map(t => t.id)) : new Set<number>();
  }

  toggleRow(id: number, event: Event): void {
    event.stopPropagation();
    const checked = (event.target as HTMLInputElement).checked;
    const next = new Set(this.selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    this.selectedIds = next;
  }

  clearSelection(): void {
    this.selectedIds = new Set<number>();
  }

  onBulkSelect(action: BulkActionType, raw: any): void {
    if (raw === '' || raw === null || raw === undefined || !this.selectedIds.size) return;
    const value = action === 'assign' ? (raw === '__unassigned__' ? null : Number(raw)) : raw;
    this.bulkAction.emit({ ids: Array.from(this.selectedIds), action, value });
    this.bulkStatusVal = '';
    this.bulkPriorityVal = '';
    this.bulkAssignVal = '';
  }

  onBulkDelete(): void {
    if (!this.selectedIds.size) return;
    this.bulkAction.emit({ ids: Array.from(this.selectedIds), action: 'delete' });
  }

  onInlineStatus(task: Task, status: TaskStatus): void {
    if (status && status !== task.status) {
      this.inlineUpdate.emit({ task, patch: { status } });
    }
  }

  onInlinePriority(task: Task, priority: Priority): void {
    if (priority && priority !== task.priority) {
      this.inlineUpdate.emit({ task, patch: { priority } });
    }
  }

  onInlineAssignee(task: Task, raw: any): void {
    const assigned_to = raw !== '' && raw !== null && raw !== undefined ? Number(raw) : null;
    if ((task.assigned_to ?? task.assignee?.id ?? null) !== assigned_to) {
      this.inlineUpdate.emit({ task, patch: { assigned_to } });
    }
  }

  sortArrow(key: SortKey): string {
    if (this.sortKey !== key) return 'unfold_more';
    return this.sortAsc ? 'arrow_upward' : 'arrow_downward';
  }

  isSoon(task: Task): boolean {
    if (isTaskOverdue(task) || task.status === 'DONE') return false;
    const d = daysUntilDue(task);
    return d !== null && d <= 2;
  }

  trackById = (_: number, t: Task) => t.id;

  readonly isOverdue       = isTaskOverdue;
  readonly dueLabel        = formatDueLabel;
  readonly doneSubtasks    = getDoneSubtasks;
  readonly hoursProgress   = getHoursProgress;
  readonly initials        = getInitials;
  readonly avatarColor     = getAvatarColor;
  readonly userName        = getUserDisplayName;
  readonly priorityColor   = getPriorityColor;
  readonly statusColor     = getStatusColor;
}
