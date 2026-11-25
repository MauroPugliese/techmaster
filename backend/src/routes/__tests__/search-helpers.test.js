'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_QUERY_LENGTH,
  normalizeSearchQuery,
  escapeLikePattern,
  normalizeNavBadges,
  buildSearchGroups
} = require('../../services/search-helpers.service');

test('normalizeSearchQuery trims, collapses spaces, and caps length', () => {
  assert.equal(normalizeSearchQuery('   pump   valve \t 01  '), 'pump valve 01');
  assert.equal(normalizeSearchQuery(null), '');
  assert.equal(normalizeSearchQuery(123), '');
  const overlong = 'a'.repeat(MAX_QUERY_LENGTH + 25);
  assert.equal(normalizeSearchQuery(overlong).length, MAX_QUERY_LENGTH);
});

test('escapeLikePattern escapes LIKE wildcards safely', () => {
  assert.equal(escapeLikePattern('100%_test\\path'), '100\\%\\_test\\\\path');
  assert.equal(escapeLikePattern(''), '');
});

test('normalizeNavBadges clamps negatives and invalid values to 0 without mutating input', () => {
  const input = { simulators: '2', operations: 5.9, maintenance: -3, warehouse: '12', tasks: NaN, notifications: undefined };
  const snapshot = { ...input };
  const result = normalizeNavBadges(input);

  assert.deepEqual(input, snapshot);
  assert.deepEqual(result, {
    simulators: 2,
    operations: 5,
    maintenance: 0,
    warehouse: 12,
    tasks: 0,
    notifications: 0
  });
});

test('buildSearchGroups maps all six entity types and drops empty groups', () => {
  const groups = buildSearchGroups({
    operations: [{ id: 7, title: 'Subsea Survey', status: 'IN_PROGRESS', priority: 'HIGH', location: 'Deck A' }],
    maintenance: [],
    assets: [{ id: 12, name: 'ROV Hydra', serial_number: 'SN-44', location: 'Bay 2', status: 'ACTIVE' }],
    inventory: [
      { id: 3, name: 'O-Ring Kit', sku: 'OR-10', quantity: 2, reorder_point: 5, unit: 'pcs' },
      { id: 4, name: 'Bolt M8', sku: 'BL-08', quantity: 0, reorder_point: 4, unit: 'pcs' }
    ],
    tasks: [{ id: 9, title: 'Check winch oil', status: 'OVERDUE', priority: 'CRITICAL', interval_type: 'WEEKLY' }],
    wiki: [{ id: 2, title: 'SOP Dive Prep', slug: 'sop-dive-prep', excerpt: 'Checklist for ROV launch', status: 'PUBLISHED' }]
  });

  assert.equal(groups.length, 5);
  assert.equal(groups[0].key, 'operations');
  assert.equal(groups[0].items[0].route, '/operations');
  assert.deepEqual(groups[0].items[0].queryParams, { search: 'Subsea Survey' });

  const warehouseGroup = groups.find((g) => g.key === 'inventory');
  assert.equal(warehouseGroup.items[0].badge, 'LOW STOCK');
  assert.equal(warehouseGroup.items[0].badgeTone, 'warning');
  assert.equal(warehouseGroup.items[1].badge, 'OUT OF STOCK');
  assert.equal(warehouseGroup.items[1].badgeTone, 'danger');
  assert.deepEqual(warehouseGroup.items[0].queryParams, { tab: 'inventory', search: 'OR-10' });

  const tasksGroup = groups.find((g) => g.key === 'tasks');
  assert.deepEqual(tasksGroup.items[0].queryParams, { id: 9 });
  assert.equal(tasksGroup.items[0].badgeTone, 'danger');

  const wikiGroup = groups.find((g) => g.key === 'wiki');
  assert.deepEqual(wikiGroup.items[0].queryParams, { article: 'sop-dive-prep' });
  assert.equal(wikiGroup.items[0].badgeTone, 'success');
});

test('buildSearchGroups maps maintenance items to work-orders search tab', () => {
  const groups = buildSearchGroups({
    maintenance: [
      { id: 19, title: 'Thruster seal swap', status: 'SCHEDULED', priority: 'HIGH', type: 'PREVENTIVE', asset: { name: 'Thruster 2' } }
    ]
  });

  assert.equal(groups.length, 1);
  assert.equal(groups[0].items[0].subtitle, 'Thruster 2 · PREVENTIVE · HIGH');
  assert.deepEqual(groups[0].items[0].queryParams, { tab: 'work-orders', search: 'Thruster seal swap' });
});

test('buildSearchGroups returns empty array for empty or invalid payloads', () => {
  assert.deepEqual(buildSearchGroups(), []);
  assert.deepEqual(buildSearchGroups(null), []);
});
