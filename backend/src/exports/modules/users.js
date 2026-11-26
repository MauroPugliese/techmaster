// =============================================================================
// exports/modules/users.js — Identity & RBAC Governance Review (CAE-IAM-11)
// Blueprint:
//   P1 Cover -> P2 RBAC Privilege & Hygiene Posture (Alerts + Role Donut + Role Summary Table)
//   -> P3 Organizational Footprint & Account Activity (Strip KPIs + Dept Lollipop + Highlights)
//   -> P4+ Authorized Accounts Directory (Curated 5-Col A4 Portrait Table)
// =============================================================================
const { User, Role } = require('../../models');
const {
  fmtDate, fmtDateTime, fmtNumber, fmtPercent, fullName, dash,
  cleanText, pct, topEntries
} = require('../core/helpers');
const { COLORS } = require('../core/branding');

const ROLE_COLORS = {
  ADMIN:      COLORS.navy,
  SUPERVISOR: COLORS.accent,
  OPERATOR:   COLORS.teal,
  TECH:       COLORS.cyan,
  TECHNICIAN: COLORS.cyan,
  VIEWER:     COLORS.muted
};

function buildIamAlerts(dormantCount, inactiveCount, privilegedCount, total) {
  const alerts = [];
  if (dormantCount > 0) {
    alerts.push({
      severity: 'warning',
      title: `${fmtNumber(dormantCount)} Provisioned Account${dormantCount > 1 ? 's' : ''} Have Never Authenticated`,
      detail: 'Stale accounts provisioned without an initial login represent unused credentials and should be verified or revoked.'
    });
  }
  const privShare = pct(privilegedCount, total);
  if (privilegedCount > 0 && privShare > 35) {
    alerts.push({
      severity: 'warning',
      title: `Elevated Privilege Density: ${fmtPercent(privShare, 1)} Hold ADMIN / SUPERVISOR Roles`,
      detail: `${fmtNumber(privilegedCount)} privileged accounts identified. Apply least-privilege RBAC review.`
    });
  }
  if (inactiveCount > 0) {
    alerts.push({
      severity: 'info',
      title: `${fmtNumber(inactiveCount)} Deactivated Account${inactiveCount > 1 ? 's' : ''} Retained for Audit Integrity`,
      detail: 'Inactive identities are blocked from login while preserving historical audit attribution.'
    });
  }
  if (!alerts.length) {
    alerts.push({
      severity: 'success',
      title: 'IAM Account Hygiene Verified — Healthy Least-Privilege Posture',
      detail: 'All registered personnel accounts are active, authenticated, and aligned with RBAC baselines.'
    });
  }
  return alerts;
}

