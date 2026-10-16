// Phase 2 check (not part of the agent trace): engine totals reconcile to the
// raw-table summary, and the decoy tee shows up as a loss by SKU.
import { loadRaw, realismSummary } from '../data-gen/summary';
import { SHIPPING } from '../data-gen/assumptions';
import { buildModel, evaluate, DEFAULT_PARAMS, companyWaterfall, topLeaks } from '../engine';
const raw = loadRaw();
const s = realismSummary(raw);
const m = buildModel(raw, SHIPPING.freeThreshold, SHIPPING.flatRateCharged);
const r = evaluate(m, DEFAULT_PARAMS(m));
const w = companyWaterfall(m, r);
const refunds = raw.shopify_refunds.reduce((a, x) => a + x.amount, 0);
const ret = raw.threepl_returns.reduce((a, x) => a + x.processing_cost + x.return_label_cost, 0);
const opexFees = raw.quickbooks_opex.filter((x) => x.account.startsWith('Payment')).reduce((a, x) => a + x.amount, 0);
const checks: [string, number, number][] = [
  ['gross sales', w.gross, s.gross_sales],
  ['sales after discounts', w.gross - w.discounts, s.net_sales_after_discounts],
  ['refunds', w.refunds, refunds],
  ['return costs', w.returnCosts, ret],
  ['payment fees vs QuickBooks', w.fees, opexFees],
];
let fail = 0;
for (const [k, a, b] of checks) { const ok = Math.abs(a - b) <= 1; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${k.padEnd(28)} engine ${a.toFixed(2)}  raw ${b.toFixed(2)}  diff ${(a - b).toFixed(2)}`); }
const leaks = topLeaks(m, r, 'sku', 15);
const teeRank = leaks.findIndex((g) => g.key.startsWith('TEE-'));
const teeStyle = topLeaks(m, r, 'style', 8).find((g) => g.key === 'Core Tee')!;
console.log(`top_leaks by sku: first tee SKU at rank ${teeRank + 1} (${leaks[teeRank]?.key} ${leaks[teeRank]?.cm.toFixed(0)}); Core Tee style CM ${teeStyle.cm.toFixed(0)}`);
if (teeStyle.cm >= 0 || teeRank < 0) { console.log('FAIL decoy tee is not a loss'); fail++; } else console.log('PASS decoy tee ranks as a loss');
process.exit(fail ? 1 : 0);
