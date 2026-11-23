-- =============================================================================
-- Migration: Enhance shift_types and shifts for custom hours and leave tracking
-- =============================================================================

SET @st_cat_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'shift_types'
    AND column_name = 'category'
);
SET @sql_stmt = IF(
  @st_cat_exists = 0,
  "ALTER TABLE shift_types ADD COLUMN category ENUM('WORK','LEAVE') NOT NULL DEFAULT 'WORK' AFTER color",
  'SELECT "Column category already exists in shift_types" AS message'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT IGNORE INTO shift_types (name, code, start_time, end_time, color, category, description) VALUES
('Custom Shift',   'CST', '08:00:00', '16:00:00', '#7C3AED', 'WORK',  'Custom schedule for overtime, early leave, or flexible hours'),
('Sick Leave',     'SCK', '00:00:00', '00:00:00', '#EF4444', 'LEAVE', 'Medical or sick leave'),
('Vacation',       'VAC', '00:00:00', '00:00:00', '#10B981', 'LEAVE', 'Planned annual vacation'),
('Public Holiday', 'HOL', '00:00:00', '00:00:00', '#F59E0B', 'LEAVE', 'National or company holiday'),
('Personal Leave', 'PRM', '00:00:00', '00:00:00', '#8B5CF6', 'LEAVE', 'Personal time off or permit');

SET @sh_entry_kind_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'shifts' AND column_name = 'entry_kind'
);
SET @sql_stmt = IF(
  @sh_entry_kind_exists = 0,
  "ALTER TABLE shifts ADD COLUMN entry_kind ENUM('WORK','CUSTOM','LEAVE') NOT NULL DEFAULT 'WORK' AFTER date",
  'SELECT "Column entry_kind already exists in shifts" AS message'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sh_leave_type_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'shifts' AND column_name = 'leave_type'
);
SET @sql_stmt = IF(
  @sh_leave_type_exists = 0,
  'ALTER TABLE shifts ADD COLUMN leave_type VARCHAR(40) NULL AFTER entry_kind',
  'SELECT "Column leave_type already exists in shifts" AS message'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sh_cstart_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'shifts' AND column_name = 'custom_start_time'
);
SET @sql_stmt = IF(
  @sh_cstart_exists = 0,
  'ALTER TABLE shifts ADD COLUMN custom_start_time TIME NULL AFTER leave_type',
  'SELECT "Column custom_start_time already exists in shifts" AS message'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sh_cend_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'shifts' AND column_name = 'custom_end_time'
);
SET @sql_stmt = IF(
  @sh_cend_exists = 0,
  'ALTER TABLE shifts ADD COLUMN custom_end_time TIME NULL AFTER custom_start_time',
  'SELECT "Column custom_end_time already exists in shifts" AS message'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sh_reason_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'shifts' AND column_name = 'adjustment_reason'
);
SET @sql_stmt = IF(
  @sh_reason_exists = 0,
  'ALTER TABLE shifts ADD COLUMN adjustment_reason VARCHAR(120) NULL AFTER overtime_hours',
  'SELECT "Column adjustment_reason already exists in shifts" AS message'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE shifts
  MODIFY COLUMN status ENUM('SCHEDULED','CONFIRMED','IN_PROGRESS','COMPLETED','ABSENT','SWAPPED','ON_LEAVE')
  DEFAULT 'SCHEDULED';
