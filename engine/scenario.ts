// Scenario = baseline + a set of actions, evaluated jointly by the same engine.
// Per-action deltas are each action alone vs baseline; the combined delta is all
// actions together (interactions included, e.g. a higher threshold also changes
// what a tee pair costs).
import type { Model } from './model';
import { evaluate, totalCm, type Overrides } from './evaluate';
import type { Params } from './types';
import { inventoryStatus, unitIncrementalCm } from './inventory';
import { ENGINE, FEES } from '../data-gen/assumptions';

export type Action =
  | { id: string; kind: 'pause_skus'; skus: string[]; months?: number; halo?: number }
  | { id: string; kind: 'fix_fit'; skus: string[]; pause_months: number; target_return_rate: number }
  | { id: string; kind: 'discount_rule'; code: string; new_pct: number; min_subtotal?: number; retention: number; below_min_retention?: number }
  | { id: string; kind: 'shipping_threshold'; threshold: number; abandon?: number }
  | { id: string; kind: 'po'; skus: string[] }
  | { id: string; kind: 'markdown'; skus: string[]; markdown_pct: number; target_weeks_cover: number; sell_through: number; cannibalization: number }
  | { id: string; kind: 'keep'; skus: string[]; counterfactual_halo: number };

export type ActionResult = {
  id: string; kind: Action['kind']; annual_contribution_delta: number;
  detail: Record<string, number | string>; assumptions: { name: string; value: string; confidence: 'high' | 'medium' | 'low' }[];
};
export type ScenarioResult = { baseline_cm: number; scenario_cm: number; combined_delta: number; sum_of_individual: number; interaction: number; actions: ActionResult[] };

const r0 = (x: number) => Math.round(x);

function skuMatch(m: Model, list: string[]) {
  const set = new Set<number>();
  m.skus.forEach((s, i) => { if (list.some((p) => s.sku === p || s.sku.startsWith(p + '-'))) set.add(i); });
  return set;
}

/** Translate actions into evaluator overrides + additive (non-order) terms. */
function compile(m: Model, params: Params, actions: Action[]) {
  const ov: Overrides & { threshold?: number } = {};
  const ensure = <K extends 'orderWeight' | 'linePresence' | 'lineDiscFactor' | 'skuReturnMult'>(k: K, n: number) => {
    if (!ov[k]) ov[k] = new Float64Array(n).fill(1) as Overrides[K];
    return ov[k]!;
  };
  const additive: { id: string; amount: number }[] = [];
  let threshold = params.threshold;
  for (const a of actions) {
    if (a.kind === 'pause_skus' || a.kind === 'keep') {
      if (a.kind === 'keep') continue; // keeping changes nothing
      const set = skuMatch(m, a.skus);
      const frac = (a.months ?? 12) / 12;
      const halo = a.halo ?? 0;
      const pres = ensure('linePresence', m.nLines), w = ensure('orderWeight', m.nOrders);
      for (let o = 0; o < m.nOrders; o++) {
        let hit = false;
        for (let l = m.oStart[o]; l < m.oEnd[o]; l++) if (set.has(m.lSku[l])) { pres[l] *= 1 - frac; hit = true; }
        if (hit && halo) w[o] *= 1 - halo * frac;
      }
    } else if (a.kind === 'fix_fit') {
      const set = skuMatch(m, a.skus);
      const pres = ensure('linePresence', m.nLines), rm = ensure('skuReturnMult', m.skus.length);
      for (let l = 0; l < m.nLines; l++) if (set.has(m.lSku[l])) pres[l] *= 1 - a.pause_months / 12;
      for (const i of set) rm[i] *= m.skuReturnRate[i] > 0 ? a.target_return_rate / m.skuReturnRate[i] : 1;
    } else if (a.kind === 'discount_rule') {
      const ci = m.codes.indexOf(a.code);
      const df = ensure('lineDiscFactor', m.nLines), w = ensure('orderWeight', m.nOrders);
      const origPct = a.code === 'WELCOME30' ? 0.3 : 0;
      const custW = new Map<number, number>();
      for (let o = 0; o < m.nOrders; o++) {
        if (m.oCode[o] !== ci) continue;
        const ok = m.oGross[o] >= (a.min_subtotal ?? 0);
        const f = ok ? a.new_pct / origPct : 0;
        for (let l = m.oStart[o]; l < m.oEnd[o]; l++) df[l] = f;
        const isFirst = m.custFirstOrder[m.oCust[o]] === o;
        if (isFirst) custW.set(m.oCust[o], ok ? a.retention : (a.below_min_retention ?? a.retention));
      }
      // Customers not acquired lose their whole in-window value.
      for (let o = 0; o < m.nOrders; o++) { const cw = custW.get(m.oCust[o]); if (cw !== undefined) w[o] *= cw; }
    } else if (a.kind === 'shipping_threshold') {
      threshold = a.threshold;
      ov.thresholdAbandon = a.abandon ?? ENGINE.thresholdAbandonRate;
    }
  }
  return { ov, threshold, additive };
}

