// =============================================================================
// config/migrate.js — Database Migration Runner
// =============================================================================
const { sequelize, Sequelize } = require('./database');
const logger = require('./logger');

const MIGRATIONS = [
  {
    name: '001_baseline_schema',
    description: 'Ensure baseline tables exist and schema tracking is active',
    up: async (queryInterface) => {
      // Check if core tables already exist (e.g. initialized via 01-schema.sql)
      const tables = await queryInterface.showAllTables();
      const tableNames = Array.isArray(tables) ? tables.map(t => (typeof t === 'string' ? t : t.tableName || Object.values(t)[0]).toLowerCase()) : [];
      
      if (!tableNames.includes('roles')) {
        logger.info('Creating baseline roles table...');
        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS roles (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(50) NOT NULL UNIQUE,
            description TEXT,
            permissions JSON,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
      }
    }
  },
  {
    name: '002_add_part_number_to_inventory_items',
    description: 'Add part_number column to inventory_items table',
    up: async (queryInterface) => {
      const tables = await queryInterface.showAllTables();
      const tableNames = Array.isArray(tables) ? tables.map(t => (typeof t === 'string' ? t : t.tableName || Object.values(t)[0]).toLowerCase()) : [];
      
      if (tableNames.includes('inventory_items')) {
        const columns = await queryInterface.describeTable('inventory_items').catch(() => ({}));
        if (!columns.part_number) {
          logger.info('Adding part_number column to inventory_items...');
          await queryInterface.addColumn('inventory_items', 'part_number', {
            type: Sequelize.STRING(120),
            allowNull: true
          });
        }
      }
    }
  },
  {
    name: '003_create_planned_maintenance_tasks',
    description: 'Create planned_maintenance_tasks and instances tables',
    up: async (queryInterface) => {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS \`planned_maintenance_tasks\` (
          \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`system\` VARCHAR(150) NOT NULL,
          \`subsystem\` VARCHAR(150) NOT NULL,
          \`task\` TEXT NOT NULL,
          \`reference\` VARCHAR(200) DEFAULT NULL,
          \`operation_date_start\` DATETIME NOT NULL,
          \`operation_date_end\` DATETIME NOT NULL,
          \`repeat_task_type\` ENUM('DAY','WEEK','MONTH') NOT NULL DEFAULT 'WEEK',
          \`repeat_task_number\` INT NOT NULL DEFAULT 1,
          \`recurrence_end_date\` DATETIME DEFAULT NULL,
          \`report_template\` VARCHAR(300) DEFAULT NULL,
          \`status\` ENUM('TODO','DONE') NOT NULL DEFAULT 'TODO',
          \`optional\` TINYINT(1) NOT NULL DEFAULT 0,
          \`created_by\` INT UNSIGNED DEFAULT NULL,
          \`deleted_at\` DATETIME DEFAULT NULL,
          \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          INDEX \`idx_pmt_system\` (\`system\`),
          INDEX \`idx_pmt_subsystem\` (\`subsystem\`),
          INDEX \`idx_pmt_operation_date\` (\`operation_date_start\`),
          INDEX \`idx_pmt_status\` (\`status\`),
          INDEX \`idx_pmt_repeat_type\` (\`repeat_task_type\`),
          INDEX \`idx_pmt_recurrence_end\` (\`recurrence_end_date\`),
          CONSTRAINT \`fk_pmt_created_by\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // Ensure recurrence_end_date exists if table was created in an older version
      const pmtCols = await queryInterface.describeTable('planned_maintenance_tasks').catch(() => ({}));
      if (pmtCols && !pmtCols.recurrence_end_date) {
        logger.info('Adding recurrence_end_date to planned_maintenance_tasks...');
        await queryInterface.addColumn('planned_maintenance_tasks', 'recurrence_end_date', {
          type: Sequelize.DATE,
          allowNull: true
        });
      }

      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS \`planned_maintenance_task_instances\` (
          \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`planned_task_id\` INT UNSIGNED NOT NULL,
          \`occurrence_date\` DATE NOT NULL,
          \`exception_type\` ENUM('OVERRIDE','DELETED') NOT NULL DEFAULT 'OVERRIDE',
          \`system\` VARCHAR(150) DEFAULT NULL,
          \`subsystem\` VARCHAR(150) DEFAULT NULL,
          \`task\` TEXT DEFAULT NULL,
          \`reference\` VARCHAR(200) DEFAULT NULL,
          \`operation_date_start\` DATETIME DEFAULT NULL,
          \`operation_date_end\` DATETIME DEFAULT NULL,
          \`repeat_task_type\` ENUM('DAY','WEEK','MONTH') DEFAULT NULL,
          \`repeat_task_number\` INT DEFAULT NULL,
          \`recurrence_end_date\` DATETIME DEFAULT NULL,
          \`report_template\` VARCHAR(300) DEFAULT NULL,
          \`status\` ENUM('TODO','DONE') DEFAULT 'TODO',
          \`optional\` TINYINT(1) DEFAULT 0,
          \`created_by\` INT UNSIGNED DEFAULT NULL,
          \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`uniq_pmti_task_date\` (\`planned_task_id\`, \`occurrence_date\`),
          INDEX \`idx_pmti_task_date\` (\`planned_task_id\`, \`occurrence_date\`),
          INDEX \`idx_pmti_date\` (\`occurrence_date\`),
          CONSTRAINT \`fk_pmti_master\` FOREIGN KEY (\`planned_task_id\`) REFERENCES \`planned_maintenance_tasks\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_pmti_created_by\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    }
  },
  {
    name: '004_create_ui_preferences',
    description: 'Create UI customizable layout and field preferences tables',
    up: async () => {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS ui_section_access_preferences (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          section_key VARCHAR(60) NOT NULL,
          subject_type ENUM('global', 'role', 'user') NOT NULL DEFAULT 'global',
          subject_key VARCHAR(120) NOT NULL,
          is_visible BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_section_subject_pref (section_key, subject_type, subject_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS ui_section_field_preferences (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          section_key VARCHAR(60) NOT NULL,
          scope ENUM('table', 'form') NOT NULL,
          field_key VARCHAR(100) NOT NULL,
          label VARCHAR(150) NULL,
          is_visible BOOLEAN NOT NULL DEFAULT TRUE,
          display_order INT NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_section_scope_field (section_key, scope, field_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS ui_section_field_role_preferences (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          section_key VARCHAR(60) NOT NULL,
          scope ENUM('table', 'form') NOT NULL,
          role_name VARCHAR(60) NOT NULL,
          field_key VARCHAR(100) NOT NULL,
          label VARCHAR(150) NULL,
          is_visible BOOLEAN NOT NULL DEFAULT TRUE,
          display_order INT NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_section_scope_role_field (section_key, scope, role_name, field_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS ui_table_column_preferences (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          table_name VARCHAR(100) NOT NULL,
          column_name VARCHAR(100) NOT NULL,
          label VARCHAR(150) NULL,
          is_visible BOOLEAN NOT NULL DEFAULT TRUE,
          display_order INT NOT NULL DEFAULT 0,
          width VARCHAR(20) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_table_column_pref (table_name, column_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    }
  },
  {
    name: '005_enhance_shifts_custom_and_leave',
    description: 'Add shift type categories, custom shift timings, and leave tracking fields to shifts',
    up: async (queryInterface) => {
      const tables = await queryInterface.showAllTables();
      const tableNames = Array.isArray(tables)
        ? tables.map(t => (typeof t === 'string' ? t : t.tableName || Object.values(t)[0]).toLowerCase())
        : [];

      if (tableNames.includes('shift_types')) {
        const typeCols = await queryInterface.describeTable('shift_types').catch(() => ({}));
        if (typeCols && !typeCols.category) {
          logger.info('Adding category column to shift_types...');
          await queryInterface.addColumn('shift_types', 'category', {
            type: Sequelize.ENUM('WORK', 'LEAVE'),
            allowNull: false,
            defaultValue: 'WORK'
          });
        }

        await sequelize.query(`
          INSERT IGNORE INTO shift_types (name, code, start_time, end_time, color, category, description) VALUES
          ('Custom Shift',   'CST', '08:00:00', '16:00:00', '#7C3AED', 'WORK',  'Custom schedule for overtime, early leave, or flexible hours'),
          ('Sick Leave',     'SCK', '00:00:00', '00:00:00', '#EF4444', 'LEAVE', 'Medical or sick leave'),
          ('Vacation',       'VAC', '00:00:00', '00:00:00', '#10B981', 'LEAVE', 'Planned annual vacation'),
          ('Public Holiday', 'HOL', '00:00:00', '00:00:00', '#F59E0B', 'LEAVE', 'National or company holiday'),
          ('Personal Leave', 'PRM', '00:00:00', '00:00:00', '#8B5CF6', 'LEAVE', 'Personal time off or permit');
        `);
      }

      if (tableNames.includes('shifts')) {
        const shiftCols = await queryInterface.describeTable('shifts').catch(() => ({}));
        const columnsToAdd = [
          ['entry_kind', { type: Sequelize.ENUM('WORK', 'CUSTOM', 'LEAVE'), allowNull: false, defaultValue: 'WORK' }],
          ['leave_type', { type: Sequelize.STRING(40), allowNull: true }],
          ['custom_start_time', { type: Sequelize.TIME, allowNull: true }],
          ['custom_end_time', { type: Sequelize.TIME, allowNull: true }],
          ['adjustment_reason', { type: Sequelize.STRING(120), allowNull: true }]
        ];

        for (const [colName, definition] of columnsToAdd) {
          if (shiftCols && !shiftCols[colName]) {
            logger.info(`Adding ${colName} column to shifts...`);
            await queryInterface.addColumn('shifts', colName, definition);
          }
        }

        await sequelize.query(`
          ALTER TABLE shifts
          MODIFY COLUMN status ENUM('SCHEDULED','CONFIRMED','IN_PROGRESS','COMPLETED','ABSENT','SWAPPED','ON_LEAVE')
          DEFAULT 'SCHEDULED';
        `);
      }
    }
  },
  {
    name: '006_flight_simulator_domain',
    description: 'Add multi-simulator fleet, subsystems, QTG compliance, sortie telemetry, aviation spares, and shift handovers',
    up: async (queryInterface) => {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS \`simulators\` (
          \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`code\` VARCHAR(40) NOT NULL UNIQUE,
          \`name\` VARCHAR(200) NOT NULL,
          \`bay_code\` VARCHAR(40) NOT NULL,
          \`platform_category\` ENUM('COMMERCIAL_FIXED_WING','ROTORCRAFT','DEFENSE_FMS','FTD_FNPT') NOT NULL DEFAULT 'COMMERCIAL_FIXED_WING',
          \`aircraft_type\` VARCHAR(120) NOT NULL,
          \`manufacturer\` VARCHAR(120) DEFAULT 'CAE',
          \`serial_number\` VARCHAR(100) DEFAULT NULL,
          \`authority\` VARCHAR(60) DEFAULT 'EASA',
          \`qualification_level\` VARCHAR(60) DEFAULT 'CS-FSTD Level D',
          \`certificate_code\` VARCHAR(100) DEFAULT NULL,
          \`certificate_expiry\` DATE DEFAULT NULL,
          \`last_eval_date\` DATE DEFAULT NULL,
          \`daily_available_hours\` DECIMAL(4,1) DEFAULT 20.0,
          \`engine_avionics\` VARCHAR(200) DEFAULT NULL,
          \`software_load\` VARCHAR(120) DEFAULT NULL,
          \`airac_cycle\` VARCHAR(60) DEFAULT NULL,
          \`visual_system\` VARCHAR(160) DEFAULT NULL,
          \`motion_system\` VARCHAR(120) DEFAULT NULL,
          \`control_loading\` VARCHAR(120) DEFAULT NULL,
          \`ios_config\` VARCHAR(120) DEFAULT NULL,
          \`status\` ENUM('READY','IN_SORTIE','PRE_FLIGHT','MAINTENANCE','DEGRADED','AOG') NOT NULL DEFAULT 'READY',
          \`power_on_hours\` DECIMAL(10,1) DEFAULT 0.0,
          \`motion_hours\` DECIMAL(10,1) DEFAULT 0.0,
          \`visual_lamp_hours\` DECIMAL(10,1) DEFAULT 0.0,
          \`limitations_mel\` TEXT DEFAULT NULL,
          \`notes\` TEXT DEFAULT NULL,
          \`asset_id\` INT UNSIGNED DEFAULT NULL,
          \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          INDEX \`idx_sim_status\` (\`status\`),
          INDEX \`idx_sim_bay\` (\`bay_code\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS \`simulator_subsystems\` (
          \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`simulator_id\` INT UNSIGNED NOT NULL,
          \`subsystem_code\` ENUM('VISUAL','MOTION','CONTROL_LOADING','AVIONICS_COCKPIT','IOS','HOST_COMPUTE','SOUND','HVAC_POWER') NOT NULL,
          \`name\` VARCHAR(150) NOT NULL,
          \`part_number\` VARCHAR(100) DEFAULT NULL,
          \`serial_number\` VARCHAR(100) DEFAULT NULL,
          \`firmware_version\` VARCHAR(80) DEFAULT NULL,
          \`status\` ENUM('NOMINAL','DEGRADED','FAULT','MAINTENANCE') NOT NULL DEFAULT 'NOMINAL',
          \`operating_hours\` DECIMAL(10,1) DEFAULT 0.0,
          \`last_calibrated_at\` DATE DEFAULT NULL,
          \`next_calibration_due\` DATE DEFAULT NULL,
          \`notes\` TEXT DEFAULT NULL,
          \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          INDEX \`idx_sim_sub_sim\` (\`simulator_id\`),
          CONSTRAINT \`fk_sim_sub_sim\` FOREIGN KEY (\`simulator_id\`) REFERENCES \`simulators\`(\`id\`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS \`simulator_qtg_records\` (
          \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`simulator_id\` INT UNSIGNED NOT NULL,
          \`test_code\` VARCHAR(60) NOT NULL,
          \`title\` VARCHAR(220) NOT NULL,
          \`category\` ENUM('PERFORMANCE','HANDLING','MOTION_CUEING','VISUAL_SYSTEM','SOUND','IOS_NAV') NOT NULL DEFAULT 'PERFORMANCE',
          \`quarter\` ENUM('Q1','Q2','Q3','Q4') NOT NULL DEFAULT 'Q1',
          \`year\` INT NOT NULL,
          \`mode\` ENUM('AUTO','MANUAL') NOT NULL DEFAULT 'AUTO',
          \`status\` ENUM('PENDING','PASSED','TOLERANCE_WARN','FAILED') NOT NULL DEFAULT 'PENDING',
          \`due_date\` DATE DEFAULT NULL,
          \`executed_at\` DATETIME DEFAULT NULL,
          \`executed_by\` INT UNSIGNED DEFAULT NULL,
          \`measured_delta\` VARCHAR(120) DEFAULT NULL,
          \`notes\` TEXT DEFAULT NULL,
          \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          INDEX \`idx_qtg_sim_yr\` (\`simulator_id\`, \`year\`, \`quarter\`),
          CONSTRAINT \`fk_qtg_sim\` FOREIGN KEY (\`simulator_id\`) REFERENCES \`simulators\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_qtg_user\` FOREIGN KEY (\`executed_by\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS \`shift_handovers\` (
          \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`shift_date\` DATE NOT NULL,
          \`from_shift_code\` VARCHAR(20) NOT NULL,
          \`to_shift_code\` VARCHAR(20) NOT NULL,
          \`authored_by\` INT UNSIGNED NOT NULL,
          \`acknowledged_by\` INT UNSIGNED DEFAULT NULL,
          \`acknowledged_at\` DATETIME DEFAULT NULL,
          \`simulators_status_summary\` TEXT DEFAULT NULL,
          \`open_drs_summary\` TEXT DEFAULT NULL,
          \`pending_actions\` TEXT DEFAULT NULL,
          \`safety_loto_notes\` TEXT DEFAULT NULL,
          \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          INDEX \`idx_handover_date\` (\`shift_date\`),
          CONSTRAINT \`fk_handover_author\` FOREIGN KEY (\`authored_by\`) REFERENCES \`users\`(\`id\`),
          CONSTRAINT \`fk_handover_ack\` FOREIGN KEY (\`acknowledged_by\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      const tables = await queryInterface.showAllTables();
      const tableNames = Array.isArray(tables)
        ? tables.map(t => (typeof t === 'string' ? t : t.tableName || Object.values(t)[0]).toLowerCase())
        : [];

      if (tableNames.includes('users')) {
        const cols = await queryInterface.describeTable('users').catch(() => ({}));
        if (!cols.certifications) {
          await queryInterface.addColumn('users', 'certifications', { type: Sequelize.JSON, allowNull: true });
        }
      }

      if (tableNames.includes('operations')) {
        const cols = await queryInterface.describeTable('operations').catch(() => ({}));
        const opCols = [
          ['sortie_code', { type: Sequelize.STRING(50), allowNull: true }],
          ['simulator_id', { type: Sequelize.INTEGER.UNSIGNED, allowNull: true }],
          ['customer_operator', { type: Sequelize.STRING(120), allowNull: true }],
          ['scenario_code', { type: Sequelize.STRING(120), allowNull: true }],
          ['weather_profile', { type: Sequelize.STRING(80), allowNull: true }],
          ['motion_required', { type: Sequelize.BOOLEAN, defaultValue: true }],
          ['scheduled_hours', { type: Sequelize.DECIMAL(5, 2), allowNull: true }],
          ['actual_flight_hours', { type: Sequelize.DECIMAL(5, 2), allowNull: true }],
          ['lost_training_minutes', { type: Sequelize.INTEGER, defaultValue: 0 }],
          ['outcome', { type: Sequelize.ENUM('PENDING','CLEAN','COMPLETED_WITH_SNAGS','INTERRUPTED_TECH','NO_SHOW','CANCELLED'), defaultValue: 'PENDING' }],
          ['snag_summary', { type: Sequelize.TEXT, allowNull: true }]
        ];
        for (const [colName, def] of opCols) {
          if (!cols[colName]) {
            await queryInterface.addColumn('operations', colName, def);
          }
        }
      }

      if (tableNames.includes('maintenance_records')) {
        await sequelize.query(`ALTER TABLE \`maintenance_records\` MODIFY COLUMN \`asset_id\` INT UNSIGNED NULL;`).catch(() => {});
        const cols = await queryInterface.describeTable('maintenance_records').catch(() => ({}));
        const mCols = [
          ['simulator_id', { type: Sequelize.INTEGER.UNSIGNED, allowNull: true }],
          ['sortie_id', { type: Sequelize.INTEGER.UNSIGNED, allowNull: true }],
          ['subsystem_code', { type: Sequelize.STRING(60), allowNull: true }],
          ['severity', { type: Sequelize.ENUM('MINOR','DEGRADED','AOG'), defaultValue: 'MINOR' }],
          ['lost_training_hours', { type: Sequelize.DECIMAL(5, 2), defaultValue: 0 }],
          ['is_snag', { type: Sequelize.BOOLEAN, defaultValue: false }]
        ];
        for (const [colName, def] of mCols) {
          if (!cols[colName]) {
            await queryInterface.addColumn('maintenance_records', colName, def);
          }
        }
      }

      if (tableNames.includes('planned_maintenance_tasks')) {
        const cols = await queryInterface.describeTable('planned_maintenance_tasks').catch(() => ({}));
        if (!cols.simulator_id) {
          await queryInterface.addColumn('planned_maintenance_tasks', 'simulator_id', { type: Sequelize.INTEGER.UNSIGNED, allowNull: true });
        }
      }

      if (tableNames.includes('inventory_items')) {
        const cols = await queryInterface.describeTable('inventory_items').catch(() => ({}));
        const iCols = [
          ['part_classification', { type: Sequelize.ENUM('CONSUMABLE','ROTATABLE_LRU','TOOL_CALIBRATED'), defaultValue: 'CONSUMABLE' }],
          ['aog_critical', { type: Sequelize.BOOLEAN, defaultValue: false }],
          ['lead_time_days', { type: Sequelize.INTEGER, defaultValue: 7 }],
          ['compatible_models', { type: Sequelize.JSON, allowNull: true }],
          ['unserviceable_qty', { type: Sequelize.INTEGER, defaultValue: 0 }]
        ];
        for (const [colName, def] of iCols) {
          if (!cols[colName]) {
            await queryInterface.addColumn('inventory_items', colName, def);
          }
        }
      }

      if (tableNames.includes('tasks')) {
        const cols = await queryInterface.describeTable('tasks').catch(() => ({}));
        if (!cols.simulator_id) {
          await queryInterface.addColumn('tasks', 'simulator_id', { type: Sequelize.INTEGER.UNSIGNED, allowNull: true });
        }
      }

      // Align default operation_types to Flight Simulator Sortie Profiles
      if (tableNames.includes('operation_types')) {
        await sequelize.query(`UPDATE operation_types SET name='Type Rating', icon='flight_takeoff', color='#1565C0', description='Initial or transition aircraft type rating training sortie' WHERE id=1 AND name='Deployment';`);
        await sequelize.query(`UPDATE operation_types SET name='Recurrent LPC / OPC', icon='verified', color='#0288D1', description='Proficiency check and recurrent airline regulatory sortie' WHERE id=2 AND name='Maintenance';`);
        await sequelize.query(`UPDATE operation_types SET name='LOFT Mission', icon='alt_route', color='#0F766E', description='Line-Oriented Flight Training full scenario sortie' WHERE id=3 AND name='Incident';`);
        await sequelize.query(`UPDATE operation_types SET name='Checkride / Exam', icon='school', color='#7C3AED', description='Authority examiner skill test and ZFT qualification' WHERE id=4 AND name='Training';`);
        await sequelize.query(`UPDATE operation_types SET name='Mission Rehearsal', icon='military_tech', color='#4338CA', description='Tactical, helicopter NVG/SAR, or defense mission training' WHERE id=5 AND name='Audit';`);
        await sequelize.query(`INSERT IGNORE INTO operation_types (id, name, color, icon, description) VALUES (6, 'QTG & Engineering Fly-Out', '#D97706', 'tune', 'Morning readiness fly-out or QTG validation flight');`);
      }

      // Seed 5 authentic CAE Flight Simulators, subsystems, QTG & initial sorties when simulators is empty
      const [[simCountRow]] = await sequelize.query(`SELECT COUNT(*) AS cnt FROM simulators;`);
      if (Number(simCountRow?.cnt || 0) === 0) {
        const currentYear = new Date().getUTCFullYear();
        const addDaysIso = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

        await sequelize.query(`
          INSERT INTO simulators
            (code, name, bay_code, platform_category, aircraft_type, manufacturer, serial_number, authority, qualification_level, certificate_code, certificate_expiry, last_eval_date, daily_available_hours, engine_avionics, software_load, airac_cycle, visual_system, motion_system, control_loading, ios_config, status, power_on_hours, motion_hours, visual_lamp_hours, limitations_mel, notes)
          VALUES
            ('FFS-A320-01', 'Airbus A320neo Full Flight Simulator #1', 'BAY-01', 'COMMERCIAL_FIXED_WING', 'Airbus A320neo / CEO', 'CAE 7000XR', 'CAE-7000XR-A320-104', 'EASA', 'CS-FSTD Level D', 'EASA.IT.FSTD.014', '${addDaysIso(165)}', '${addDaysIso(-200)}', 20.0, 'CFM LEAP-1A26 / Thales FMS R2', 'Host Load v4.18.2', 'AIRAC 2611', 'CAE Tropos 6000XR · 200x40 Laser 3ch', 'CAE 6-DOF Electric eMotion', 'Moog/CAE Digital CLS-500', 'Dual-Screen Instructor Console v8', 'IN_SORTIE', 18420.5, 14210.0, 3120.4, NULL, 'Primary commercial narrowbody bay. Cat IIIB LVP qualified.'),
            ('FFS-B737-02', 'Boeing 737 MAX 8 Full Flight Simulator #2', 'BAY-02', 'COMMERCIAL_FIXED_WING', 'Boeing 737 MAX 8 / 800', 'CAE 7000XR', 'CAE-7000XR-B737-209', 'EASA', 'CS-FSTD Level D', 'EASA.IT.FSTD.022', '${addDaysIso(24)}', '${addDaysIso(-340)}', 20.0, 'CFM LEAP-1B / Rockwell Collins ProLine', 'Host Load v5.04.1', 'AIRAC 2611', 'CAE Medallion-6000XR · 220x40 LED', 'CAE 6-DOF Electric eMotion', 'CAE Digital CLS-500', 'Mobile Tablet + Desk IOS', 'READY', 15290.0, 11845.5, 2410.0, NULL, 'Annual EASA re-evaluation due within 30 days.'),
            ('FFS-A350-03', 'Airbus A350-900 Full Flight Simulator #3', 'BAY-03', 'COMMERCIAL_FIXED_WING', 'Airbus A350-900 XWB', 'CAE 7000XR', 'CAE-7000XR-A350-312', 'EASA / FAA', 'Level D Dual-Qual', 'EASA.FAA.350.008', '${addDaysIso(280)}', '${addDaysIso(-85)}', 20.0, 'Trent XWB-84 / Honeywell Primus Epic', 'Host Load v3.22.0', 'AIRAC 2611', 'CAE Tropos 6000XR · 4K Laser Array', 'CAE 6-DOF Hydraulic-Free', 'Active Side-Stick CLS', 'CAE Rise IOS + Debrief Pod', 'DEGRADED', 9840.2, 7610.8, 1890.0, 'Visual Ch.3 right peripheral projector dimmed by 12% (MEL Cat B pending laser module swap).', 'Long-haul widebody fleet bay.'),
            ('FFS-AW139-04', 'Leonardo AW139 Rotorcraft FFS #4', 'BAY-04', 'ROTORCRAFT', 'Leonardo AW139', 'CAE 3000 Series', 'CAE-3000-AW139-077', 'EASA / ENAC', 'CS-FSTD(H) Level D', 'ENAC.FSTD.H.005', '${addDaysIso(120)}', '${addDaysIso(-245)}', 18.0, 'PT6C-67C / Honeywell Phase 8', 'RotorHost v6.1.4', 'AIRAC 2611', '8-Channel Extreme FOV Chin-Window Dome', 'CAE 6-DOF High-Frequency Rotor', '4-Axis Helicopter AFCS CLS', 'HEMS / SAR Mission IOS', 'READY', 11340.0, 9450.0, 2105.5, NULL, 'Offshore Oil&Gas, HEMS & NVG Level D certified.'),
            ('FMS-M346-05', 'Leonardo M-346 Full Mission Simulator #5', 'BAY-05', 'DEFENSE_FMS', 'Leonardo M-346 Master AJT', 'CAE FMS-5000', 'CAE-FMS-M346-019', 'MAA / AER(EP)', 'Level D Tactical', 'MAA.IFTS.FMS.005', '${addDaysIso(215)}', '${addDaysIso(-150)}', 16.0, 'F124-GA-200 / Embedded ETTS', 'TacCore v7.3.0', 'Tactical DB 26-B', '360° Partial Dome 9ch LCoS', 'Fixed-Base G-Seat + G-Suit', 'Fighter HOTAS Force-Feel', 'LVC Tactical White-Force IOS', 'READY', 7620.0, 0.0, 1480.0, NULL, 'LVC networked for multi-ship BFM/ACM & EW sorties.');
        `);

        const [seededSims] = await sequelize.query(`SELECT id, code, bay_code FROM simulators ORDER BY id ASC;`);
        const [[firstUser]] = await sequelize.query(`SELECT id FROM users ORDER BY id ASC LIMIT 1;`);
        const adminId = firstUser?.id || 1;

        for (const sim of seededSims) {
          const isFixedSeat = sim.code === 'FMS-M346-05';
          const visStatus = sim.code === 'FFS-A350-03' ? 'DEGRADED' : 'NOMINAL';
          await sequelize.query(`
            INSERT INTO simulator_subsystems (simulator_id, subsystem_code, name, firmware_version, status, operating_hours)
            VALUES
              (${sim.id}, 'VISUAL', 'Visual Display & Projectors', 'VIS-8.4.2', '${visStatus}', 2100.0),
              (${sim.id}, 'MOTION', '${isFixedSeat ? 'G-Seat & Cueing Seat Actuation' : '6-DOF Electric Motion Platform'}', 'MOT-4.2.0', 'NOMINAL', 1850.0),
              (${sim.id}, 'CONTROL_LOADING', 'Primary Flight Control Loading (CLS)', 'CLS-5.1.3', 'NOMINAL', 2400.0),
              (${sim.id}, 'AVIONICS_COCKPIT', 'Simulated Avionics, Displays & Panels', 'AV-11.0.4', 'NOMINAL', 2600.0),
              (${sim.id}, 'IOS', 'Instructor Operating Station & Debrief', 'IOS-9.2.1', 'NOMINAL', 2750.0),
              (${sim.id}, 'HOST_COMPUTE', 'Real-Time Host Simulation Rack', 'HOST-6.0.8', 'NOMINAL', 3100.0),
              (${sim.id}, 'SOUND', '3D Acoustic & Intercom System', 'SND-3.4.0', 'NOMINAL', 2600.0),
              (${sim.id}, 'HVAC_POWER', 'Bay PDU, UPS & Precision Chiller', 'PWR-2.1.0', 'NOMINAL', 4200.0);
          `);

          await sequelize.query(`
            INSERT INTO simulator_qtg_records (simulator_id, test_code, title, category, quarter, year, mode, status, due_date, measured_delta)
            VALUES
              (${sim.id}, 'QTG-1.B.1', 'Takeoff Ground Acceleration & V1 Cut', 'PERFORMANCE', 'Q1', ${currentYear}, 'AUTO', 'PASSED', '${currentYear}-03-31', '±0.8 kt / ±1.2%'),
              (${sim.id}, 'QTG-2.C.4', 'Roll Rate & Dutch Roll Damping Response', 'HANDLING', 'Q2', ${currentYear}, 'AUTO', 'PASSED', '${currentYear}-06-30', 'Within CS-FSTD tolerance'),
              (${sim.id}, 'QTG-3.A.2', '6-DOF Latency & Pitch Cueing Phase Check', 'MOTION_CUEING', 'Q3', ${currentYear}, 'AUTO', '${sim.code === 'FFS-A350-03' ? 'TOLERANCE_WARN' : 'PASSED'}', '${currentYear}-09-30', '${sim.code === 'FFS-A350-03' ? '38ms (warn limit 40ms)' : '24ms nominal'}'),
              (${sim.id}, 'QTG-4.D.1', 'Optical Collimation, Contrast & Edge Blending', 'VISUAL_SYSTEM', 'Q4', ${currentYear}, 'MANUAL', 'PENDING', '${currentYear}-12-15', NULL);
          `);
        }

        // Seed today's sample sorties if operations table is currently empty
        const [[opsCnt]] = await sequelize.query(`SELECT COUNT(*) AS cnt FROM operations;`);
        if (Number(opsCnt?.cnt || 0) === 0 && seededSims.length >= 4 && firstUser) {
          const day = new Date().toISOString().slice(0, 10);
          await sequelize.query(`
            INSERT INTO operations
              (sortie_code, type_id, simulator_id, created_by, title, customer_operator, scenario_code, weather_profile, motion_required, scheduled_hours, actual_flight_hours, lost_training_minutes, outcome, status, priority, location, start_date, end_date, description)
            VALUES
              ('SRT-${day.replace(/-/g, '')}-01', 2, ${seededSims[0].id}, ${adminId}, 'A320neo LVP CAT IIIB Recurrent Check', 'ITA Airways', 'LIRF → LIMC', 'Night IMC / RVR 75m', 1, 4.00, NULL, 0, 'PENDING', 'IN_PROGRESS', 'HIGH', '${seededSims[0].bay_code}', '${day} 08:00:00', '${day} 12:00:00', 'Biannual LPC crew proficiency check with dual engine failure scenarios.'),
              ('SRT-${day.replace(/-/g, '')}-02', 1, ${seededSims[1].id}, ${adminId}, 'B737 MAX Type Rating Slot #4', 'Ryanair DAC', 'EIDW → EGSS', 'Crosswind 28kt / Gusts', 1, 4.00, 4.00, 0, 'CLEAN', 'COMPLETED', 'MEDIUM', '${seededSims[1].bay_code}', '${day} 06:00:00', '${day} 10:00:00', 'Normal & abnormal procedures phase 2.'),
              ('SRT-${day.replace(/-/g, '')}-03', 3, ${seededSims[2].id}, ${adminId}, 'A350 ETOPS Transatlantic LOFT', 'Lufthansa', 'EDDF → KJFK', 'North Atlantic Turbulence', 1, 4.00, NULL, 15, 'PENDING', 'PLANNED', 'HIGH', '${seededSims[2].bay_code}', '${day} 14:00:00', '${day} 18:00:00', 'Full LOFT mission; check MEL note on Visual Channel 3.'),
              ('SRT-${day.replace(/-/g, '')}-04', 5, ${seededSims[3].id}, ${adminId}, 'AW139 Offshore Helideck Night NVG', 'Leonardo / HEMS', 'LIPE → Offshore Rig', 'Night NVG · Sea State 5', 1, 3.00, NULL, 0, 'PENDING', 'PLANNED', 'CRITICAL', '${seededSims[3].bay_code}', '${day} 13:00:00', '${day} 16:00:00', 'Offshore deck landing and hoist emergency recovery.');
          `);
        }
      }
    }
  },
  {
    name: '007_station_daily_ops',
    description: 'Add station_kind (Test Places, IOS Consoles, FFS Bays), daily operating log, shifts, entries & sample Test Place MNT history',
    async up(queryInterface, Sequelize) {
      const tableNames = await queryInterface.showAllTables();

      if (tableNames.includes('simulators')) {
        const cols = await queryInterface.describeTable('simulators').catch(() => ({}));
        if (!cols.station_kind) {
          await queryInterface.addColumn('simulators', 'station_kind', {
            type: Sequelize.ENUM('FFS_BAY', 'TEST_PLACE', 'IOS_CONSOLE'),
            allowNull: false,
            defaultValue: 'FFS_BAY'
          });
        }
        if (!cols.sort_order) {
          await queryInterface.addColumn('simulators', 'sort_order', {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0
          });
        }
        await sequelize.query(`UPDATE simulators SET station_kind='FFS_BAY' WHERE station_kind IS NULL;`).catch(() => {});
        await sequelize.query(`UPDATE simulators SET sort_order=id WHERE sort_order=0 AND station_kind='FFS_BAY';`).catch(() => {});
      }

      await sequelize.query(`
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
      `);

      await sequelize.query(`
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
      `);

      await sequelize.query(`
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
      `);

      const [[tpCntRow]] = await sequelize.query(`SELECT COUNT(*) AS cnt FROM simulators WHERE station_kind = 'TEST_PLACE';`);
      if (Number(tpCntRow?.cnt || 0) === 0) {
        const tpValues = [];
        for (let i = 1; i <= 10; i++) {
          const pad = String(i).padStart(2, '0');
          const status = i === 8 ? 'DEGRADED' : 'READY';
          const mel = i === 8 ? `'Throttle quadrant potentiometer intermittent — monitor on pre-flight'` : 'NULL';
          tpValues.push(
            `('TP-${pad}', 'TEST PLACE ${i}', 'TP-${pad}', 'TEST_PLACE', ${i}, 'FTD_FNPT', 'Multi-Role Sim Test Place', 'CAE', 'EASA', 'FSTD / TPS', 16.0, 'Digital Flight Deck Sim Rack', 'TPS Load v5.2', 'AIRAC 2611', 'Collimated Multi-Ch LED', 'Fixed-Base TPS', 'Control Loading Bench', 'Dual-Screen IOS v8', '${status}', 3200.0, 0.0, 950.0, ${mel}, 'Operational Test Place workstation ${i}.')`
          );
        }
        await sequelize.query(`
          INSERT IGNORE INTO simulators
            (code, name, bay_code, station_kind, sort_order, platform_category, aircraft_type, manufacturer, authority, qualification_level, daily_available_hours, engine_avionics, software_load, airac_cycle, visual_system, motion_system, control_loading, ios_config, status, power_on_hours, motion_hours, visual_lamp_hours, limitations_mel, notes)
          VALUES ${tpValues.join(',\n')};
        `);
      }

      const [[iosCntRow]] = await sequelize.query(`SELECT COUNT(*) AS cnt FROM simulators WHERE station_kind = 'IOS_CONSOLE';`);
      if (Number(iosCntRow?.cnt || 0) === 0) {
        const iosValues = [];
        for (let i = 1; i <= 8; i++) {
          const pad = String(i).padStart(2, '0');
          iosValues.push(
            `('IOS-${pad}', 'IOS CONSOLE ${i}', 'IOS-${pad}', 'IOS_CONSOLE', ${i}, 'FTD_FNPT', 'Instructor Operating Console', 'CAE', 'EASA', 'IOS Station', 16.0, 'CAE Rise Host Telemetry', 'IOS v8.4', 'AIRAC 2611', 'Dual 27-inch Touch Displays', 'Fixed Console', 'Instructor Desks', 'Primary IOS Console #${i}', 'READY', 2800.0, 0.0, 0.0, NULL, 'Instructor Operating Station Console #${i}.')`
          );
        }
        await sequelize.query(`
          INSERT IGNORE INTO simulators
            (code, name, bay_code, station_kind, sort_order, platform_category, aircraft_type, manufacturer, authority, qualification_level, daily_available_hours, engine_avionics, software_load, airac_cycle, visual_system, motion_system, control_loading, ios_config, status, power_on_hours, motion_hours, visual_lamp_hours, limitations_mel, notes)
          VALUES ${iosValues.join(',\n')};
        `);
      }

      // Seed authentic preventive + corrective maintenance history on TP-01 / TP-04 / TP-08 for rapid MNT RECORDS view
      const [tps] = await sequelize.query(`SELECT id, code FROM simulators WHERE station_kind = 'TEST_PLACE' ORDER BY sort_order ASC;`);
      const [[adminRow]] = await sequelize.query(`SELECT id FROM users ORDER BY id ASC LIMIT 1;`);
      const adminId = adminRow?.id || 1;
      if (tps.length >= 4 && tableNames.includes('maintenance_records')) {
        const tpIds = tps.map(t => t.id);
        const [[existingTpMaint]] = await sequelize.query(`SELECT COUNT(*) AS cnt FROM maintenance_records WHERE simulator_id IN (${tpIds.join(',')});`);
        if (Number(existingTpMaint?.cnt || 0) === 0) {
          const tp4 = tps.find(t => t.code === 'TP-04')?.id || tps[3].id;
          const tp8 = tps.find(t => t.code === 'TP-08')?.id || tps[Math.min(7, tps.length - 1)].id;
          const tp1 = tps[0].id;
          await sequelize.query(`
            INSERT INTO maintenance_records
              (asset_id, simulator_id, subsystem_code, severity, lost_training_hours, is_snag, performed_by, type, title, description, status, priority, scheduled_date, completed_date, downtime_hours, findings)
            VALUES
              (NULL, ${tp4}, 'CONTROL_LOADING', 'MINOR', 0.0, 0, ${adminId}, 'PREVENTIVE', 'Lubrication of rudder pedals & trim linkages', 'Scheduled mechanical preventive lubrication and friction check.', 'COMPLETED', 'LOW', '2026-02-12 08:00:00', '2026-02-12 09:00:00', 1.0, 'All linkage travel nominal.'),
              (NULL, ${tp4}, 'SOUND', 'MINOR', 0.0, 0, ${adminId}, 'PREVENTIVE', 'New headphone ear cushions & PTT cable test', 'Replaced pilot/instructor headset ear cushions and tested boom mic PTT.', 'COMPLETED', 'LOW', '2026-05-19 13:00:00', '2026-05-19 13:30:00', 0.5, 'Headsets restored to nominal acoustic clarity.'),
              (NULL, ${tp4}, 'HVAC_POWER', 'AOG', 2.5, 1, ${adminId}, 'CORRECTIVE', 'Not starting - New power supply unit installed', 'Station failed cold power-on self-test at 06:30; 28V PSU rail fault.', 'COMPLETED', 'CRITICAL', '2026-09-08 06:35:00', '2026-09-08 09:05:00', 2.5, 'Replaced faulty 28V PSU from LRU stock; burn-in passed.'),
              (NULL, ${tp8}, 'VISUAL', 'DEGRADED', 1.5, 1, ${adminId}, 'CORRECTIVE', 'SMT test froze during cold start, GPU channel reset', 'Display channel #2 froze during TPS pre-flight verification.', 'IN_PROGRESS', 'HIGH', '2026-11-23 07:10:00', NULL, 1.5, 'Escalated to electronics bench for GPU thermal paste & fan check.'),
              (NULL, ${tp1}, 'IOS', 'MINOR', 0.0, 0, ${adminId}, 'PREVENTIVE', 'Touchscreen calibration & AIRAC 2611 verification', 'Quarterly calibration of IOS touch displays and NavDB load.', 'COMPLETED', 'LOW', '2026-10-03 18:15:00', '2026-10-03 19:00:00', 0.75, 'Calibration delta < 1px.');
          `);
        }
      }

      // Seed today's default daily log + SHIFT 1 for TEST_PLACE so screen opens live immediately
      const todayIso = new Date().toISOString().slice(0, 10);
      await sequelize.query(`
        INSERT IGNORE INTO simulator_daily_logs (log_date, station_kind, system_readiness_time, post_testing_time, logout_time, updated_by)
        VALUES ('${todayIso}', 'TEST_PLACE', '06:30', '17:00', '18:00', ${adminId});
      `);
      const [[dailyLog]] = await sequelize.query(`SELECT id FROM simulator_daily_logs WHERE log_date='${todayIso}' AND station_kind='TEST_PLACE' LIMIT 1;`);
      if (dailyLog && tps.length > 0) {
        await sequelize.query(`
          INSERT IGNORE INTO simulator_daily_shifts (daily_log_id, shift_number, shift_name, pre_flight_test_time, lead_user_id)
          VALUES (${dailyLog.id}, 1, 'SHIFT 1', '06:40', ${adminId});
        `);
        const [[shift1]] = await sequelize.query(`SELECT id FROM simulator_daily_shifts WHERE daily_log_id=${dailyLog.id} AND shift_number=1 LIMIT 1;`);
        if (shift1) {
          for (const tp of tps) {
            const isNa = tp.code === 'TP-08';
            const isActive = ['TP-01', 'TP-02', 'TP-03', 'TP-04', 'TP-05', 'TP-06'].includes(tp.code);
            const st = isNa ? 'NA' : (isActive ? 'IN_USE' : 'READY');
            const sTime = isActive ? '07:00' : '00:00';
            const eTime = isActive ? '12:30' : '00:00';
            const note = isNa
              ? `'NOT STARTING, TO BE TROUBLESHOOTED'`
              : (tp.code === 'TP-04' ? `'SMT TEST FROZE DURING PRE-FLIGHT, RESTARTED OK'` : 'NULL');
            await sequelize.query(`
              INSERT IGNORE INTO simulator_shift_entries (shift_id, simulator_id, usage_status, sim_testing_start, sim_testing_end, notes, updated_by)
              VALUES (${shift1.id}, ${tp.id}, '${st}', '${sTime}', '${eTime}', ${note}, ${adminId});
            `);
          }
        }
      }
    }
  }
];

