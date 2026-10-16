// The agent's only window into Fernhollow's data. Every invocation appends a
// trace entry to agent/trace.jsonl and writes the full output to agent/outputs/<step>.json.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw } from '../data-gen/summary';
import { SHIPPING } from '../data-gen/assumptions';
import { SOURCES } from './sources';
import {
  buildModel, evaluate, DEFAULT_PARAMS, waterfallBy, topLeaks, waterfallSteps, cohortSummary, basketAttach,
  inventoryStatus, runScenario, DIMENSIONS, fmt$, fmtPct, type Dim, type Filter, type Params, type Action, type Model,
} from '../engine';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENT = join(ROOT, 'agent');
const TRACE = join(AGENT, 'trace.jsonl');
const OUTPUTS = join(AGENT, 'outputs');
const PROPOSALS = join(AGENT, 'proposals.json');
mkdirSync(OUTPUTS, { recursive: true });

type TraceEntry = { step: number; ts: string; type: string; tool: string; args: Record<string, unknown>; output_summary: string; output_ref: string | null; evidence?: number[] };

function readTrace(): TraceEntry[] {
  if (!existsSync(TRACE)) return [];
  return readFileSync(TRACE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
function log(type: string, tool: string, args: Record<string, unknown>, summary: string, output: unknown, evidence?: number[]) {
  const step = readTrace().length + 1;
  let ref: string | null = null;
  if (output !== undefined) {
    ref = `outputs/${step}.json`;
    writeFileSync(join(AGENT, ref), JSON.stringify(output, (_, v) => (v === Infinity ? 'Infinity' : v), 2));
  }
  const entry: TraceEntry = { step, ts: new Date().toISOString(), type, tool, args, output_summary: summary, output_ref: ref, ...(evidence ? { evidence } : {}) };
  appendFileSync(TRACE, JSON.stringify(entry) + '\n');
  console.log(`[step ${step}] ${tool}: ${summary}`);
  if (output !== undefined) console.log(JSON.stringify(output, (_, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v), 2).slice(0, 6000));
}

// ---- arg parsing ----
const argv = process.argv.slice(2);
const cmd = argv[0];
const positional: string[] = [];
const flags: Record<string, string> = {};
for (let i = 1; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = argv[i + 1] ?? 'true'; i++; } else positional.push(argv[i]);
}
const parseEvidence = (s?: string) => (s ? s.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n)) : []);
function checkEvidence(ev: number[]) {
  const n = readTrace().length;
  const bad = ev.filter((e) => e < 1 || e > n);
  if (bad.length) { console.error(`evidence steps not in trace: ${bad.join(',')}`); process.exit(1); }
}

let _m: Model | null = null;
const model = () => (_m ??= buildModel(loadRaw(), SHIPPING.freeThreshold, SHIPPING.flatRateCharged));
function params(m: Model): Params {
  const p = DEFAULT_PARAMS(m);
  if (flags.allocation) p.allocation = flags.allocation as Params['allocation'];
  if (flags['return-mult']) p.returnMultiplier = parseFloat(flags['return-mult']);
  if (flags.freight) p.freightPerOrder = parseFloat(flags.freight);
  if (flags.threshold) p.threshold = parseFloat(flags.threshold);
  return p;
}
const paramArgs = () => Object.fromEntries(['allocation', 'return-mult', 'freight', 'threshold'].filter((k) => flags[k]).map((k) => [k, flags[k]]));
function parseFilter(s?: string): Filter | undefined {
  if (!s) return undefined;
  const f: Filter = {};
  for (const kv of s.split(';')) { const [k, v] = kv.split('='); if (!DIMENSIONS.includes(k as Dim)) throw new Error(`unknown filter dim ${k}`); f[k as Dim] = v; }
  return f;
}
const r2 = (x: number) => Math.round(x * 100) / 100;
const roundWf = <T extends Record<string, unknown>>(w: T) => Object.fromEntries(Object.entries(w).map(([k, v]) => [k, typeof v === 'number' ? (k.endsWith('Pct') || k.endsWith('Rate') ? Math.round(v * 10000) / 10000 : r2(v)) : v]));

