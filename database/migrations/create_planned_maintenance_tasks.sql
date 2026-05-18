-- =============================================================================
-- Migration: Create planned_maintenance_tasks table
-- =============================================================================

CREATE TABLE IF NOT EXISTS `planned_maintenance_tasks` (
  `id`                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `system`               VARCHAR(150) NOT NULL,
  `subsystem`            VARCHAR(150) NOT NULL,
  `task`                 TEXT NOT NULL,
  `reference`            VARCHAR(200) DEFAULT NULL,
  `operation_date_start` DATETIME NOT NULL,
  `operation_date_end`   DATETIME NOT NULL,
  `repeat_task_type`     ENUM('DAY','WEEK','MONTH') NOT NULL DEFAULT 'WEEK',
  `repeat_task_number`   INT NOT NULL DEFAULT 1,
  `report_template`      VARCHAR(300) DEFAULT NULL,
  `status`               ENUM('TODO','DONE') NOT NULL DEFAULT 'TODO',
  `optional`             TINYINT(1) NOT NULL DEFAULT 0,
  `created_by`           INT UNSIGNED DEFAULT NULL,
  `created_at`           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_pmt_system` (`system`),
  INDEX `idx_pmt_subsystem` (`subsystem`),
  INDEX `idx_pmt_operation_date` (`operation_date_start`),
  INDEX `idx_pmt_status` (`status`),
  INDEX `idx_pmt_repeat_type` (`repeat_task_type`),
  CONSTRAINT `fk_pmt_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- Seed data — matches the frontend mock for consistency
-- =============================================================================

INSERT INTO `planned_maintenance_tasks`
  (`system`, `subsystem`, `task`, `reference`, `operation_date_start`, `operation_date_end`, `repeat_task_type`, `repeat_task_number`, `report_template`, `status`, `optional`)
VALUES
  ('Server Room', 'DEHUMIDIFIER', 'Empty the external tank', '', '2025-02-03 09:00:00', '2025-02-03 09:15:00', 'DAY', 1, '', 'TODO', 0),
  ('Server Room', 'DATALOGGERS', 'Collect log files', '', '2025-02-03 10:00:00', '2025-02-03 10:30:00', 'WEEK', 2, '', 'TODO', 0),
  ('Computer and Peripherials', 'OPSERVER', 'Check the auto-backup on Windows Backup Server', '', '2025-02-04 10:00:00', '2025-02-04 10:30:00', 'WEEK', 1, '', 'TODO', 0),
  ('Computer and Peripherials', 'ALL', 'Swap main/backup disks on all the nodes but OPSERVER', '', '2025-02-07 14:00:00', '2025-02-07 15:00:00', 'WEEK', 2, '', 'TODO', 0),
  ('Computer and Peripherials', 'SESRV1', 'Check integrity of the RAID, check status of RAID BATTERY', '', '2025-02-07 10:00:00', '2025-02-07 10:15:00', 'WEEK', 1, '', 'TODO', 0),
  ('Server Room', 'DEHUMIDIFIER', 'Check filter status and clean if necessary', '', '2026-05-14 09:00:00', '2026-05-14 09:15:00', 'MONTH', 1, '', 'DONE', 0),
  ('Server Room', 'ELECTRICAL PANELS', 'Apply Lockout-Tagout Procedure to Server Room Electrical Panels', '', '2026-05-14 00:00:00', '2026-05-14 00:00:00', 'WEEK', 1, '', 'TODO', 1),
  ('Server Room', 'ALL', 'Restore all systems in Server Room', '', '2026-05-14 00:00:00', '2026-05-14 00:00:00', 'WEEK', 1, '', 'TODO', 1),
  ('Server Room', 'ALL', 'Shutdown all systems in Server Room', '', '2026-05-14 00:00:00', '2026-05-14 00:00:00', 'WEEK', 1, '', 'TODO', 1),
  ('Server Room', 'DEHUMIDIFIER', 'Empty the external tank', '', '2026-05-14 09:00:00', '2026-05-14 09:15:00', 'DAY', 1, '', 'DONE', 0),
  ('Computer and Peripherials', 'OPSERVER', 'Check the funcionality of the hi-temp emergency shutdown system', '', '2026-05-14 17:00:00', '2026-05-14 18:00:00', 'WEEK', 1, '', 'TODO', 0),
  ('Computer and Peripherials', 'ALL', 'Verify network connectivity on all nodes', '', '2026-05-15 08:00:00', '2026-05-15 08:30:00', 'WEEK', 1, '', 'TODO', 0),
  ('Server Room', 'DATALOGGERS', 'Download and archive temperature logs', '', '2026-05-18 10:00:00', '2026-05-18 10:30:00', 'WEEK', 2, '', 'TODO', 0),
  ('Computer and Peripherials', 'SESRV1', 'Update firmware on RAID controller', '', '2026-05-20 14:00:00', '2026-05-20 15:00:00', 'MONTH', 1, '', 'TODO', 0),
  ('Server Room', 'ELECTRICAL PANELS', 'Inspect UPS battery status and run self-test', '', '2026-05-21 09:00:00', '2026-05-21 09:45:00', 'WEEK', 1, '', 'TODO', 0),
  ('Computer and Peripherials', 'OPSERVER', 'Rotate backup tapes and verify offsite copy', '', '2026-05-25 11:00:00', '2026-05-25 12:00:00', 'WEEK', 2, '', 'TODO', 1),
  ('Server Room', 'DEHUMIDIFIER', 'Quarterly deep cleaning of internal coils', '', '2026-05-28 08:00:00', '2026-05-28 10:00:00', 'MONTH', 1, '', 'TODO', 0);