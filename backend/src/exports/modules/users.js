// =============================================================================
// exports/modules/users.js — Users directory report (admin)
// =============================================================================
const { User, Role } = require('../../models');
const { fmtDateTime, dash } = require('../core/helpers');

module.exports = {
  key: 'users',
  title: 'Users Directory Report',
  subtitle: 'System accounts, roles and activity',
  orientation: 'landscape',
  roles: ['admin'],

  async build(req) {
    const { role, is_active } = req.query;
    const where = {};
    if (is_active === 'true') where.is_active = true;
    if (is_active === 'false') where.is_active = false;

    const users = await User.findAll({
      where,
      include: [{ model: Role, as: 'role', attributes: ['name'] }],
      attributes: { exclude: ['password_hash'] },
      order: [['last_name', 'ASC']]
    });

    const filtered = role ? users.filter((u) => u.role?.name === role) : users;
    const active = filtered.filter((u) => u.is_active).length;

    return {
      filters: [
        { label: 'Role', value: role || 'All' },
        { label: 'Active filter', value: is_active || 'All' },
        { label: 'Total users', value: filtered.length }
      ],
      tables: [{
        name: 'Users',
        summary: [
          { label: 'Total users', value: filtered.length },
          { label: 'Active', value: active },
          { label: 'Inactive', value: filtered.length - active }
        ],
        columns: [
          { header: '#', key: 'id', width: 7, align: 'right' },
          { header: 'Username', key: 'username', width: 16 },
          { header: 'Full name', key: 'name', width: 22 },
          { header: 'Email', key: 'email', width: 26 },
          { header: 'Role', key: 'role', width: 14 },
          { header: 'Department', key: 'department', width: 18 },
          { header: 'Job title', key: 'job', width: 20 },
          { header: 'Phone', key: 'phone', width: 16 },
          { header: 'Active', key: 'active', width: 9, align: 'center' },
          { header: 'Last login', key: 'lastLogin', width: 17 }
        ],
        rows: filtered.map((u) => ({
          id: u.id,
          username: u.username,
          name: `${u.first_name} ${u.last_name}`.trim(),
          email: u.email,
          role: u.role?.name || '—',
          department: dash(u.department),
          job: dash(u.job_title),
          phone: dash(u.phone),
          active: u.is_active ? 'Yes' : 'No',
          lastLogin: fmtDateTime(u.last_login),
          _flag: u.is_active ? undefined : 'muted'
        }))
      }]
    };
  }
};