function additiveTerms(m: Model, params: Params, actions: Action[], base: ReturnType<typeof evaluate>) {
  const out: { id: string; amount: number; detail: Record<string, number | string> }[] = [];
  const needInv = actions.some((a) => a.kind === 'po' || a.kind === 'markdown');
  const inv = needInv ? inventoryStatus(m) : [];
  for (const a of actions) {
    if (a.kind === 'po') {
      let amt = 0, lostUnits = 0;
      for (const s of a.skus) {
        const row = inv.find((r) => r.sku === s);
        if (!row) continue;
        const u = unitIncrementalCm(m, params, m.skuIndex[s], base);
        amt += row.est_lost_units_12m * u;
        lostUnits += row.est_lost_units_12m;
      }
      out.push({ id: a.id, amount: amt, detail: { recovered_units_per_year: lostUnits, method: 'trailing-12m stockout lost units × incremental unit CM' } });
    } else if (a.kind === 'markdown') {
      let amt = 0, excessTotal = 0, cleared = 0, cash = 0;
      for (const s of a.skus) {
        const row = inv.find((r) => r.sku === s);
        if (!row) continue;
        const i = m.skuIndex[s];
        const sku = m.skus[i];
        const excess = Math.max(0, row.on_hand - Math.ceil(a.target_weeks_cover * row.peak_weekly_velocity));
        const units = excess * a.sell_through;
        const u = unitIncrementalCm(m, params, i, base);
        const R = Math.min(0.95, m.skuReturnRate[i] * params.returnMultiplier);
        const uMd = u - sku.price * a.markdown_pct * (1 - R) * (1 - FEES.paymentPct);
        const carrying = units * sku.landed * ENGINE.carryingCostAnnual * 0.5;
        amt += units * uMd - units * a.cannibalization * u + carrying;
        excessTotal += excess; cleared += units; cash += units * sku.price * (1 - a.markdown_pct) * (1 - R);
      }
      out.push({ id: a.id, amount: amt, detail: { excess_units: excessTotal, units_cleared: r0(cleared), cash_released: r0(cash) } });
    }
  }
  return out;
}

function evalTotal(m: Model, params: Params, actions: Action[]) {
  const { ov, threshold } = compile(m, params, actions);
  const r = evaluate(m, { ...params, threshold }, ov);
  return { r, total: totalCm(r) };
}

