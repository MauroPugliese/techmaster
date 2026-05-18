-- =============================================================================
-- TECHMANAGER DATABASE SCHEMA
-- Version: 1.0.0 | Engine: MySQL 8.0+ | Charset: utf8mb4
-- =============================================================================

CREATE DATABASE IF NOT EXISTS techmanager CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE techmanager;

SET FOREIGN_KEY_CHECKS = 0;

-- =============================================================================
-- SECTION 1: AUTHENTICATION & USER MANAGEMENT
-- =============================================================================

CREATE TABLE roles (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    permissions JSON,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE users (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    role_id         INT UNSIGNED NOT NULL,
    username        VARCHAR(60) NOT NULL UNIQUE,
    email           VARCHAR(120) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    first_name      VARCHAR(80) NOT NULL,
    last_name       VARCHAR(80) NOT NULL,
    avatar_url      VARCHAR(500),
    department      VARCHAR(100),
    job_title       VARCHAR(100),
    phone           VARCHAR(30),
    is_active       BOOLEAN DEFAULT TRUE,
    last_login      TIMESTAMP NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB;

CREATE TABLE refresh_tokens (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id     INT UNSIGNED NOT NULL,
    token       VARCHAR(500) NOT NULL,
    expires_at  TIMESTAMP NOT NULL,
    is_revoked  BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =============================================================================
-- SECTION 2: OPERATIONS & ACTIVITIES (SORTIES)
-- =============================================================================

CREATE TABLE operation_types (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    color       VARCHAR(7) DEFAULT '#1565C0',
    icon        VARCHAR(50),
    description TEXT
) ENGINE=InnoDB;

CREATE TABLE operations (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    type_id         INT UNSIGNED NOT NULL,
    created_by      INT UNSIGNED NOT NULL,
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    status          ENUM('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED','ON_HOLD') DEFAULT 'PLANNED',
    priority        ENUM('LOW','MEDIUM','HIGH','CRITICAL') DEFAULT 'MEDIUM',
    location        VARCHAR(200),
    start_date      DATETIME NOT NULL,
    end_date        DATETIME,
    actual_end_date DATETIME,
    notes           TEXT,
    metadata        JSON,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_ops_type    FOREIGN KEY (type_id)    REFERENCES operation_types(id),
    CONSTRAINT fk_ops_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE operation_members (
    operation_id    INT UNSIGNED NOT NULL,
    user_id         INT UNSIGNED NOT NULL,
    role_in_op      VARCHAR(100),
    joined_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (operation_id, user_id),
    CONSTRAINT fk_opmembers_op   FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE,
    CONSTRAINT fk_opmembers_user FOREIGN KEY (user_id)      REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE operation_logs (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    operation_id    INT UNSIGNED NOT NULL,
    user_id         INT UNSIGNED NOT NULL,
    action          VARCHAR(200) NOT NULL,
    details         TEXT,
    logged_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_oplog_op   FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE,
    CONSTRAINT fk_oplog_user FOREIGN KEY (user_id)      REFERENCES users(id)
) ENGINE=InnoDB;

-- =============================================================================
-- SECTION 3: MAINTENANCE
-- =============================================================================

CREATE TABLE asset_categories (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    type        ENUM('HARDWARE','SOFTWARE','NETWORK','OTHER') NOT NULL,
    description TEXT
) ENGINE=InnoDB;

CREATE TABLE assets (
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
) ENGINE=InnoDB;

CREATE TABLE maintenance_records (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    asset_id        INT UNSIGNED NOT NULL,
    performed_by    INT UNSIGNED NOT NULL,
    type            ENUM('PREVENTIVE','CORRECTIVE','PREDICTIVE','UPGRADE','INSPECTION') NOT NULL,
    title           VARCHAR(200) NOT NULL,
    description     TEXT NOT NULL,
    status          ENUM('SCHEDULED','IN_PROGRESS','COMPLETED','FAILED','DEFERRED') DEFAULT 'SCHEDULED',
    priority        ENUM('LOW','MEDIUM','HIGH','CRITICAL') DEFAULT 'MEDIUM',
    scheduled_date  DATETIME NOT NULL,
    completed_date  DATETIME,
    downtime_hours  DECIMAL(6,2),
    cost            DECIMAL(10,2),
    parts_used      JSON,
    findings        TEXT,
    next_scheduled  DATETIME,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_maint_asset FOREIGN KEY (asset_id)     REFERENCES assets(id),
    CONSTRAINT fk_maint_user  FOREIGN KEY (performed_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- =============================================================================
-- SECTION 4: WAREHOUSE / INVENTORY
-- =============================================================================

CREATE TABLE warehouse_locations (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    code        VARCHAR(20) NOT NULL UNIQUE,
    description TEXT,
    is_active   BOOLEAN DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE item_categories (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    parent_id   INT UNSIGNED,
    description TEXT,
    color       VARCHAR(7) DEFAULT '#1565C0',
    CONSTRAINT fk_itemcat_parent FOREIGN KEY (parent_id) REFERENCES item_categories(id)
) ENGINE=InnoDB;

CREATE TABLE inventory_items (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    category_id     INT UNSIGNED NOT NULL,
    location_id     INT UNSIGNED,
    sku             VARCHAR(80) NOT NULL UNIQUE,
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    unit            VARCHAR(30) DEFAULT 'pcs',
    quantity        INT DEFAULT 0,
    min_stock       INT DEFAULT 0,
    max_stock       INT,
    reorder_point   INT DEFAULT 0,
    unit_cost       DECIMAL(10,2),
    supplier        VARCHAR(200),
    supplier_ref    VARCHAR(100),
    image_url       VARCHAR(500),
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_inv_cat      FOREIGN KEY (category_id) REFERENCES item_categories(id),
    CONSTRAINT fk_inv_location FOREIGN KEY (location_id) REFERENCES warehouse_locations(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE stock_movements (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    item_id         INT UNSIGNED NOT NULL,
    user_id         INT UNSIGNED NOT NULL,
    type            ENUM('IN','OUT','TRANSFER','ADJUSTMENT','RETURN') NOT NULL,
    quantity        INT NOT NULL,
    quantity_before INT NOT NULL,
    quantity_after  INT NOT NULL,
    reference       VARCHAR(100),
    reason          TEXT,
    destination     VARCHAR(200),
    movement_date   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_stock_item FOREIGN KEY (item_id)  REFERENCES inventory_items(id),
    CONSTRAINT fk_stock_user FOREIGN KEY (user_id)  REFERENCES users(id)
) ENGINE=InnoDB;

-- =============================================================================
-- SECTION 5: SHIFTS & SCHEDULING
-- =============================================================================

CREATE TABLE shift_types (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(80) NOT NULL,
    code        VARCHAR(10) NOT NULL UNIQUE,
    start_time  TIME NOT NULL,
    end_time    TIME NOT NULL,
    color       VARCHAR(7) DEFAULT '#1565C0',
    description TEXT
) ENGINE=InnoDB;

CREATE TABLE shifts (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    shift_type_id   INT UNSIGNED NOT NULL,
    user_id         INT UNSIGNED NOT NULL,
    supervisor_id   INT UNSIGNED,
    date            DATE NOT NULL,
    status          ENUM('SCHEDULED','CONFIRMED','IN_PROGRESS','COMPLETED','ABSENT','SWAPPED') DEFAULT 'SCHEDULED',
    check_in        DATETIME,
    check_out       DATETIME,
    notes           TEXT,
    overtime_hours  DECIMAL(5,2) DEFAULT 0,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_shift_user_date (user_id, date),
    CONSTRAINT fk_shift_type  FOREIGN KEY (shift_type_id) REFERENCES shift_types(id),
    CONSTRAINT fk_shift_user  FOREIGN KEY (user_id)       REFERENCES users(id),
    CONSTRAINT fk_shift_super FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE shift_swap_requests (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    from_shift_id   INT UNSIGNED NOT NULL,
    to_shift_id     INT UNSIGNED NOT NULL,
    requested_by    INT UNSIGNED NOT NULL,
    approved_by     INT UNSIGNED,
    status          ENUM('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING',
    reason          TEXT,
    response_note   TEXT,
    requested_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    responded_at    TIMESTAMP,
    CONSTRAINT fk_swap_from     FOREIGN KEY (from_shift_id) REFERENCES shifts(id),
    CONSTRAINT fk_swap_to       FOREIGN KEY (to_shift_id)   REFERENCES shifts(id),
    CONSTRAINT fk_swap_reqby    FOREIGN KEY (requested_by)  REFERENCES users(id),
    CONSTRAINT fk_swap_approver FOREIGN KEY (approved_by)   REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- =============================================================================
-- SECTION 6: TASK MANAGER
-- =============================================================================

CREATE TABLE task_categories (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    color       VARCHAR(7) DEFAULT '#1565C0',
    icon        VARCHAR(50)
) ENGINE=InnoDB;

CREATE TABLE tasks (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    parent_id       INT UNSIGNED,
    category_id     INT UNSIGNED,
    created_by      INT UNSIGNED NOT NULL,
    assigned_to     INT UNSIGNED,
    title           VARCHAR(300) NOT NULL,
    description     TEXT,
    interval_type   ENUM('ONCE','DAILY','WEEKLY','MONTHLY','YEARLY') DEFAULT 'ONCE',
    status          ENUM('TODO','IN_PROGRESS','REVIEW','DONE','CANCELLED','OVERDUE') DEFAULT 'TODO',
    priority        ENUM('LOW','MEDIUM','HIGH','CRITICAL') DEFAULT 'MEDIUM',
    due_date        DATETIME,
    completed_at    DATETIME,
    recurrence_rule VARCHAR(200),
    estimated_hours DECIMAL(6,2),
    actual_hours    DECIMAL(6,2),
    tags            JSON,
    attachments     JSON,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_task_parent   FOREIGN KEY (parent_id)   REFERENCES tasks(id) ON DELETE CASCADE,
    CONSTRAINT fk_task_cat      FOREIGN KEY (category_id) REFERENCES task_categories(id) ON DELETE SET NULL,
    CONSTRAINT fk_task_creator  FOREIGN KEY (created_by)  REFERENCES users(id),
    CONSTRAINT fk_task_assignee FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE task_comments (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    task_id     INT UNSIGNED NOT NULL,
    user_id     INT UNSIGNED NOT NULL,
    content     TEXT NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_tcomment_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    CONSTRAINT fk_tcomment_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- =============================================================================
-- SECTION 7: WIKI / KNOWLEDGE BASE
-- =============================================================================

CREATE TABLE wiki_categories (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    parent_id   INT UNSIGNED,
    name        VARCHAR(150) NOT NULL,
    slug        VARCHAR(150) NOT NULL UNIQUE,
    icon        VARCHAR(50),
    sort_order  INT DEFAULT 0,
    CONSTRAINT fk_wikicat_parent FOREIGN KEY (parent_id) REFERENCES wiki_categories(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE wiki_articles (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    category_id     INT UNSIGNED,
    author_id       INT UNSIGNED NOT NULL,
    last_editor_id  INT UNSIGNED,
    title           VARCHAR(300) NOT NULL,
    slug            VARCHAR(300) NOT NULL UNIQUE,
    content         LONGTEXT NOT NULL,
    excerpt         TEXT,
    status          ENUM('DRAFT','PUBLISHED','ARCHIVED','REVIEW') DEFAULT 'DRAFT',
    is_pinned       BOOLEAN DEFAULT FALSE,
    view_count      INT DEFAULT 0,
    tags            JSON,
    version         INT DEFAULT 1,
    published_at    TIMESTAMP NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_wiki_cat    FOREIGN KEY (category_id)    REFERENCES wiki_categories(id) ON DELETE SET NULL,
    CONSTRAINT fk_wiki_author FOREIGN KEY (author_id)      REFERENCES users(id),
    CONSTRAINT fk_wiki_editor FOREIGN KEY (last_editor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE wiki_revisions (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    article_id  INT UNSIGNED NOT NULL,
    editor_id   INT UNSIGNED NOT NULL,
    content     LONGTEXT NOT NULL,
    change_note VARCHAR(300),
    version     INT NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_wikirev_article FOREIGN KEY (article_id) REFERENCES wiki_articles(id) ON DELETE CASCADE,
    CONSTRAINT fk_wikirev_editor  FOREIGN KEY (editor_id)  REFERENCES users(id)
) ENGINE=InnoDB;

-- =============================================================================
-- SECTION 8: NOTIFICATIONS
-- =============================================================================

CREATE TABLE notifications (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id     INT UNSIGNED NOT NULL,
    type        VARCHAR(80) NOT NULL,
    title       VARCHAR(200) NOT NULL,
    body        TEXT,
    link        VARCHAR(500),
    is_read     BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =============================================================================
-- INDEXES FOR PERFORMANCE
-- =============================================================================

CREATE INDEX idx_operations_status     ON operations(status);
CREATE INDEX idx_operations_start_date ON operations(start_date);
CREATE INDEX idx_operations_type       ON operations(type_id);
CREATE INDEX idx_maint_asset           ON maintenance_records(asset_id);
CREATE INDEX idx_maint_scheduled       ON maintenance_records(scheduled_date);
CREATE INDEX idx_maint_status          ON maintenance_records(status);
CREATE INDEX idx_inventory_sku         ON inventory_items(sku);
CREATE INDEX idx_inventory_qty         ON inventory_items(quantity);
CREATE INDEX idx_stock_date            ON stock_movements(movement_date);
CREATE INDEX idx_stock_type            ON stock_movements(type);
CREATE INDEX idx_shifts_date           ON shifts(date);
CREATE INDEX idx_shifts_user_date      ON shifts(user_id, date);
CREATE INDEX idx_tasks_interval        ON tasks(interval_type);
CREATE INDEX idx_tasks_due             ON tasks(due_date);
CREATE INDEX idx_tasks_status          ON tasks(status);
CREATE INDEX idx_tasks_parent          ON tasks(parent_id);
CREATE INDEX idx_wiki_slug             ON wiki_articles(slug);
CREATE INDEX idx_wiki_status           ON wiki_articles(status);
CREATE INDEX idx_notif_user_read       ON notifications(user_id, is_read);

-- =============================================================================
-- SEED DATA
-- =============================================================================

INSERT INTO roles (name, description, permissions) VALUES
('admin',   'System Administrator',  '["*"]'),
('manager', 'Operations Manager',    '["read","write","manage_users"]'),
('tech',    'Technician',            '["read","write"]'),
('viewer',  'Read-only access',      '["read"]');

INSERT INTO operation_types (name, color, icon, description) VALUES
('Deployment',    '#1565C0', 'rocket',      'System or hardware deployment'),
('Maintenance',   '#E65100', 'build',       'Scheduled maintenance window'),
('Incident',      '#B71C1C', 'warning',     'Incident response operation'),
('Training',      '#1B5E20', 'school',      'Team training activity'),
('Audit',         '#4A148C', 'fact_check',  'Security or compliance audit');

INSERT INTO shift_types (name, code, start_time, end_time, color) VALUES
('Morning',   'MOR', '06:00:00', '14:00:00', '#1565C0'),
('Afternoon', 'AFT', '14:00:00', '22:00:00', '#0288D1'),
('Night',     'NGT', '22:00:00', '06:00:00', '#01579B'),
('On-Call',   'ONC', '00:00:00', '23:59:59', '#37474F');

INSERT INTO warehouse_locations (name, code, description) VALUES
('Main Warehouse',  'WH-MAIN', 'Primary storage facility'),
('Server Room A',   'SR-A',    'Server hardware storage'),
('Server Room B',   'SR-B',    'Backup equipment storage'),
('Field Storage',   'FLD',     'Mobile/field equipment');

INSERT INTO asset_categories (name, type) VALUES
('Servers',             'HARDWARE'),
('Workstations',        'HARDWARE'),
('Network Equipment',   'HARDWARE'),
('Storage Devices',     'HARDWARE'),
('Operating Systems',   'SOFTWARE'),
('Enterprise Software', 'SOFTWARE'),
('Security Tools',      'SOFTWARE');

INSERT INTO task_categories (name, color, icon) VALUES
('Infrastructure',  '#1565C0', 'storage'),
('Security',        '#B71C1C', 'security'),
('Development',     '#1B5E20', 'code'),
('Support',         '#E65100', 'support_agent'),
('Compliance',      '#4A148C', 'gavel');

INSERT INTO wiki_categories (name, slug, icon, sort_order) VALUES
('Getting Started',     'getting-started',    'start',        1),
('Infrastructure',      'infrastructure',     'dns',          2),
('Security Policies',   'security-policies',  'lock',         3),
('SOPs',                'sops',               'description',  4),
('Troubleshooting',     'troubleshooting',    'build',        5);

INSERT INTO item_categories (name, description) VALUES
('Cables & Connectors', 'Network and power cables'),
('Hardware Parts',      'Replacement parts and components'),
('Consumables',         'Toner, paper, cleaning supplies'),
('Peripherals',         'Keyboards, mice, monitors'),
('Storage Media',       'SSDs, HDDs, USBs');

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

INSERT INTO users
    (role_id, username, email, password_hash, first_name, last_name, is_active, created_at, updated_at)
VALUES
    (1, 'Admin2', 'admin@admin.com', '$2a$12$mT2ebUe8xkTaPtkN1um38eHC8WoWiFH2wMa1LiqXyRUv6SdxhTKZm', 'System', 'Administrator', TRUE, NOW(), NOW());


SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- ERD SUMMARY
-- users (1) ──< operations (M) via created_by
-- users (1) ──< operation_members (M) via user_id
-- users (1) ──< maintenance_records (M) via performed_by
-- assets (1) ──< maintenance_records (M) via asset_id
-- inventory_items (1) ──< stock_movements (M) via item_id
-- users (1) ──< shifts (M) via user_id
-- tasks (1) ──< tasks (M) via parent_id [recursive]
-- wiki_articles (1) ──< wiki_revisions (M) via article_id
-- =============================================================================
