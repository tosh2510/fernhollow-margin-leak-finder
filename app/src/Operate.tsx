import { useMemo, useState } from 'react';
import { waterfallBy, waterfallSteps, fmt$, fmtPct, type Dim, type EvalResult, type Params, type ScenarioResult, type Waterfall } from '../../engine';
import { ENGINE } from '../../data-gen/assumptions';
import { model, proposals, makeRule, type Decision, type Proposal, type Rule } from './data';
import type { Sensitivity } from './App';

const DIMS: [Dim | 'company', string][] = [['company', 'Company'], ['style', 'Style'], ['sku', 'SKU'], ['size', 'Size'], ['band', 'Order value'], ['cohort', 'Cohort'], ['code', 'Discount code'], ['channel', 'Channel'], ['month', 'Month']];

export function WaterfallChart({ w }: { w: Waterfall }) {
  const steps = waterfallSteps(w);
  const max = Math.max(w.gross, 1);
  let run = 0;
  return (
    <div role="img" aria-label={`Contribution margin waterfall for ${w.key}`}>
      {steps.map((s, i) => {
        let x0: number, x1: number;
        if (s.kind === 'total') { x0 = Math.min(0, s.value); x1 = Math.max(0, s.value); run = s.value; } else { x0 = run + s.value; x1 = run; run += s.value; }
        const neg = s.kind === 'total' && s.value < 0;
        const left = Math.max(0, (Math.min(x0, x1) / max) * 100);
        const width = Math.max(0.4, (Math.abs(x1 - x0) / max) * 100);
        const color = s.kind === 'total' ? (neg ? 'var(--neg)' : 'var(--accent)') : 'var(--bar-deduct)';
        return (
          <div key={i} className={`wf-row ${s.kind}`} title={`${s.label}: ${fmt$(s.value)} (${w.netRevenue ? fmtPct(s.value / w.netRevenue) : '–'} of net revenue)`}>
            <span className="lbl">{s.kind === 'delta' ? '− ' : ''}{s.label}</span>
            <div className="wf-track">
              <div style={{ position: 'absolute', left: `${left}%`, width: `${width}%`, top: 2, bottom: 2, background: color, borderRadius: 3 }} />
            </div>
            <span className={`v ${neg ? 'negc' : ''}`} style={{ fontWeight: s.kind === 'total' ? 600 : 400 }}>{fmt$(s.value)}</span>
            <span className="p">{w.netRevenue && i >= 3 ? fmtPct(s.value / w.netRevenue) : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

function Sliders({ params, setParams }: { params: Params; setParams: (p: Params) => void }) {
  const R = ENGINE.sliderRanges;
  return (
    <div className="card">
      <div className="card-h"><h3>Assumptions</h3><span className="small muted">Re-runs the margin engine in your browser</span></div>
      <div className="card-b">
        <div className="slider">
          <span>Return rate multiplier</span>
          <input type="range" min={R.returnMultiplier[0]} max={R.returnMultiplier[1]} step={R.returnMultiplier[2]} value={params.returnMultiplier} onChange={(e) => setParams({ ...params, returnMultiplier: +e.target.value })} aria-label="Return rate multiplier" />
          <span className="v">×{params.returnMultiplier.toFixed(2)}</span>
        </div>
        <div className="slider">
          <span>Freight per order (avg)</span>
          <input type="range" min={R.freightPerOrder[0]} max={R.freightPerOrder[1]} step={R.freightPerOrder[2]} value={params.freightPerOrder ?? model.avgOutbound} onChange={(e) => setParams({ ...params, freightPerOrder: +e.target.value })} aria-label="Freight per order" />
          <span className="v">${(params.freightPerOrder ?? model.avgOutbound).toFixed(2)}</span>
        </div>
        <div className="slider">
          <span>Free-shipping threshold</span>
          <input type="range" min={R.freeShippingThreshold[0]} max={R.freeShippingThreshold[1]} step={R.freeShippingThreshold[2]} value={params.threshold} onChange={(e) => setParams({ ...params, threshold: +e.target.value })} aria-label="Free-shipping threshold" />
          <span className="v">${params.threshold}</span>
        </div>
        <div className="slider">
          <span>Order-cost allocation</span>
          <div className="seg" role="group" aria-label="Allocation method">
            {(['revenue', 'units'] as const).map((a) => <button key={a} className={params.allocation === a ? 'on' : ''} onClick={() => setParams({ ...params, allocation: a })}>{a === 'revenue' ? 'Revenue share' : 'Units'}</button>)}
          </div>
          <span />
        </div>
        <p className="small muted" style={{ margin: '8px 0 0' }}>
          Order-level costs (net outbound shipping, pick-pack, fixed payment fee) are spread across lines by {params.allocation === 'revenue' ? 'line net sales' : 'units'}. Allocation changes which slice looks like a leak, never the company total or a proposal's incremental impact. The threshold slider is the what-if baseline; an approved P-002 overrides it.
        </p>
      </div>
    </div>
  );
}

const QUICK = ['core product', 'brand reasons', 'bad data', 'timing'];

function PayloadView({ p }: { p: Proposal }) {
  const pay = p.payload as Record<string, unknown>;
  if (p.type === 'create_po') {
    const pos = pay.purchase_orders as { supplier: string; eta_if_issued_2026_09_30?: string; lines: { sku: string; qty: number; unit_fob: number; needed_by: string }[]; [k: string]: unknown }[];
    return (
      <div>
        {pos.map((po, i) => {
          const total = po.lines.reduce((a, l) => a + l.qty * l.unit_fob, 0);
          const units = po.lines.reduce((a, l) => a + l.qty, 0);
          return (
            <div key={i} style={{ margin: '8px 0' }}>
              <div className="small"><b>{po.supplier}</b> · ETA if issued 30 Sep: {String(po['eta_if_issued_2026-09-30'])}</div>
              <table className="t"><thead><tr><th>SKU</th><th className="num">Qty</th><th className="num">FOB</th><th className="num">Extended</th><th>Needed by</th></tr></thead>
                <tbody>{po.lines.map((l) => <tr key={l.sku}><td className="mono">{l.sku}</td><td className="num">{l.qty}</td><td className="num">{fmt$(l.unit_fob, 2)}</td><td className="num">{fmt$(l.qty * l.unit_fob, 2)}</td><td>{l.needed_by}</td></tr>)}
                  <tr><td><b>Total</b></td><td className="num"><b>{units}</b></td><td /><td className="num"><b>{fmt$(total, 2)}</b></td><td /></tr></tbody></table>
            </div>
          );
        })}
        <pre className="json">{JSON.stringify(p.payload, null, 2)}</pre>
      </div>
    );
  }
  if (p.type === 'markdown') {
    const w = (pay.writes as { op: string; compare_at_price?: number; price_multiplier?: number }[]).find((x) => x.op === 'variant.schedule_price');
    return (
      <div>
        {w?.compare_at_price && w.price_multiplier && <div className="small">Price {fmt$(w.compare_at_price, 2)} → <b>{fmt$(w.compare_at_price * w.price_multiplier, 2)}</b> (computed from payload)</div>}
        <pre className="json">{JSON.stringify(p.payload, null, 2)}</pre>
      </div>
    );
  }
  return <pre className="json">{JSON.stringify(p.payload, null, 2)}</pre>;
}

function ProposalCard({ p, liveDelta, liveDetail, decision, decide, sens, showEvidence }: {
  p: Proposal; liveDelta: number; liveDetail: Record<string, number | string>; decision?: Decision;
  decide: (id: string, d: Decision | null, rule?: Rule) => void; sens?: Sensitivity[string]; showEvidence: (id: string) => void;
}) {
  const [showPayload, setShowPayload] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [quick, setQuick] = useState('');
  const [text, setText] = useState('');
  const st = decision?.status ?? 'pending';
  const recorded = p.impact.annual_contribution_delta;
  const isKeep = p.type === 'keep_with_rationale';
  return (
    <div className={`prop ${st}`}>
      <div className="prop-h">
        <div>
          <h4>{p.id} · {p.title}</h4>
          <div className="row small">
            <span className="badge">{p.type}</span>
            <span className="badge">→ {p.target_system}</span>
            <span className={`badge ${p.confidence === 'high' ? 'accent' : p.confidence === 'low' ? 'warn' : ''}`}>{p.confidence} confidence</span>
            {sens?.flips && <span className="badge warn" title={`Sign flips at: ${sens.detail.join(', ')}`}>assumption-sensitive</span>}
            {st !== 'pending' && <span className={`badge ${st === 'approved' ? 'accent' : 'neg'}`}>{st}</span>}
          </div>
        </div>
        <div className="impact">
          <div className="small muted">annual CM impact</div>
          <div className={`big ${liveDelta > 0 ? 'pos' : liveDelta < 0 ? 'negc' : ''}`}>{isKeep ? '$0' : `${liveDelta > 0 ? '+' : ''}${fmt$(liveDelta)}`}</div>
          {isKeep ? <div className="small muted">cutting it: {fmt$(liveDetail.counterfactual_cut_delta as number)}</div>
            : liveDelta !== recorded && <div className="small muted">recorded {fmt$(recorded)}</div>}
        </div>
      </div>
      <div className="prop-b">
        <ul className="risks">{p.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
        <div className="small muted">Checks: {p.checks_performed.join(' · ')}</div>
        {sens && <div className="small muted">Range across slider extremes: {fmt$(sens.range[0])} to {fmt$(sens.range[1])}{isKeep ? ' (avoided loss)' : ''}</div>}
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn ghost" onClick={() => setShowPayload(!showPayload)}>{showPayload ? 'Hide payload' : 'Show payload'}</button>
          <button className="btn ghost" onClick={() => showEvidence(p.id)}>Show evidence ({p.evidence_steps.length} steps)</button>
          <span style={{ flex: 1 }} />
          {st === 'pending' ? (
            <>
              <button className="btn danger" onClick={() => setRejecting(true)}>Reject</button>
              <button className="btn primary" onClick={() => decide(p.id, { status: 'approved', ts: new Date().toISOString() })}>Approve</button>
            </>
          ) : <button className="btn" onClick={() => decide(p.id, null)}>Undo</button>}
        </div>
        {showPayload && <PayloadView p={p} />}
        {st === 'approved' && <div className="queued">Queued for write → {p.target_system} (not executed in demo){isKeep ? ' · no-op: tag only' : ''}</div>}
        {st === 'rejected' && <div className="small" style={{ marginTop: 8 }}>Rejected: {decision?.quick}{decision?.reason ? ` · “${decision.reason}”` : ''}. Saved as a policy rule (Learn tab).</div>}
        {rejecting && st === 'pending' && (
          <div className="rejbox">
            <div className="small" style={{ marginBottom: 6 }}><b>Why?</b> (required; becomes a policy rule)</div>
            <div className="row" style={{ marginBottom: 6 }}>{QUICK.map((q) => <button key={q} className={`chip ${quick === q ? 'on' : ''}`} onClick={() => setQuick(q)}>{q}</button>)}</div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Reason (free text)" aria-label="Rejection reason" />
            <div className="row" style={{ marginTop: 6, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setRejecting(false)}>Cancel</button>
              <button className="btn danger" disabled={!quick && !text.trim()} onClick={() => { decide(p.id, { status: 'rejected', quick: quick || 'other', reason: text.trim(), ts: new Date().toISOString() }, makeRule(p, quick, text.trim())); setRejecting(false); }}>Reject and save rule</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Operate({ params, setParams, base, live, decisions, decide, sens, showEvidence }: {
  params: Params; setParams: (p: Params) => void; base: EvalResult; live: ScenarioResult; decisions: Record<string, Decision>;
  decide: (id: string, d: Decision | null, rule?: Rule) => void; sens: Sensitivity | null; showEvidence: (id: string) => void;
}) {
  const [dim, setDim] = useState<Dim | 'company'>('style');
  const [sel, setSel] = useState<string | null>(null);
  const company = useMemo(() => waterfallBy(model, base, null)[0], [base]);
  const slices = useMemo(() => (dim === 'company' ? [] : waterfallBy(model, base, dim).sort((a, b) => a.cm - b.cm)), [base, dim]);
  const selected = sel && dim !== 'company' ? slices.find((s) => s.key === sel) : null;
  const shown = selected ?? company;
  const maxAbs = Math.max(1, ...slices.map((s) => Math.abs(s.cm)));
  return (
    <div className="grid-2">
      <div className="stack sticky-col">
        <div className="card">
          <div className="card-h">
            <h2>Contribution margin waterfall · {selected ? `${dim}: ${selected.key}` : 'Company'}</h2>
            <div className="row small muted">
              <span>{fmt$(shown.netRevenue)} net revenue · {Math.round(shown.units).toLocaleString()} units · return rate {fmtPct(shown.returnRate)} · CM {fmtPct(shown.cmPct)}</span>
              {selected && <button className="btn ghost" onClick={() => setSel(null)}>Back to company</button>}
            </div>
          </div>
          <div className="card-b"><WaterfallChart w={shown} /></div>
        </div>
        <div className="card">
          <div className="card-h">
            <h3>Find leaks: slices ranked by contribution margin</h3>
            <div className="row">{DIMS.map(([k, l]) => <button key={k} className={`chip ${dim === k ? 'on' : ''}`} onClick={() => { setDim(k); setSel(null); }}>{l}</button>)}</div>
          </div>
          {dim === 'company' ? <div className="card-b small muted">Pick a dimension to rank its slices. Click a slice to drill into its waterfall.</div> : (
            <div className="scroll-y scroll-x">
              <table className="t">
                <thead><tr><th>{DIMS.find((d) => d[0] === dim)![1]}</th><th className="num">Net revenue</th><th className="num">CM</th><th style={{ width: '22%' }} /><th className="num">CM %</th><th className="num">Return rate</th><th className="num">Orders</th></tr></thead>
                <tbody>
                  {slices.map((s) => (
                    <tr key={s.key} className={`click ${sel === s.key ? 'sel' : ''}`} onClick={() => setSel(s.key)}>
                      <td className={dim === 'sku' ? 'mono' : ''}>{s.key}</td>
                      <td className="num">{fmt$(s.netRevenue)}</td>
                      <td className={`num ${s.cm < 0 ? 'negc' : ''}`}>{fmt$(s.cm)}</td>
                      <td><div style={{ height: 8, width: `${(Math.abs(s.cm) / maxAbs) * 100}%`, background: s.cm < 0 ? 'var(--neg)' : 'var(--accent)', borderRadius: 2, opacity: 0.85 }} /></td>
                      <td className={`num ${s.cmPct < 0 ? 'negc' : ''}`}>{fmtPct(s.cmPct)}</td>
                      <td className="num">{fmtPct(s.returnRate)}</td>
                      <td className="num">{s.orders.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <div className="stack">
        <Sliders params={params} setParams={setParams} />
        <div className="card">
          <div className="card-h">
            <h2>Approval queue</h2>
            <span className="small muted">{proposals.filter((p) => !decisions[p.id]).length} pending · impacts re-computed live from the engine</span>
          </div>
          <div className="card-b">
            {proposals.map((p) => {
              const a = live.actions.find((x) => x.id === p.id)!;
              return <ProposalCard key={p.id} p={p} liveDelta={a.annual_contribution_delta} liveDetail={a.detail} decision={decisions[p.id]} decide={decide} sens={sens?.[p.id]} showEvidence={showEvidence} />;
            })}
            <p className="small muted" style={{ marginBottom: 0 }}>All proposals together: {fmt$(live.combined_delta)} / yr (sum of individual {fmt$(live.sum_of_individual)}, interaction {fmt$(live.interaction)}).</p>
          </div>
        </div>
      </div>
    </div>
  );
}
