-- =============================================================================
-- database/reset_clean_db.sql
-- SMaRT Platform â€” Full Clean Reset (Zero Operational / Demo Data)
-- =============================================================================
-- Usage (manual import via Adminer, phpMyAdmin, MySQL Workbench, or CLI):
--   mysql -u root -p smart < database/reset_clean_db.sql
--
-- What this script does:
--   1. Drops and recreates ALL SMaRT tables cleanly from scratch (v008 schema)
--      so no stale columns, orphan rows, or leftover AUTO_INCREMENT counters exist.
--   2. Registers all 8 schema_migrations (001..008) so backend startup does NOT
--      auto-insert any sample simulators, sorties, or maintenance records.
--   3. Loads ONLY minimal reference catalogs (roles, shift_types, operation_types,
--      categories, warehouse_locations) + 1 administrator account:
--        Username: admin  (or admin@smart.local)
--        Password: Admin@1234
--   4. Leaves ALL operational tables 100% EMPTY (0 simulators, 0 sorties,
--      0 work orders, 0 planned maintenance, 0 inventory, 0 shifts, 0 tasks, 0 wiki).
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET time_zone = '+00:00';

-- â”€â”€ Drop every table for a guaranteed spotless zero-data rebuild â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
DROP TABLE IF EXISTS
  ui_table_column_preferences,
  ui_section_field_role_preferences,
  ui_section_field_preferences,
  ui_section_access_preferences,
  audit_logs,
  notifications,
  wiki_revisions,
  wiki_articles,
  wiki_categories,
  task_comments,
  tasks,
  task_categories,
  shift_handovers,
  shift_swap_requests,
  shifts,
  shift_types,
  stock_movements,
  inventory_items,
  item_categories,
  warehouse_locations,
  planned_maintenance_task_instances,
  planned_maintenance_tasks,
  maintenance_records,
  assets,
  asset_categories,
  operation_logs,
  operation_members,
  operations,
  operation_types,
  simulator_shift_entries,
  simulator_daily_shifts,
  simulator_daily_logs,
  simulator_qtg_records,
  simulator_subsystems,
  simulators,
  refresh_tokens,
  users,
  roles,
  schema_migrations;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- 01-schema.sql
-- Mounted at: /docker-entrypoint-initdb.d/01-schema.sql
--
-- MySQL executes every *.sql file in /docker-entrypoint-initdb.d/ in
-- alphabetical order on the FIRST container start (empty data volume).
-- Subsequent starts skip this directory entirely.
--
-- Convention: prefix files with NN- to control execution order.
--   01-schema.sql  -> tables, indexes, constraints, seeds
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;
SET time_zone = '+00:00';

