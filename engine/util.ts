export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
export const toCents = (x: number) => Math.round(x * 100);

/** Split an order-level discount (cents) across lines by gross share; last line takes the remainder. */
export function allocateCents(totalCents: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const out: number[] = [];
  let used = 0;
  for (let i = 0; i < weights.length; i++) {
    if (i === weights.length - 1) out.push(totalCents - used);
    else {
      const c = sum > 0 ? Math.round((totalCents * weights[i]) / sum) : 0;
      out.push(c);
      used += c;
    }
  }
  return out;
}

const DAY_MS = 86400000;
const START = Date.UTC(2025, 9, 1);
export const dayToDate = (d: number) => new Date(START + d * DAY_MS).toISOString().slice(0, 10);
export const dateToDay = (iso: string) => Math.floor((Date.parse(iso.slice(0, 10) + 'T00:00:00Z') - START) / DAY_MS);
export const dayToMonthIdx = (d: number) => {
  const dt = new Date(START + d * DAY_MS);
  return (dt.getUTCFullYear() - 2025) * 12 + dt.getUTCMonth() - 9; // 0 = Oct 2025
};
export const MONTH_LABELS = ['Oct 25', 'Nov 25', 'Dec 25', 'Jan 26', 'Feb 26', 'Mar 26', 'Apr 26', 'May 26', 'Jun 26', 'Jul 26', 'Aug 26', 'Sep 26'];

export const fmt$ = (x: number, d = 0) =>
  (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtPct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
