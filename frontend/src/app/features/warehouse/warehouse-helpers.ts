import {
  InventoryItem,
  MovementType,
  StockMovement,
  WarehouseStockStatus
} from '../../core/models/interfaces';

export interface MovementTypeOption {
  value: MovementType;
  label: string;
  icon: string;
  color: string;
  bg: string;
}

export const MOVEMENT_TYPES: MovementTypeOption[] = [
  { value: 'IN',         label: 'Stock In',  icon: 'add_circle_outline',    color: '#16A34A', bg: '#DCFCE7' },
  { value: 'OUT',        label: 'Stock Out', icon: 'remove_circle_outline', color: '#DC2626', bg: '#FEE2E2' },
  { value: 'TRANSFER',   label: 'Transfer',  icon: 'swap_horiz',            color: '#0288D1', bg: '#E0F2FE' },
  { value: 'ADJUSTMENT', label: 'Adjust',    icon: 'tune',                  color: '#D97706', bg: '#FEF3C7' },
  { value: 'RETURN',     label: 'Return',    icon: 'assignment_return',     color: '#7C3AED', bg: '#EDE9FE' },
];

export function getMovementTypeMeta(type: MovementType | string): MovementTypeOption {
  return MOVEMENT_TYPES.find(t => t.value === type) || {
    value: 'ADJUSTMENT',
    label: String(type || 'Unknown'),
    icon: 'swap_horiz',
    color: '#6B7280',
    bg: '#F1F5F9'
  };
}

export function getEffectiveThreshold(item: Partial<InventoryItem> | null | undefined): number {
  if (!item) return 0;
  const reorder = Number(item.reorder_point) || 0;
  const min = Number(item.min_stock) || 0;
  return Math.max(reorder > 0 ? reorder : 0, min > 0 ? min : 0);
}

export function getStockStatusKey(item: Partial<InventoryItem> | null | undefined): WarehouseStockStatus {
  const qty = Number(item?.quantity) || 0;
  if (qty <= 0) return 'out';
  const threshold = getEffectiveThreshold(item);
  if (qty <= threshold) return 'low';
  const maxStock = item?.max_stock != null ? Number(item.max_stock) : null;
  if (maxStock != null && Number.isFinite(maxStock) && maxStock > 0 && qty > maxStock) {
    return 'overstock';
  }
  return 'healthy';
}

export function getStockStatusLabel(item: Partial<InventoryItem> | null | undefined): string {
  switch (getStockStatusKey(item)) {
    case 'out':       return 'Out of Stock';
    case 'low':       return 'Low Stock';
    case 'overstock': return 'Overstock';
    default:          return 'Healthy';
  }
}

export function getStockStatusColor(item: Partial<InventoryItem> | null | undefined): string {
  switch (getStockStatusKey(item)) {
    case 'out':       return '#DC2626';
    case 'low':       return '#D97706';
    case 'overstock': return '#0288D1';
    default:          return '#16A34A';
  }
}

export function getStockBadgeBg(item: Partial<InventoryItem> | null | undefined): string {
  switch (getStockStatusKey(item)) {
    case 'out':       return '#FEE2E2';
    case 'low':       return '#FEF3C7';
    case 'overstock': return '#E0F2FE';
    default:          return '#DCFCE7';
  }
}

export function getStockProgressPercent(item: Partial<InventoryItem> | null | undefined): number {
  if (!item) return 0;
  const qty = Math.max(0, Number(item.quantity) || 0);
  if (qty === 0) return 0;

  const maxStock = item.max_stock != null && Number(item.max_stock) > 0
    ? Number(item.max_stock)
    : null;
  const threshold = getEffectiveThreshold(item);
  const scaleRef = maxStock || Math.max(threshold * 2, qty, 10);

  return Math.max(0, Math.min(100, Math.round((qty / scaleRef) * 100)));
}

export function getItemTotalValue(item: Partial<InventoryItem> | null | undefined): number | null {
  if (!item || item.unit_cost === null || item.unit_cost === undefined || (item.unit_cost as unknown) === '') {
    return null;
  }
  const cost = Number(item.unit_cost);
  if (!Number.isFinite(cost)) return null;
  return Number(((Number(item.quantity) || 0) * cost).toFixed(2));
}

