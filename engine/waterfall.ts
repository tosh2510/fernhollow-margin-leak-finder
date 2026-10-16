import type { Model } from './model';
import type { EvalResult } from './evaluate';
import { dayToMonthIdx, MONTH_LABELS } from './util';
import { EVERGREEN_CODES } from '../data-gen/assumptions';

export const DIMENSIONS = ['sku', 'style', 'category', 'size', 'color', 'channel', 'code', 'cohort', 'band', 'month', 'supplier'] as const;
export type Dim = (typeof DIMENSIONS)[number];

export const BANDS = [0, 50, 65, 100, 150, 250];
export function bandLabel(sub: number): string {
  for (let i = BANDS.length - 1; i >= 0; i--) if (sub >= BANDS[i] - 1e-9) return i === BANDS.length - 1 ? `$${BANDS[i]}+` : `$${BANDS[i]}–${BANDS[i + 1]}`;
  return '$0–50';
}

export function cohortLabel(m: Model, cust: number): string {
  if (!m.custIsNew[cust]) return 'pre-window customers';
  const code = m.codes[m.custFirstCode[cust]] ?? '';
  if (code === 'WELCOME30') return 'WELCOME30';
  if (code && !EVERGREEN_CODES.includes(code)) return 'promo-acquired';
  return 'full-price acquired';
}

/** Label for line l along a dimension. */
export function lineKey(m: Model, dim: Dim, l: number): string {
  const o = m.lOrder[l];
  const s = m.skus[m.lSku[l]];
  switch (dim) {
    case 'sku': return s.sku;
    case 'style': return s.style;
    case 'category': return s.category;
    case 'size': return s.size;
    case 'color': return `${s.style} · ${s.color}`;
    case 'channel': return m.channels[m.oCh[o]];
    case 'code': return m.codes[m.oCode[o]] || '(none)';
    case 'cohort': return cohortLabel(m, m.oCust[o]);
    case 'band': return bandLabel(m.oSubtotal[o]);
    case 'month': return MONTH_LABELS[dayToMonthIdx(m.oDay[o])];
    case 'supplier': return s.supplier;
  }
}

export type Waterfall = {
  key: string;
  gross: number; discounts: number; refunds: number; netRevenue: number; cogs: number; writeoffs: number;
  fees: number; shipping: number; pickpack: number; returnCosts: number; cm: number; cmPct: number;
  units: number; returnedUnits: number; returnRate: number; orders: number;
};

export type Filter = Partial<Record<Dim, string>>;

export function lineMatches(m: Model, l: number, f?: Filter): boolean {
  if (!f) return true;
  for (const k in f) if (lineKey(m, k as Dim, l) !== f[k as Dim]) return false;
  return true;
}

function empty(key: string): Waterfall {
  return { key, gross: 0, discounts: 0, refunds: 0, netRevenue: 0, cogs: 0, writeoffs: 0, fees: 0, shipping: 0, pickpack: 0, returnCosts: 0, cm: 0, cmPct: 0, units: 0, returnedUnits: 0, returnRate: 0, orders: 0 };
}

export function waterfallBy(m: Model, r: EvalResult, dim: Dim | null, filter?: Filter): Waterfall[] {
  const groups = new Map<string, Waterfall>();
  const orderSeen = new Map<string, Set<number>>();
  for (let l = 0; l < m.nLines; l++) {
    if (!lineMatches(m, l, filter)) continue;
    const key = dim ? lineKey(m, dim, l) : 'Company';
    let g = groups.get(key);
    if (!g) { g = empty(key); groups.set(key, g); orderSeen.set(key, new Set()); }
    g.gross += r.gross[l]; g.discounts += r.discounts[l]; g.refunds += r.refunds[l]; g.cogs += r.cogs[l];
    g.writeoffs += r.writeoffs[l]; g.fees += r.fees[l]; g.shipping += r.shipping[l]; g.pickpack += r.pickpack[l];
    g.returnCosts += r.returnCosts[l]; g.cm += r.cm[l]; g.units += r.units[l]; g.returnedUnits += r.returnedUnits[l];
    orderSeen.get(key)!.add(m.lOrder[l]);
  }
  for (const [k, g] of groups) {
    g.netRevenue = g.gross - g.discounts - g.refunds;
    g.cmPct = g.netRevenue ? g.cm / g.netRevenue : 0;
    g.returnRate = g.units ? g.returnedUnits / g.units : 0;
    g.orders = orderSeen.get(k)!.size;
  }
  return [...groups.values()];
}

export const companyWaterfall = (m: Model, r: EvalResult) => waterfallBy(m, r, null)[0];

export function topLeaks(m: Model, r: EvalResult, dim: Dim, n = 10) {
  return waterfallBy(m, r, dim).sort((a, b) => a.cm - b.cm).slice(0, n);
}

/** Waterfall as ordered steps for charts and the trace. */
export function waterfallSteps(w: Waterfall) {
  return [
    { label: 'Gross sales at list', value: w.gross, kind: 'total' as const },
    { label: 'Discounts', value: -w.discounts, kind: 'delta' as const },
    { label: 'Refunds', value: -w.refunds, kind: 'delta' as const },
    { label: 'Net revenue', value: w.netRevenue, kind: 'total' as const },
    { label: 'Landed COGS (kept units)', value: -w.cogs, kind: 'delta' as const },
    { label: 'Write-offs (unrestocked returns)', value: -w.writeoffs, kind: 'delta' as const },
    { label: 'Payment fees', value: -w.fees, kind: 'delta' as const },
    { label: 'Outbound shipping (net of charged)', value: -w.shipping, kind: 'delta' as const },
    { label: 'Pick & pack', value: -w.pickpack, kind: 'delta' as const },
    { label: 'Return processing + labels', value: -w.returnCosts, kind: 'delta' as const },
    { label: 'Contribution margin', value: w.cm, kind: 'total' as const },
  ];
}
