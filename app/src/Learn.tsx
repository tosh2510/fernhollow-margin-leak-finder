import { useState } from 'react';
import { proposals, conflicts, type Saved } from './data';

export function Learn({ saved, reset, showEvidence }: { saved: Saved; reset: () => void; showEvidence: (id: string) => void }) {
  const [result, setResult] = useState<{ ts: string; rows: { id: string; title: string; hits: { rule: string; why: string[] }[] }[] } | null>(null);
  const pending = proposals.filter((p) => !saved.decisions[p.id]);
  const run = () => {
    const rows = pending.map((p) => ({
      id: p.id, title: p.title,
      hits: saved.rules.map((r) => ({ rule: r.id, why: conflicts(r, p) })).filter((h) => h.why.length),
    }));
    setResult({ ts: new Date().toISOString(), rows });
  };
  return (
    <div className="stack">
      <div className="note-bar">
        Learn: every rejection needs a reason, and the reason becomes a policy rule. The policy check below is a <b>deterministic rule replay</b> over the pending proposals: no model call, no new agent run. In production these rules and decisions would also become training signal.
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-h"><h2>Policy rules</h2><span className="small muted">{saved.rules.length} from rejections</span></div>
          <div className="card-b">
            {saved.rules.length === 0 && <p className="small muted" style={{ margin: 0 }}>No rules yet. Reject a proposal in Operate to create one. For example, reject P-004 with “brand reasons”, then re-run the check: the markdown and threshold proposals get flagged, because they are price-family changes too.</p>}
            <table className="t">
              {saved.rules.length > 0 && <thead><tr><th>Rule</th><th>From</th><th>Created</th></tr></thead>}
              <tbody>{saved.rules.map((r) => <tr key={r.id}><td><span className="badge">{r.reason}</span> {r.text}</td><td style={{ whiteSpace: "nowrap" }}><button className="btn ghost" onClick={() => showEvidence(r.source)}>{r.source}</button></td><td className="num small">{r.ts.slice(0, 16).replace('T', ' ')}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-h">
            <h2>Re-run agent policy check</h2>
            <div className="row">
              <button className="btn primary" onClick={run}>Run rule check</button>
              <button className="btn" onClick={() => { reset(); setResult(null); }}>Reset demo</button>
            </div>
          </div>
          <div className="card-b">
            {!result ? <p className="small muted" style={{ margin: 0 }}>Scores the {pending.length} pending proposals against the current rules.</p> : (
              <>
                <p className="small muted" style={{ marginTop: 0 }}>Checked {result.rows.length} pending proposals against {saved.rules.length} rules at {result.ts.slice(11, 19)} UTC.</p>
                <table className="t">
                  <thead><tr><th>Proposal</th><th>Result</th></tr></thead>
                  <tbody>{result.rows.map((r) => (
                    <tr key={r.id}><td><b>{r.id}</b> <span className="small muted">{r.title}</span></td>
                      <td>{r.hits.length ? r.hits.map((h) => <div key={h.rule}><span className="badge warn">conflict</span> <span className="small">{h.rule}: {h.why.join('; ')}</span></div>) : <span className="badge accent">clear</span>}</td></tr>
                  ))}</tbody>
                </table>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
