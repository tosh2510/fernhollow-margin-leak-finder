import type { ReactNode } from 'react';
import { ASSUMPTION_TABLE } from '../../data-gen/assumptions';
import { fmt$, fmtPct } from '../../engine';
import { bundle } from './data';

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith('**') ? <b key={k++}>{t.slice(2, -2)}</b> : t.startsWith('`') ? <code key={k++}>{t.slice(1, -1)}</code> : <i key={k++}>{t.slice(1, -1)}</i>);
    last = m.index + t.length;
  }
  out.push(s.slice(last));
  return out;
}
/** Minimal markdown for run-notes: headings, tables, lists, paragraphs. */
function Md({ src }: { src: string }) {
  const lines = src.split('\n');
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    if (l.startsWith('#')) { const n = l.match(/^#+/)![0].length; const T = (`h${Math.min(3, n)}`) as 'h1'; blocks.push(<T key={i}>{inline(l.slice(n).trim())}</T>); continue; }
    if (l.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) { if (!/^\|[\s-|]+\|$/.test(lines[i])) rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim())); i++; }
      i--;
      blocks.push(<div className="scroll-x" key={i}><table><thead><tr>{rows[0].map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead><tbody>{rows.slice(1).map((r, a) => <tr key={a}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^(\d+\.|-) /.test(l)) {
      const items: string[] = [];
      const ordered = /^\d+\./.test(l);
      while (i < lines.length && (/^(\d+\.|-) /.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
        if (/^(\d+\.|-) /.test(lines[i])) items.push(lines[i].replace(/^(\d+\.|-) /, '')); else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      i--;
      const L = ordered ? 'ol' : 'ul';
      blocks.push(<L key={i}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</L>);
      continue;
    }
    blocks.push(<p key={i}>{inline(l)}</p>);
  }
  return <div className="md">{blocks}</div>;
}

export function About() {
  const r = bundle.realism;
  const recorded = new Date(bundle.recordedAt).toUTCString().slice(5, 16);
  return (
    <div className="stack">
      <div className="grid-2">
        <div className="card">
          <div className="card-h"><h2>How this was built</h2><span className="small muted">Run recorded {recorded} with Claude Code</span></div>
          <div className="card-b">
            <ul>
              <li><b>Mirror.</b> A seeded generator (mulberry32, seed 42) writes 11 source tables in Shopify, QuickBooks, 3PL and inventory field names. Realism targets are asserted before anything else runs.</li>
              <li><b>Engine.</b> One pure TypeScript module computes the 11-step contribution waterfall, cohorts, baskets, inventory and scenarios. The CLI runs it in Node and this page runs the same code for the sliders.</li>
              <li><b>Tools + trace.</b> The agent could only see data through <code>tools/cli.ts</code>. Every call appended a trace entry, and proposal impacts are rejected unless they match a logged scenario step.</li>
              <li><b>Approval gate.</b> Proposals carry the exact write payload. Approving queues it, and nothing is sent. Rejections need a reason and become rules.</li>
              <li><b>Ship.</b> Vite + React, inlined into one HTML file with the data bundle. No backend, no API keys, works offline.</li>
            </ul>
            <p className="small">
              GDPi’s loop is Mirror → Operate → Learn. This is that loop in miniature. Copy the systems of record into one model with real schemas, so the numbers reconcile to the cent. Let an agent read freely through deterministic tools, with no LLM arithmetic, and make it argue against its own first idea before proposing anything. That is why the tee is kept even though it tops the loss list. Gate every write behind a human, with the exact payload visible, because a wrong archive or PO costs real money. Make every operation leave a structured trace, so a reviewer can audit why. Finally, turn each rejection into a rule the next run is checked against. That is the seed of “traces become training signal.” The data here is synthetic and the leaks were planted on purpose. The interesting test is a real, anonymised dataset that nobody has seen.
            </p>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h2>Realism check (Phase 1)</h2><span className="small muted">computed from the raw tables</span></div>
          <div className="card-b">
            <table className="t"><tbody>
              <tr><td>Gross sales</td><td className="num">{fmt$(r.gross_sales)}</td><td className="muted small">target $3.5–4.5M</td></tr>
              <tr><td>Gross margin (after discounts, landed COGS)</td><td className="num">{fmtPct(r.gross_margin_pct)}</td><td className="muted small">60–70%</td></tr>
              <tr><td>Unit return rate</td><td className="num">{fmtPct(r.return_rate_units)}</td><td className="muted small">20–28%</td></tr>
              <tr><td>Restock rate</td><td className="num">{fmtPct(r.restock_rate)}</td><td className="muted small">~85% (wrap dress planted at 58%)</td></tr>
              <tr><td>AOV</td><td className="num">{fmt$(r.aov, 2)}</td><td className="muted small">$110–160</td></tr>
              <tr><td>Units per order</td><td className="num">{r.units_per_order.toFixed(2)}</td><td className="muted small">1.6–2.2</td></tr>
              <tr><td>Outbound cost per order</td><td className="num">{fmt$(r.avg_outbound_per_order, 2)}</td><td className="muted small">$7–14</td></tr>
              <tr><td>Orders · customers · SKUs</td><td className="num">{r.orders.toLocaleString()} · {r.customers.toLocaleString()} · {r.skus}</td><td className="muted small">see DECISIONS.md #2</td></tr>
            </tbody></table>
          </div>
        </div>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-h"><h2>Planted leaks (revealed)</h2><span className="small muted">from data/planted.json; the agent never read it during the run</span></div>
          <div className="card-b">
            <table className="t"><thead><tr><th>#</th><th>Leak</th><th>Expected action</th></tr></thead>
              <tbody>{bundle.planted.leaks.map((l) => <tr key={l.id}><td>{l.id}</td><td><b>{l.name}</b><div className="small muted">{l.detail}</div></td><td className="small">{l.expected_action}</td></tr>)}</tbody></table>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h2>Agent hits and misses</h2><span className="small muted">agent/run-notes.md, written after the run</span></div>
          <div className="card-b"><Md src={bundle.runNotes} /></div>
        </div>
      </div>
      <div className="card">
        <div className="card-h"><h2>Assumptions</h2><span className="small muted">data-gen/assumptions.ts, the single source for generator and engine</span></div>
        <div className="scroll-x">
          <table className="t"><thead><tr><th>Group</th><th>Parameter</th><th>Value</th><th>Why</th></tr></thead>
            <tbody>{ASSUMPTION_TABLE.map((a, i) => <tr key={i}><td className="muted">{a.group}</td><td>{a.name}</td><td className="small">{a.value}</td><td className="small muted">{a.why}</td></tr>)}</tbody></table>
        </div>
      </div>
    </div>
  );
}
