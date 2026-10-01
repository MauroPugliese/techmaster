-- =============================================================================
-- Migration: Add optional part number field to inventory items safely
-- =============================================================================

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'inventory_items'
    AND column_name = 'part_number'
);

SET @sql_stmt = IF(
  @col_exists = 0,
  'ALTER TABLE inventory_items ADD COLUMN part_number VARCHAR(120) NULL AFTER sku',
  'SELECT "Column part_number already exists in inventory_items" AS message'
);

PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
