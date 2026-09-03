-- Add optional part number field to inventory items
ALTER TABLE inventory_items
  ADD COLUMN part_number VARCHAR(120) NULL AFTER sku;
