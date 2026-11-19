// =============================================================================
// exports/modules/audit.js — Security & Forensic Audit Trail (CAE-SEC-12)
// Blueprint:
//   P1 Cover -> P2 Security Integrity & Threat Telemetry (Alerts + Compact KPIs + ChartPair)
//   -> P3 Operator Activity & Anomaly Hotspots (Brief + Actor Hotspots Table)
//   -> P4+ Forensic Chronological Audit Trail (Curated 6-Col A4 Portrait Ledger)
// =============================================================================
const { Op } = require('sequelize');
const { AuditLog, User } = require('../../models');
const {
  fmtDateTime, fmtNumber, fmtPercent, fullName, dash,
  parseRange, rangeLabel, cleanText, toNumber, pct, topEntries
} = require('../core/helpers');
const { COLORS } = require('../core/branding');

const METHOD_TONE = {
  GET:    'info',
  POST:   'success',
  PUT:    'warning',
  PATCH:  'warning',
  DELETE: 'danger'
};

function httpTone(code) {
  if (code >= 500) return 'danger';
  if (code >= 400) return 'warning';
  if (code >= 200 && code < 400) return 'success';
  return 'neutral';
}

function buildSecurityAlerts(err5xx, warn4xx, authFailures, total) {
  const alerts = [];
  if (err5xx > 0) {
    alerts.push({
      severity: 'danger',
      title: `${fmtNumber(err5xx)} HTTP 5xx Server Fault${err5xx > 1 ? 's' : ''} Recorded`,
      detail: 'Internal server errors indicate unhandled exceptions or service degradation requiring log traceback inspection.'
    });
  }
  if (authFailures > 0) {
    alerts.push({
      severity: authFailures >= 10 ? 'danger' : 'warning',
      title: `${fmtNumber(authFailures)} Authentication / Authorization Rejection${authFailures > 1 ? 's' : ''} (401/403)`,
      detail: 'Repeated access denials may reflect stale session tokens, misconfigured roles, or unauthorized probing.'
    });
  } else if (warn4xx > 0) {
    alerts.push({
      severity: 'warning',
      title: `${fmtNumber(warn4xx)} HTTP 4xx Client Validation Error${warn4xx > 1 ? 's' : ''}`,
      detail: `Rejected client requests account for ${fmtPercent(pct(warn4xx, total), 1)} of audited events.`
    });
  }
  if (!alerts.length) {
    alerts.push({
      severity: 'success',
      title: 'Zero Security Faults or Rejected Requests Detected',
      detail: `All ${fmtNumber(total)} audited API actions returned successful HTTP 2xx/3xx status codes.`
    });
  }
  return alerts;
}