function assumptionsFor(a: Action): ActionResult['assumptions'] {
  switch (a.kind) {
    case 'pause_skus': return [{ name: 'Basket halo (orders lost with the SKU)', value: `${((a.halo ?? 0) * 100).toFixed(0)}%`, confidence: 'low' }, { name: 'Order base costs persist when other items remain', value: 'yes (incremental method)', confidence: 'high' }];
    case 'fix_fit': return [{ name: 'Months paused before revised fit lands', value: `${a.pause_months}`, confidence: 'medium' }, { name: 'Post-fix return rate', value: `${(a.target_return_rate * 100).toFixed(0)}% (other sizes run ~26–31%)`, confidence: 'medium' }, { name: 'Paused-size demand lost, not substituted', value: 'yes (conservative)', confidence: 'medium' }];
    case 'discount_rule': return [{ name: 'Acquisition retained at new offer', value: `${(a.retention * 100).toFixed(0)}%`, confidence: 'low' }, ...(a.min_subtotal ? [{ name: `Below-minimum basket retention (<$${a.min_subtotal})`, value: `${((a.below_min_retention ?? a.retention) * 100).toFixed(0)}% buy at full price`, confidence: 'low' as const }] : []), { name: 'Lost customers lose their whole 12-month value', value: 'yes', confidence: 'medium' }];
    case 'shipping_threshold': return [{ name: 'Abandon rate among newly-charged orders', value: `${((a.abandon ?? ENGINE.thresholdAbandonRate) * 100).toFixed(0)}%`, confidence: 'low' }, { name: 'Trade-up to clear threshold', value: 'not counted', confidence: 'medium' }];
    case 'po': return [{ name: 'Past 12m stockout pattern recurs without a reorder policy', value: 'yes', confidence: 'medium' }, { name: 'Substitution during stockout', value: `${(ENGINE.stockoutSubstitution * 100).toFixed(0)}%`, confidence: 'medium' }];
    case 'markdown': return [{ name: 'Sell-through of excess at markdown', value: `${(a.sell_through * 100).toFixed(0)}%`, confidence: 'medium' }, { name: 'Cannibalisation of full-price units', value: `${(a.cannibalization * 100).toFixed(0)}%`, confidence: 'medium' }, { name: 'Carrying cost avoided', value: `${(ENGINE.carryingCostAnnual * 100).toFixed(0)}%/yr × 6 months`, confidence: 'medium' }];
    case 'keep': return [{ name: 'Counterfactual basket halo if cut', value: `${(a.counterfactual_halo * 100).toFixed(0)}%`, confidence: 'low' }];
  }
}

export function runScenario(m: Model, params: Params, actions: Action[]): ScenarioResult {
  const base = evaluate(m, params);
  const baseTotal = totalCm(base);
  const results: ActionResult[] = [];
  for (const a of actions) {
    let delta = 0;
    const detail: Record<string, number | string> = {};
    if (a.kind === 'po' || a.kind === 'markdown') {
      const t = additiveTerms(m, params, [a], base)[0];
      delta = t.amount; Object.assign(detail, t.detail);
    } else if (a.kind === 'keep') {
      const cut = evalTotal(m, params, [{ id: a.id, kind: 'pause_skus', skus: a.skus, months: 12, halo: a.counterfactual_halo }]).total - baseTotal;
      const cutNoHalo = evalTotal(m, params, [{ id: a.id, kind: 'pause_skus', skus: a.skus, months: 12, halo: 0 }]).total - baseTotal;
      const cutFullHalo = evalTotal(m, params, [{ id: a.id, kind: 'pause_skus', skus: a.skus, months: 12, halo: 1 }]).total - baseTotal;
      delta = 0;
      detail.counterfactual_cut_delta = r0(cut);
      detail.counterfactual_cut_delta_no_halo = r0(cutNoHalo);
      // Cut delta is linear in halo; breakeven = halo at which cutting stops paying.
      detail.breakeven_halo = cutNoHalo > 0 ? Math.round((cutNoHalo / (cutNoHalo - cutFullHalo)) * 10000) / 10000 : 0;
    } else {
      delta = evalTotal(m, params, [a]).total - baseTotal;
    }
    results.push({ id: a.id, kind: a.kind, annual_contribution_delta: r0(delta), detail, assumptions: assumptionsFor(a) });
  }
  const joint = evalTotal(m, params, actions);
  const add = additiveTerms(m, params, actions, base).reduce((s, t) => s + t.amount, 0);
  const combined = joint.total + add - baseTotal;
  const sum = results.reduce((s, x) => s + x.annual_contribution_delta, 0);
  return { baseline_cm: r0(baseTotal), scenario_cm: r0(baseTotal + combined), combined_delta: r0(combined), sum_of_individual: sum, interaction: r0(combined) - sum, actions: results };
}
