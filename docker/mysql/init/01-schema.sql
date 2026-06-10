-- =============================================================================
-- 01-schema.sql
-- Mounted at: /docker-entrypoint-initdb.d/01-schema.sql
--
-- MySQL executes every *.sql file in /docker-entrypoint-initdb.d/ in
-- alphabetical order on the FIRST container start (empty data volume).
-- Subsequent starts skip this directory entirely.
--
-- Convention: prefix files with NN- to control execution order.
--   01-schema.sql  → tables, indexes, constraints
--   02-seeds.sql   → reference / lookup data  (this file includes both)
-- =============================================================================

-- Use the database created by MYSQL_DATABASE env var
-- (MySQL already created it; this just makes sure we're on it)
CREATE DATABASE IF NOT EXISTS smart
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE smart;

SET FOREIGN_KEY_CHECKS = 0;
SET time_zone = '+00:00';

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
    last_login      TIMESTAMP NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- OPERATION TYPES
-- =============================================================================
CREATE TABLE IF NOT EXISTS operation_types (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    color       VARCHAR(7)   DEFAULT '#1565C0',
    icon        VARCHAR(50),
    description TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- OPERATIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS operations (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    type_id         INT UNSIGNED NOT NULL,
    created_by      INT UNSIGNED NOT NULL,
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    status          ENUM('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED','ON_HOLD') DEFAULT 'PLANNED',
    priority        ENUM('LOW','MEDIUM','HIGH','CRITICAL') DEFAULT 'MEDIUM',
    location        VARCHAR(200),
    start_date      DATETIME     NOT NULL,
    end_date        DATETIME,
    actual_end_date DATETIME,
    notes           TEXT,
    metadata        JSON,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_ops_type    FOREIGN KEY (type_id)    REFERENCES operation_types(id),
    CONSTRAINT fk_ops_creator FOREIGN KEY (created_by) REFERENCES users(id)
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
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    asset_id        INT UNSIGNED NOT NULL,
    performed_by    INT UNSIGNED NOT NULL,
    type            ENUM('PREVENTIVE','CORRECTIVE','PREDICTIVE','UPGRADE','INSPECTION') NOT NULL,
    title           VARCHAR(200) NOT NULL,
    description     TEXT         NOT NULL,
    status          ENUM('SCHEDULED','IN_PROGRESS','COMPLETED','FAILED','DEFERRED') DEFAULT 'SCHEDULED',
    priority        ENUM('LOW','MEDIUM','HIGH','CRITICAL') DEFAULT 'MEDIUM',
    scheduled_date  DATETIME     NOT NULL,
    completed_date  DATETIME,
    downtime_hours  DECIMAL(6,2),
    cost            DECIMAL(10,2),
    parts_used      JSON,
    findings        TEXT,
    next_scheduled  DATETIME,
    deleted_at      DATETIME NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_maint_asset FOREIGN KEY (asset_id)     REFERENCES assets(id),
    CONSTRAINT fk_maint_user  FOREIGN KEY (performed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- PLANNED MAINTENANCE
-- =============================================================================
CREATE TABLE IF NOT EXISTS planned_maintenance_tasks (
    id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
    system               VARCHAR(150) NOT NULL,
    subsystem            VARCHAR(150) NOT NULL,
    task                 TEXT NOT NULL,
    reference            VARCHAR(200) DEFAULT NULL,
    operation_date_start  DATETIME NOT NULL,
    operation_date_end    DATETIME NOT NULL,
    repeat_task_type      ENUM('DAY','WEEK','MONTH') NOT NULL DEFAULT 'WEEK',
    repeat_task_number    INT NOT NULL DEFAULT 1,
    recurrence_end_date   DATETIME DEFAULT NULL,
    report_template       VARCHAR(300) DEFAULT NULL,
    status                ENUM('TODO','DONE') NOT NULL DEFAULT 'TODO',
    optional              TINYINT(1) NOT NULL DEFAULT 0,
    created_by            INT UNSIGNED DEFAULT NULL,
    deleted_at            DATETIME DEFAULT NULL,
    created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_pmt_system        (system),
    INDEX idx_pmt_subsystem     (subsystem),
    INDEX idx_pmt_operation_date(operation_date_start),
    INDEX idx_pmt_status        (status),
    INDEX idx_pmt_repeat_type   (repeat_task_type),
    INDEX idx_pmt_recurrence_end(recurrence_end_date),
    CONSTRAINT fk_pmt_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS planned_maintenance_task_instances (
    id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
    planned_task_id     INT UNSIGNED NOT NULL,
    occurrence_date     DATE NOT NULL,
    exception_type      ENUM('OVERRIDE','DELETED') NOT NULL DEFAULT 'OVERRIDE',
    system              VARCHAR(150) DEFAULT NULL,
    subsystem           VARCHAR(150) DEFAULT NULL,
    task                TEXT DEFAULT NULL,
    reference           VARCHAR(200) DEFAULT NULL,
    operation_date_start DATETIME DEFAULT NULL,
    operation_date_end   DATETIME DEFAULT NULL,
    repeat_task_type    ENUM('DAY','WEEK','MONTH') DEFAULT NULL,
    repeat_task_number   INT DEFAULT NULL,
    recurrence_end_date  DATETIME DEFAULT NULL,
    report_template     VARCHAR(300) DEFAULT NULL,
    status              ENUM('TODO','DONE') DEFAULT 'TODO',
    optional            TINYINT(1) DEFAULT 0,
    created_by          INT UNSIGNED DEFAULT NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_pmti_task_date (planned_task_id, occurrence_date),
    INDEX idx_pmti_task_date (planned_task_id, occurrence_date),
    INDEX idx_pmti_date      (occurrence_date),
    CONSTRAINT fk_pmti_master FOREIGN KEY (planned_task_id) REFERENCES planned_maintenance_tasks(id) ON DELETE CASCADE,
    CONSTRAINT fk_pmti_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO planned_maintenance_tasks
  (id, system, subsystem, task, reference, operation_date_start, operation_date_end, repeat_task_type, repeat_task_number, report_template, status, optional)
VALUES
  (1, 'Server Room', 'DEHUMIDIFIER', 'Empty the external tank', '', '2025-02-03 09:00:00', '2025-02-03 09:15:00', 'DAY', 1, '', 'TODO', 0),
  (2, 'Server Room', 'DATALOGGERS', 'Collect log files', '', '2025-02-03 10:00:00', '2025-02-03 10:30:00', 'WEEK', 2, '', 'TODO', 0),
  (3, 'Computer and Peripherials', 'OPSERVER', 'Check the auto-backup on Windows Backup Server', '', '2025-02-04 10:00:00', '2025-02-04 10:30:00', 'WEEK', 1, '', 'TODO', 0),
  (4, 'Computer and Peripherials', 'ALL', 'Swap main/backup disks on all the nodes but OPSERVER', '', '2025-02-07 14:00:00', '2025-02-07 15:00:00', 'WEEK', 2, '', 'TODO', 0),
  (5, 'Computer and Peripherials', 'SESRV1', 'Check integrity of the RAID, check status of RAID BATTERY', '', '2025-02-07 10:00:00', '2025-02-07 10:15:00', 'WEEK', 1, '', 'TODO', 0),
  (6, 'Server Room', 'DEHUMIDIFIER', 'Check filter status and clean if necessary', '', '2026-05-14 09:00:00', '2026-05-14 09:15:00', 'MONTH', 1, '', 'DONE', 0),
  (7, 'Server Room', 'ELECTRICAL PANELS', 'Apply Lockout-Tagout Procedure to Server Room Electrical Panels', '', '2026-05-14 00:00:00', '2026-05-14 00:00:00', 'WEEK', 1, '', 'TODO', 1),
  (8, 'Server Room', 'ALL', 'Restore all systems in Server Room', '', '2026-05-14 00:00:00', '2026-05-14 00:00:00', 'WEEK', 1, '', 'TODO', 1),
  (9, 'Server Room', 'ALL', 'Shutdown all systems in Server Room', '', '2026-05-14 00:00:00', '2026-05-14 00:00:00', 'WEEK', 1, '', 'TODO', 1),
  (10, 'Server Room', 'DEHUMIDIFIER', 'Empty the external tank', '', '2026-05-14 09:00:00', '2026-05-14 09:15:00', 'DAY', 1, '', 'DONE', 0),
  (11, 'Computer and Peripherials', 'OPSERVER', 'Check the funcionality of the hi-temp emergency shutdown system', '', '2026-05-14 17:00:00', '2026-05-14 18:00:00', 'WEEK', 1, '', 'TODO', 0),
  (12, 'Computer and Peripherials', 'ALL', 'Verify network connectivity on all nodes', '', '2026-05-15 08:00:00', '2026-05-15 08:30:00', 'WEEK', 1, '', 'TODO', 0),
  (13, 'Server Room', 'DATALOGGERS', 'Download and archive temperature logs', '', '2026-05-18 10:00:00', '2026-05-18 10:30:00', 'WEEK', 2, '', 'TODO', 0),
  (14, 'Computer and Peripherials', 'SESRV1', 'Update firmware on RAID controller', '', '2026-05-20 14:00:00', '2026-05-20 15:00:00', 'MONTH', 1, '', 'TODO', 0),
  (15, 'Server Room', 'ELECTRICAL PANELS', 'Inspect UPS battery status and run self-test', '', '2026-05-21 09:00:00', '2026-05-21 09:45:00', 'WEEK', 1, '', 'TODO', 0),
  (16, 'Computer and Peripherials', 'OPSERVER', 'Rotate backup tapes and verify offsite copy', '', '2026-05-25 11:00:00', '2026-05-25 12:00:00', 'WEEK', 2, '', 'TODO', 1),
  (17, 'Server Room', 'DEHUMIDIFIER', 'Quarterly deep cleaning of internal coils', '', '2026-05-28 08:00:00', '2026-05-28 10:00:00', 'MONTH', 1, '', 'TODO', 0);

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
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    unit            VARCHAR(30)  DEFAULT 'pcs',
    quantity        INT          DEFAULT 0,
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
    CONSTRAINT fk_inv_cat      FOREIGN KEY (category_id) REFERENCES item_categories(id),
    CONSTRAINT fk_inv_location FOREIGN KEY (location_id) REFERENCES warehouse_locations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_movements (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    item_id         INT UNSIGNED NOT NULL,
    user_id         INT UNSIGNED NOT NULL,
    type            ENUM('IN','OUT','TRANSFER','ADJUSTMENT','RETURN') NOT NULL,
    quantity        INT          NOT NULL,
    quantity_before INT          NOT NULL,
    quantity_after  INT          NOT NULL,
    reference       VARCHAR(100),
    reason          TEXT,
    destination     VARCHAR(200),
    movement_date   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
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
    description TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shifts (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    shift_type_id   INT UNSIGNED NOT NULL,
    user_id         INT UNSIGNED NOT NULL,
    supervisor_id   INT UNSIGNED,
    date            DATE         NOT NULL,
    status          ENUM('SCHEDULED','CONFIRMED','IN_PROGRESS','COMPLETED','ABSENT','SWAPPED') DEFAULT 'SCHEDULED',
    check_in        DATETIME,
    check_out       DATETIME,
    notes           TEXT,
    overtime_hours  DECIMAL(5,2) DEFAULT 0,
    deleted_at      DATETIME NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_shift_user_date (user_id, date),
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
-- REFRESH TOKENS
-- =============================================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id    INT UNSIGNED NOT NULL,
    token      VARCHAR(500) NOT NULL,
    expires_at TIMESTAMP    NOT NULL,
    is_revoked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- INDEXES
-- =============================================================================
CREATE INDEX idx_operations_status     ON operations(status);
CREATE INDEX idx_operations_start_date ON operations(start_date);
CREATE INDEX idx_maint_asset           ON maintenance_records(asset_id);
CREATE INDEX idx_maint_scheduled       ON maintenance_records(scheduled_date);
CREATE INDEX idx_maint_status          ON maintenance_records(status);
CREATE INDEX idx_inventory_qty         ON inventory_items(quantity);
CREATE INDEX idx_stock_date            ON stock_movements(movement_date);
CREATE INDEX idx_stock_type            ON stock_movements(type);
CREATE INDEX idx_shifts_date           ON shifts(date);
CREATE INDEX idx_tasks_interval        ON tasks(interval_type);
CREATE INDEX idx_tasks_due             ON tasks(due_date);
CREATE INDEX idx_tasks_status          ON tasks(status);
CREATE INDEX idx_tasks_parent          ON tasks(parent_id);
CREATE INDEX idx_wiki_status           ON wiki_articles(status);
CREATE INDEX idx_notif_user_read       ON notifications(user_id, is_read);

-- =============================================================================
-- SEED DATA — Lookup / Reference tables
-- =============================================================================

-- Roles
INSERT IGNORE INTO roles (id, name, description, permissions) VALUES
(1, 'admin',   'System Administrator',  '["*"]'),
(2, 'manager', 'Operations Manager',    '["read","write","manage_users"]'),
(3, 'tech',    'Technician',            '["read","write"]'),
(4, 'viewer',  'Read-only access',      '["read"]');

-- Operation types
INSERT IGNORE INTO operation_types (id, name, color, icon, description) VALUES
(1, 'Deployment',  '#1565C0', 'rocket',      'System or hardware deployment'),
(2, 'Maintenance', '#E65100', 'build',       'Scheduled maintenance window'),
(3, 'Incident',    '#B71C1C', 'warning',     'Incident response operation'),
(4, 'Training',    '#1B5E20', 'school',      'Team training activity'),
(5, 'Audit',       '#4A148C', 'fact_check',  'Security or compliance audit');

-- Shift types
INSERT IGNORE INTO shift_types (id, name, code, start_time, end_time, color) VALUES
(1, 'Morning',   'MOR', '06:00:00', '14:00:00', '#1565C0'),
(2, 'Afternoon', 'AFT', '14:00:00', '22:00:00', '#0288D1'),
(3, 'Night',     'NGT', '22:00:00', '06:00:00', '#01579B'),
(4, 'On-Call',   'ONC', '00:00:00', '23:59:59', '#37474F');

-- Warehouse locations
INSERT IGNORE INTO warehouse_locations (id, name, code, description) VALUES
(1, 'Main Warehouse', 'WH-MAIN', 'Primary storage facility'),
(2, 'Server Room A',  'SR-A',    'Server hardware storage'),
(3, 'Server Room B',  'SR-B',    'Backup equipment storage'),
(4, 'Field Storage',  'FLD',     'Mobile/field equipment');

-- Asset categories
INSERT IGNORE INTO asset_categories (id, name, type) VALUES
(1, 'Servers',             'HARDWARE'),
(2, 'Workstations',        'HARDWARE'),
(3, 'Network Equipment',   'HARDWARE'),
(4, 'Storage Devices',     'HARDWARE'),
(5, 'Operating Systems',   'SOFTWARE'),
(6, 'Enterprise Software', 'SOFTWARE'),
(7, 'Security Tools',      'SOFTWARE');

-- Task categories
INSERT IGNORE INTO task_categories (id, name, color, icon) VALUES
(1, 'Infrastructure', '#1565C0', 'storage'),
(2, 'Security',       '#B71C1C', 'security'),
(3, 'Development',    '#1B5E20', 'code'),
(4, 'Support',        '#E65100', 'support_agent'),
(5, 'Compliance',     '#4A148C', 'gavel');

-- Wiki categories
INSERT IGNORE INTO wiki_categories (id, name, slug, icon, sort_order) VALUES
(1, 'Getting Started',   'getting-started',   'start',       1),
(2, 'Infrastructure',    'infrastructure',    'dns',         2),
(3, 'Security Policies', 'security-policies', 'lock',        3),
(4, 'SOPs',              'sops',              'description', 4),
(5, 'Troubleshooting',   'troubleshooting',   'build',       5);

-- Item categories
INSERT IGNORE INTO item_categories (id, name, description) VALUES
(1, 'Cables & Connectors', 'Network and power cables'),
(2, 'Hardware Parts',      'Replacement parts and components'),
(3, 'Consumables',         'Toner, paper, cleaning supplies'),
(4, 'Peripherals',         'Keyboards, mice, monitors'),
(5, 'Storage Media',       'SSDs, HDDs, USBs');

INSERT IGNORE INTO assets
  (id, category_id, name, serial_number, model, manufacturer, location, status)
VALUES
  (1, 1, 'Primary Web Server',     'SRV-001-WEB',  'PowerEdge R740',   'Dell',    'Server Room A', 'ACTIVE'),
  (2, 1, 'Database Server',        'SRV-002-DB',   'PowerEdge R640',   'Dell',    'Server Room A', 'ACTIVE'),
  (3, 1, 'Backup Server',          'SRV-003-BCK',  'ProLiant DL380',   'HP',      'Server Room B', 'ACTIVE'),
  (4, 3, 'Core Switch',            'NET-001-SW',   'Catalyst 9300',    'Cisco',   'Server Room A', 'ACTIVE'),
  (5, 3, 'Edge Firewall',          'NET-002-FW',   'FortiGate 100F',   'Fortinet','Server Room A', 'ACTIVE'),
  (6, 3, 'Wi-Fi Access Point L1',  'NET-003-AP1',  'UniFi U6-Pro',     'Ubiquiti','Floor 1',       'ACTIVE'),
  (7, 2, 'IT Workstation #1',      'WS-001',       'OptiPlex 7090',    'Dell',    'IT Office',     'ACTIVE'),
  (8, 2, 'IT Workstation #2',      'WS-002',       'OptiPlex 7090',    'Dell',    'IT Office',     'ACTIVE'),
  (9, 4, 'NAS Storage Array',      'STR-001-NAS',  'DS1823xs+',        'Synology','Server Room B', 'ACTIVE'),
  (10,4, 'Tape Library',           'STR-002-TAPE', 'StoreEver MSL3040','HP',      'Server Room B', 'INACTIVE');


-- Demo admin user
-- Password: Admin@1234  (bcrypt hash, 12 rounds)
INSERT IGNORE INTO users (id, role_id, username, email, password_hash, first_name, last_name, department, job_title) VALUES
(1, 1, 'admin', 'admin@smart.local',
 '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewFX5nGLPBhDvb4W',
 'System', 'Admin', 'IT', 'Platform Administrator');

 INSERT INTO users
    (role_id, username, email, password_hash, first_name, last_name, is_active, created_at, updated_at)
VALUES
    (1, 'Admin2', 'admin@admin.com', '$2a$12$mT2ebUe8xkTaPtkN1um38eHC8WoWiFH2wMa1LiqXyRUv6SdxhTKZm', 'System', 'Administrator', TRUE, NOW(), NOW());

SET FOREIGN_KEY_CHECKS = 1;

-- Confirmation message (visible in docker logs on first boot)
SELECT CONCAT(
    '✅  SMaRT schema initialised. ',
    COUNT(*), ' roles loaded.'
) AS init_status FROM roles;
