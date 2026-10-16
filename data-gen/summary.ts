// Phase 1 check: realism summary computed directly from raw tables, with assertions.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RawData } from '../engine/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export function loadRaw(): RawData {
  const names = ['shopify_orders', 'shopify_refunds', 'shopify_products', 'shopify_customers', 'quickbooks_cogs', 'quickbooks_opex', 'threepl_shipments', 'threepl_returns', 'inventory', 'inventory_stockouts', 'suppliers'];
  return Object.fromEntries(names.map((n) => [n, JSON.parse(readFileSync(join(ROOT, 'data', `${n}.json`), 'utf8'))])) as RawData;
}

export function realismSummary(raw: RawData) {
  const landed = new Map(raw.quickbooks_cogs.map((c) => [c.sku, c.landed_cost]));
  let gross = 0, disc = 0, units = 0, cogsShipped = 0, freeShipOrders = 0;
  for (const o of raw.shopify_orders) {
    for (const l of o.line_items) { gross += l.qty * l.unit_price; units += l.qty; cogsShipped += l.qty * landed.get(l.sku)!; }
    disc += o.discount_amount;
    if (o.shipping_charged === 0) freeShipOrders++;
  }
  const retUnits = raw.shopify_refunds.reduce((a, r) => a + r.qty, 0);
  const restocked = new Map(raw.threepl_returns.map((t) => [t.refund_id, t.restocked]));
  const restockUnits = raw.shopify_refunds.reduce((a, r) => a + (restocked.get(r.refund_id) ? r.qty : 0), 0);
  const nOrders = raw.shopify_orders.length;
  const out = raw.threepl_shipments.reduce((a, s) => a + s.outbound_cost, 0) / nOrders;
  return {
    gross_sales: gross,
    net_sales_after_discounts: gross - disc,
    gross_margin_pct: (gross - disc - cogsShipped) / (gross - disc),
    return_rate_units: retUnits / units,
    restock_rate: restockUnits / retUnits,
    aov: (gross - disc) / nOrders,
    units_per_order: units / nOrders,
    avg_outbound_per_order: out,
    free_shipping_order_share: freeShipOrders / nOrders,
    orders: nOrders,
    customers: raw.shopify_customers.length,
    skus: raw.shopify_products.length,
  };
}

export const TARGETS: Record<string, [number, number]> = {
  gross_sales: [3_500_000, 4_500_000],
  gross_margin_pct: [0.6, 0.7],
  return_rate_units: [0.2, 0.28],
  aov: [110, 160],
  units_per_order: [1.6, 2.2],
  avg_outbound_per_order: [7, 14],
  restock_rate: [0.8, 0.9],
  orders: [24_000, 34_000],
  customers: [11_000, 16_000],
  skus: [76, 84],
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = realismSummary(loadRaw());
  let fail = 0;
  for (const [k, v] of Object.entries(s)) {
    const t = TARGETS[k];
    const ok = !t || (v >= t[0] && v <= t[1]);
    if (!ok) fail++;
    const shown = Math.abs(v) < 5 ? v.toFixed(3) : Math.round(v).toLocaleString();
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${k.padEnd(28)} ${shown.padStart(12)}  ${t ? `[${t[0]} – ${t[1]}]` : ''}`);
  }
  if (fail) { console.error(`${fail} realism assertion(s) failed`); process.exit(1); }
  console.log('All realism assertions pass.');
}
