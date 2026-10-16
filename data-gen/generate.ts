// Generates Fernhollow's synthetic systems of record into /data/*.json.
// Deterministic: mulberry32(42). All parameters live in ./assumptions.ts.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from './assumptions';
import { mulberry32, round2, allocateCents, dayToDate, dayToMonthIdx } from '../engine/util';
import type {
  ShopifyOrder, ShopifyRefund, ShopifyProduct, ShopifyCustomer, QbCogs, QbOpex, TplShipment, TplReturn, InventoryRow, StockoutRow, RawData,
} from '../engine/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data');
const rand = mulberry32(A.SEED);

const pick = <T>(arr: readonly T[], weights: readonly number[]): T => {
  const t = weights.reduce((a, b) => a + b, 0);
  let x = rand() * t;
  for (let i = 0; i < arr.length; i++) { x -= weights[i]; if (x <= 0) return arr[i]; }
  return arr[arr.length - 1];
};
const pickIdx = (weights: readonly number[]) => pick(weights.map((_, i) => i), weights);
const uniform = (a: number, b: number) => a + (b - a) * rand();
const expo = (mean: number) => -Math.log(1 - rand()) * mean;
const poisson = (lambda: number) => { let k = 0, p = 1; const L = Math.exp(-lambda); do { k++; p *= rand(); } while (p > L); return k - 1; };
const pad = (n: number, w: number) => String(n).padStart(w, '0');

// ---------- products ----------
const products: ShopifyProduct[] = [];
const cogs: QbCogs[] = [];
const skuMeta = new Map<string, { style: A.StyleDef; size: string; color: string }>();
for (const s of A.STYLES) {
  for (const color of s.colors) {
    for (const size of A.SIZES) {
      const sku = `${s.code}-${color.replace(/\s+/g, '').slice(0, 3).toUpperCase()}-${size}`;
      products.push({ sku, style: s.style, category: s.category, size, color, list_price: s.price, status: 'active' });
      cogs.push({ sku, fob_cost: s.fob, inbound_freight_per_unit: s.freight, duty_rate: s.duty, landed_cost: round2(s.fob * (1 + s.duty) + s.freight) });
      skuMeta.set(sku, { style: s, size, color });
    }
  }
}
const skuOf = (code: string, color: string, size: string) => `${code}-${color.replace(/\s+/g, '').slice(0, 3).toUpperCase()}-${size}`;
const priceOf = new Map(products.map((p) => [p.sku, p.list_price]));
const landedOf = new Map(cogs.map((c) => [c.sku, c.landed_cost]));

// ---------- calendar ----------
const promoOn = (d: number) => A.PROMOS.find((p) => d >= p.from && d <= p.to);
const dayWeight = (d: number) => A.MONTH_WEIGHTS[dayToMonthIdx(d)] * (promoOn(d)?.uplift ?? 1);
const dayWeights = Array.from({ length: A.WINDOW.days }, (_, d) => dayWeight(d));
const cumDay: number[] = [];
dayWeights.reduce((a, w, i) => (cumDay[i] = a + w), 0);
const sampleDay = (from = 0) => {
  const lo = from > 0 ? cumDay[from - 1] : 0;
  const x = lo + rand() * (cumDay[A.WINDOW.days - 1] - lo);
  let a = from, b = A.WINDOW.days - 1;
  while (a < b) { const mid = (a + b) >> 1; if (cumDay[mid] < x) a = mid + 1; else b = mid; }
  return a;
};
const stockoutSet = new Map<string, [number, number][]>(A.STOCKOUTS.map((s) => [s.sku, s.periods]));
const isOut = (sku: string, d: number) => (stockoutSet.get(sku) ?? []).some(([a, b]) => d >= a && d <= b);

