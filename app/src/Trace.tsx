import { useEffect, useMemo, useState } from 'react';
import { bundle, proposals, trace, type TraceStep } from './data';

const TYPES: [TraceStep['type'], string, string][] = [
  ['tool', 'Tool call', 'T'], ['note', 'Note', 'N'], ['hypothesis', 'Hypothesis', 'H'], ['check', 'Counter-check', 'C'], ['propose', 'Proposal', 'P'], ['conclude', 'Conclusion', '∴'],
];
const decoySteps = new Set(proposals.find((p) => p.type === 'keep_with_rationale')?.evidence_steps.filter((s) => trace[s - 1]?.type === 'check' || trace[s - 1]?.type === 'hypothesis') ?? []);

function Step({ s, flash }: { s: TraceStep; flash: boolean }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const label = TYPES.find((t) => t[0] === s.type)!;
  const usedBy = proposals.filter((p) => p.evidence_steps.includes(s.step)).map((p) => p.id);
  const decoy = decoySteps.has(s.step);
  return (
    <div className={`step ${s.type} ${decoy ? 'decoy' : ''} ${flash ? 'flash' : ''}`} id={`step-${s.step}`}>
      <div className="dot" aria-hidden>{label[2]}</div>
      <div className="step-box" onClick={() => setOpen(!open)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(!open)} aria-expanded={open}>
        <div className="step-meta">
          <span className="num">#{s.step}</span>
          <span className="kind">{label[1]}</span>
          {s.type === 'tool' && <span className="mono">{s.tool}</span>}
          {decoy && <span className="badge accent">Decoy save: the tee</span>}
          {s.evidence && <span>evidence: {s.evidence.join(', ')}</span>}
          {usedBy.length > 0 && <span>→ {usedBy.join(', ')}</span>}
          <span style={{ marginLeft: 'auto' }}>{new Date(s.ts).toISOString().slice(11, 19)} UTC</span>
        </div>
        <div className="step-text">{s.output_summary}</div>
      </div>
      {open && (
        <div style={{ padding: '6px 0 0 4px' }}>
          <div className="small muted">args</div>
          <pre className="json">{JSON.stringify(s.args, null, 2)}</pre>
          {s.output_ref && (
            <>
              <button className="btn ghost" onClick={() => setFull(!full)}>{full ? 'Hide full output' : `Show full output (${s.output_ref})`}</button>
              {full && <pre className="json" style={{ maxHeight: 480 }}>{JSON.stringify(bundle.outputs[s.step], null, 2)}</pre>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function TraceView({ focus }: { focus: { proposal?: string; step?: number; n: number } }) {
  const [types, setTypes] = useState<Set<string>>(new Set(TYPES.map((t) => t[0])));
  const [prop, setProp] = useState<string>(focus.proposal ?? '');
  useEffect(() => { if (focus.proposal) setProp(focus.proposal); }, [focus.n, focus.proposal]);
  const steps = useMemo(() => {
    const p = proposals.find((x) => x.id === prop);
    const allowed = p ? new Set([...p.evidence_steps, ...trace.filter((t) => t.type === 'propose' && (t.args as { id?: string }).id === p.id).map((t) => t.step)]) : null;
    return trace.filter((s) => types.has(s.type) && (!allowed || allowed.has(s.step)));
  }, [types, prop]);
  useEffect(() => {
    if (!focus.proposal) return;
    const first = steps[0];
    if (first) setTimeout(() => document.getElementById(`step-${first.step}`)?.scrollIntoView({ block: 'center' }), 50);
  }, [focus.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (t: string) => { const n = new Set(types); if (n.has(t)) n.delete(t); else n.add(t); setTypes(n); };
  const checks = trace.filter((s) => s.type === 'check').length;
  return (
    <div className="stack">
      <div className="note-bar">
        Recorded run: Claude Code acting as Fernhollow’s operating agent on {new Date(bundle.recordedAt).toUTCString().slice(5, 16)}, {trace.length} steps. It saw the data only through the tool CLI, and every tool call was logged automatically. {checks} counter-argument checks are highlighted; the tee decoy save is marked. This is a replay; no model runs in this page.
      </div>
      <div className="card">
        <div className="card-h">
          <div className="row">{TYPES.map(([k, l]) => <button key={k} className={`chip ${types.has(k) ? 'on' : ''}`} onClick={() => toggle(k)}>{l}</button>)}</div>
          <div className="row small">
            <label htmlFor="pf" className="muted">Show only steps behind</label>
            <select id="pf" value={prop} onChange={(e) => setProp(e.target.value)}>
              <option value="">all steps</option>
              {proposals.map((p) => <option key={p.id} value={p.id}>{p.id} · {p.title.slice(0, 40)}</option>)}
            </select>
            <button className="btn" onClick={() => setTypes(new Set(['check']))}>Counter-checks only</button>
          </div>
        </div>
        <div className="card-b">
          <div className="tl">{steps.map((s) => <Step key={s.step} s={s} flash={focus.step === s.step} />)}</div>
          {!steps.length && <div className="muted small">No steps match the filters.</div>}
        </div>
      </div>
    </div>
  );
}
