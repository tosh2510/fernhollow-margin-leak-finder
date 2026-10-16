import type { Model } from './model';
import { evaluate, totalCm, type EvalResult } from './evaluate';
import type { Params } from './types';

/** Lines matching a SKU or a style-code prefix (e.g. "TEE" or "TEE-BLA-M"). */
export function matchSkuLines(m: Model, skuOrPrefix: string): Float64Array {
  const sel = new Float64Array(m.nLines);
  for (let l = 0; l < m.nLines; l++) {
    const s = m.skus[m.lSku[l]].sku;
    if (s === skuOrPrefix || s.startsWith(skuOrPrefix + '-')) sel[l] = 1;
  }
  return sel;
}

export function basketAttach(m: Model, r: EvalResult, params: Params, skuOrPrefix: string) {
  const sel = matchSkuLines(m, skuOrPrefix);
  let units = 0, unitsInOnlyOrders = 0, allocCm = 0;
  let multi = 0, multiWith = 0, cmWith = 0, cmWithout = 0, subWith = 0, subWithout = 0, unitsWith = 0, unitsWithout = 0;
  let ordersWith = 0, onlyOrders = 0, onlyCm = 0;
  let mixed = 0, mixedWith = 0, mixCmWith = 0, mixCmWithout = 0, mixSubWith = 0, mixSubWithout = 0;
  const coStyles = new Map<string, number>();
  for (let o = 0; o < m.nOrders; o++) {
    let has = false, allSel = true;
    for (let l = m.oStart[o]; l < m.oEnd[o]; l++) {
      if (sel[l]) { has = true; units += m.lQty[l]; allocCm += r.cm[l]; } else allSel = false;
    }
    if (has) ordersWith++;
    if (has && allSel) {
      onlyOrders++; onlyCm += r.orderCm[o];
      for (let l = m.oStart[o]; l < m.oEnd[o]; l++) unitsInOnlyOrders += m.lQty[l];
    }
    if (m.oUnits[o] >= 2 && !(has && allSel)) {
      // mixed basket: at least one item that is not the target
      mixed++;
      if (has) { mixedWith++; mixCmWith += r.orderCm[o]; mixSubWith += m.oSubtotal[o]; }
      else { mixCmWithout += r.orderCm[o]; mixSubWithout += m.oSubtotal[o]; }
    }
    if (m.oUnits[o] >= 2) {
      multi++;
      if (has) {
        multiWith++; cmWith += r.orderCm[o]; subWith += m.oSubtotal[o]; unitsWith += m.oUnits[o];
        if (!allSel) for (let l = m.oStart[o]; l < m.oEnd[o]; l++) if (!sel[l]) coStyles.set(m.skus[m.lSku[l]].style, (coStyles.get(m.skus[m.lSku[l]].style) ?? 0) + 1);
      } else { cmWithout += r.orderCm[o]; subWithout += m.oSubtotal[o]; unitsWithout += m.oUnits[o]; }
    }
  }
  // Incremental CM: what disappears if these lines are removed and nothing else changes.
  const base = totalCm(r);
  const presence = new Float64Array(m.nLines).fill(1);
  for (let l = 0; l < m.nLines; l++) if (sel[l]) presence[l] = 0;
  const without = totalCm(evaluate(m, params, { linePresence: presence }));
  const altAlloc = evaluate(m, { ...params, allocation: params.allocation === 'revenue' ? 'units' : 'revenue' });
  let allocCmAlt = 0;
  for (let l = 0; l < m.nLines; l++) if (sel[l]) allocCmAlt += altAlloc.cm[l];
  const multiWithout = multi - multiWith;
  return {
    target: skuOrPrefix,
    units,
    orders_containing: ordersWith,
    share_of_units_in_orders_with_only_this_item: units ? unitsInOnlyOrders / units : 0,
    only_this_item_orders: onlyOrders,
    only_this_item_orders_avg_cm: onlyOrders ? onlyCm / onlyOrders : 0,
    multi_item_orders: multi,
    attach_rate_multi_item: multi ? multiWith / multi : 0,
    mixed_multi_item_orders: mixed,
    attach_rate_mixed_baskets: mixed ? mixedWith / mixed : 0,
    mixed_with: { orders: mixedWith, avg_order_cm: mixedWith ? mixCmWith / mixedWith : 0, avg_subtotal: mixedWith ? mixSubWith / mixedWith : 0 },
    mixed_without: { orders: mixed - mixedWith, avg_order_cm: mixed - mixedWith ? mixCmWithout / (mixed - mixedWith) : 0, avg_subtotal: mixed - mixedWith ? mixSubWithout / (mixed - mixedWith) : 0 },
    multi_with: { orders: multiWith, avg_order_cm: multiWith ? cmWith / multiWith : 0, avg_subtotal: multiWith ? subWith / multiWith : 0, avg_units: multiWith ? unitsWith / multiWith : 0 },
    multi_without: { orders: multiWithout, avg_order_cm: multiWithout ? cmWithout / multiWithout : 0, avg_subtotal: multiWithout ? subWithout / multiWithout : 0, avg_units: multiWithout ? unitsWithout / multiWithout : 0 },
    allocated_cm: { [params.allocation]: allocCm, [params.allocation === 'revenue' ? 'units' : 'revenue']: allocCmAlt },
    incremental_cm_if_removed: base - without,
    incremental_cm_per_unit: units ? (base - without) / units : 0,
    top_co_purchased_styles: [...coStyles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([style, orders]) => ({ style, orders })),
  };
}
