// Phase 5 verification. Independent re-implementation from the RAW tables (no engine
// imports for the hand recompute), compared to the engine the UI runs, to the cent.
import { readFileSync } from 'node:fs';
import { loadRaw } from '../data-gen/summary';
import { SHIPPING } from '../data-gen/assumptions';
import { buildModel, evaluate, DEFAULT_PARAMS, waterfallBy } from '../engine';

let fail = 0;
const ok = (n: string, p: boolean, d = '') => { if (!p) fail++; console.log(`${p ? 'PASS' : 'FAIL'} ${n} ${d}`); };
const raw = loadRaw();
const m = buildModel(raw, SHIPPING.freeThreshold, SHIPPING.flatRateCharged);
const r = evaluate(m, DEFAULT_PARAMS(m));
const engineSku = new Map(waterfallBy(m, r, 'sku').map((w) => [w.key, w]));

function hand(sku: string) {
  const landed = raw.quickbooks_cogs.find((c) => c.sku === sku)!.landed_cost;
  const price = new Map(raw.shopify_products.map((p) => [p.sku, p.list_price]));
  const ship = new Map(raw.threepl_shipments.map((s) => [s.order_id, s]));
  const tpl = new Map(raw.threepl_returns.map((t) => [t.refund_id, t]));
  const refundsByOrder = new Map<string, typeof raw.shopify_refunds>();
  for (const f of raw.shopify_refunds) { const a = refundsByOrder.get(f.order_id) ?? []; a.push(f); refundsByOrder.set(f.order_id, a); }
  const t = { gross: 0, disc: 0, refunds: 0, cogs: 0, wo: 0, fees: 0, ship: 0, pick: 0, ret: 0 };
  for (const o of raw.shopify_orders) {
    const idx = o.line_items.findIndex((l) => l.sku === sku);
    if (idx < 0) continue;
    // discount allocation by gross share in cents, last line takes the remainder
    const g = o.line_items.map((l) => Math.round(price.get(l.sku)! * 100) * l.qty);
    const G = g.reduce((a, b) => a + b, 0);
    const D = Math.round(o.discount_amount * 100);
    let used = 0; const dc = g.map((x, i) => { if (i === g.length - 1) return D - used; const c = Math.round((D * x) / G); used += c; return c; });
    const lineNet = (g[idx] - dc[idx]) / 100;
    const share = lineNet / o.subtotal;
    const l = o.line_items[idx];
    const refs = refundsByOrder.get(o.order_id) ?? [];
    const mine = refs.filter((f) => f.sku === sku);
    const retQty = mine.reduce((a, f) => a + f.qty, 0);
    const notRestocked = mine.reduce((a, f) => a + (tpl.get(f.refund_id)!.restocked ? 0 : f.qty), 0);
    const orderRetUnits = refs.reduce((a, f) => a + f.qty, 0);
    const orderLabel = refs.reduce((a, f) => a + tpl.get(f.refund_id)!.return_label_cost, 0);
    const s = ship.get(o.order_id)!;
    t.gross += g[idx] / 100; t.disc += dc[idx] / 100;
    t.refunds += mine.reduce((a, f) => a + f.amount, 0);
    t.cogs += (l.qty - retQty) * landed; t.wo += notRestocked * landed;
    t.fees += 0.029 * lineNet + share * (0.3 + 0.029 * o.shipping_charged);
    t.ship += share * (s.outbound_cost - o.shipping_charged);
    t.pick += share * s.pick_pack_cost;
    t.ret += mine.reduce((a, f) => a + tpl.get(f.refund_id)!.processing_cost, 0) + (orderRetUnits ? (orderLabel * retQty) / orderRetUnits : 0);
  }
  const cm = t.gross - t.disc - t.refunds - t.cogs - t.wo - t.fees - t.ship - t.pick - t.ret;
  return { ...t, cm };
}
for (const sku of ['TEE-WHI-M', 'WRP-BLA-L', 'CHN-KHA-M']) {
  const h = hand(sku), e = engineSku.get(sku)!;
  const pairs: [string, number, number][] = [['gross', h.gross, e.gross], ['discounts', h.disc, e.discounts], ['refunds', h.refunds, e.refunds], ['cogs', h.cogs, e.cogs], ['writeoffs', h.wo, e.writeoffs], ['fees', h.fees, e.fees], ['shipping', h.ship, e.shipping], ['pickpack', h.pick, e.pickpack], ['returnCosts', h.ret, e.returnCosts], ['CM', h.cm, e.cm]];
  const bad = pairs.filter(([, a, b]) => Math.abs(a - b) >= 0.005);
  ok(`spot-check ${sku} matches to the cent`, bad.length === 0, `hand CM ${h.cm.toFixed(2)} vs engine ${e.cm.toFixed(2)}${bad.length ? ' mismatched: ' + bad.map((b) => b[0]).join(',') : ''}`);
}

// evidence links resolve to real trace steps
const trace = readFileSync('agent/trace.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const props = JSON.parse(readFileSync('agent/proposals.json', 'utf8'));
for (const p of props) {
  const missing = p.evidence_steps.filter((s: number) => !trace[s - 1] || trace[s - 1].step !== s);
  ok(`${p.id} evidence steps resolve`, missing.length === 0, `${p.evidence_steps.length} steps${missing.length ? ' missing ' + missing : ''}`);
}
for (const t of trace) if (t.evidence) { const bad = t.evidence.filter((s: number) => s >= t.step); if (bad.length) ok(`step ${t.step} cites only earlier steps`, false, String(bad)); }

// bundle hygiene
const html = readFileSync('dist/index.html', 'utf8');
ok('bundle has no "real customer"', !/real customer/i.test(html));
ok('bundle has no API keys', !/(sk-[A-Za-z0-9]{20,}|api[_-]?key|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,})/i.test(html));
ok('bundle has no local paths', !/\/Users\/|\/private\/tmp|\/home\//.test(html));
ok('bundle has no external URLs loaded', !/<(script|link)[^>]+(src|href)=["']https?:/i.test(html));
ok('bundle under 8MB', html.length < 8e6, `${(html.length / 1e6).toFixed(2)} MB`);
process.exit(fail ? 1 : 0);
