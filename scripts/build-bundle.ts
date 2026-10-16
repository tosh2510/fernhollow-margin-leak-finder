// Packs the compact unified model, the recorded trace, proposals, table samples
// and docs into app/src/generated/bundle.json for the single-file build.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw, realismSummary } from '../data-gen/summary';
import { SHIPPING, WINDOW } from '../data-gen/assumptions';
import { compactFromRaw, finalize, evaluate, totalCm, DEFAULT_PARAMS } from '../engine';
import { SOURCES } from '../tools/sources';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = loadRaw();
const compact = compactFromRaw(raw, SHIPPING.freeThreshold, SHIPPING.flatRateCharged);

// Round-trip check: the browser model must equal the CLI model.
const viaJson = finalize(JSON.parse(JSON.stringify(compact)));
const direct = finalize(compact);
const a = totalCm(evaluate(direct, DEFAULT_PARAMS(direct))), b = totalCm(evaluate(viaJson, DEFAULT_PARAMS(viaJson)));
if (Math.abs(a - b) > 1e-6) throw new Error(`compact round-trip mismatch ${a} vs ${b}`);

const trace = readFileSync(join(ROOT, 'agent/trace.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const outputs: Record<number, unknown> = {};
for (const t of trace) if (t.output_ref) outputs[t.step] = JSON.parse(readFileSync(join(ROOT, 'agent', t.output_ref), 'utf8'));
const proposals = JSON.parse(readFileSync(join(ROOT, 'agent/proposals.json'), 'utf8'));

const samples: Record<string, unknown[]> = {};
const tables = Object.entries(SOURCES).map(([name, s]) => {
  const rows = (raw as unknown as Record<string, unknown[]>)[name];
  samples[name] = rows.slice(0, 100);
  return { name, system: s.system, description: s.desc, fields: s.fields, rows: rows.length };
});

const bundle = {
  builtAt: new Date().toISOString(),
  recordedAt: trace[0]?.ts ?? null,
  syncedAt: WINDOW.syncedAt,
  compact,
  trace,
  outputs,
  proposals,
  tables,
  samples,
  realism: realismSummary(raw),
  planted: JSON.parse(readFileSync(join(ROOT, 'data/planted.json'), 'utf8')),
  runNotes: existsSync(join(ROOT, 'agent/run-notes.md')) ? readFileSync(join(ROOT, 'agent/run-notes.md'), 'utf8') : '',
};
mkdirSync(join(ROOT, 'app/src/generated'), { recursive: true });
const json = JSON.stringify(bundle);
writeFileSync(join(ROOT, 'app/src/generated/bundle.json'), json);
console.log(`bundle: ${(json.length / 1e6).toFixed(2)} MB, ${trace.length} trace steps, ${proposals.length} proposals, baseline CM ${a.toFixed(2)}`);
