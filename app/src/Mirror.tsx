import { useState } from 'react';
import { bundle, model } from './data';

const SYSTEMS = ['Shopify', 'QuickBooks', '3PL', 'Inventory'];

function Diagram() {
  const W = 880, H = 230;
  const src = SYSTEMS.map((s, i) => ({ s, y: 18 + i * 52 }));
  const tables = (s: string) => bundle.tables.filter((t) => t.system === s).length;
  return (
    <div className="diagram">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Four source systems flow into one unified model, which feeds the margin engine, the agent tools and this app">
        {src.map(({ s, y }) => (
          <g key={s}>
            <rect x={8} y={y} width={170} height={40} rx={6} fill="var(--surface-2)" stroke="var(--border-strong)" />
            <text x={20} y={y + 17} fontSize={13} fontWeight={600} fill="var(--ink)">{s}</text>
            <text x={20} y={y + 32} fontSize={11} fill="var(--ink-3)">{tables(s)} tables</text>
            <path d={`M178 ${y + 20} C 250 ${y + 20}, 250 115, 320 115`} fill="none" stroke="var(--border-strong)" strokeWidth={1.5} />
          </g>
        ))}
        <rect x={320} y={70} width={210} height={90} rx={8} fill="var(--accent-soft)" stroke="var(--accent)" />
        <text x={336} y={96} fontSize={13} fontWeight={600} fill="var(--ink)">Unified model</text>
        <text x={336} y={114} fontSize={11} fill="var(--ink-2)">{model.nOrders.toLocaleString()} orders · {model.nLines.toLocaleString()} lines</text>
        <text x={336} y={130} fontSize={11} fill="var(--ink-2)">{model.custIds.length.toLocaleString()} customers · {model.skus.length} SKUs</text>
        <text x={336} y={146} fontSize={11} fill="var(--ink-3)">joined on order_id · sku · refund_id</text>
        <path d="M530 115 L 600 115" stroke="var(--accent)" strokeWidth={1.5} markerEnd="url(#arr)" />
        <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="var(--accent)" /></marker></defs>
        {[['Margin engine (pure TS)', 'same module in CLI + browser', 52], ['Agent tool CLI', 'every call → trace.jsonl', 115], ['This app', 'replay · approve · learn', 178]].map(([a, b, y]) => (
          <g key={a as string}>
            <rect x={604} y={(y as number) - 22} width={268} height={44} rx={6} fill="var(--surface)" stroke="var(--border-strong)" />
            <text x={618} y={(y as number) - 3} fontSize={12.5} fontWeight={600} fill="var(--ink)">{a}</text>
            <text x={618} y={(y as number) + 13} fontSize={11} fill="var(--ink-3)">{b}</text>
          </g>
        ))}
        <path d="M600 115 L 604 52 M600 115 L604 178" stroke="var(--accent)" strokeWidth={1.5} fill="none" />
      </svg>
    </div>
  );
}

function Preview({ table }: { table: string }) {
  const rows = bundle.samples[table] ?? [];
  const meta = bundle.tables.find((t) => t.name === table)!;
  const [page, setPage] = useState(0);
  const per = 20;
  const pages = Math.ceil(rows.length / per);
  const cols = Object.keys(meta.fields);
  const cell = (v: unknown) => (v === null || v === undefined ? <span className="muted">null</span> : typeof v === 'object' ? JSON.stringify(v) : typeof v === 'number' && !Number.isInteger(v) ? (Math.abs(v) < 1 ? String(v) : v.toFixed(2)) : String(v));
  return (
    <div className="card">
      <div className="card-h">
        <h3>Row preview · <span className="mono">{table}</span></h3>
        <div className="row small">
          <span className="muted">rows {page * per + 1}–{Math.min(rows.length, (page + 1) * per)} of first {rows.length} (table has {meta.rows.toLocaleString()})</span>
          <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</button>
          <button className="btn" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>
      <div className="scroll-x scroll-y">
        <table className="t">
          <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{rows.slice(page * per, (page + 1) * per).map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className={typeof r[c] === 'number' ? 'num' : c === 'line_items' ? 'mono' : ''} style={c === 'line_items' ? { maxWidth: 380 } : undefined}>{cell(r[c])}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

export function Mirror() {
  const [open, setOpen] = useState<string | null>(null);
  const [table, setTable] = useState('shopify_orders');
  const synced = new Date(bundle.syncedAt).toUTCString().replace(':00 GMT', ' UTC');
  return (
    <div className="stack">
      <div className="note-bar">Mirror: four systems of record copied into one tenant-isolated model with their native field names. All rows are synthetic (Fernhollow is fictional). Previews show a sample; the full tables live in the build’s data layer.</div>
      <div className="grid-4">
        {SYSTEMS.map((s) => (
          <div className="card" key={s}>
            <div className="card-h"><h3>{s}</h3><span className="badge accent">synced</span></div>
            <div className="card-b">
              <div className="small muted" style={{ marginBottom: 8 }}>Last synced {synced}</div>
              {bundle.tables.filter((t) => t.system === s).map((t) => (
                <div key={t.name} style={{ borderTop: '1px solid var(--border)', padding: '6px 0' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <button className="btn ghost mono" onClick={() => setTable(t.name)}>{t.name}</button>
                    <span className="small num">{t.rows.toLocaleString()} rows</span>
                  </div>
                  <button className="btn ghost small" onClick={() => setOpen(open === t.name ? null : t.name)}>{open === t.name ? 'Hide schema' : 'Schema'}</button>
                  {open === t.name && (
                    <div className="schema" style={{ marginTop: 4 }}>
                      <p className="small muted" style={{ fontFamily: 'var(--sans)', margin: '0 0 4px' }}>{t.description}</p>
                      {Object.entries(t.fields).map(([k, v]) => <div key={k}><span>{k}</span><span>{v}</span></div>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="card"><div className="card-h"><h3>Unified layer</h3><span className="small muted">tools read only from the unified model; writes go back through the approval queue</span></div><div className="card-b"><Diagram /></div></div>
      <Preview table={table} key={table} />
    </div>
  );
}
