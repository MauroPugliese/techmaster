// ─── Planned Maintenance ─────────────────────────────────────────────────────
export type RepeatTaskType = 'DAY' | 'WEEK' | 'MONTH';
export type PlannedTaskStatus = 'TODO' | 'DONE';

export interface PlannedMaintenanceTask {
  id: number;
  system: string;
  subsystem: string;
  task: string;
  reference?: string;
  operation_date_start?: string;
  operation_date_end?: string;
  operationDateStart?: string;
  operationDateEnd?: string;
  repeat_task_type?: RepeatTaskType;
  repeat_task_number?: number;
  repeatTaskType?: RepeatTaskType;
  repeatTaskNumber?: number;
  report_template?: string;
  reportTemplate?: string;
  status: PlannedTaskStatus;
  optional?: boolean;
  created_by?: number;
  created_at?: string;
  updated_at?: string;
}

export interface CalendarIndicator {
  color: string;
  count: number;
}

export interface CalendarIndicators {
  [day: number]: CalendarIndicator[];
}