// ---------- customers ----------
type Persona = 'full' | 'welcome_converter' | 'welcome_dealseeker' | 'existing';
type Cust = { id: string; created: number; channel: string; persona: Persona; sizeIdx: number };
const customers: Cust[] = [];
const totalCust = A.CUSTOMERS.newCustomers + A.CUSTOMERS.existingCustomers;
const nWelcome = Math.round(totalCust * A.CUSTOMERS.welcomeShareOfAll);
for (let i = 0; i < A.CUSTOMERS.newCustomers; i++) {
  const welcome = i < nWelcome;
  let persona: Persona = 'full';
  if (welcome) persona = rand() < A.CUSTOMERS.welcomeConverterShare ? 'welcome_converter' : 'welcome_dealseeker';
  const channel = pick(A.CUSTOMERS.acquisitionChannels, welcome ? A.CUSTOMERS.welcomeChannelMix : A.CUSTOMERS.channelMix);
  customers.push({ id: '', created: sampleDay(), channel, persona, sizeIdx: pickIdx(A.SIZE_CURVE) });
}
for (let i = 0; i < A.CUSTOMERS.existingCustomers; i++) {
  const channel = pick(A.CUSTOMERS.acquisitionChannels, A.CUSTOMERS.channelMix);
  customers.push({ id: '', created: -Math.floor(uniform(30, 1000)), channel, persona: 'existing', sizeIdx: pickIdx(A.SIZE_CURVE) });
}
// shuffle so ids don't encode persona
for (let i = customers.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [customers[i], customers[j]] = [customers[j], customers[i]]; }
customers.forEach((c, i) => (c.id = `C-${pad(10001 + i, 6)}`));

// ---------- order intents ----------
type Intent = { cust: Cust; day: number; code: string | null; first: boolean };
const intents: Intent[] = [];
const fullRepeats = (c: Cust, start: number, p0: number, pc: number) => {
  let d = start;
  let p = p0;
  while (rand() < p) {
    d = Math.round(d + 10 + expo(A.CUSTOMERS.repeatGapDays));
    if (d > A.WINDOW.days - 1) break;
    const promo = promoOn(d);
    intents.push({ cust: c, day: d, code: promo && rand() < A.PROMO_CODE_USE ? promo.code : null, first: false });
    p = pc;
  }
};
for (const c of customers) {
  if (c.persona === 'existing') {
    const n = 1 + poisson(A.CUSTOMERS.existingOrdersMean - 1);
    for (let k = 0; k < n; k++) {
      const d = sampleDay();
      const promo = promoOn(d);
      intents.push({ cust: c, day: d, code: promo && rand() < A.PROMO_CODE_USE ? promo.code : null, first: false });
    }
    continue;
  }
  if (c.persona === 'full') {
    const promo = promoOn(c.created);
    intents.push({ cust: c, day: c.created, code: promo && rand() < 0.55 ? promo.code : null, first: true });
    fullRepeats(c, c.created, A.CUSTOMERS.fullPriceRepeatP, A.CUSTOMERS.fullPriceRepeatContinue);
  } else {
    // WELCOME30 can't stack with a sitewide promo; if acquired inside one, push to day after.
    let d = c.created;
    while (promoOn(d) && d < A.WINDOW.days - 1) d++;
    c.created = d;
    intents.push({ cust: c, day: d, code: 'WELCOME30', first: true });
    if (c.persona === 'welcome_converter') fullRepeats(c, d, A.CUSTOMERS.welcomeConverterRepeatP, A.CUSTOMERS.fullPriceRepeatContinue);
    else {
      // deal-seekers come back only for promotions
      const future = A.PROMOS.filter((p) => p.from > d + 7);
      let bought = false;
      for (const p of future) {
        if (rand() < A.CUSTOMERS.welcomeDealSeekerRepeatP / Math.max(1, future.length * 0.55)) {
          intents.push({ cust: c, day: Math.floor(uniform(p.from, p.to + 1)), code: p.code, first: false });
          bought = true;
        }
      }
      // a small number buy at full price anyway (noise)
      if (!bought && rand() < 0.04) {
        const dd = Math.round(d + 20 + expo(90));
        if (dd < A.WINDOW.days && !promoOn(dd)) intents.push({ cust: c, day: dd, code: null, first: false });
      }
    }
  }
}
intents.sort((a, b) => a.day - b.day || (a.first === b.first ? 0 : a.first ? -1 : 1));