function main() {
  switch (cmd) {
    case 'list_sources': {
      const raw = loadRaw();
      const out = Object.entries(SOURCES).map(([name, s]) => ({ table: name, system: s.system, rows: (raw as Record<string, unknown[]>)[name].length, description: s.desc }));
      log('tool', 'list_sources', {}, `${out.length} tables across Shopify, QuickBooks, 3PL, Inventory`, out);
      break;
    }
    case 'describe_table': {
      const name = positional[0];
      const s = SOURCES[name];
      if (!s) throw new Error(`unknown table ${name}`);
      const rows = (loadRaw() as Record<string, Record<string, unknown>[]>)[name];
      // --where col=val (val may end in * for prefix match; comma = OR); returns up to 50 matching rows
      let matched: Record<string, unknown>[] | undefined;
      if (flags.where) {
        const [col, vals] = flags.where.split('=');
        const opts = vals.split(',');
        matched = rows.filter((r) => opts.some((v) => (v.endsWith('*') ? String(r[col]).startsWith(v.slice(0, -1)) : String(r[col]) === v))).slice(0, 50);
      }
      log('tool', 'describe_table', { name, ...(flags.where ? { where: flags.where } : {}) }, `${name}: ${rows.length} rows, ${Object.keys(s.fields).length} fields${matched ? `; ${matched.length} rows where ${flags.where}` : ''}`, { table: name, system: s.system, rows: rows.length, description: s.desc, fields: s.fields, ...(matched ? { matched } : { sample: rows.slice(0, 2) }) });
      break;
    }
    case 'margin_waterfall': {
      const m = model(); const p = params(m); const r = evaluate(m, p);
      const by = (flags.by && flags.by !== 'company' ? flags.by : null) as Dim | null;
      const filter = parseFilter(flags.filter);
      const groups = waterfallBy(m, r, by, filter).sort((a, b) => b.netRevenue - a.netRevenue);
      const out = { params: p, by: by ?? 'company', filter: filter ?? null, groups: groups.map((g) => ({ ...roundWf(g), steps: by ? undefined : waterfallSteps(g).map((s) => ({ ...s, value: r2(s.value) })) })) };
      const top = groups[0];
      const summary = by
        ? `${groups.length} groups by ${by}${filter ? ` (filter ${flags.filter})` : ''}; lowest CM%: ${[...groups].sort((a, b) => a.cmPct - b.cmPct).slice(0, 3).map((g) => `${g.key} ${fmtPct(g.cmPct)}`).join(', ')}`
        : `${filter ? flags.filter + ': ' : 'Company: '}gross ${fmt$(top.gross)}, net revenue ${fmt$(top.netRevenue)}, CM ${fmt$(top.cm)} (${fmtPct(top.cmPct)}), return rate ${fmtPct(top.returnRate)}`;
      log('tool', 'margin_waterfall', { by: flags.by ?? 'company', ...(flags.filter ? { filter: flags.filter } : {}), ...paramArgs() }, summary, out);
      break;
    }
    case 'top_leaks': {
      const m = model(); const p = params(m); const r = evaluate(m, p);
      const by = flags.by as Dim; const n = parseInt(flags.n ?? '10', 10);
      const rows = topLeaks(m, r, by, n).map((g) => ({ key: g.key, cm: r2(g.cm), cm_pct: Math.round(g.cmPct * 10000) / 10000, net_revenue: r2(g.netRevenue), units: Math.round(g.units), return_rate: Math.round(g.returnRate * 1000) / 1000, orders: g.orders }));
      const neg = rows.filter((x) => x.cm < 0);
      log('tool', 'top_leaks', { by, n, ...paramArgs() }, `${neg.length} of top ${rows.length} ${by} groups are CM-negative; worst: ${rows.slice(0, 3).map((x) => `${x.key} ${fmt$(x.cm)}`).join(', ')}`, { params: p, by, rows });
      break;
    }
    case 'cohort_summary': {
      const m = model(); const p = params(m); const r = evaluate(m, p);
      const by = (flags.by ?? 'code') as 'code' | 'channel';
      const rows = cohortSummary(m, r, by).map((x) => roundWf(x));
      log('tool', 'cohort_summary', { by, ...paramArgs() }, rows.map((x) => `${x.cohort}: ${fmt$(x.value_cm_per_customer_tenure_matched as number)} CM/cust (tenure-matched), repeat ${fmtPct(x.repeat_rate_tenure_matched as number)}, FP conversion ${fmtPct(x.full_price_conversion as number)}`).join('; '), { params: p, by, note: 'New customers only. Tenure-matched = acquired Oct–Mar (6–12 months observed). Discounted = promo code (TEE2FOR50 multi-buy excluded).', rows });
      break;
    }
    case 'basket_attach': {
      const m = model(); const p = params(m); const r = evaluate(m, p);
      const b = basketAttach(m, r, p, flags.sku);
      log('tool', 'basket_attach', { sku: flags.sku, ...paramArgs() }, `${flags.sku}: in ${fmtPct(b.attach_rate_mixed_baskets)} of mixed multi-item baskets (avg ${fmt$(b.mixed_with.avg_order_cm, 2)} CM/order vs ${fmt$(b.mixed_without.avg_order_cm, 2)} without); ${fmtPct(b.share_of_units_in_orders_with_only_this_item)} of units in only-this-item orders (avg ${fmt$(b.only_this_item_orders_avg_cm, 2)}/order); allocated CM ${fmt$(b.allocated_cm[p.allocation])}, incremental CM if removed ${fmt$(b.incremental_cm_if_removed)}`, b);
      break;
    }
    case 'returns_breakdown': {
      const m = model(); const p = params(m); const r = evaluate(m, p);
      const style = flags.style;
      const raw = loadRaw();
      const styleSkus = new Set(m.skus.filter((s) => s.style === style).map((s) => s.sku));
      const bySize = waterfallBy(m, r, 'size', { style }).map((g) => ({ size: g.key, units: Math.round(g.units), returned: Math.round(g.returnedUnits), return_rate: Math.round(g.returnRate * 1000) / 1000, cm: r2(g.cm), cm_pct: Math.round(g.cmPct * 1000) / 1000 }));
      const sizeOf = new Map(m.skus.map((s) => [s.sku, s.size]));
      const reasons: Record<string, Record<string, number>> = {};
      for (const f of raw.shopify_refunds) {
        if (!styleSkus.has(f.sku)) continue;
        const sz = sizeOf.get(f.sku)!;
        reasons[sz] ??= {};
        reasons[sz][f.reason] = (reasons[sz][f.reason] ?? 0) + f.qty;
      }
      const order = ['XS', 'S', 'M', 'L', 'XL'];
      bySize.sort((a, b) => order.indexOf(a.size) - order.indexOf(b.size));
      const rows = bySize.map((s) => {
        const rs = reasons[s.size] ?? {};
        const tot = Object.values(rs).reduce((a, b) => a + b, 0);
        return { ...s, reasons: Object.fromEntries(Object.entries(rs).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round((v / tot) * 1000) / 1000])) };
      });
      const worst = [...rows].sort((a, b) => b.return_rate - a.return_rate).slice(0, 2);
      log('tool', 'returns_breakdown', { style, by: flags.by ?? 'size,reason', ...paramArgs() }, `${style}: ${worst.map((w) => `${w.size} returns ${fmtPct(w.return_rate)} (top reason ${Object.keys(w.reasons)[0]} ${fmtPct(Object.values(w.reasons)[0] as number)}), CM ${fmt$(w.cm)}`).join('; ')}`, { params: p, style, rows });
      break;
    }
    case 'order_value_bands': {
      const m = model(); const p = params(m); const r = evaluate(m, p);
      const width = parseFloat(flags.width ?? '10');
      const cap = 300;
      const bands = new Map<number, { orders: number; sub: number; cm: number; net: number; free: number; units: number }>();
      const orderNet = new Float64Array(m.nOrders);
      for (let l = 0; l < m.nLines; l++) orderNet[m.lOrder[l]] += r.gross[l] - r.discounts[l] - r.refunds[l];
      for (let o = 0; o < m.nOrders; o++) {
        const b = Math.min(cap, Math.floor(m.oSubtotal[o] / width) * width);
        const g = bands.get(b) ?? { orders: 0, sub: 0, cm: 0, net: 0, free: 0, units: 0 };
        g.orders++; g.sub += m.oSubtotal[o]; g.cm += r.orderCm[o]; g.net += orderNet[o]; g.units += m.oUnits[o];
        if (r.orderShipCharged[o] === 0) g.free++;
        bands.set(b, g);
      }
      const rows = [...bands.entries()].sort((a, b) => a[0] - b[0]).map(([b, g]) => ({ band: b >= cap ? `$${cap}+` : `$${b}–${b + width}`, orders: g.orders, avg_subtotal: r2(g.sub / g.orders), avg_units: r2(g.units / g.orders), free_shipping_share: Math.round((g.free / g.orders) * 1000) / 1000, cm: r2(g.cm), cm_per_order: r2(g.cm / g.orders), cm_pct: Math.round((g.cm / g.net) * 1000) / 1000 }));
      const neg = rows.filter((x) => x.cm < 0);
      log('tool', 'order_value_bands', { width, ...paramArgs() }, `threshold $${p.threshold}; CM-negative bands: ${neg.map((x) => `${x.band} (${x.orders} orders, ${fmt$(x.cm_per_order, 2)}/order)`).join(', ') || 'none'}`, { params: p, rows });
      break;
    }
    case 'inventory_status': {
      const m = model();
      let rows = inventoryStatus(m);
      const below = flags['below-cover-weeks'] ? parseFloat(flags['below-cover-weeks']) : null;
      if (below !== null) rows = rows.filter((x) => x.weeks_cover < below);
      if (flags.flag) rows = rows.filter((x) => x.flag === flags.flag);
      if (flags.style) rows = rows.filter((x) => x.style === flags.style);
      const reorder = rows.filter((x) => x.flag === 'reorder'), over = rows.filter((x) => x.flag === 'overstock');
      log('tool', 'inventory_status', { ...(below !== null ? { 'below-cover-weeks': below } : {}), ...(flags.flag ? { flag: flags.flag } : {}), ...(flags.style ? { style: flags.style } : {}) },
        `${rows.length} SKUs; ${reorder.length} below reorder point (${reorder.slice(0, 6).map((x) => `${x.sku} ${x.weeks_cover}w`).join(', ')}); ${over.length} overstocked`, { as_of: '2026-09-30', rows });
      break;
    }
    case 'scenario': {
      const m = model(); const p = params(m);
      const file = JSON.parse(readFileSync(flags.actions, 'utf8')) as { actions: Action[] };
      const res = runScenario(m, p, file.actions);
      log('tool', 'scenario', { actions: flags.actions, ids: file.actions.map((a) => a.id), ...paramArgs() }, `${file.actions.map((a) => a.id).join('+')}: combined Δ ${fmt$(res.combined_delta)} / yr (${res.actions.map((a) => `${a.id} ${fmt$(a.annual_contribution_delta)}`).join(', ')}; interaction ${fmt$(res.interaction)})`, { params: p, actions: file.actions, result: res });
      break;
    }
    case 'note': case 'hypothesis': case 'conclude': case 'check': {
      const text = positional.join(' ');
      const ev = parseEvidence(flags.evidence);
      if ((cmd === 'check' || cmd === 'conclude') && !ev.length) { console.error(`${cmd} requires --evidence`); process.exit(1); }
      checkEvidence(ev);
      log(cmd, cmd, { text, ...(ev.length ? { evidence: ev } : {}) }, text, undefined, ev.length ? ev : undefined);
      break;
    }
    case 'propose': {
      const prop = JSON.parse(readFileSync(flags.file, 'utf8'));
      const errs: string[] = [];
      const req = ['id', 'title', 'type', 'target_system', 'payload', 'impact', 'evidence_steps', 'risks', 'checks_performed', 'confidence'];
      for (const k of req) if (prop[k] === undefined) errs.push(`missing ${k}`);
      const types = ['discontinue_sku', 'change_discount_rule', 'change_shipping_threshold', 'create_po', 'fix_fit_and_pause', 'markdown', 'keep_with_rationale'];
      if (!types.includes(prop.type)) errs.push(`bad type ${prop.type}`);
      if (!['shopify', 'quickbooks', '3pl', 'supplier_email'].includes(prop.target_system)) errs.push('bad target_system');
      if (!['high', 'medium', 'low'].includes(prop.confidence)) errs.push('bad confidence');
      const trace = readTrace();
      const ev: number[] = prop.evidence_steps ?? [];
      if (ev.some((e: number) => e < 1 || e > trace.length)) errs.push('evidence step not in trace');
      // Impact must come from a scenario step, never typed by hand.
      const mm = /scenario step (\d+)/.exec(prop.impact?.method ?? '');
      if (!mm) errs.push('impact.method must reference "scenario step N"');
      else {
        const st = trace[parseInt(mm[1], 10) - 1];
        if (!st || st.tool !== 'scenario') errs.push(`step ${mm[1]} is not a scenario step`);
        else {
          const out = JSON.parse(readFileSync(join(AGENT, st.output_ref!), 'utf8'));
          const a = out.result.actions.find((x: { id: string }) => x.id === prop.id);
          if (!a) errs.push(`scenario step ${mm[1]} has no action ${prop.id}`);
          else if (a.annual_contribution_delta !== prop.impact.annual_contribution_delta) errs.push(`impact ${prop.impact.annual_contribution_delta} does not match scenario step ${mm[1]} (${a.annual_contribution_delta})`);
          else prop.scenario_action = out.actions.find((x: { id: string }) => x.id === prop.id);
          if (!ev.includes(parseInt(mm[1], 10))) ev.push(parseInt(mm[1], 10));
        }
      }
      if (errs.length) { console.error('REJECTED proposal:\n - ' + errs.join('\n - ')); process.exit(1); }
      const list = existsSync(PROPOSALS) ? JSON.parse(readFileSync(PROPOSALS, 'utf8')) : [];
      if (list.some((x: { id: string }) => x.id === prop.id)) { console.error(`proposal ${prop.id} already exists`); process.exit(1); }
      const rec = { ...prop, evidence_steps: ev, status: 'pending', proposed_at: new Date().toISOString() };
      list.push(rec);
      writeFileSync(PROPOSALS, JSON.stringify(list, null, 2));
      log('propose', 'propose', { file: flags.file, id: prop.id }, `${prop.id} ${prop.title} → ${prop.target_system} (pending approval; Δ ${fmt$(prop.impact.annual_contribution_delta)}/yr, ${prop.confidence})`, rec, ev);
      break;
    }
    default:
      console.log('commands: list_sources | describe_table <t> | margin_waterfall --by <dim> [--filter k=v;k=v] | top_leaks --by <dim> --n N | cohort_summary --by code|channel | basket_attach --sku <sku|style code> | returns_breakdown --style <style> --by size,reason | order_value_bands --width 10 | inventory_status [--below-cover-weeks N] [--flag reorder|overstock] | scenario --actions <file> | note|hypothesis "<t>" | check|conclude "<t>" --evidence a,b | propose --file <p.json>');
      console.log('global: --allocation revenue|units --return-mult x --freight $ --threshold $');
    
  }
}
main();
