const { sequelize } = require('../models');

let sectionAccessTableInitPromise = null;

async function ensureSectionAccessPrefsTable() {
  if (!sectionAccessTableInitPromise) {
    sectionAccessTableInitPromise = sequelize.query(`
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
    `).catch((err) => {
      sectionAccessTableInitPromise = null;
      throw err;
    });
  }

  await sectionAccessTableInitPromise;
}

function isHiddenValue(value) {
  return value === false || value === 0 || value === '0';
}

async function isSectionHiddenForUser(user, sectionKey) {
  await ensureSectionAccessPrefsTable();

  const roleName = String(user?.role?.name || '').trim().toLowerCase();
  const userId = user?.id ? String(user.id) : '';

  const [rows] = await sequelize.query(
    `SELECT subject_type, subject_key, is_visible
     FROM ui_section_access_preferences
     WHERE section_key = ?
       AND (
         (subject_type = 'global' AND subject_key = 'ALL')
         OR (subject_type = 'role' AND subject_key = ?)
         OR (subject_type = 'user' AND subject_key = ?)
       )`,
    {
      replacements: [sectionKey, roleName, userId]
    }
  );

  const globalPref = rows.find(row => row.subject_type === 'global' && row.subject_key === 'ALL');
  const rolePref = rows.find(row => row.subject_type === 'role' && row.subject_key === roleName);
  const userPref = rows.find(row => row.subject_type === 'user' && row.subject_key === userId);
  const effectivePref = userPref || rolePref || globalPref || null;

  return Boolean(effectivePref && isHiddenValue(effectivePref.is_visible));
}

async function getHiddenSectionKeysForUser(user) {
  await ensureSectionAccessPrefsTable();

  const roleName = String(user?.role?.name || '').trim().toLowerCase();
  const userId = user?.id ? String(user.id) : '';

  const [rows] = await sequelize.query(
    `SELECT section_key, subject_type, subject_key, is_visible
     FROM ui_section_access_preferences
     WHERE (subject_type = 'global' AND subject_key = 'ALL')
        OR (subject_type = 'role' AND subject_key = ?)
        OR (subject_type = 'user' AND subject_key = ?)`,
    { replacements: [roleName, userId] }
  );

  const bySection = new Map();
  for (const r of rows) {
    const entry = bySection.get(r.section_key) || {};
    if (r.subject_type === 'global') entry.global = r.is_visible;
    else if (r.subject_type === 'role') entry.role = r.is_visible;
    else if (r.subject_type === 'user') entry.user = r.is_visible;
    bySection.set(r.section_key, entry);
  }

  const hidden = new Set();
  for (const [key, prefs] of bySection.entries()) {
    const effective = prefs.user !== undefined ? prefs.user : (prefs.role !== undefined ? prefs.role : prefs.global);
    if (isHiddenValue(effective)) hidden.add(key);
  }
  return hidden;
}

function requireSectionAccess(sectionKey) {
  return async (req, res, next) => {
    try {
      const hidden = await isSectionHiddenForUser(req.user, sectionKey);
      if (hidden) {
        return res.status(403).json({
          success: false,
          message: 'This section is hidden for the current user.'
        });
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = {
  requireSectionAccess,
  isSectionHiddenForUser,
  getHiddenSectionKeysForUser
};