// ---------- baskets ----------
const coreStyles = A.STYLES.filter((s) => s.code !== 'TEE');
const tee = A.STYLES.find((s) => s.code === 'TEE')!;
const lostDemand = new Map<string, number>();
const nearSize = (i: number) => (rand() < A.BASKET.sizeDeviationP ? Math.max(0, Math.min(4, i + (rand() < 0.5 ? -1 : 1))) : i);
function chooseLine(style: A.StyleDef, sizeIdx: number, day: number): string | null {
  const size = A.SIZES[nearSize(sizeIdx)];
  const color = pick(style.colors, style.colorWeights);
  const sku = skuOf(style.code, color, size);
  if (!isOut(sku, day)) return sku;
  lostDemand.set(sku, (lostDemand.get(sku) ?? 0) + 1);
  if (rand() < A.STOCKOUT_SUBSTITUTION) {
    const alts = style.colors.map((c) => skuOf(style.code, c, size)).filter((s) => s !== sku && !isOut(s, day));
    if (alts.length) return alts[Math.floor(rand() * alts.length)];
  }
  return null;
}
function basket(c: Cust, day: number): string[] {
  const mi = dayToMonthIdx(day);
  const out: string[] = [];
  if (rand() < A.BASKET.teeOnlyShare) {
    const n = 1 + pickIdx(A.BASKET.teeOnlyUnitsDist);
    for (let k = 0; k < n; k++) { const s = chooseLine(tee, c.sizeIdx, day); if (s) out.push(s); }
    return out;
  }
  const n = 1 + pickIdx(A.BASKET.coreUnitsDist);
  const w = coreStyles.map((s) => s.popularity * s.seasonality[mi]);
  for (let k = 0; k < n; k++) { const s = chooseLine(pick(coreStyles, w), c.sizeIdx, day); if (s) out.push(s); }
  if (rand() < A.BASKET.teeAttachByCoreUnits[n - 1]) { const s = chooseLine(tee, c.sizeIdx, day); if (s) out.push(s); }
  return out;
}