-- =============================================================================
-- SCHEMA MIGRATIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(255) NOT NULL UNIQUE,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- ROLES
-- =============================================================================
CREATE TABLE IF NOT EXISTS roles (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(50)  NOT NULL UNIQUE,
    description TEXT,
    permissions JSON,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- USERS
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    role_id         INT UNSIGNED NOT NULL,
    username        VARCHAR(60)  NOT NULL UNIQUE,
    email           VARCHAR(120) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    first_name      VARCHAR(80)  NOT NULL,
    last_name       VARCHAR(80)  NOT NULL,
    avatar_url      VARCHAR(500),
    department      VARCHAR(100),
    job_title       VARCHAR(100),
    phone           VARCHAR(30),
    is_active       BOOLEAN DEFAULT TRUE,
    certifications  JSON,
    last_login      TIMESTAMP NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- REFRESH TOKENS
-- =============================================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id    INT UNSIGNED NOT NULL,
    token      TEXT         NOT NULL,
    expires_at TIMESTAMP    NOT NULL,
    is_revoked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- FLIGHT SIMULATORS, SUBSYSTEMS & QTG COMPLIANCE
-- =============================================================================
CREATE TABLE IF NOT EXISTS simulators (
    id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code                  VARCHAR(40)  NOT NULL UNIQUE,
    name                  VARCHAR(200) NOT NULL,
    bay_code              VARCHAR(40)  NOT NULL,
    station_kind          ENUM('FFS_BAY','TEST_PLACE','IOS_CONSOLE') NOT NULL DEFAULT 'FFS_BAY',
    sort_order            INT          NOT NULL DEFAULT 0,
    platform_category     ENUM('COMMERCIAL_FIXED_WING','ROTORCRAFT','DEFENSE_FMS','FTD_FNPT') NOT NULL DEFAULT 'COMMERCIAL_FIXED_WING',
    aircraft_type         VARCHAR(120) NOT NULL,
    manufacturer          VARCHAR(120) DEFAULT 'CAE',
    serial_number         VARCHAR(100),
    authority             VARCHAR(60)  DEFAULT 'EASA',
    qualification_level   VARCHAR(60)  DEFAULT 'CS-FSTD Level D',
    certificate_code      VARCHAR(100),
    certificate_expiry    DATE,
    last_eval_date        DATE,
    daily_available_hours DECIMAL(4,1) DEFAULT 20.0,
    engine_avionics       VARCHAR(200),
    software_load         VARCHAR(120),
    airac_cycle           VARCHAR(60),
    visual_system         VARCHAR(160),
    motion_system         VARCHAR(120),
    control_loading       VARCHAR(120),
    ios_config            VARCHAR(120),
    status                ENUM('READY','IN_SORTIE','PRE_FLIGHT','MAINTENANCE','DEGRADED','AOG') NOT NULL DEFAULT 'READY',
    power_on_hours        DECIMAL(10,1) DEFAULT 0.0,
    motion_hours          DECIMAL(10,1) DEFAULT 0.0,
    visual_lamp_hours     DECIMAL(10,1) DEFAULT 0.0,
    limitations_mel       TEXT,
    notes                 TEXT,
    asset_id              INT UNSIGNED NULL,
    created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_sim_status (status),
    INDEX idx_sim_bay (bay_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS simulator_subsystems (
    id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    simulator_id         INT UNSIGNED NOT NULL,
    subsystem_code       ENUM('VISUAL','MOTION','CONTROL_LOADING','AVIONICS_COCKPIT','IOS','HOST_COMPUTE','SOUND','HVAC_POWER') NOT NULL,
    name                 VARCHAR(150) NOT NULL,
    part_number          VARCHAR(100),
    serial_number        VARCHAR(100),
    firmware_version     VARCHAR(80),
    status               ENUM('NOMINAL','DEGRADED','FAULT','MAINTENANCE') NOT NULL DEFAULT 'NOMINAL',
    operating_hours      DECIMAL(10,1) DEFAULT 0.0,
    last_calibrated_at   DATE,
    next_calibration_due DATE,
    notes                TEXT,
    created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_sim_sub_sim (simulator_id),
    CONSTRAINT fk_sim_sub_sim FOREIGN KEY (simulator_id) REFERENCES simulators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS simulator_qtg_records (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    simulator_id   INT UNSIGNED NOT NULL,
    test_code      VARCHAR(60)  NOT NULL,
    title          VARCHAR(220) NOT NULL,
    category       ENUM('PERFORMANCE','HANDLING','MOTION_CUEING','VISUAL_SYSTEM','SOUND','IOS_NAV') NOT NULL DEFAULT 'PERFORMANCE',
    quarter        ENUM('Q1','Q2','Q3','Q4') NOT NULL DEFAULT 'Q1',
    year           INT          NOT NULL,
    mode           ENUM('AUTO','MANUAL') NOT NULL DEFAULT 'AUTO',
    status         ENUM('PENDING','PASSED','TOLERANCE_WARN','FAILED') NOT NULL DEFAULT 'PENDING',
    due_date       DATE,
    executed_at    DATETIME,
    executed_by    INT UNSIGNED NULL,
    measured_delta VARCHAR(120),
    notes          TEXT,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_qtg_sim_yr (simulator_id, year, quarter),
    CONSTRAINT fk_qtg_sim  FOREIGN KEY (simulator_id) REFERENCES simulators(id) ON DELETE CASCADE,
    CONSTRAINT fk_qtg_user FOREIGN KEY (executed_by)  REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
    signed_off_at        DATETIME NULL,
    signed_off_by        INT UNSIGNED NULL,
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

-- =============================================================================
-- SORTIE TYPES & FLIGHT SORTIES
-- =============================================================================
CREATE TABLE IF NOT EXISTS operation_types (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    color       VARCHAR(7)   DEFAULT '#1565C0',
    icon        VARCHAR(50),
    description TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS operations (
    id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    sortie_code           VARCHAR(50),
    type_id               INT UNSIGNED NOT NULL,
    simulator_id          INT UNSIGNED NULL,
    created_by            INT UNSIGNED NOT NULL,
    title                 VARCHAR(200) NOT NULL,
    customer_operator     VARCHAR(120),
    scenario_code         VARCHAR(120),
    weather_profile       VARCHAR(80),
    motion_required       BOOLEAN DEFAULT TRUE,
    scheduled_hours       DECIMAL(5,2),
    actual_flight_hours   DECIMAL(5,2),
    lost_training_minutes INT DEFAULT 0,
    outcome               ENUM('PENDING','CLEAN','COMPLETED_WITH_SNAGS','INTERRUPTED_TECH','NO_SHOW','CANCELLED') DEFAULT 'PENDING',
    snag_summary          TEXT,
    description           TEXT,
    status                ENUM('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED','ON_HOLD') DEFAULT 'PLANNED',
    priority              ENUM('LOW','MEDIUM','HIGH','CRITICAL') DEFAULT 'MEDIUM',
    location              VARCHAR(200),
    start_date            DATETIME     NOT NULL,
    end_date              DATETIME,
    actual_end_date       DATETIME,
    notes                 TEXT,
    metadata              JSON,
    created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_operations_status     (status),
    INDEX idx_operations_start_date (start_date),
    INDEX idx_operations_simulator  (simulator_id),
    CONSTRAINT fk_ops_type    FOREIGN KEY (type_id)      REFERENCES operation_types(id),
    CONSTRAINT fk_ops_sim     FOREIGN KEY (simulator_id) REFERENCES simulators(id) ON DELETE SET NULL,
    CONSTRAINT fk_ops_creator FOREIGN KEY (created_by)   REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS operation_members (
    operation_id INT UNSIGNED NOT NULL,
    user_id      INT UNSIGNED NOT NULL,
    role_in_op   VARCHAR(100),
    joined_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (operation_id, user_id),
    CONSTRAINT fk_opmembers_op   FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE,
    CONSTRAINT fk_opmembers_user FOREIGN KEY (user_id)      REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS operation_logs (
    id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    operation_id INT UNSIGNED NOT NULL,
    user_id      INT UNSIGNED NOT NULL,
    action       VARCHAR(200) NOT NULL,
    details      TEXT,
    logged_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_oplog_op   FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE,
    CONSTRAINT fk_oplog_user FOREIGN KEY (user_id)      REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- ASSET CATEGORIES & ASSETS
-- =============================================================================
CREATE TABLE IF NOT EXISTS asset_categories (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    type        ENUM('HARDWARE','SOFTWARE','NETWORK','OTHER') NOT NULL,
    description TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assets (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    category_id     INT UNSIGNED NOT NULL,
    assigned_to     INT UNSIGNED,
    name            VARCHAR(200) NOT NULL,
    serial_number   VARCHAR(100) UNIQUE,
    model           VARCHAR(150),
    manufacturer    VARCHAR(150),
    purchase_date   DATE,
    warranty_expiry DATE,
    location        VARCHAR(200),
    status          ENUM('ACTIVE','INACTIVE','UNDER_MAINTENANCE','RETIRED','LOST') DEFAULT 'ACTIVE',
    specs           JSON,
    notes           TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_assets_cat  FOREIGN KEY (category_id) REFERENCES asset_categories(id),
    CONSTRAINT fk_assets_user FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- MAINTENANCE
-- =============================================================================
CREATE TABLE IF NOT EXISTS maintenance_records (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    asset_id            INT UNSIGNED NULL,
    simulator_id        INT UNSIGNED NULL,
    sortie_id           INT UNSIGNED NULL,
    subsystem_code      VARCHAR(60),
    severity            ENUM('MINOR','DEGRADED','AOG') DEFAULT 'MINOR',
    lost_training_hours DECIMAL(5,2) DEFAULT 0,
    is_snag             BOOLEAN DEFAULT FALSE,
    performed_by        INT UNSIGNED NOT NULL,
    type                ENUM('PREVENTIVE','CORRECTIVE','PREDICTIVE','UPGRADE','INSPECTION') NOT NULL,
    title               VARCHAR(200) NOT NULL,
    description         TEXT         NOT NULL,
    status              ENUM('SCHEDULED','IN_PROGRESS','COMPLETED','FAILED','DEFERRED') DEFAULT 'SCHEDULED',
    priority            ENUM('LOW','MEDIUM','HIGH','CRITICAL') DEFAULT 'MEDIUM',
    scheduled_date      DATETIME     NOT NULL,
    completed_date      DATETIME,
    downtime_hours      DECIMAL(6,2),
    cost                DECIMAL(10,2),
    parts_cost          DECIMAL(10,2),
    labor_cost          DECIMAL(10,2),
    parts_used          JSON,
    stock_deducted_snapshot JSON,
    mel_category        ENUM('NONE','CAT_A','CAT_B','CAT_C','CAT_D') NOT NULL DEFAULT 'NONE',
    mel_expiry_date     DATE NULL,
    wiki_article_id     INT UNSIGNED NULL,
    findings            TEXT,
    next_scheduled      DATETIME,
    deleted_at          DATETIME NULL,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_maint_asset     (asset_id),
    INDEX idx_maint_simulator (simulator_id),
    INDEX idx_maint_scheduled (scheduled_date),
    INDEX idx_maint_status    (status),
    CONSTRAINT fk_maint_asset FOREIGN KEY (asset_id)     REFERENCES assets(id),
    CONSTRAINT fk_maint_sim   FOREIGN KEY (simulator_id) REFERENCES simulators(id) ON DELETE SET NULL,
    CONSTRAINT fk_maint_user  FOREIGN KEY (performed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- PLANNED MAINTENANCE
-- =============================================================================
CREATE TABLE IF NOT EXISTS planned_maintenance_tasks (
    id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
    simulator_id         INT UNSIGNED NULL,
    `system`             VARCHAR(150) NOT NULL,
    subsystem            VARCHAR(150) NOT NULL,
    task                 TEXT NOT NULL,
    reference            VARCHAR(200) DEFAULT NULL,
    operation_date_start DATETIME NOT NULL,
    operation_date_end   DATETIME NOT NULL,
    repeat_task_type     ENUM('DAY','WEEK','MONTH') NOT NULL DEFAULT 'WEEK',
    repeat_task_number   INT NOT NULL DEFAULT 1,
    recurrence_end_date  DATETIME DEFAULT NULL,
    report_template      VARCHAR(300) DEFAULT NULL,
    status               ENUM('TODO','DONE') NOT NULL DEFAULT 'TODO',
    optional             TINYINT(1) NOT NULL DEFAULT 0,
    created_by           INT UNSIGNED DEFAULT NULL,
    deleted_at           DATETIME DEFAULT NULL,
    created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_pmt_system        (`system`),
    INDEX idx_pmt_subsystem     (subsystem),
    INDEX idx_pmt_operation_date(operation_date_start),
    INDEX idx_pmt_status        (status),
    INDEX idx_pmt_repeat_type   (repeat_task_type),
    INDEX idx_pmt_recurrence_end(recurrence_end_date),
    CONSTRAINT fk_pmt_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS planned_maintenance_task_instances (
    id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
    planned_task_id      INT UNSIGNED NOT NULL,
    occurrence_date      DATE NOT NULL,
    exception_type       ENUM('OVERRIDE','DELETED') NOT NULL DEFAULT 'OVERRIDE',
    `system`             VARCHAR(150) DEFAULT NULL,
    subsystem            VARCHAR(150) DEFAULT NULL,
    task                 TEXT DEFAULT NULL,
    reference            VARCHAR(200) DEFAULT NULL,
    operation_date_start DATETIME DEFAULT NULL,
    operation_date_end   DATETIME DEFAULT NULL,
    repeat_task_type     ENUM('DAY','WEEK','MONTH') DEFAULT NULL,
    repeat_task_number   INT DEFAULT NULL,
    recurrence_end_date  DATETIME DEFAULT NULL,
    report_template      VARCHAR(300) DEFAULT NULL,
    status               ENUM('TODO','DONE') DEFAULT 'TODO',
    optional             TINYINT(1) DEFAULT 0,
    created_by           INT UNSIGNED DEFAULT NULL,
    created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_pmti_task_date (planned_task_id, occurrence_date),
    INDEX idx_pmti_task_date (planned_task_id, occurrence_date),
    INDEX idx_pmti_date      (occurrence_date),
    CONSTRAINT fk_pmti_master     FOREIGN KEY (planned_task_id) REFERENCES planned_maintenance_tasks(id) ON DELETE CASCADE,
    CONSTRAINT fk_pmti_created_by FOREIGN KEY (created_by)      REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- WAREHOUSE / INVENTORY
-- =============================================================================
CREATE TABLE IF NOT EXISTS warehouse_locations (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    code        VARCHAR(20)  NOT NULL UNIQUE,
    description TEXT,
    is_active   BOOLEAN DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS item_categories (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    parent_id   INT UNSIGNED,
    description TEXT,
    color       VARCHAR(7) DEFAULT '#1565C0',
    CONSTRAINT fk_itemcat_parent FOREIGN KEY (parent_id) REFERENCES item_categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_items (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    category_id     INT UNSIGNED NOT NULL,
    location_id     INT UNSIGNED,
    sku             VARCHAR(80)  NOT NULL UNIQUE,
    part_number     VARCHAR(120),
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    unit                VARCHAR(30)  DEFAULT 'pcs',
    part_classification ENUM('CONSUMABLE','ROTATABLE_LRU','TOOL_CALIBRATED') DEFAULT 'CONSUMABLE',
    subsystem_code      VARCHAR(60) NULL,
    aog_critical        BOOLEAN DEFAULT FALSE,
    serial_number       VARCHAR(100) NULL,
    lru_status          ENUM('SERVICEABLE','INSTALLED','UNSERVICEABLE','IN_REPAIR_RMA','QUARANTINE') NOT NULL DEFAULT 'SERVICEABLE',
    installed_simulator_id INT UNSIGNED NULL,
    rma_reference       VARCHAR(100) NULL,
    on_order_qty        INT NOT NULL DEFAULT 0,
    expected_delivery_date DATE NULL,
    lead_time_days      INT DEFAULT 7,
    compatible_models   JSON,
    unserviceable_qty   INT DEFAULT 0,
    quantity            INT          DEFAULT 0,
    min_stock       INT          DEFAULT 0,
    max_stock       INT,
    reorder_point   INT          DEFAULT 0,
    unit_cost       DECIMAL(10,2),
    supplier        VARCHAR(200),
    supplier_ref    VARCHAR(100),
    image_url       VARCHAR(500),
    is_active       BOOLEAN DEFAULT TRUE,
    deleted_at      DATETIME NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_inventory_qty (quantity),
    CONSTRAINT fk_inv_cat      FOREIGN KEY (category_id) REFERENCES item_categories(id),
    CONSTRAINT fk_inv_location FOREIGN KEY (location_id) REFERENCES warehouse_locations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_movements (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    item_id         INT UNSIGNED NOT NULL,
    user_id         INT UNSIGNED NOT NULL,
    simulator_id    INT UNSIGNED NULL,
    maintenance_record_id INT UNSIGNED NULL,
    type            ENUM('IN','OUT','TRANSFER','ADJUSTMENT','RETURN') NOT NULL,
    quantity        INT          NOT NULL,
    quantity_before INT          NOT NULL,
    quantity_after  INT          NOT NULL,
    reference       VARCHAR(100),
    reason          TEXT,
    destination     VARCHAR(200),
    movement_date   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_stock_date (movement_date),
    INDEX idx_stock_type (type),
    CONSTRAINT fk_stock_item FOREIGN KEY (item_id) REFERENCES inventory_items(id),
    CONSTRAINT fk_stock_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- SHIFTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS shift_types (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(80)  NOT NULL,
    code        VARCHAR(10)  NOT NULL UNIQUE,
    start_time  TIME         NOT NULL,
    end_time    TIME         NOT NULL,
    color       VARCHAR(7)   DEFAULT '#1565C0',
    category    ENUM('WORK','LEAVE') NOT NULL DEFAULT 'WORK',
    description TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shifts (
    id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    shift_type_id     INT UNSIGNED NOT NULL,
    user_id           INT UNSIGNED NOT NULL,
    supervisor_id     INT UNSIGNED,
    date              DATE         NOT NULL,
    entry_kind        ENUM('WORK','CUSTOM','LEAVE') NOT NULL DEFAULT 'WORK',
    leave_type        VARCHAR(40)  NULL,
    custom_start_time TIME         NULL,
    custom_end_time   TIME         NULL,
    status            ENUM('SCHEDULED','CONFIRMED','IN_PROGRESS','COMPLETED','ABSENT','SWAPPED','ON_LEAVE') DEFAULT 'SCHEDULED',
    check_in          DATETIME,
    check_out         DATETIME,
    notes             TEXT,
    overtime_hours    DECIMAL(5,2) DEFAULT 0,
    adjustment_reason VARCHAR(120) NULL,
    deleted_at        DATETIME NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_shift_user_date (user_id, date),
    INDEX idx_shifts_date (date),
    CONSTRAINT fk_shift_type  FOREIGN KEY (shift_type_id) REFERENCES shift_types(id),
    CONSTRAINT fk_shift_user  FOREIGN KEY (user_id)       REFERENCES users(id),
    CONSTRAINT fk_shift_super FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shift_swap_requests (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    from_shift_id INT UNSIGNED NOT NULL,
    to_shift_id   INT UNSIGNED NOT NULL,
    requested_by  INT UNSIGNED NOT NULL,
    approved_by   INT UNSIGNED,
    status        ENUM('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING',
    reason        TEXT,
    response_note TEXT,
    requested_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    responded_at  TIMESTAMP,
    CONSTRAINT fk_swap_from     FOREIGN KEY (from_shift_id) REFERENCES shifts(id),
    CONSTRAINT fk_swap_to       FOREIGN KEY (to_shift_id)   REFERENCES shifts(id),
    CONSTRAINT fk_swap_reqby    FOREIGN KEY (requested_by)  REFERENCES users(id),
    CONSTRAINT fk_swap_approver FOREIGN KEY (approved_by)   REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shift_handovers (
    id                        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    shift_date                DATE         NOT NULL,
    from_shift_code           VARCHAR(20)  NOT NULL,
    to_shift_code             VARCHAR(20)  NOT NULL,
    authored_by               INT UNSIGNED NOT NULL,
    acknowledged_by           INT UNSIGNED NULL,
    acknowledged_at           DATETIME     NULL,
    simulators_status_summary TEXT,
    open_drs_summary          TEXT,
    pending_actions           TEXT,
    safety_loto_notes         TEXT,
    created_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_handover_date (shift_date),
    CONSTRAINT fk_handover_author FOREIGN KEY (authored_by)     REFERENCES users(id),
    CONSTRAINT fk_handover_ack    FOREIGN KEY (acknowledged_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- TASKS (recursive / self-referencing)
-- =============================================================================
CREATE TABLE IF NOT EXISTS task_categories (
    id    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name  VARCHAR(100) NOT NULL,
    color VARCHAR(7)   DEFAULT '#1565C0',
    icon  VARCHAR(50)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tasks (
    id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    parent_id        INT UNSIGNED,
    category_id      INT UNSIGNED,
    simulator_id     INT UNSIGNED NULL,
    created_by       INT UNSIGNED NOT NULL,
    assigned_to      INT UNSIGNED,
    title            VARCHAR(300) NOT NULL,
    description      TEXT,
    interval_type    ENUM('ONCE','DAILY','WEEKLY','MONTHLY','YEARLY') DEFAULT 'ONCE',
    status           ENUM('TODO','IN_PROGRESS','REVIEW','DONE','CANCELLED','OVERDUE') DEFAULT 'TODO',
    priority         ENUM('LOW','MEDIUM','HIGH','CRITICAL') DEFAULT 'MEDIUM',
    due_date         DATETIME,
    completed_at     DATETIME,
    recurrence_rule  VARCHAR(200),
    estimated_hours  DECIMAL(6,2),
    actual_hours     DECIMAL(6,2),
    tags             JSON,
    attachments      JSON,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tasks_interval (interval_type),
    INDEX idx_tasks_due      (due_date),
    INDEX idx_tasks_status   (status),
    INDEX idx_tasks_parent   (parent_id),
    CONSTRAINT fk_task_parent   FOREIGN KEY (parent_id)   REFERENCES tasks(id) ON DELETE CASCADE,
    CONSTRAINT fk_task_cat      FOREIGN KEY (category_id) REFERENCES task_categories(id) ON DELETE SET NULL,
    CONSTRAINT fk_task_creator  FOREIGN KEY (created_by)  REFERENCES users(id),
    CONSTRAINT fk_task_assignee FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_comments (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    task_id    INT UNSIGNED NOT NULL,
    user_id    INT UNSIGNED NOT NULL,
    content    TEXT         NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_tcomment_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    CONSTRAINT fk_tcomment_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- WIKI
-- =============================================================================
CREATE TABLE IF NOT EXISTS wiki_categories (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    parent_id  INT UNSIGNED,
    name       VARCHAR(150) NOT NULL,
    slug       VARCHAR(150) NOT NULL UNIQUE,
    icon       VARCHAR(50),
    sort_order INT          DEFAULT 0,
    CONSTRAINT fk_wikicat_parent FOREIGN KEY (parent_id) REFERENCES wiki_categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wiki_articles (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    category_id    INT UNSIGNED,
    author_id      INT UNSIGNED NOT NULL,
    last_editor_id INT UNSIGNED,
    title          VARCHAR(300) NOT NULL,
    slug           VARCHAR(300) NOT NULL UNIQUE,
    content        LONGTEXT     NOT NULL,
    excerpt        TEXT,
    status         ENUM('DRAFT','PUBLISHED','ARCHIVED','REVIEW') DEFAULT 'DRAFT',
    is_pinned      BOOLEAN DEFAULT FALSE,
    view_count     INT     DEFAULT 0,
    tags           JSON,
    version        INT     DEFAULT 1,
    published_at   TIMESTAMP NULL,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_wiki_status (status),
    CONSTRAINT fk_wiki_cat    FOREIGN KEY (category_id)    REFERENCES wiki_categories(id) ON DELETE SET NULL,
    CONSTRAINT fk_wiki_author FOREIGN KEY (author_id)      REFERENCES users(id),
    CONSTRAINT fk_wiki_editor FOREIGN KEY (last_editor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wiki_revisions (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    article_id  INT UNSIGNED NOT NULL,
    editor_id   INT UNSIGNED NOT NULL,
    content     LONGTEXT     NOT NULL,
    change_note VARCHAR(300),
    version     INT          NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_wikirev_article FOREIGN KEY (article_id) REFERENCES wiki_articles(id) ON DELETE CASCADE,
    CONSTRAINT fk_wikirev_editor  FOREIGN KEY (editor_id)  REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- NOTIFICATIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS notifications (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id    INT UNSIGNED NOT NULL,
    type       VARCHAR(80)  NOT NULL,
    title      VARCHAR(200) NOT NULL,
    body       TEXT,
    link       VARCHAR(500),
    is_read    BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_notif_user_read (user_id, is_read),
    CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- AUDIT LOGS
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id     INT UNSIGNED,
    username    VARCHAR(60),
    action      VARCHAR(100),
    ip          VARCHAR(45),
    method      VARCHAR(10),
    path        VARCHAR(255),
    status      INT,
    details     JSON,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- UI PREFERENCES
-- =============================================================================
CREATE TABLE IF NOT EXISTS ui_section_access_preferences (
    id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    section_key  VARCHAR(60) NOT NULL,
    subject_type ENUM('global', 'role', 'user') NOT NULL DEFAULT 'global',
    subject_key  VARCHAR(120) NOT NULL,
    is_visible   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_section_subject_pref (section_key, subject_type, subject_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ui_section_field_preferences (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    section_key   VARCHAR(60) NOT NULL,
    scope         ENUM('table', 'form') NOT NULL,
    field_key     VARCHAR(100) NOT NULL,
    label         VARCHAR(150) NULL,
    is_visible    BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_section_scope_field (section_key, scope, field_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ui_section_field_role_preferences (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    section_key   VARCHAR(60) NOT NULL,
    scope         ENUM('table', 'form') NOT NULL,
    role_name     VARCHAR(60) NOT NULL,
    field_key     VARCHAR(100) NOT NULL,
    label         VARCHAR(150) NULL,
    is_visible    BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_section_scope_role_field (section_key, scope, role_name, field_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ui_table_column_preferences (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    table_name    VARCHAR(100) NOT NULL,
    column_name   VARCHAR(100) NOT NULL,
    label         VARCHAR(150) NULL,
    is_visible    BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL DEFAULT 0,
    width         VARCHAR(20) NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_table_column_pref (table_name, column_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- SEED DATA - Minimal System Lookups & Default Admin Account ONLY (Zero Demo Data)
-- =============================================================================

-- Schema migrations tracking baseline (all 8 migrations marked applied so
-- backend/src/config/migrate.js will NOT auto-seed demo simulators/sorties)
INSERT IGNORE INTO schema_migrations (id, name) VALUES
(1, '001_baseline_schema'),
(2, '002_add_part_number_to_inventory_items'),
(3, '003_create_planned_maintenance_tasks'),
(4, '004_create_ui_preferences'),
(5, '005_enhance_shifts_custom_and_leave'),
(6, '006_flight_simulator_domain'),
(7, '007_station_daily_ops'),
(8, '008_cae_enterprise_ops');

-- Roles
INSERT IGNORE INTO roles (id, name, description, permissions) VALUES
(1, 'admin',   'System Administrator',  '["*"]'),
(2, 'manager', 'Operations Manager',    '["read","write","manage_users"]'),
(3, 'tech',    'Technician',            '["read","write"]'),
(4, 'viewer',  'Read-only access',      '["read"]');

-- Sortie profiles (Operation types)
INSERT IGNORE INTO operation_types (id, name, color, icon, description) VALUES
(1, 'Type Rating',               '#1565C0', 'flight_takeoff', 'Initial or transition aircraft type rating training sortie'),
(2, 'Recurrent LPC / OPC',       '#0288D1', 'verified',       'Proficiency check and recurrent airline regulatory sortie'),
(3, 'LOFT Mission',              '#0F766E', 'alt_route',      'Line-Oriented Flight Training full scenario sortie'),
(4, 'Checkride / Exam',          '#7C3AED', 'school',         'Authority examiner skill test and ZFT qualification'),
(5, 'Mission Rehearsal',         '#4338CA', 'military_tech',  'Tactical, helicopter NVG/SAR, or defense mission training'),
(6, 'QTG & Engineering Fly-Out', '#D97706', 'tune',           'Morning readiness fly-out or QTG validation flight');

-- Shift types
INSERT IGNORE INTO shift_types (id, name, code, start_time, end_time, color, category, description) VALUES
(1, 'Morning',        'MOR', '06:00:00', '14:00:00', '#1565C0', 'WORK',  'Standard morning shift'),
(2, 'Afternoon',      'AFT', '14:00:00', '22:00:00', '#0288D1', 'WORK',  'Standard afternoon shift'),
(3, 'Night',          'NGT', '22:00:00', '06:00:00', '#01579B', 'WORK',  'Overnight shift'),
(4, 'On-Call',        'ONC', '00:00:00', '23:59:59', '#37474F', 'WORK',  '24h on-call coverage'),
(5, 'Custom Shift',   'CST', '08:00:00', '16:00:00', '#7C3AED', 'WORK',  'Custom schedule for overtime, early leave, or flexible hours'),
(6, 'Sick Leave',     'SCK', '00:00:00', '00:00:00', '#EF4444', 'LEAVE', 'Medical or sick leave'),
(7, 'Vacation',       'VAC', '00:00:00', '00:00:00', '#10B981', 'LEAVE', 'Planned annual vacation'),
(8, 'Public Holiday', 'HOL', '00:00:00', '00:00:00', '#F59E0B', 'LEAVE', 'National or company holiday'),
(9, 'Personal Leave', 'PRM', '00:00:00', '00:00:00', '#8B5CF6', 'LEAVE', 'Personal time off or permit');

-- Warehouse locations
INSERT IGNORE INTO warehouse_locations (id, name, code, description) VALUES
(1, 'Main Aviation Spares Vault', 'WH-MAIN', 'Primary climate-controlled spares storage'),
(2, 'Bay-Side Line Stock',        'BAY-STK', 'Fast-access bay line replacement spares'),
(3, 'Quarantine & RMA Bench',     'RMA-BAY', 'Unserviceable LRUs awaiting vendor RMA'),
(4, 'Calibrated Tooling Lab',     'CAL-LAB', 'Optical alignment & calibrated test equipment');

-- Asset categories
INSERT IGNORE INTO asset_categories (id, name, type) VALUES
(1, 'Servers',             'HARDWARE'),
(2, 'Workstations',        'HARDWARE'),
(3, 'Network Equipment',   'HARDWARE'),
(4, 'Storage Devices',     'HARDWARE'),
(5, 'Power & HVAC',        'HARDWARE'),
(6, 'Enterprise Software', 'SOFTWARE'),
(7, 'Security & Safety',   'OTHER');

-- Task categories
INSERT IGNORE INTO task_categories (id, name, color, icon) VALUES
(1, 'Simulators & Bays', '#1565C0', 'flight_takeoff'),
(2, 'Safety & LOTO',     '#B71C1C', 'security'),
(3, 'Engineering',       '#1B5E20', 'build'),
(4, 'Logistics & RMA',   '#E65100', 'inventory_2'),
(5, 'QTG & Compliance',  '#4A148C', 'gavel');

-- Wiki categories
INSERT IGNORE INTO wiki_categories (id, name, slug, icon, sort_order) VALUES
(1, 'Getting Started',   'getting-started',   'start',       1),
(2, 'Simulator Systems', 'simulator-systems', 'dns',         2),
(3, 'Safety & LOTO',     'safety-loto',       'lock',        3),
(4, 'SOPs & Runbooks',   'sops',              'description', 4),
(5, 'Troubleshooting',   'troubleshooting',   'build',       5);

-- Item categories
INSERT IGNORE INTO item_categories (id, name, description, color) VALUES
(1, 'Visual & Laser Optics',     'Projectors, laser modules, mirrors and collimation parts', '#0288D1'),
(2, 'Motion & Actuation LRUs',   'eMotion actuators, servo drives, hydraulic seals and sensors', '#1565C0'),
(3, 'Avionics & Host Compute',   'Host blades, GPUs, ARINC 429 boards and cockpit displays', '#7C3AED'),
(4, 'Control Loading & Cockpit', 'CLS sensors, sidesticks, throttles, headsets and switches', '#0F766E'),
(5, 'Consumables & Filters',     'HVAC filters, cooling fluids, cables, fuses and fasteners', '#D97706'),
(6, 'Calibrated Tooling',        'Photometers, torque wrenches and optical calibration rigs', '#37474F');

-- Default Administrator account ONLY
-- Login:    admin  (or admin@smart.local)
-- Password: Admin@1234  (verified bcrypt hash)
INSERT IGNORE INTO users (id, role_id, username, email, password_hash, first_name, last_name, department, job_title, is_active) VALUES
(1, 1, 'admin', 'admin@smart.local',
 '$2a$10$rZUO5AEvFPhymrjKuac.QuNWfwqgfzJ6UHc8m3q.Y/bIOsymF8z7u',
 'System', 'Administrator', 'Operations & IT', 'Platform Administrator', TRUE);

SET FOREIGN_KEY_CHECKS = 1;

-- Confirmation message (visible in docker logs on first boot)
SELECT CONCAT(
    'SMaRT clean schema initialised successfully (0 operational records). ',
    COUNT(*), ' roles loaded.'
) AS init_status FROM roles;