module.exports = {
  key: 'users',
  roles: ['admin', 'manager'],
  docCode: 'CAE-IAM-11',
  theme: 'users',
  title: 'Users & Access Control Governance Report',
  subtitle: 'RBAC privilege posture, organizational footprint and account hygiene audit',
  category: 'IDENTITY & ACCESS GOVERNANCE',
  orientation: 'portrait',

  async build(req) {
    const { role, role_id, is_active, status, department, search } = req.query;

    const allUsers = await User.findAll({
      attributes: ['id', 'role_id', 'username', 'email', 'first_name', 'last_name', 'department', 'job_title', 'phone', 'is_active', 'last_login', 'created_at'],
      include: [{ model: Role, as: 'role', attributes: ['id', 'name', 'description'] }],
      order: [['last_name', 'ASC'], ['first_name', 'ASC']]
    });

    const roleFilter = role_id || role;
    const normStatus = status ? String(status).trim().toLowerCase() : '';
    const deptFilter = department ? String(department).trim().toLowerCase() : '';
    const searchQ = search ? String(search).trim().toLowerCase() : '';

    const filtered = allUsers.filter((u) => {
      if (roleFilter) {
        const rName = (u.role?.name || '').toUpperCase();
        const qRole = String(roleFilter).toUpperCase();
        if (rName !== qRole && String(u.role_id) !== String(roleFilter)) return false;
      }
      if (is_active === 'true' || is_active === '1' || normStatus === 'active') {
        if (!u.is_active) return false;
      }
      if (is_active === 'false' || is_active === '0' || normStatus === 'inactive') {
        if (u.is_active) return false;
      }
      if (deptFilter && String(u.department || '').trim().toLowerCase() !== deptFilter) {
        return false;
      }
      if (searchQ) {
        const hay = [
          u.first_name, u.last_name, u.username, u.email, u.department, u.job_title, u.role?.name
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(searchQ)) return false;
      }
      return true;
    });

    const byRole = {};
    const byDept = {};
    const roleAgg = {};
    let active = 0;
    let inactive = 0;
    let neverLoggedIn = 0;
    let privileged = 0;

    const userRows = filtered.map((u) => {
      const roleName = (u.role?.name || 'UNKNOWN').toUpperCase();
      const dept = u.department && String(u.department).trim() ? String(u.department).trim() : 'Unassigned';
      const isActive = Boolean(u.is_active);
      const isDormant = !u.last_login;
      const isPriv = roleName === 'ADMIN' || roleName === 'SUPERVISOR';

      byRole[roleName] = (byRole[roleName] || 0) + 1;
      byDept[dept] = (byDept[dept] || 0) + 1;
      if (!roleAgg[roleName]) roleAgg[roleName] = { role: roleName, total: 0, active: 0, dormant: 0 };
      roleAgg[roleName].total += 1;
      if (isActive) { active += 1; roleAgg[roleName].active += 1; } else { inactive += 1; }
      if (isDormant) { neverLoggedIn += 1; roleAgg[roleName].dormant += 1; }
      if (isPriv) privileged += 1;

      return {
        full_name: fullName(u),
        username: `@${u.username}`,
        email: dash(u.email),
        role: roleName,
        role_tone: roleName === 'ADMIN' ? 'danger' : (roleName === 'SUPERVISOR' ? 'warning' : 'info'),
        department: dept,
        job_title: dash(u.job_title),
        phone: dash(u.phone),
        status: isActive ? 'ACTIVE' : 'INACTIVE',
        status_tone: isActive ? 'success' : 'neutral',
        last_login: u.last_login ? fmtDateTime(u.last_login) : 'Never',
        created_at: fmtDate(u.created_at),
        _flag: !isActive ? 'neutral' : (isDormant ? 'warning' : null)
      };
    });

    const total = filtered.length;
    const activeRate = pct(active, total);
    const roleKeys = Object.keys(byRole).sort((a, b) => byRole[b] - byRole[a]);
    const deptTop = topEntries(byDept, 7);

    const roleSummaryRows = Object.values(roleAgg)
      .sort((a, b) => b.total - a.total)
      .map((r) => ({
        role: r.role,
        role_tone: r.role === 'ADMIN' ? 'danger' : (r.role === 'SUPERVISOR' ? 'warning' : 'info'),
        total: r.total,
        active: r.active,
        dormant: r.dormant,
        share_pct: pct(r.total, total),
        _flag: r.dormant > 0 ? 'warning' : null
      }));

    const roleTable = {
      name: 'RBAC Role Governance Matrix',
      note: 'User entitlement breakdown, active ratio and dormant login count per RBAC role.',
      columns: [
        { header: 'RBAC Role', key: 'role', width: 95, type: 'badge', align: 'center' },
        { header: 'Users', key: 'total', width: 65, type: 'number', align: 'right', total: 'sum' },
        { header: 'Active', key: 'active', width: 65, type: 'number', align: 'right', total: 'sum' },
        { header: 'Never Logged In', key: 'dormant', width: 85, type: 'number', align: 'right', total: 'sum' },
        { header: 'Org Share %', key: 'share_pct', width: 95, type: 'percent', decimals: 1, align: 'right', dataBar: true }
      ],
      rows: roleSummaryRows
    };

    const directoryTable = {
      name: 'Authorized Accounts Directory',
      priority: true,
      note: 'Curated identity register. Contact details, job titles and last-login timestamps preserved in Excel.',
      columns: [
        { header: 'Full Name', key: 'full_name', width: 120 },
        { header: 'Username', key: 'username', width: 88, type: 'mono' },
        { header: 'Role', key: 'role', width: 78, type: 'badge', align: 'center' },
        { header: 'Department', key: 'department', width: 105 },
        { header: 'Status', key: 'status', width: 68, type: 'badge', align: 'center' },
        { header: 'Email', key: 'email', width: 140, printHidden: true },
        { header: 'Job Title', key: 'job_title', width: 105, printHidden: true },
        { header: 'Phone', key: 'phone', width: 85, printHidden: true },
        { header: 'Last Login', key: 'last_login', width: 95, printHidden: true },
        { header: 'Provisioned', key: 'created_at', width: 70, printHidden: true }
      ],
      rows: userRows
    };

    const filters = { Scope: 'System User Directory' };
    if (roleFilter) filters['Role Filter'] = String(roleFilter).toUpperCase();
    if (department) filters.Department = department;
    if (search) filters.Search = search;
    if (is_active !== undefined && is_active !== '') {
      filters['Account Status'] = (is_active === 'true' || is_active === '1') ? 'Active Only' : 'Inactive Only';
    } else if (normStatus === 'active' || normStatus === 'inactive') {
      filters['Account Status'] = normStatus === 'active' ? 'Active Only' : 'Inactive Only';
    }

    const largestDept = deptTop[0];

    const pages = [
      {
        title: 'RBAC Privilege & Hygiene Posture',
        subtitle: `${fmtNumber(total)} registered identities · ${fmtNumber(privileged)} privileged entitlements`,
        blocks: [
          { type: 'alerts', title: 'Security & Entitlement Advisories', items: buildIamAlerts(neverLoggedIn, inactive, privileged, total) },
          {
            type: 'chart',
            height: 196,
            chart: {
              type: 'donut',
              title: 'Users by RBAC Role',
              subtitle: 'Privilege tier distribution across registered identities',
              labels: roleKeys,
              values: roleKeys.map((k) => byRole[k]),
              colors: roleKeys.map((k) => ROLE_COLORS[k] || COLORS.accent)
            }
          },
          { type: 'table', showHeading: true, table: roleTable }
        ]
      },
      {
        title: 'Organizational Footprint & Activity',
        subtitle: 'Department headcount distribution and lifecycle authentication metrics',
        blocks: [
          {
            type: 'kpis',
            variant: 'strips',
            items: [
              { label: 'Total Accounts', value: fmtNumber(total), rawValue: total, sublabel: `${deptTop.length} departments`, tone: 'primary' },
              { label: 'Active Status Rate', value: fmtPercent(activeRate, 1), rawValue: activeRate, numFmt: '0.0"%"', sublabel: `${fmtNumber(active)} active / ${fmtNumber(inactive)} disabled`, tone: 'success' },
              { label: 'Privileged Accounts', value: fmtNumber(privileged), rawValue: privileged, sublabel: 'ADMIN + SUPERVISOR tiers', tone: pct(privileged, total) > 35 ? 'warning' : 'info' },
              { label: 'Dormant (No Login)', value: fmtNumber(neverLoggedIn), rawValue: neverLoggedIn, sublabel: 'Zero recorded sign-ins', tone: neverLoggedIn > 0 ? 'warning' : 'success' }
            ]
          },
          {
            type: 'chart',
            height: 204,
            chart: {
              type: 'lollipop',
              title: 'Authorized Headcount by Department',
              subtitle: 'Account distribution per organizational unit',
              valueFormat: 'number',
              labels: deptTop.map(([k]) => cleanText(k, 18)),
              values: deptTop.map(([, v]) => v)
            }
          },
          {
            type: 'highlights',
            title: 'Identity Governance Key Findings',
            items: [
              {
                eyebrow: 'LARGEST UNIT',
                metric: largestDept ? `${fmtNumber(largestDept[1])} users` : '—',
                title: largestDept ? cleanText(largestDept[0], 30) : 'No Departments',
                detail: largestDept ? `${fmtPercent(pct(largestDept[1], total), 1)} of directory headcount.` : 'No department metadata populated.',
                tone: 'primary'
              },
              {
                eyebrow: 'PRIVILEGED POSTURE',
                metric: fmtPercent(pct(privileged, total), 1),
                title: `${fmtNumber(privileged)} Elevated Accounts`,
                detail: `${fmtNumber(total - privileged)} standard operator/technician identities.`,
                tone: 'info'
              }
            ]
          }
        ]
      },
      {
        title: 'Authorized Accounts Directory',
        subtitle: `User roster register (${fmtNumber(userRows.length)} accounts)`,
        blocks: [{ type: 'table', showHeading: false, table: directoryTable }]
      }
    ];

    return {
      moduleKey: 'users',
      docCode: 'CAE-IAM-11',
      theme: 'users',
      title: 'Users & Access Control Governance Report',
      subtitle: 'RBAC privilege posture, organizational footprint and account hygiene audit',
      category: 'IDENTITY & ACCESS GOVERNANCE',
      orientation: 'portrait',
      coverHighlights: [
        { label: 'Registered Accounts', value: fmtNumber(total) },
        { label: 'Active Status Rate', value: fmtPercent(activeRate, 1) },
        { label: 'Privileged Roles', value: fmtNumber(privileged) }
      ],
      filters,
      pages,
      tables: [directoryTable, roleTable]
    };
  }
};
