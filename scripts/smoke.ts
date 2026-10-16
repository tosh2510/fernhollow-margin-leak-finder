import { loadRaw } from '../data-gen/summary';
import { SHIPPING } from '../data-gen/assumptions';
import { buildModel, evaluate, DEFAULT_PARAMS, cohortSummary, basketAttach, inventoryStatus, runScenario } from '../engine';
const m = buildModel(loadRaw(), SHIPPING.freeThreshold, SHIPPING.flatRateCharged);
const p = DEFAULT_PARAMS(m); const r = evaluate(m, p);
let t = Date.now(); evaluate(m, p); console.log('eval ms', Date.now() - t);
console.log(cohortSummary(m, r, 'code').map(x => [x.cohort, x.customers, x.value_cm_per_customer_tenure_matched.toFixed(0), x.repeat_rate_tenure_matched.toFixed(3), x.full_price_conversion.toFixed(3), x.converter_value_cm.toFixed(0), x.pct_repeat_orders_discounted.toFixed(2)]));
const b = basketAttach(m, r, p, 'TEE'); console.log(JSON.stringify(b));
const inv = inventoryStatus(m); console.log(inv.filter(x => x.flag !== 'ok').map(x => [x.sku, x.weeks_cover, x.weeks_cover_at_peak, x.flag, x.suggested_order_qty, x.stockout_days_12m, x.est_lost_units_12m, x.unavoidable_stockout_days]));
t = Date.now();
const s = runScenario(m, p, [
 { id: 'A', kind: 'fix_fit', skus: ['WRP-BLA-M','WRP-BLA-L','WRP-TER-M','WRP-TER-L'], pause_months: 4, target_return_rate: 0.3 },
 { id: 'B', kind: 'shipping_threshold', threshold: 75 },
 { id: 'C', kind: 'discount_rule', code: 'WELCOME30', new_pct: 0.15, retention: 0.85 },
 { id: 'D', kind: 'po', skus: ['CHN-KHA-M','CHN-KHA-L','CHN-NAV-M','CHN-NAV-L','POL-NAV-M','POL-NAV-L'] },
 { id: 'E', kind: 'markdown', skus: m.skus.filter(s=>s.sku.startsWith('KNT-MOS')).map(s=>s.sku), markdown_pct: 0.3, target_weeks_cover: 16, sell_through: 0.7, cannibalization: 0.15 },
 { id: 'F', kind: 'keep', skus: ['TEE'], counterfactual_halo: 0.15 },
]);
console.log('ms', Date.now()-t, JSON.stringify(s, null, 1).slice(0, 3000));