async function ensureMigrationTable() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

async function getAppliedMigrations() {
  const [rows] = await sequelize.query(`SELECT name FROM schema_migrations;`);
  return new Set(rows.map(r => r.name));
}

async function runMigrations() {
  await ensureMigrationTable();
  const applied = await getAppliedMigrations();
  const queryInterface = sequelize.getQueryInterface();

  let executedCount = 0;
  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.name)) {
      logger.info(`Applying migration: ${migration.name} - ${migration.description}`);
      try {
        await migration.up(queryInterface, Sequelize);
        await sequelize.query(
          `INSERT INTO schema_migrations (name) VALUES (?);`,
          { replacements: [migration.name] }
        );
        logger.info(`✅ Applied migration: ${migration.name}`);
        executedCount++;
      } catch (err) {
        logger.error(`❌ Migration failed: ${migration.name}`, err);
        throw err;
      }
    }
  }

  if (executedCount === 0) {
    logger.info('Database schema is already up to date (no pending migrations).');
  } else {
    logger.info(`Successfully applied ${executedCount} migration(s).`);
  }

  return { success: true, executedCount };
}

// Standalone CLI execution
if (require.main === module) {
  (async () => {
    try {
      await sequelize.authenticate();
      logger.info('Database connection established for migrations.');
      await runMigrations();
      logger.info('Migration process finished.');
      process.exit(0);
    } catch (err) {
      logger.error('Migration process failed:', err);
      process.exit(1);
    }
  })();
}

module.exports = {
  runMigrations,
  MIGRATIONS
};