// ---------- orders, refunds, 3PL ----------
const orders: ShopifyOrder[] = [];
const refunds: ShopifyRefund[] = [];
const shipments: TplShipment[] = [];
const tplReturns: TplReturn[] = [];
let orderNo = 100001, refundNo = 500001;
for (const it of intents) {
  const skus = basket(it.cust, it.day);
  if (!skus.length) continue;
  const counts = new Map<string, number>();
  for (const s of skus) counts.set(s, (counts.get(s) ?? 0) + 1);
  const lines = [...counts.entries()].map(([sku, qty]) => ({ sku, qty, unit_price: priceOf.get(sku)! }));
  const grossC = lines.map((l) => Math.round(l.unit_price * 100) * l.qty);
  const gross = grossC.reduce((a, b) => a + b, 0);
  const pct = it.code === 'WELCOME30' ? 0.3 : it.code ? A.PROMOS.find((p) => p.code === it.code)!.pct : 0;
  let discC = Math.round(gross * pct);
  let code = it.code;
  const teeUnits = skus.filter((s) => s.startsWith('TEE-')).length;
  if (!code && teeUnits >= 2) {
    discC = Math.floor(teeUnits / 2) * (2 * tee.price - A.TEE_MULTIBUY.pairPrice) * 100;
    code = A.TEE_MULTIBUY.code;
  }
  const subC = gross - discC;
  const shipCharged = subC < A.SHIPPING.freeThreshold * 100 ? A.SHIPPING.flatRateCharged : 0;
  const units = skus.length;
  const order_id = `FH-${orderNo++}`;
  const hh = Math.floor(uniform(6, 24)), mm = Math.floor(uniform(0, 60));
  const firstChannel = it.first ? it.cust.channel : pick(['email', 'organic', 'paid_social', 'search'], [0.38, 0.32, 0.18, 0.12]);
  orders.push({
    order_id, customer_id: it.cust.id, created_at: `${dayToDate(it.day)}T${pad(hh, 2)}:${pad(mm, 2)}:00Z`,
    channel: firstChannel, discount_code: code, discount_amount: discC / 100, subtotal: subC / 100, shipping_charged: shipCharged, line_items: lines,
  });
  const zone = uniform(A.SHIPPING.zoneMin, A.SHIPPING.zoneMax);
  const outbound = round2(Math.min(A.SHIPPING.outboundCap, zone * (A.SHIPPING.outboundBase + A.SHIPPING.outboundPerExtraUnit * (units - 1))));
  shipments.push({ order_id, shipped_at: dayToDate(Math.min(A.WINDOW.days + 1, it.day + 1)), outbound_cost: outbound, pick_pack_cost: round2(A.FEES.pickPackBase + A.FEES.pickPackPerExtraUnit * (units - 1)) });

  // returns, decided per unit
  const lineDisc = allocateCents(discC, grossC);
  const lag = Math.floor(uniform(A.RETURNS.lagDaysMin, A.RETURNS.lagDaysMax + 1));
  let labelUsed = false;
  lines.forEach((l, k) => {
    const meta = skuMeta.get(l.sku)!;
    const isWrap = meta.style.code === 'WRP';
    const rate = isWrap ? (A.RETURNS.wrapFitSizes.includes(meta.size) ? A.RETURNS.wrapFitReturn : A.RETURNS.wrapOtherReturn) : meta.style.baseReturn;
    const mix = isWrap && A.RETURNS.wrapFitSizes.includes(meta.size) ? A.RETURNS.wrapFitReasonMix : A.RETURNS.baseReasonMix;
    const restockRate = isWrap ? A.RETURNS.wrapRestockRate : A.RETURNS.restockRate;
    const groups = new Map<string, number>();
    for (let u = 0; u < l.qty; u++) {
      if (rand() >= rate) continue;
      const reason = pick(A.RETURNS.reasons, mix);
      const restocked = rand() < restockRate;
      const key = reason + '|' + restocked;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    const netUnitC = (grossC[k] - lineDisc[k]) / l.qty;
    for (const [key, qty] of groups) {
      const [reason, rs] = key.split('|');
      const refund_id = `R-${refundNo++}`;
      refunds.push({ refund_id, order_id, sku: l.sku, qty, amount: Math.round(netUnitC * qty) / 100, reason, refunded_at: dayToDate(it.day + lag) });
      tplReturns.push({
        refund_id, processing_cost: round2(A.FEES.returnProcessingPerUnit * qty),
        return_label_cost: labelUsed ? 0 : round2(uniform(A.FEES.returnLabelMin, A.FEES.returnLabelMax)), restocked: rs === 'true',
      });
      labelUsed = true;
    }
  });
}

// ---------- customers table (only those who ordered in the window) ----------
const ordered = new Set(orders.map((o) => o.customer_id));
const shopifyCustomers: ShopifyCustomer[] = customers.filter((c) => ordered.has(c.id)).map((c) => ({
  customer_id: c.id,
  created_at: c.created >= 0 ? dayToDate(c.created) : dayToDate(c.created),
  acquisition_channel: c.channel,
}));

// ---------- QuickBooks opex (monthly) ----------
const opexMap = new Map<string, number>();
const addOpex = (month: string, account: string, amt: number) => opexMap.set(month + '|' + account, (opexMap.get(month + '|' + account) ?? 0) + amt);
const shipById = new Map(shipments.map((s) => [s.order_id, s]));
for (const o of orders) {
  const mo = o.created_at.slice(0, 7);
  addOpex(mo, 'Payment processing fees', A.FEES.paymentPct * (o.subtotal + o.shipping_charged) + A.FEES.paymentFixed);
  const s = shipById.get(o.order_id)!;
  addOpex(mo, '3PL outbound postage', s.outbound_cost);
  addOpex(mo, '3PL pick & pack', s.pick_pack_cost);
}
const refundById = new Map(refunds.map((r) => [r.refund_id, r]));
for (const t of tplReturns) {
  const mo = refundById.get(t.refund_id)!.refunded_at.slice(0, 7);
  addOpex(mo, '3PL returns processing', t.processing_cost);
  addOpex(mo, '3PL return labels', t.return_label_cost);
}
const opex: QbOpex[] = [...opexMap.entries()].map(([k, v]) => {
  const [month, account] = k.split('|');
  return { month, account, vendor: account.startsWith('Payment') ? 'Shopify Payments' : 'Northgate Fulfilment (3PL)', amount: round2(v) };
}).sort((a, b) => a.month.localeCompare(b.month) || a.account.localeCompare(b.account));

// ---------- inventory snapshot ----------
const DAYS = A.WINDOW.days;
const dailyUnits = new Map<string, number[]>();
for (const p of products) dailyUnits.set(p.sku, new Array(DAYS).fill(0));
for (const o of orders) {
  const d = Math.floor((Date.parse(o.created_at) - Date.parse(A.WINDOW.start + 'T00:00:00Z')) / 86400000);
  for (const l of o.line_items) dailyUnits.get(l.sku)![d] += l.qty;
}
const supplierOf = (code: string) => A.SUPPLIERS.find((s) => s.supplier_id === A.STYLES.find((x) => x.code === code)!.supplier)!;
const inventory: InventoryRow[] = products.map((p) => {
  const meta = skuMeta.get(p.sku)!;
  const series = dailyUnits.get(p.sku)!;
  const trailing = series.slice(DAYS - 91).reduce((a, b) => a + b, 0) / 13;
  let peak = 0;
  for (let d = 0; d + 56 <= DAYS; d += 7) peak = Math.max(peak, series.slice(d, d + 56).reduce((a, b) => a + b, 0) / 8);
  const sup = supplierOf(meta.style.code);
  let onHand: number;
  if (stockoutSet.has(p.sku)) onHand = Math.round(trailing * uniform(0.9, 1.7));
  else if (meta.style.code === 'KNT') onHand = Math.round(peak * (meta.color === A.SLOW_KNIT_COLOR ? uniform(31, 38) : uniform(9, 13)));
  else onHand = Math.round(Math.max(trailing, 1) * uniform(13, 21));
  return { sku: p.sku, on_hand: onHand, weekly_sales_velocity: round2(trailing), supplier: sup.supplier_id, lead_time_days: sup.lead_time_days, moq: sup.moq };
});
const stockouts: StockoutRow[] = A.STOCKOUTS.flatMap((s) => s.periods.map(([a, b]) => ({ sku: s.sku, out_of_stock_from: dayToDate(a), back_in_stock_at: dayToDate(b + 1) })));

// ---------- write ----------
mkdirSync(OUT, { recursive: true });
const raw: RawData = {
  shopify_orders: orders, shopify_refunds: refunds, shopify_products: products, shopify_customers: shopifyCustomers,
  quickbooks_cogs: cogs, quickbooks_opex: opex, threepl_shipments: shipments, threepl_returns: tplReturns,
  inventory, inventory_stockouts: stockouts, suppliers: A.SUPPLIERS,
};
for (const [k, v] of Object.entries(raw)) writeFileSync(join(OUT, `${k}.json`), JSON.stringify(v));

const planted = {
  note: 'Ground truth for the planted leaks. The agent did not read this file during its run.',
  leaks: [
    { id: 1, name: 'Fit-problem wrap dress', detail: `Wrap dress unit return probability ${Math.round(A.RETURNS.wrapFitReturn * 100)}% in M/L (reason mix 70% size_too_small) vs ${Math.round(A.RETURNS.wrapOtherReturn * 100)}% in other sizes; wrap restock ${Math.round(A.RETURNS.wrapRestockRate * 100)}%.`, expected_action: 'Pause M/L, send fit-spec revision to the factory; do not discontinue the style.' },
    { id: 2, name: 'Free-shipping threshold too low', detail: `Threshold $${A.SHIPPING.freeThreshold} vs ~$${Math.round(orders.reduce((a, o) => a + o.subtotal, 0) / orders.length)} AOV. $50–65 orders (TEE2FOR50 pairs at exactly $50, discounted single items) ship free and are CM-negative.`, expected_action: 'Raise the threshold (model several) with conversion trade-off stated.' },
    { id: 3, name: 'WELCOME30 cohort', detail: `${nWelcome} customers (~18%) acquired with 30% off. ${Math.round(A.CUSTOMERS.welcomeConverterShare * 100)}% are 'converter' personas who buy at full price if they return (repeat probability ${A.CUSTOMERS.welcomeConverterRepeatP}); the rest return only inside promo windows.`, expected_action: 'Raise the bar (15% or min basket), do not kill the code.' },
    { id: 4, name: 'Stockouts on core M/L', detail: 'Six chino/polo M/L SKUs with historical stockouts and <2 weeks cover vs 42–60 day lead times.', skus: A.STOCKOUTS.map((s) => s.sku), lost_demand_line_choices_true: Object.fromEntries(lostDemand), substitution_rate: A.STOCKOUT_SUBSTITUTION, note_lost: 'line choices hitting a stockout; ~25% of these were substituted to another colour, the rest were lost', expected_action: 'Draft POs respecting lead time, safety stock and MOQ.' },
    { id: 5, name: 'Decoy: loss-leader tee', detail: 'Core tee priced at ~32% GM with an evergreen 2-for-$50 multi-buy: slightly negative on allocated CM, but added to fuller baskets (attach probability rises with basket size) that carry well-above-average CM. Tee-only pairs at $50 ship free and are where the loss sits.', expected_action: 'Keep, with rationale.' },
    { id: 6, name: 'Slow knitwear colourway', detail: `Merino Crew in ${A.SLOW_KNIT_COLOR}: >30 weeks of cover even at peak-season velocity.`, expected_action: 'Markdown or bundle; do not reorder.' },
  ],
};
writeFileSync(join(OUT, 'planted.json'), JSON.stringify(planted, null, 2));
console.log(`wrote ${orders.length} orders, ${refunds.length} refund rows, ${shopifyCustomers.length} customers, ${products.length} SKUs`);
