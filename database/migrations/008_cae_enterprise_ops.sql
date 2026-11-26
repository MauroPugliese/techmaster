-- =============================================================================
-- Migration 008: CAE Enterprise Operations (LRU/RMA Spares, MEL/SOP, Shift Sign-Off, Parts Delta)
-- Applied idempotently by backend/src/config/migrate.js
-- =============================================================================

ALTER TABLE simulator_daily_shifts
  ADD COLUMN IF NOT EXISTS signed_off_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS signed_off_by INT UNSIGNED NULL;

ALTER TABLE maintenance_records
  ADD COLUMN IF NOT EXISTS parts_cost DECIMAL(10,2) NULL,
  ADD COLUMN IF NOT EXISTS labor_cost DECIMAL(10,2) NULL,
  ADD COLUMN IF NOT EXISTS stock_deducted_snapshot JSON NULL,
  ADD COLUMN IF NOT EXISTS mel_category ENUM('NONE','CAT_A','CAT_B','CAT_C','CAT_D') NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS mel_expiry_date DATE NULL,
  ADD COLUMN IF NOT EXISTS wiki_article_id INT UNSIGNED NULL;

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS subsystem_code VARCHAR(60) NULL,
  ADD COLUMN IF NOT EXISTS serial_number VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS lru_status ENUM('SERVICEABLE','INSTALLED','UNSERVICEABLE','IN_REPAIR_RMA','QUARANTINE') NOT NULL DEFAULT 'SERVICEABLE',
  ADD COLUMN IF NOT EXISTS installed_simulator_id INT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS rma_reference VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS on_order_qty INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_delivery_date DATE NULL;

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS simulator_id INT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS maintenance_record_id INT UNSIGNED NULL;

INSERT IGNORE INTO schema_migrations (name) VALUES ('008_cae_enterprise_ops');
