-- =============================================================================
-- Migration 006: CAE Flight Simulator Fleet, Sorties, QTG & Handover Domain
-- =============================================================================

CREATE TABLE IF NOT EXISTS simulators (
    id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code                  VARCHAR(40)  NOT NULL UNIQUE,
    name                  VARCHAR(200) NOT NULL,
    bay_code              VARCHAR(40)  NOT NULL,
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
