// Opens dist/index.html from disk with all network blocked, screenshots every tab
// at 1280/1920/390 and runs the UI checks from the Phase 5 list.
import { chromium, type Page } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { loadRaw } from '../data-gen/summary';
import { SHIPPING } from '../data-gen/assumptions';
import { buildModel, DEFAULT_PARAMS, runScenario, fmt$, type Action } from '../engine';
import proposals from '../agent/proposals.json' with { type: 'json' };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL = 'file://' + join(ROOT, 'dist/index.html');
const SHOTS = join(ROOT, 'screenshots');
mkdirSync(SHOTS, { recursive: true });

const results: [string, boolean, string][] = [];
const ok = (name: string, pass: boolean, detail = '') => { results.push([name, pass, detail]); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

const m = buildModel(loadRaw(), SHIPPING.freeThreshold, SHIPPING.flatRateCharged);
const combined = runScenario(m, DEFAULT_PARAMS(m), (proposals as unknown as { scenario_action: Action }[]).map((p) => p.scenario_action));

async function open(width: number, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const errors: string[] = [];
  const network: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/*', (route) => { const u = route.request().url(); if (!u.startsWith('file://')) { network.push(u); return route.abort(); } return route.continue(); });
  await page.goto(URL);
  await page.waitForSelector('.kpi .val');
  return { page, ctx, errors, network };
}
const tab = (page: Page, name: string) => page.getByRole('tab', { name }).click();
const headerDelta = async (page: Page) => (await page.locator('.kpi .val').nth(1).innerText()).trim();
const headerCm = async (page: Page) => (await page.locator('.kpi .val').nth(0).innerText()).trim();
const setRange = (page: Page, label: string, v: number) => page.getByLabel(label).evaluate((el, val) => {
  const input = el as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(val));
  input.dispatchEvent(new Event('input', { bubbles: true }));
}, v);
const money = (s: string) => parseFloat(s.replace(/[^0-9.-]/g, '')) * (s.includes('-') ? 1 : 1);

const browser = await chromium.launch();

// ---- 1280 desktop: screenshots + interaction checks ----
{
  const { page, ctx, errors, network } = await open(1280);
  for (const [t, f] of [['Operate', 'operate'], ['Mirror', 'mirror'], ['Trace', 'trace'], ['Learn', 'learn'], ['How this was built', 'about']] as const) {
    await tab(page, t);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, `1280-${f}.png`), fullPage: f !== 'trace' && f !== 'about' });
  }
  // Operate interactions
  await tab(page, 'Operate');
  await page.waitForTimeout(1500); // sensitivity pass
  await page.screenshot({ path: join(SHOTS, '1280-operate.png'), fullPage: true });
  const cm0 = money(await headerCm(page));
  await setRange(page, 'Freight per order', 14);
  await page.waitForTimeout(400);
  const cmFreight = money(await headerCm(page));
  ok('higher freight lowers projected CM', cmFreight < cm0, `${cm0} → ${cmFreight}`);
  await setRange(page, 'Freight per order', 9.0);
  await setRange(page, 'Return rate multiplier', 1.3);
  await page.waitForTimeout(400);
  ok('higher returns lower projected CM', money(await headerCm(page)) < cm0);
  await page.getByRole('button', { name: 'Units' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, '1280-operate-units-allocation.png'), fullPage: false });
  // back to defaults via reset on Learn
  await tab(page, 'Learn'); await page.getByRole('button', { name: 'Reset demo' }).click(); await tab(page, 'Operate');
  await page.waitForTimeout(400);
  ok('reset restores baseline', money(await headerCm(page)) === cm0);
  // approve all
  const approves = page.getByRole('button', { name: 'Approve', exact: true });
  const n = await approves.count();
  for (let i = 0; i < n; i++) { await approves.first().click(); await page.waitForTimeout(150); }
  await page.waitForTimeout(500);
  const d = await headerDelta(page);
  ok('approve all = combined scenario delta', d === '+' + fmt$(combined.combined_delta), `header ${d} vs scenario ${fmt$(combined.combined_delta)} (CLI step 67: $135,710)`);
  ok('approved cards show queued-for-write', (await page.locator('.queued').count()) === n, `${await page.locator('.queued').count()} of ${n}`);
  await page.screenshot({ path: join(SHOTS, '1280-operate-all-approved.png'), fullPage: false });
  // show payload + evidence links
  await tab(page, 'Learn'); await page.getByRole('button', { name: 'Reset demo' }).click(); await tab(page, 'Operate');
  await page.locator('.prop').filter({ hasText: 'P-005' }).getByRole('button', { name: 'Show payload' }).click();
  await page.locator('.prop').filter({ hasText: 'P-005' }).screenshot({ path: join(SHOTS, '1280-po-payload.png') });
  // reject P-004 with brand reasons → rule → policy check flags price-family proposals
  const p4 = page.locator('.prop').filter({ hasText: 'P-004' });
  await p4.getByRole('button', { name: 'Reject' }).click();
  await p4.getByRole('button', { name: 'brand reasons' }).click();
  await p4.getByLabel('Rejection reason').fill('We never run sitewide-feeling discounts above 15% on first orders without brand sign-off.');
  await p4.getByRole('button', { name: 'Reject and save rule' }).click();
  await tab(page, 'Learn');
  ok('rejection creates a rule', (await page.locator('.card').first().locator('tbody tr').count()) === 1);
  await page.getByRole('button', { name: 'Run rule check' }).click();
  const flagged = await page.locator('tr', { has: page.locator('.badge.warn') }).allInnerTexts();
  ok('policy check flags related proposals', flagged.some((t) => t.includes('P-006')) && flagged.some((t) => t.includes('P-002')), flagged.map((t) => t.split('\n')[0]).join(' | '));
  await page.screenshot({ path: join(SHOTS, '1280-learn-after-reject.png'), fullPage: true });
  // UI SKU table shows the same CM as the engine (UI displays whole dollars)
  await tab(page, 'Learn'); await page.getByRole('button', { name: 'Reset demo' }).click(); await tab(page, 'Operate');
  await page.getByRole('button', { name: 'SKU', exact: true }).click();
  const base = (await import('../engine')).evaluate(m, DEFAULT_PARAMS(m));
  const bySku = new Map((await import('../engine')).waterfallBy(m, base, 'sku').map((w) => [w.key, w.cm]));
  for (const sku of ['TEE-WHI-M', 'WRP-BLA-L', 'CHN-KHA-M']) {
    const cells = await page.locator('tr', { hasText: sku }).first().locator('td').allInnerTexts();
    ok(`UI CM for ${sku} matches engine`, cells[2] === fmt$(bySku.get(sku)!), `UI ${cells[2]} vs engine ${bySku.get(sku)!.toFixed(2)}`);
  }
  // evidence links resolve
  await tab(page, 'Operate');
  await page.locator('.prop').filter({ hasText: 'P-003' }).getByRole('button', { name: /Show evidence/ }).click();
  await page.waitForTimeout(400);
  const shown = await page.locator('.step').count();
  const p3 = proposals.find((p: { id: string }) => p.id === 'P-003') as { evidence_steps: number[] };
  ok('evidence link filters trace to proposal steps', shown >= p3.evidence_steps.length, `${shown} steps shown for ${p3.evidence_steps.length} evidence steps`);
  await page.screenshot({ path: join(SHOTS, '1280-trace-P-003-evidence.png'), fullPage: false });
  await page.locator('.step.decoy .step-box').first().click();
  await page.screenshot({ path: join(SHOTS, '1280-trace-decoy-expanded.png'), fullPage: false });
  ok('no console errors (1280)', errors.length === 0, errors.join(' | '));
  ok('no network requests', network.length === 0, network.join(', '));
  await ctx.close();
}

// ---- 1920 + 390 ----
for (const w of [1920, 390]) {
  const { page, ctx, errors } = await open(w, w === 390 ? 844 : 1080);
  for (const [t, f] of [['Operate', 'operate'], ['Mirror', 'mirror'], ['Trace', 'trace'], ['Learn', 'learn'], ['How this was built', 'about']] as const) {
    await tab(page, t);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, `${w}-${f}.png`), fullPage: false });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (w === 390) ok(`no horizontal page scroll at 390 (${f})`, overflow <= 1, `overflow ${overflow}px`);
  }
  ok(`no console errors (${w})`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}
// ---- dark mode ----
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(URL); await page.waitForSelector('.kpi .val'); await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, '1280-operate-dark.png') });
  await ctx.close();
}
await browser.close();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} UI checks passed`);
process.exit(failed.length ? 1 : 0);
