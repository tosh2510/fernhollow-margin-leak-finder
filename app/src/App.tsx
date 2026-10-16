import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { evaluate, runScenario, DEFAULT_PARAMS, totalCm, fmt$, type Params, type ScenarioResult } from '../../engine';
import { ENGINE } from '../../data-gen/assumptions';
import { model, proposals, load, save, clearSaved, type Saved, type Decision, type Rule } from './data';
import { Mirror } from './Mirror';
import { Operate } from './Operate';
import { TraceView } from './Trace';
import { Learn } from './Learn';
import { About } from './About';

export type Tab = 'mirror' | 'operate' | 'trace' | 'learn' | 'about';
const TABS: [Tab, string][] = [['mirror', 'Mirror'], ['operate', 'Operate'], ['trace', 'Trace'], ['learn', 'Learn'], ['about', 'How this was built']];

export type Sensitivity = Record<string, { flips: boolean; range: [number, number]; detail: string[] }>;

export default function App() {
  const [tab, setTab] = useState<Tab>('operate');
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS(model));
  const dParams = useDeferredValue(params);
  const [saved, setSaved] = useState<Saved>(() => load());
  const [traceFocus, setTraceFocus] = useState<{ proposal?: string; step?: number; n: number }>({ n: 0 });
  useEffect(() => save(saved), [saved]);

  const allActions = useMemo(() => proposals.map((p) => p.scenario_action), []);
  const approvedActions = useMemo(() => proposals.filter((p) => saved.decisions[p.id]?.status === 'approved').map((p) => p.scenario_action), [saved.decisions]);
  const base = useMemo(() => evaluate(model, dParams), [dParams]);
  const live: ScenarioResult = useMemo(() => runScenario(model, dParams, allActions), [dParams, allActions]);
  const header: ScenarioResult = useMemo(
    () => (approvedActions.length ? runScenario(model, dParams, approvedActions) : { baseline_cm: Math.round(totalCm(base)), scenario_cm: Math.round(totalCm(base)), combined_delta: 0, sum_of_individual: 0, interaction: 0, actions: [] }),
    [dParams, approvedActions, base],
  );
  const recordedBaseline = useMemo(() => Math.round(totalCm(evaluate(model, DEFAULT_PARAMS(model)))), []);

  // Assumption sensitivity: does any proposal's sign flip across the slider ranges?
  const [sens, setSens] = useState<Sensitivity | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const d = DEFAULT_PARAMS(model);
      const R = ENGINE.sliderRanges;
      const variants: [string, Params][] = [
        [`returns ×${R.returnMultiplier[0]}`, { ...d, returnMultiplier: R.returnMultiplier[0] }],
        [`returns ×${R.returnMultiplier[1]}`, { ...d, returnMultiplier: R.returnMultiplier[1] }],
        [`freight $${R.freightPerOrder[0]}`, { ...d, freightPerOrder: R.freightPerOrder[0] }],
        [`freight $${R.freightPerOrder[1]}`, { ...d, freightPerOrder: R.freightPerOrder[1] }],
        ['allocation: units', { ...d, allocation: 'units' }],
      ];
      const baseRes = runScenario(model, d, allActions);
      const out: Sensitivity = {};
      const val = (r: ScenarioResult, id: string) => {
        const a = r.actions.find((x) => x.id === id)!;
        return a.kind === 'keep' ? -(a.detail.counterfactual_cut_delta as number) : a.annual_contribution_delta;
      };
      for (const p of proposals) out[p.id] = { flips: false, range: [val(baseRes, p.id), val(baseRes, p.id)], detail: [] };
      for (const [label, pv] of variants) {
        const r = runScenario(model, pv, allActions);
        for (const p of proposals) {
          const v = val(r, p.id), b0 = val(baseRes, p.id);
          const o = out[p.id];
          o.range = [Math.min(o.range[0], v), Math.max(o.range[1], v)];
          if (Math.sign(v) !== Math.sign(b0) && b0 !== 0) { o.flips = true; o.detail.push(label); }
        }
      }
      setSens(out);
    }, 50);
    return () => clearTimeout(t);
  }, [allActions]);

  const decide = (id: string, d: Decision | null, rule?: Rule) =>
    setSaved((s) => {
      const decisions = { ...s.decisions };
      if (d) decisions[id] = d; else delete decisions[id];
      return { decisions, rules: rule ? [...s.rules, rule] : s.rules };
    });
  const reset = () => { clearSaved(); setSaved({ decisions: {}, rules: [] }); setParams(DEFAULT_PARAMS(model)); };
  const showEvidence = (proposal: string, step?: number) => { setTraceFocus((f) => ({ proposal, step, n: f.n + 1 })); setTab('trace'); window.scrollTo({ top: 0 }); };
  const nApproved = approvedActions.length;
  const paramsChanged = JSON.stringify(params) !== JSON.stringify(DEFAULT_PARAMS(model));

  return (
    <>
      <header className="hdr">
        <div className="hdr-inner">
          <div className="hdr-top">
            <div className="brand">
              <h1>Fernhollow · Operating Layer (demo)</h1>
              <div className="row">
                <span className="badge accent">Synthetic data · recorded agent run</span>
                <span className="badge">Writes are approval-gated and never executed</span>
              </div>
            </div>
            <div className="kpis">
              <div className="kpi">
                <div className="lbl">Projected annual contribution margin</div>
                <div className="val">{fmt$(header.scenario_cm)}</div>
                <div className="sub">baseline {fmt$(header.baseline_cm)}{paramsChanged ? ` at current assumptions (recorded ${fmt$(recordedBaseline)})` : ''}</div>
              </div>
              <div className="kpi">
                <div className="lbl">Δ from approved actions</div>
                <div className={`val ${header.combined_delta > 0 ? 'pos' : header.combined_delta < 0 ? 'negc' : ''}`}>{header.combined_delta > 0 ? '+' : ''}{fmt$(header.combined_delta)}</div>
                <div className="sub">{nApproved} of {proposals.length} approved{nApproved > 1 ? ` · interaction ${fmt$(header.interaction)}` : ''}</div>
              </div>
            </div>
          </div>
          <nav className="tabs" role="tablist">
            {TABS.map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>
            ))}
          </nav>
        </div>
      </header>
      <main>
        {tab === 'mirror' && <Mirror />}
        {tab === 'operate' && <Operate params={params} setParams={setParams} base={base} live={live} decisions={saved.decisions} decide={decide} sens={sens} showEvidence={showEvidence} />}
        {tab === 'trace' && <TraceView focus={traceFocus} />}
        {tab === 'learn' && <Learn saved={saved} reset={reset} showEvidence={showEvidence} />}
        {tab === 'about' && <About />}
        <div className="foot">
          Fernhollow is a fictional brand. Every row is synthetic, generated with mulberry32(seed 42); six leaks were planted on purpose. The agent run was recorded on 16 Oct 2026 with Claude Code and is replayed here; nothing in this page calls a model. Approved writes are queued, not sent.
        </div>
      </main>
    </>
  );
}
