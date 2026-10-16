import type { Model } from './model';
import type { EvalResult } from './evaluate';
import { EVERGREEN_CODES } from '../data-gen/assumptions';

export const TENURE_MATCH_LAST_DAY = 181; // acquired Oct–Mar → 6–12 months observed

const isPromoCode = (code: string) => !!code && !EVERGREEN_CODES.includes(code);

export type CohortRow = {
  cohort: string;
  customers: number;
  customers_tenure_matched: number;
  first_order_cm: number;
  value_cm_per_customer: number; // all in-window orders
  value_cm_per_customer_tenure_matched: number;
  net_revenue_per_customer_tenure_matched: number;
  repeat_rate_tenure_matched: number;
  pct_repeat_orders_discounted: number;
  full_price_conversion: number; // share of customers with ≥1 later order without a promo code
  full_price_converters: number;
  converter_value_cm: number; // avg CM per converter
};

export function cohortSummary(m: Model, r: EvalResult, by: 'code' | 'channel'): CohortRow[] {
  const C = m.custIds.length;
  const custOrders: number[][] = Array.from({ length: C }, () => []);
  for (let o = 0; o < m.nOrders; o++) custOrders[m.oCust[o]].push(o);
  const orderNet = new Float64Array(m.nOrders);
  for (let l = 0; l < m.nLines; l++) orderNet[m.lOrder[l]] += r.gross[l] - r.discounts[l] - r.refunds[l];

  const groups = new Map<string, number[]>();
  for (let c = 0; c < C; c++) {
    if (!m.custIsNew[c] || m.custFirstOrder[c] < 0) continue;
    let key: string;
    if (by === 'channel') key = m.channels[m.custAcq[c]];
    else {
      const code = m.codes[m.custFirstCode[c]];
      key = code === 'WELCOME30' ? 'WELCOME30' : isPromoCode(code) ? 'other promo code' : 'full price';
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  const rows: CohortRow[] = [];
  for (const [cohort, cs] of groups) {
    let firstCm = 0, cm = 0, cmTm = 0, netTm = 0, nTm = 0, repTm = 0, repOrders = 0, repDisc = 0, conv = 0, convCm = 0;
    for (const c of cs) {
      const os = custOrders[c];
      let ccm = 0, cnet = 0;
      for (const o of os) { ccm += r.orderCm[o]; cnet += orderNet[o]; }
      firstCm += r.orderCm[os[0]];
      cm += ccm;
      const tm = m.custCreatedDay[c] <= TENURE_MATCH_LAST_DAY;
      if (tm) { nTm++; cmTm += ccm; netTm += cnet; if (os.length > 1) repTm++; }
      let converted = false;
      for (const o of os.slice(1)) {
        repOrders++;
        if (isPromoCode(m.codes[m.oCode[o]])) repDisc++;
        else converted = true;
      }
      if (converted) { conv++; convCm += ccm; }
    }
    rows.push({
      cohort,
      customers: cs.length,
      customers_tenure_matched: nTm,
      first_order_cm: firstCm / cs.length,
      value_cm_per_customer: cm / cs.length,
      value_cm_per_customer_tenure_matched: nTm ? cmTm / nTm : 0,
      net_revenue_per_customer_tenure_matched: nTm ? netTm / nTm : 0,
      repeat_rate_tenure_matched: nTm ? repTm / nTm : 0,
      pct_repeat_orders_discounted: repOrders ? repDisc / repOrders : 0,
      full_price_conversion: conv / cs.length,
      full_price_converters: conv,
      converter_value_cm: conv ? convCm / conv : 0,
    });
  }
  return rows.sort((a, b) => b.customers - a.customers);
}
