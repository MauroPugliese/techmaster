-- =============================================================================
-- Migration 008: Enterprise Operations (LRU/RMA Spares, MEL/SOP, Shift Sign-Off, Parts Delta)
-- MySQL 8.0-compatible idempotent DDL (also applied by backend/src/config/migrate.js)
-- =============================================================================

DROP PROCEDURE IF EXISTS smart_add_col_if_missing_008;

DELIMITER $$
CREATE PROCEDURE smart_add_col_if_missing_008(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND COLUMN_NAME = p_column
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

CALL smart_add_col_if_missing_008('simulator_daily_shifts', 'signed_off_at', 'DATETIME NULL');
CALL smart_add_col_if_missing_008('simulator_daily_shifts', 'signed_off_by', 'INT UNSIGNED NULL');

CALL smart_add_col_if_missing_008('maintenance_records', 'parts_cost', 'DECIMAL(10,2) NULL');
CALL smart_add_col_if_missing_008('maintenance_records', 'labor_cost', 'DECIMAL(10,2) NULL');
CALL smart_add_col_if_missing_008('maintenance_records', 'stock_deducted_snapshot', 'JSON NULL');
CALL smart_add_col_if_missing_008('maintenance_records', 'mel_category', "ENUM('NONE','CAT_A','CAT_B','CAT_C','CAT_D') NOT NULL DEFAULT 'NONE'");
CALL smart_add_col_if_missing_008('maintenance_records', 'mel_expiry_date', 'DATE NULL');
CALL smart_add_col_if_missing_008('maintenance_records', 'wiki_article_id', 'INT UNSIGNED NULL');

CALL smart_add_col_if_missing_008('inventory_items', 'subsystem_code', 'VARCHAR(60) NULL');
CALL smart_add_col_if_missing_008('inventory_items', 'serial_number', 'VARCHAR(100) NULL');
CALL smart_add_col_if_missing_008('inventory_items', 'lru_status', "ENUM('SERVICEABLE','INSTALLED','UNSERVICEABLE','IN_REPAIR_RMA','QUARANTINE') NOT NULL DEFAULT 'SERVICEABLE'");
CALL smart_add_col_if_missing_008('inventory_items', 'installed_simulator_id', 'INT UNSIGNED NULL');
CALL smart_add_col_if_missing_008('inventory_items', 'rma_reference', 'VARCHAR(100) NULL');
CALL smart_add_col_if_missing_008('inventory_items', 'on_order_qty', 'INT NOT NULL DEFAULT 0');
CALL smart_add_col_if_missing_008('inventory_items', 'expected_delivery_date', 'DATE NULL');

CALL smart_add_col_if_missing_008('stock_movements', 'simulator_id', 'INT UNSIGNED NULL');
CALL smart_add_col_if_missing_008('stock_movements', 'maintenance_record_id', 'INT UNSIGNED NULL');

DROP PROCEDURE IF EXISTS smart_add_col_if_missing_008;

INSERT IGNORE INTO schema_migrations (name) VALUES ('008_cae_enterprise_ops');
