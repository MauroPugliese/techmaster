// =============================================================================
// task-event-list.component.ts — Event list for selected day
// =============================================================================
import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlannedMaintenanceTask } from '../../../../core/models/interfaces';

@Component({
  selector: 'app-task-event-list',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './task-event-list.component.html',
  styleUrls: ['./task-event-list.component.scss']
})
export class TaskEventListComponent {

  @Input() tasks: PlannedMaintenanceTask[] = [];
  @Input() selectedDate = '';
  @Output() editTask = new EventEmitter<PlannedMaintenanceTask>();

  viewModes = ['DAY', 'WEEK', 'MONTH', 'YEAR'] as const;
  viewMode: string = 'DAY';

  setViewMode(mode: string): void {
    this.viewMode = mode;
  }

  viewModeColor(mode: string): string {
    switch (mode) {
      case 'DAY':   return '#2563eb';
      case 'WEEK':  return '#10B981';
      case 'MONTH': return '#F59E0B';
      case 'YEAR':  return '#EF4444';
      default:      return '#64748b';
    }
  }

  iconColor(t: PlannedMaintenanceTask): string {
    if (t.optional) return '#0288D1';
    if (t.status === 'DONE') return '#10B981';
    return '#F59E0B';
  }

  formatDateLine(iso: string): string {
    if (!iso) return '';
    const date = iso.substring(0, 10);
    const time = iso.substring(11, 16);
    return `${date}, at ${time}`;
  }
}