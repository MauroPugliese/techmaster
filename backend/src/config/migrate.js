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
