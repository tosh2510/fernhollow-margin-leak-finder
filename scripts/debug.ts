import { loadRaw } from '../data-gen/summary';
import { buildModel } from '../engine/model';
import { evaluate, DEFAULT_PARAMS } from '../engine/evaluate';
import { waterfallBy, companyWaterfall } from '../engine/waterfall';
import { SHIPPING } from '../data-gen/assumptions';
const m = buildModel(loadRaw(), SHIPPING.freeThreshold, SHIPPING.flatRateCharged);
for (const alloc of ['revenue','units'] as const) {
const r = evaluate(m, { ...DEFAULT_PARAMS(m), allocation: alloc });
const c = companyWaterfall(m, r);
console.log(alloc, 'company CM', Math.round(c.cm), (c.cmPct*100).toFixed(1)+'%', 'net', Math.round(c.netRevenue));
for (const dim of ['style','band','cohort','size'] as const) {
  console.log('--', dim);
  for (const g of waterfallBy(m, r, dim).sort((a,b)=>a.cm-b.cm)) console.log(g.key.padEnd(26), Math.round(g.cm).toString().padStart(9), (g.cmPct*100).toFixed(1).padStart(6)+'%', 'ret', (g.returnRate*100).toFixed(1), 'units', Math.round(g.units), 'orders', g.orders);
}
const wrap = waterfallBy(m, r, 'size', { style: 'Wrap Dress' });
console.log('-- wrap by size'); for (const g of wrap) console.log(g.key, Math.round(g.cm), (g.returnRate*100).toFixed(1));
console.log('-- worst skus'); for (const g of waterfallBy(m, r, 'sku').sort((a,b)=>a.cm-b.cm).slice(0,8)) console.log(g.key, Math.round(g.cm), (g.cmPct*100).toFixed(1));
}
