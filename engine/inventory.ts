import type { Model } from './model';
import { evaluate, totalCm, type EvalResult } from './evaluate';
import type { Params } from './types';
import { ENGINE, WINDOW, SIZES, SIZE_CURVE } from '../data-gen/assumptions';
import { dateToDay, dayToDate } from './util';

export type InvStatus = {
  sku: string; style: string; color: string; size: string; supplier: string;
  on_hand: number; weekly_velocity: number; weeks_cover: number;
  peak_weekly_velocity: number; weeks_cover_at_peak: number;
  lead_time_days: number; safety_stock: number; reorder_point: number; below_reorder_point: boolean;
  projected_stockout_date: string | null; eta_if_ordered_today: string; unavoidable_stockout_days: number;
  stockout_days_12m: number; est_lost_units_12m: number; est_lost_revenue_12m: number;
  suggested_order_qty: number; moq_style_colour: number; flag: 'reorder' | 'overstock' | 'ok';
};

const ASOF = dateToDay(WINDOW.asOf);

function dailySeries(m: Model, skuIdx: number): number[] {
  const s = new Array(WINDOW.days).fill(0);
  for (let l = 0; l < m.nLines; l++) if (m.lSku[l] === skuIdx) s[m.oDay[m.lOrder[l]]] += m.lQty[l];
  return s;
}

export function inventoryStatus(m: Model): InvStatus[] {
  const outDays = new Map<string, Set<number>>();
  for (const so of m.stockouts) {
    const set = outDays.get(so.sku) ?? new Set<number>();
    for (let d = dateToDay(so.out_of_stock_from); d < dateToDay(so.back_in_stock_at); d++) set.add(d);
    outDays.set(so.sku, set);
  }
  const avgNetUnit = new Map<number, number>();
  {
    const net = new Float64Array(m.skus.length), u = new Float64Array(m.skus.length);
    for (let l = 0; l < m.nLines; l++) { net[m.lSku[l]] += m.lGross[l] - m.lDisc[l]; u[m.lSku[l]] += m.lQty[l]; }
    m.skus.forEach((_, i) => avgNetUnit.set(i, u[i] ? net[i] / u[i] : 0));
  }
  const rows: InvStatus[] = m.inventory.map((inv) => {
    const i = m.skuIndex[inv.sku];
    const s = m.skus[i];
    const series = dailySeries(m, i);
    const out = outDays.get(inv.sku) ?? new Set<number>();
    // weekly in-stock sales, last 26 weeks, for σ
    const weeks: number[] = [];
    for (let w = 0; w < 26; w++) {
      const a = WINDOW.days - 7 * (w + 1);
      let sum = 0, inStock = true;
      for (let d = a; d < a + 7; d++) { sum += series[d]; if (out.has(d)) inStock = false; }
      if (inStock) weeks.push(sum);
    }
    const mean = weeks.reduce((a, b) => a + b, 0) / Math.max(1, weeks.length);
    const sd = Math.sqrt(weeks.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, weeks.length - 1));
    let peak = 0;
    for (let d = 0; d + 56 <= WINDOW.days; d += 7) {
      let sum = 0;
      for (let k = d; k < d + 56; k++) sum += series[k];
      peak = Math.max(peak, sum / 8);
    }
    const v = inv.weekly_sales_velocity;
    const ltW = inv.lead_time_days / 7;
    const safety = Math.ceil(ENGINE.safetyZ * sd * Math.sqrt(ltW));
    const rop = Math.ceil(v * ltW + safety);
    const orderUpTo = rop + Math.ceil(ENGINE.reviewWeeks * v);
    const cover = v > 0 ? inv.on_hand / v : Infinity;
    const stockoutDay = v > 0 ? ASOF + Math.floor((inv.on_hand / v) * 7) : null;
    const eta = ASOF + inv.lead_time_days;
    // historic lost demand: daily rate over the 28 in-stock days before each outage
    let lostUnits = 0;
    const sorted = [...out].sort((a, b) => a - b);
    for (const d of sorted) {
      let sum = 0, n = 0;
      for (let k = d - 1; k >= 0 && n < 28; k--) if (!out.has(k)) { sum += series[k]; n++; }
      if (n < 7) for (let k = d + 1; k < WINDOW.days && n < 28; k++) if (!out.has(k)) { sum += series[k]; n++; }
      lostUnits += (n ? sum / n : 0) * (1 - ENGINE.stockoutSubstitution);
    }
    const overstock = Math.min(cover, peak > 0 ? inv.on_hand / peak : Infinity) > 30;
    const needs = inv.on_hand <= rop;
    return {
      sku: inv.sku, style: s.style, color: s.color, size: s.size, supplier: inv.supplier,
      on_hand: inv.on_hand, weekly_velocity: v, weeks_cover: Math.round(cover * 10) / 10,
      peak_weekly_velocity: Math.round(peak * 10) / 10, weeks_cover_at_peak: peak > 0 ? Math.round((inv.on_hand / peak) * 10) / 10 : Infinity,
      lead_time_days: inv.lead_time_days, safety_stock: safety, reorder_point: rop, below_reorder_point: needs,
      projected_stockout_date: stockoutDay !== null ? dayToDate(stockoutDay) : null,
      eta_if_ordered_today: dayToDate(eta),
      unavoidable_stockout_days: stockoutDay !== null ? Math.max(0, eta - stockoutDay) : 0,
      stockout_days_12m: out.size,
      est_lost_units_12m: Math.round(lostUnits),
      est_lost_revenue_12m: Math.round(lostUnits * avgNetUnit.get(i)!),
      suggested_order_qty: needs && !overstock ? Math.max(0, orderUpTo - inv.on_hand) : 0,
      moq_style_colour: inv.moq,
      flag: overstock ? 'overstock' : needs ? 'reorder' : 'ok',
    };
  });
  // MOQ is per style-colour: top up short colourways across sizes by the size curve.
  const byColour = new Map<string, InvStatus[]>();
  for (const r of rows) {
    const k = r.sku.split('-').slice(0, 2).join('-');
    byColour.set(k, [...(byColour.get(k) ?? []), r]);
  }
  for (const group of byColour.values()) {
    const total = group.reduce((a, r) => a + r.suggested_order_qty, 0);
    if (total === 0 || total >= group[0].moq_style_colour) continue;
    const extra = group[0].moq_style_colour - total;
    const alloc = group.map((r) => SIZE_CURVE[SIZES.indexOf(r.size as (typeof SIZES)[number])]);
    const sum = alloc.reduce((a, b) => a + b, 0);
    let used = 0;
    group.forEach((r, k) => {
      const add = k === group.length - 1 ? extra - used : Math.round((extra * alloc[k]) / sum);
      used += add;
      r.suggested_order_qty += add;
    });
  }
  return rows;
}

/** Average incremental CM per unit for a SKU under the given params (removal method). */
export function unitIncrementalCm(m: Model, params: Params, skuIdx: number, base?: EvalResult): number {
  const b = base ?? evaluate(m, params);
  const presence = new Float64Array(m.nLines).fill(1);
  let units = 0;
  for (let l = 0; l < m.nLines; l++) if (m.lSku[l] === skuIdx) { presence[l] = 0; units += m.lQty[l]; }
  if (!units) return 0;
  return (totalCm(b) - totalCm(evaluate(m, params, { linePresence: presence }))) / units;
}
