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
) ENGINE=InnoDB;