module.exports = {
  key: 'audit',
  docCode: 'CAE-SEC-12',
  theme: 'audit',
  title: 'Security & Forensic Audit Trail Report',
  subtitle: 'API event integrity, HTTP rejection telemetry, operator activity and forensic log',
  category: 'SECURITY & COMPLIANCE AUDIT',
  orientation: 'portrait',

  async build(req) {
    const range = parseRange(req.query);
    const { action, method, user_id } = req.query;

    const where = {};
    if (range.from || range.to) {
      where.created_at = {};
      if (range.from) where.created_at[Op.gte] = range.from;
      if (range.to) where.created_at[Op.lte] = range.to;
    }
    if (action) where.action = { [Op.like]: `%${String(action).trim()}%` };
    if (method) where.method = String(method).toUpperCase();
    if (user_id) where.user_id = user_id;

    const logs = await AuditLog.findAll({
      where,
      include: [{ model: User, as: 'user', attributes: ['first_name', 'last_name', 'username'] }],
      order: [['created_at', 'DESC']],
      limit: 300
    });

    let okCount = 0;
    let warn4xx = 0;
    let err5xx = 0;
    let authFailures = 0;
    const byAction = {};
    const byMethod = {};
    const uniqueIps = new Set();
    const actorStats = {};

    const ledgerRows = logs.map((l) => {
      const code = toNumber(l.status, 200);
      if (code >= 500) err5xx += 1;
      else if (code >= 400) warn4xx += 1;
      else okCount += 1;
      if (code === 401 || code === 403) authFailures += 1;

      const actName = l.action || 'UNKNOWN';
      const meth = String(l.method || 'GET').toUpperCase();
      byAction[actName] = (byAction[actName] || 0) + 1;
      byMethod[meth] = (byMethod[meth] || 0) + 1;

      const ipAddr = dash(l.ip);
      if (ipAddr !== '—') uniqueIps.add(ipAddr);

      const actorName = l.username || (l.user ? l.user.username : 'anonymous');
      if (!actorStats[actorName]) {
        actorStats[actorName] = { actor: actorName, count: 0, failures: 0, lastIp: ipAddr };
      }
      actorStats[actorName].count += 1;
      if (code >= 400) actorStats[actorName].failures += 1;

      return {
        timestamp: fmtDateTime(l.created_at),
        actor: actorName,
        full_name: l.user ? fullName(l.user) : 'System / Anonymous',
        user_id: l.user_id || '—',
        method: meth,
        method_tone: METHOD_TONE[meth] || 'neutral',
        action: cleanText(actName, 36),
        status: String(code),
        status_tone: httpTone(code),
        ip: ipAddr,
        path: cleanText(l.path, 52),
        _flag: code >= 500 ? 'danger' : (code >= 400 ? 'warning' : null)
      };
    });

    const total = logs.length;
    const successRate = total ? pct(okCount, total) : 100;
    const topActions = topEntries(byAction, 7);

    const actorRows = Object.values(actorStats)
      .sort((a, b) => (b.failures - a.failures) || (b.count - a.count))
      .map((a) => ({
        actor: a.actor,
        count: a.count,
        failures: a.failures,
        last_ip: a.lastIp,
        share_pct: pct(a.count, total),
        _flag: a.failures > 0 ? 'warning' : null
      }));

    const topActor = [...actorRows].sort((a, b) => b.count - a.count)[0] || null;
    const dominantMethod = topEntries(byMethod, 1)[0];

    const hotspotsTable = {
      name: 'Operator Activity & Anomaly Hotspots',
      note: 'Actors ranked by rejected events (4xx/5xx) and request volume, with originating IP telemetry.',
      columns: [
        { header: 'Operator / Username', key: 'actor', width: 130, type: 'mono' },
        { header: 'Events', key: 'count', width: 65, type: 'number', align: 'right', total: 'sum' },
        { header: '4xx / 5xx Faults', key: 'failures', width: 85, type: 'number', align: 'right', total: 'sum' },
        { header: 'Latest IP', key: 'last_ip', width: 105, type: 'mono' },
        { header: 'Share %', key: 'share_pct', width: 85, type: 'percent', decimals: 1, align: 'right', dataBar: true }
      ],
      rows: actorRows
    };

    const ledgerTable = {
      name: 'Forensic Chronological Audit Trail',
      priority: true,
      note: 'Latest 300 audited API events in descending chronological order. Endpoint path and full user metadata in Excel.',
      columns: [
        { header: 'Timestamp', key: 'timestamp', width: 88, type: 'date' },
        { header: 'Operator', key: 'actor', width: 78, type: 'mono' },
        { header: 'Method', key: 'method', width: 54, type: 'badge', align: 'center' },
        { header: 'Audited Action', key: 'action', width: 132 },
        { header: 'HTTP', key: 'status', width: 50, type: 'badge', align: 'center' },
        { header: 'Client IP', key: 'ip', width: 82, type: 'mono' },
        { header: 'Endpoint Path', key: 'path', width: 145, type: 'mono', printHidden: true },
        { header: 'Full Name', key: 'full_name', width: 110, printHidden: true },
        { header: 'User ID', key: 'user_id', width: 55, printHidden: true }
      ],
      rows: ledgerRows
    };

    const filters = { 'Audit Window': rangeLabel(range) };
    if (action) filters['Action Filter'] = action;
    if (method) filters['HTTP Method'] = String(method).toUpperCase();
    if (user_id) filters['User ID'] = user_id;

    const pages = [
      {
        title: 'Security Integrity & Threat Telemetry',
        subtitle: `${fmtNumber(total)} audited events from ${fmtNumber(uniqueIps.size)} unique IP source(s)`,
        blocks: [
          { type: 'alerts', title: 'Security & HTTP Integrity Alerts', items: buildSecurityAlerts(err5xx, warn4xx, authFailures, total) },
          {
            type: 'kpis',
            variant: 'compact-row',
            items: [
              { label: 'Audited Events', value: fmtNumber(total), rawValue: total, sublabel: `${fmtNumber(uniqueIps.size)} unique IPs`, tone: 'primary' },
              { label: 'HTTP Success Rate', value: fmtPercent(successRate, 1), rawValue: successRate, numFmt: '0.0"%"', sublabel: `${fmtNumber(okCount)} OK responses`, tone: successRate >= 98 ? 'success' : 'warning' },
              { label: '4xx Rejections', value: fmtNumber(warn4xx), rawValue: warn4xx, sublabel: `${fmtNumber(authFailures)} auth denials`, tone: warn4xx > 0 ? 'warning' : 'success' },
              { label: '5xx Server Faults', value: fmtNumber(err5xx), rawValue: err5xx, sublabel: 'Critical exceptions', tone: err5xx > 0 ? 'danger' : 'success' }
            ]
          },
          {
            type: 'chartPair',
            height: 204,
            left: {
              type: 'donut',
              title: 'HTTP Response Integrity',
              subtitle: '2xx/3xx OK vs 4xx & 5xx faults',
              labels: ['2xx/3xx OK', '4xx Client/Auth', '5xx Server Fault'],
              values: [okCount, warn4xx, err5xx],
              colors: [COLORS.successAccent, COLORS.amber, COLORS.coral]
            },
            right: {
              type: 'lollipop',
              title: 'Top Audited Event Types',
              subtitle: 'Most frequent platform actions',
              valueFormat: 'number',
              labels: topActions.map(([k]) => cleanText(k, 17)),
              values: topActions.map(([, v]) => v)
            }
          }
        ]
      },
      {
        title: 'Operator Activity & Anomaly Hotspots',
        subtitle: 'Actor-level event share, originating IPs and failure concentration',
        blocks: [
          {
            type: 'brief',
            title: 'Forensic Telemetry Summary',
            text: `Across ${fmtNumber(total)} inspected API operations, ${fmtNumber(actorRows.length)} distinct operators originated traffic from ${fmtNumber(uniqueIps.size)} source IP(s). `
              + `The dominant HTTP verb is ${dominantMethod ? `${dominantMethod[0]} (${fmtNumber(dominantMethod[1])} req)` : 'N/A'}, and the highest-volume actor is `
              + `${topActor ? `'${topActor.actor}' (${fmtNumber(topActor.count)} events, ${fmtNumber(topActor.failures)} faults)` : 'N/A'}.`
          },
          { type: 'table', showHeading: true, table: { ...hotspotsTable, rows: actorRows.slice(0, 16) } }
        ]
      },
      {
        title: 'Forensic Chronological Audit Trail',
        subtitle: `Latest ${fmtNumber(ledgerRows.length)} recorded API security events`,
        blocks: [{ type: 'table', showHeading: false, table: ledgerTable }]
      }
    ];

    return {
      moduleKey: 'audit',
      docCode: 'CAE-SEC-12',
      theme: 'audit',
      title: 'Security & Forensic Audit Trail Report',
      subtitle: 'API event integrity, HTTP rejection telemetry, operator activity and forensic log',
      category: 'SECURITY & COMPLIANCE AUDIT',
      orientation: 'portrait',
      coverHighlights: [
        { label: 'Audited Events', value: fmtNumber(total) },
        { label: 'HTTP Integrity', value: fmtPercent(successRate, 1) },
        { label: '4xx / 5xx Faults', value: fmtNumber(warn4xx + err5xx) }
      ],
      filters,
      pages,
      tables: [ledgerTable, hotspotsTable]
    };
  }
};
