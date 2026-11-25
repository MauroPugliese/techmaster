-- =============================================================================
-- Migration 007: Station Kinds (Test Places / IOS Consoles / FFS Bays) &
--                Multi-Shift Daily Operating Sheet
-- =============================================================================

SET @col_kind = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'simulators' AND COLUMN_NAME = 'station_kind'
);
SET @sql_kind = IF(@col_kind = 0,
  "ALTER TABLE simulators ADD COLUMN station_kind ENUM('FFS_BAY','TEST_PLACE','IOS_CONSOLE') NOT NULL DEFAULT 'FFS_BAY' AFTER bay_code;",
  'SELECT 1;'
);
PREPARE stmt FROM @sql_kind; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_sort = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'simulators' AND COLUMN_NAME = 'sort_order'
);
SET @sql_sort = IF(@col_sort = 0,
  'ALTER TABLE simulators ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER station_kind;',
  'SELECT 1;'
);
PREPARE stmt FROM @sql_sort; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS simulator_daily_logs (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  log_date              DATE NOT NULL,
  station_kind          ENUM('FFS_BAY','TEST_PLACE','IOS_CONSOLE') NOT NULL DEFAULT 'TEST_PLACE',
  system_readiness_time VARCHAR(8) DEFAULT '06:30',
  post_testing_time     VARCHAR(8) DEFAULT '17:00',
  logout_time           VARCHAR(8) DEFAULT '18:00',
  general_notes         TEXT NULL,
  updated_by            INT UNSIGNED NULL,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_sim_daily_log_date_kind (log_date, station_kind),
  CONSTRAINT fk_sim_daily_log_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS simulator_daily_shifts (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  daily_log_id         INT UNSIGNED NOT NULL,
  shift_number         INT NOT NULL DEFAULT 1,
  shift_name           VARCHAR(40) NOT NULL DEFAULT 'SHIFT 1',
  pre_flight_test_time VARCHAR(8) DEFAULT '06:40',
  lead_user_id         INT UNSIGNED NULL,
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_sim_daily_shift_num (daily_log_id, shift_number),
  CONSTRAINT fk_sim_shift_log  FOREIGN KEY (daily_log_id) REFERENCES simulator_daily_logs(id) ON DELETE CASCADE,
  CONSTRAINT fk_sim_shift_lead FOREIGN KEY (lead_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS simulator_shift_entries (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shift_id          INT UNSIGNED NOT NULL,
  simulator_id      INT UNSIGNED NOT NULL,
  usage_status      ENUM('READY','IN_USE','NA') NOT NULL DEFAULT 'READY',
  sim_testing_start VARCHAR(8) NOT NULL DEFAULT '00:00',
  sim_testing_end   VARCHAR(8) NOT NULL DEFAULT '00:00',
  notes             TEXT NULL,
  updated_by        INT UNSIGNED NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_sim_shift_entry (shift_id, simulator_id),
  CONSTRAINT fk_sim_entry_shift   FOREIGN KEY (shift_id)     REFERENCES simulator_daily_shifts(id) ON DELETE CASCADE,
  CONSTRAINT fk_sim_entry_sim     FOREIGN KEY (simulator_id) REFERENCES simulators(id) ON DELETE CASCADE,
  CONSTRAINT fk_sim_entry_updater FOREIGN KEY (updated_by)   REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (name) VALUES ('007_station_daily_ops');
