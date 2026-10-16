import bundleJson from './generated/bundle.json';
import { finalize, type Action, type Compact, type Model } from '../../engine';

export type TraceStep = {
  step: number; ts: string; type: 'tool' | 'note' | 'hypothesis' | 'check' | 'conclude' | 'propose';
  tool: string; args: Record<string, unknown>; output_summary: string; output_ref: string | null; evidence?: number[];
};
export type Proposal = {
  id: string; title: string; type: string; target_system: string; payload: unknown;
  impact: { annual_contribution_delta: number; method: string };
  evidence_steps: number[]; risks: string[]; checks_performed: string[]; confidence: 'high' | 'medium' | 'low';
  scenario_action: Action; status: string; proposed_at: string;
};
export type TableMeta = { name: string; system: string; description: string; fields: Record<string, string>; rows: number };

type Bundle = {
  builtAt: string; recordedAt: string; syncedAt: string; compact: Compact; trace: TraceStep[];
  outputs: Record<string, unknown>; proposals: Proposal[]; tables: TableMeta[]; samples: Record<string, Record<string, unknown>[]>;
  realism: Record<string, number>; planted: { note: string; leaks: { id: number; name: string; detail: string; expected_action: string }[] };
  runNotes: string;
};
export const bundle = bundleJson as unknown as Bundle;
export const model: Model = finalize(bundle.compact);
export const proposals = bundle.proposals;
export const trace = bundle.trace;

// ---- persistence (localStorage is optional) ----
const KEY = 'fernhollow-demo-v1';
export type Decision = { status: 'approved' | 'rejected'; reason?: string; quick?: string; ts: string };
export type Rule = { id: string; text: string; reason: string; source: string; ts: string; scope: { styles: string[]; types: string[]; targets: string[]; evidence: number[] } };
export type Saved = { decisions: Record<string, Decision>; rules: Rule[] };
export function load(): Saved {
  try {
    const s = localStorage.getItem(KEY);
    if (s) return JSON.parse(s) as Saved;
  } catch { /* storage unavailable */ }
  return { decisions: {}, rules: [] };
}
export function save(s: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}
export function clearSaved() {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

// ---- what a proposal touches (for policy rules) ----
export function touchedStyles(p: Proposal): string[] {
  const a = p.scenario_action as { skus?: string[] };
  if (!a.skus) return [];
  const set = new Set<string>();
  for (const s of model.skus) if (a.skus.some((x) => s.sku === x || s.sku.startsWith(x + '-'))) set.add(s.style);
  return [...set];
}
export const toolSteps = (p: Proposal) => p.evidence_steps.filter((s) => trace[s - 1]?.type === 'tool');

const PRICING = ['change_discount_rule', 'markdown', 'change_shipping_threshold'];
const ASSORTMENT = ['discontinue_sku', 'fix_fit_and_pause'];
const FAMILY: Record<string, string[]> = Object.fromEntries([...PRICING.map((t) => [t, PRICING]), ...ASSORTMENT.map((t) => [t, ASSORTMENT])]);

export function makeRule(p: Proposal, quick: string, text: string): Rule {
  const styles = touchedStyles(p);
  const scope = { styles: [] as string[], types: [] as string[], targets: [] as string[], evidence: [] as number[] };
  let ruleText = '';
  if (quick === 'core product') {
    scope.styles = styles;
    ruleText = styles.length ? `Treat ${styles.join(', ')} as core product: flag any proposal that pauses, discounts or marks it down.` : `Treat items in ${p.id} as core product.`;
  } else if (quick === 'brand reasons') {
    scope.types = FAMILY[p.type] ?? [p.type]; scope.styles = styles;
    ruleText = `Brand guardrail: ${scope.types.join(' / ')} changes${styles.length ? ` and anything touching ${styles.join(', ')}` : ''} need brand sign-off.`;
  } else if (quick === 'bad data') {
    scope.evidence = toolSteps(p);
    ruleText = `Data quality: evidence steps ${scope.evidence.join(', ')} are disputed; flag any proposal relying on them.`;
  } else if (quick === 'timing') {
    scope.types = [p.type]; scope.targets = [p.target_system];
    ruleText = `Timing: hold ${p.type} changes to ${p.target_system} this quarter.`;
  } else {
    scope.styles = styles; scope.types = [p.type];
    ruleText = `Reviewer rejected ${p.type}${styles.length ? ` on ${styles.join(', ')}` : ''}; flag similar proposals.`;
  }
  return { id: `R-${Date.now().toString(36)}`, text: ruleText + (text ? ` Reviewer note: "${text}"` : ''), reason: quick || 'other', source: p.id, ts: new Date().toISOString(), scope };
}

/** Deterministic rule check: which other proposals conflict with a rule? */
export function conflicts(rule: Rule, p: Proposal): string[] {
  if (p.id === rule.source) return [];
  const why: string[] = [];
  const styles = touchedStyles(p);
  const s = styles.filter((x) => rule.scope.styles.includes(x));
  if (s.length) why.push(`touches ${s.join(', ')}`);
  if (rule.scope.types.includes(p.type)) why.push(`same type (${p.type})`);
  if (rule.scope.targets.length && rule.scope.targets.includes(p.target_system) && rule.scope.types.includes(p.type)) why.push(`same target (${p.target_system})`);
  const ev = toolSteps(p).filter((e) => rule.scope.evidence.includes(e));
  if (ev.length) why.push(`relies on disputed steps ${ev.join(', ')}`);
  // Keep-with-rationale proposals never write, so they don't conflict with guardrails on writes.
  if (p.type === 'keep_with_rationale' && !ev.length) return [];
  return why;
}
