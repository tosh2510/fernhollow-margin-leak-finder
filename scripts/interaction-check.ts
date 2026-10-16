// Post-run (outside the trace): which pair of proposals produces the interaction term?
import { loadRaw } from '../data-gen/summary';
import { SHIPPING } from '../data-gen/assumptions';
import { buildModel, DEFAULT_PARAMS, runScenario, type Action } from '../engine';
import { readFileSync } from 'node:fs';
const m = buildModel(loadRaw(), SHIPPING.freeThreshold, SHIPPING.flatRateCharged);
const acts = JSON.parse(readFileSync('agent/actions/combined.json', 'utf8')).actions as Action[];
for (let i = 0; i < acts.length; i++) for (let j = i + 1; j < acts.length; j++) {
  const r = runScenario(m, DEFAULT_PARAMS(m), [acts[i], acts[j]]);
  if (r.interaction !== 0) console.log(acts[i].id, acts[j].id, r.interaction);
}