export function formatMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatMovementDelta(m: StockMovement): string {
  const delta = (Number(m.quantity_after) || 0) - (Number(m.quantity_before) || 0);
  return delta > 0 ? `+${delta}` : `${delta}`;
}

export function formatMovementUser(m: StockMovement): string {
  const first = m.user?.first_name || '';
  const last = m.user?.last_name || '';
  const full = `${first} ${last}`.trim();
  return full || m.user?.username || 'System';
}

export function generateAutoSku(categoryName?: string, itemName?: string): string {
  const catClean = String(categoryName || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const itemClean = String(itemName || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const prefix = (catClean.slice(0, 3) || itemClean.slice(0, 3) || 'INV').padEnd(3, 'X');
  const code = String(Math.floor(1000 + Math.random() * 9000));
  return `${prefix}-${code}`;
}

export function escapeHtml(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function printBinLabel(item: InventoryItem): boolean {
  if (typeof window === 'undefined') return false;
  const popup = window.open('', '_blank', 'width=480,height=380');
  if (!popup) return false;

  const locationLabel = item.location
    ? `${escapeHtml(item.location.code)} — ${escapeHtml(item.location.name)}`
    : 'Unassigned';
  const categoryLabel = item.category?.name ? escapeHtml(item.category.name) : 'Uncategorized';
  const partNumber = item.part_number ? escapeHtml(item.part_number) : '—';

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Bin Label — ${escapeHtml(item.sku)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&family=JetBrains+Mono:wght@500;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      color: #0A1628;
      background: #F0F4F8;
      padding: 20px;
      display: flex;
      justify-content: center;
    }
    .label-card {
      width: 100%;
      max-width: 420px;
      background: #FFFFFF;
      border: 2px solid #0D1F3C;
      border-radius: 12px;
      padding: 18px 20px;
    }
    .label-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1.5px solid #CBD5E1;
      padding-bottom: 10px;
      margin-bottom: 12px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #1565C0;
    }
    .sku-box {
      font-family: 'JetBrains Mono', monospace;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 0.04em;
      color: #0A1628;
      background: #F0F7FF;
      border: 1px solid #BBDEFB;
      border-radius: 8px;
      padding: 8px 12px;
      margin-bottom: 10px;
      text-align: center;
    }
    .item-name {
      font-size: 17px;
      font-weight: 800;
      color: #0A1628;
      margin-bottom: 4px;
      line-height: 1.25;
    }
    .meta-line {
      font-size: 12px;
      color: #475569;
      margin-bottom: 12px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      border-top: 1px solid #E1EAF5;
      padding-top: 10px;
    }
    .cell-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6B7280;
    }
    .cell-val {
      font-size: 13px;
      font-weight: 700;
      color: #0D1F3C;
      margin-top: 2px;
    }
    .mono { font-family: 'JetBrains Mono', monospace; }
    @media print {
      body { background: #FFFFFF; padding: 0; }
      .label-card { border-width: 1.5px; }
    }
  </style>
</head>
<body>
  <div class="label-card">
    <div class="label-top">
      <span>SMaRT Warehouse Bin</span>
      <span>${categoryLabel}</span>
    </div>
    <div class="sku-box">${escapeHtml(item.sku)}</div>
    <div class="item-name">${escapeHtml(item.name)}</div>
    <div class="meta-line">Part No: <span class="mono">${partNumber}</span> · Unit: ${escapeHtml(item.unit || 'pcs')}</div>
    <div class="grid">
      <div>
        <div class="cell-label">Location</div>
        <div class="cell-val">${locationLabel}</div>
      </div>
      <div>
        <div class="cell-label">Min / Reorder / Max</div>
        <div class="cell-val mono">${Number(item.min_stock) || 0} / ${Number(item.reorder_point) || 0} / ${item.max_stock != null ? Number(item.max_stock) : '—'}</div>
      </div>
    </div>
  </div>
  <script>
    window.addEventListener('load', function () {
      setTimeout(function () { window.print(); }, 250);
    });
  </script>
</body>
</html>`;

  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  return true;
}
