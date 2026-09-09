CREATE TABLE IF NOT EXISTS ui_section_access_preferences (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  section_key VARCHAR(60) NOT NULL,
  subject_type ENUM('global', 'role', 'user') NOT NULL DEFAULT 'global',
  subject_key VARCHAR(120) NOT NULL,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_section_subject_pref (section_key, subject_type, subject_key)
) ENGINE=InnoDB;
