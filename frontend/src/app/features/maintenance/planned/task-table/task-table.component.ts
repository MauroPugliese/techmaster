// =============================================================================
// task-table.component.ts — Planned Maintenance Task Table
// =============================================================================
import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlannedMaintenanceTask } from '../../../../core/models/interfaces';

@Component({
  selector: 'app-task-table',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './task-table.component.html',
  styleUrls: ['./task-table.component.scss']
})
export class TaskTableComponent {

  @Input() tasks: PlannedMaintenanceTask[] = [];
  @Output() editTask   = new EventEmitter<PlannedMaintenanceTask>();
  @Output() deleteTask = new EventEmitter<PlannedMaintenanceTask>();
  @Output() addTask    = new EventEmitter<void>();

  searchTerm = '';
  pageSize   = 5;
  currentPage = 1;

  get filteredTasks(): PlannedMaintenanceTask[] {
    if (!this.searchTerm.trim()) return this.tasks;
    const term = this.searchTerm.toLowerCase();
    return this.tasks.filter(t =>
      t.system.toLowerCase().includes(term) ||
      t.subsystem.toLowerCase().includes(term) ||
      t.task.toLowerCase().includes(term) ||
      (t.reference || '').toLowerCase().includes(term) ||
      t.repeat_task_type.toLowerCase().includes(term) ||
      String(t.id).includes(term)
    );
  }

  get totalPages(): number {
    return Math.ceil(this.filteredTasks.length / this.pageSize) || 1;
  }

  get paginatedTasks(): PlannedMaintenanceTask[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredTasks.slice(start, start + this.pageSize);
  }

  get rangeLabel(): string {
    const total = this.filteredTasks.length;
    if (total === 0) return '0 of 0';
    const start = (this.currentPage - 1) * this.pageSize + 1;
    const end = Math.min(this.currentPage * this.pageSize, total);
    return `${start} – ${end} of ${total}`;
  }

  onSearchChange(): void { this.currentPage = 1; }
  onPageSizeChange(): void { this.currentPage = 1; }

  goFirst(): void { this.currentPage = 1; }
  goPrev(): void  { if (this.currentPage > 1) this.currentPage--; }
  goNext(): void  { if (this.currentPage < this.totalPages) this.currentPage++; }
  goLast(): void  { this.currentPage = this.totalPages; }

  formatDate(iso: string): string {
    if (!iso) return '';
    return iso.replace('T', ' ').substring(0, 16);
  }

  getRepeatBadgeClass(type: string): string {
    switch (type) {
      case 'DAY':   return 'badge-planned';
      case 'WEEK':  return 'badge-completed';
      case 'MONTH': return 'badge-on-hold';
      default:      return 'badge-in-progress';
    }
  }
}
