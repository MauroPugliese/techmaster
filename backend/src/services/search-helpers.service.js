'use strict';

const MAX_QUERY_LENGTH = 100;
const MIN_QUERY_LENGTH = 2;

function normalizeSearchQuery(rawQuery) {
  if (typeof rawQuery !== 'string') return '';
  return rawQuery.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH);
}

function escapeLikePattern(term) {
  return String(term || '').replace(/[\\%_]/g, '\\$&');
}

function clampCount(value) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function normalizeNavBadges(rawCounts = {}) {
  const src = rawCounts && typeof rawCounts === 'object' ? rawCounts : {};
  return {
    simulators: clampCount(src.simulators),
    operations: clampCount(src.operations),
    maintenance: clampCount(src.maintenance),
    warehouse: clampCount(src.warehouse),
    tasks: clampCount(src.tasks),
    notifications: clampCount(src.notifications)
  };
}

function statusToTone(status) {
  const key = String(status || '').toUpperCase();
  if (['COMPLETED', 'DONE', 'PUBLISHED', 'ACTIVE', 'READY', 'IN STOCK'].includes(key)) return 'success';
  if (['IN_PROGRESS', 'IN_SORTIE', 'PRE_FLIGHT', 'SCHEDULED', 'PLANNED', 'REVIEW'].includes(key)) return 'info';
  if (['ON_HOLD', 'DEFERRED', 'UNDER_MAINTENANCE', 'MAINTENANCE', 'DEGRADED', 'LOW STOCK', 'DRAFT'].includes(key)) return 'warning';
  if (['FAILED', 'OVERDUE', 'OUT OF STOCK', 'CANCELLED', 'LOST', 'RETIRED', 'AOG'].includes(key)) return 'danger';
  return 'neutral';
}

function joinSubtitle(parts) {
  return parts
    .map((p) => (p === null || p === undefined ? '' : String(p).trim()))
    .filter(Boolean)
    .join(' · ');
}

function buildSearchGroups(payload = {}) {
  const src = payload && typeof payload === 'object' ? payload : {};

  const groups = [
    {
      key: 'simulators',
      label: 'Flight Simulators',
      sectionKey: 'simulators',
      items: (src.simulators || []).map((sim) => ({
        id: sim.id,
        kind: 'simulator',
        title: `${sim.bay_code || ''} · ${sim.code || sim.name}`.replace(/^\s*·\s*/, ''),
        subtitle: joinSubtitle([sim.aircraft_type, sim.qualification_level]),
        badge: sim.status || 'READY',
        badgeTone: statusToTone(sim.status),
        route: '/simulators',
        queryParams: { id: sim.id }
      }))
    },
    {
      key: 'operations',
      label: 'Sorties & Dispatch',
      sectionKey: 'operations',
      items: (src.operations || []).map((op) => ({
        id: op.id,
        kind: 'operation',
        title: op.sortie_code ? `${op.sortie_code} · ${op.title}` : (op.title || `Sortie #${op.id}`),
        subtitle: joinSubtitle([op.customer_operator, op.location, op.priority]),
        badge: op.status || 'PLANNED',
        badgeTone: statusToTone(op.status),
        route: '/operations',
        queryParams: { search: op.sortie_code || op.title || String(op.id) }
      }))
    },
    {
      key: 'maintenance',
      label: 'Maintenance',
      sectionKey: 'maintenance',
      items: (src.maintenance || []).map((rec) => ({
        id: rec.id,
        kind: 'maintenance',
        title: rec.title || `Work Order #${rec.id}`,
        subtitle: joinSubtitle([rec.asset?.name, rec.type, rec.priority]),
        badge: rec.status || 'SCHEDULED',
        badgeTone: statusToTone(rec.status),
        route: '/maintenance',
        queryParams: { tab: 'work-orders', search: rec.title || String(rec.id) }
      }))
    },
    {
      key: 'assets',
      label: 'Assets',
      sectionKey: 'maintenance',
      items: (src.assets || []).map((asset) => ({
        id: asset.id,
        kind: 'asset',
        title: asset.name || `Asset #${asset.id}`,
        subtitle: joinSubtitle([asset.serial_number, asset.location]),
        badge: asset.status || 'ACTIVE',
        badgeTone: statusToTone(asset.status),
        route: '/maintenance',
        queryParams: { tab: 'assets', search: asset.serial_number || asset.name || String(asset.id) }
      }))
    },
    {
      key: 'inventory',
      label: 'Warehouse',
      sectionKey: 'warehouse',
      items: (src.inventory || []).map((item) => {
        const qty = Number(item.quantity) || 0;
        const reorderPoint = Math.max(0, Number(item.reorder_point) || 0);
        const stockLabel = qty <= 0 ? 'OUT OF STOCK' : qty <= reorderPoint ? 'LOW STOCK' : 'IN STOCK';
        return {
          id: item.id,
          kind: 'inventory',
          title: item.name || item.sku || `SKU #${item.id}`,
          subtitle: joinSubtitle([item.sku, `${qty} ${item.unit || 'pcs'}`]),
          badge: stockLabel,
          badgeTone: statusToTone(stockLabel),
          route: '/warehouse',
          queryParams: { tab: 'inventory', search: item.sku || item.name || String(item.id) }
        };
      })
    },
    {
      key: 'tasks',
      label: 'Tasks',
      sectionKey: 'tasks',
      items: (src.tasks || []).map((task) => ({
        id: task.id,
        kind: 'task',
        title: task.title || `Task #${task.id}`,
        subtitle: joinSubtitle([task.priority, task.interval_type]),
        badge: task.status || 'TODO',
        badgeTone: statusToTone(task.status),
        route: '/tasks',
        queryParams: { id: task.id }
      }))
    },
    {
      key: 'wiki',
      label: 'Knowledge Base',
      sectionKey: 'wiki',
      items: (src.wiki || []).map((article) => ({
        id: article.id,
        kind: 'wiki',
        title: article.title || `Article #${article.id}`,
        subtitle: joinSubtitle([article.excerpt]),
        badge: article.status || 'PUBLISHED',
        badgeTone: statusToTone(article.status),
        route: '/wiki',
        queryParams: { article: article.slug || String(article.id) }
      }))
    }
  ];

  return groups.filter((g) => g.items.length > 0);
}

module.exports = {
  MAX_QUERY_LENGTH,
  MIN_QUERY_LENGTH,
  normalizeSearchQuery,
  escapeLikePattern,
  clampCount,
  normalizeNavBadges,
  statusToTone,
  buildSearchGroups
};
