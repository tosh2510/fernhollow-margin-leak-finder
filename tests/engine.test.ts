import { describe, it, expect } from 'vitest';
import { buildModel, evaluate, totalCm, companyWaterfall, waterfallBy, runScenario, basketAttach, allocateCents, mulberry32 } from '../engine';
import type { RawData, Params } from '../engine';

// Hand-computed fixture: two SKUs, three orders, one return.
// SKU A: $100, landed $30. SKU T: $28, landed $19.
const raw: RawData = {
  shopify_products: [
    { sku: 'AAA-BLK-M', style: 'Alpha', category: 'Tops', size: 'M', color: 'Black', list_price: 100, status: 'active' },
    { sku: 'TEE-WHI-M', style: 'Core Tee', category: 'Tops', size: 'M', color: 'White', list_price: 28, status: 'active' },
  ],
  quickbooks_cogs: [
    { sku: 'AAA-BLK-M', fob_cost: 24, inbound_freight_per_unit: 1, duty_rate: 0.2083, landed_cost: 30 },
    { sku: 'TEE-WHI-M', fob_cost: 15.6, inbound_freight_per_unit: 0.83, duty_rate: 0.165, landed_cost: 19 },
  ],
  shopify_customers: [
    { customer_id: 'C1', created_at: '2025-10-05', acquisition_channel: 'search' },
    { customer_id: 'C2', created_at: '2024-02-01', acquisition_channel: 'organic' },
  ],
  shopify_orders: [
    { order_id: 'O1', customer_id: 'C1', created_at: '2025-10-05T10:00:00Z', channel: 'search', discount_code: null, discount_amount: 0, subtotal: 128, shipping_charged: 0, line_items: [{ sku: 'AAA-BLK-M', qty: 1, unit_price: 100 }, { sku: 'TEE-WHI-M', qty: 1, unit_price: 28 }] },
    { order_id: 'O2', customer_id: 'C2', created_at: '2025-11-01T10:00:00Z', channel: 'email', discount_code: 'TEE2FOR50', discount_amount: 6, subtotal: 50, shipping_charged: 0, line_items: [{ sku: 'TEE-WHI-M', qty: 2, unit_price: 28 }] },
    { order_id: 'O3', customer_id: 'C1', created_at: '2025-12-01T10:00:00Z', channel: 'email', discount_code: null, discount_amount: 0, subtotal: 28, shipping_charged: 7.95, line_items: [{ sku: 'TEE-WHI-M', qty: 1, unit_price: 28 }] },
  ],
  shopify_refunds: [{ refund_id: 'R1', order_id: 'O1', sku: 'TEE-WHI-M', qty: 1, amount: 28, reason: 'quality', refunded_at: '2025-10-20' }],
  threepl_shipments: [
    { order_id: 'O1', shipped_at: '2025-10-06', outbound_cost: 9.15, pick_pack_cost: 3.75 },
    { order_id: 'O2', shipped_at: '2025-11-02', outbound_cost: 9.15, pick_pack_cost: 3.75 },
    { order_id: 'O3', shipped_at: '2025-12-02', outbound_cost: 8.0, pick_pack_cost: 3.0 },
  ],
  threepl_returns: [{ refund_id: 'R1', processing_cost: 7.25, return_label_cost: 8, restocked: false }],
  quickbooks_opex: [],
  inventory: [
    { sku: 'AAA-BLK-M', on_hand: 10, weekly_sales_velocity: 1, supplier: 'S', lead_time_days: 42, moq: 100 },
    { sku: 'TEE-WHI-M', on_hand: 10, weekly_sales_velocity: 1, supplier: 'S', lead_time_days: 42, moq: 100 },
  ],
  inventory_stockouts: [],
  suppliers: [],
};
const m = buildModel(raw, 50, 7.95);
const P: Params = { allocation: 'revenue', returnMultiplier: 1, freightPerOrder: null, threshold: 50 };
const O1 = 100 - 30 - 19 - (0.029 * 128 + 0.3) - 9.15 - 3.75 - (7.25 + 8); // 18.838
const O2 = 50 - 38 - (0.029 * 50 + 0.3) - 9.15 - 3.75; // -2.65
const O3 = 28 - 19 - (0.029 * (28 + 7.95) + 0.3) - (8 - 7.95) - 3; // 4.60745

describe('waterfall', () => {
  it('reproduces the hand-computed company contribution margin', () => {
    const w = companyWaterfall(m, evaluate(m, P));
    expect(w.gross).toBeCloseTo(212, 6);
    expect(w.discounts).toBeCloseTo(6, 6);
    expect(w.refunds).toBeCloseTo(28, 6);
    expect(w.netRevenue).toBeCloseTo(178, 6);
    expect(w.cogs).toBeCloseTo(30 + 38 + 19, 6);
    expect(w.writeoffs).toBeCloseTo(19, 6);
    expect(w.shipping).toBeCloseTo(9.15 + 9.15 + 0.05, 6);
    expect(w.pickpack).toBeCloseTo(10.5, 6);
    expect(w.returnCosts).toBeCloseTo(15.25, 6);
    expect(w.cm).toBeCloseTo(O1 + O2 + O3, 6);
  });
  it('company total does not depend on the allocation method', () => {
    const a = totalCm(evaluate(m, P));
    const b = totalCm(evaluate(m, { ...P, allocation: 'units' }));
    expect(a).toBeCloseTo(b, 9);
  });
  it('allocates order-level costs by revenue share', () => {
    const tee = waterfallBy(m, evaluate(m, P), 'sku').find((g) => g.key === 'TEE-WHI-M')!;
    const s = 28 / 128;
    const teeO1 = 28 - 28 - 0 - 19 - 0.029 * 28 - s * (0.3 + 9.15 + 3.75) - 15.25;
    expect(tee.cm).toBeCloseTo(teeO1 + O2 + O3, 6);
  });
  it('allocates by units when toggled', () => {
    const tee = waterfallBy(m, evaluate(m, { ...P, allocation: 'units' }), 'sku').find((g) => g.key === 'TEE-WHI-M')!;
    const teeO1 = 28 - 28 - 19 - 0.029 * 28 - 0.5 * (0.3 + 9.15 + 3.75) - 15.25;
    expect(tee.cm).toBeCloseTo(teeO1 + O2 + O3, 6);
  });
});

describe('levers', () => {
  it('higher freight lowers margin; higher return multiplier lowers margin', () => {
    const base = totalCm(evaluate(m, P));
    expect(totalCm(evaluate(m, { ...P, freightPerOrder: 12 }))).toBeLessThan(base);
    expect(totalCm(evaluate(m, { ...P, returnMultiplier: 1.3 }))).toBeLessThan(base);
    expect(totalCm(evaluate(m, { ...P, returnMultiplier: 0.5 }))).toBeGreaterThan(base);
  });
  it('raising the threshold charges shipping on the $50 order', () => {
    const r = runScenario(m, P, [{ id: 'X', kind: 'shipping_threshold', threshold: 60, abandon: 0 }]);
    expect(r.actions[0].annual_contribution_delta).toBe(Math.round(7.95 * (1 - 0.029)));
  });
  it('abandon rate removes newly-charged orders', () => {
    const r = runScenario(m, P, [{ id: 'X', kind: 'shipping_threshold', threshold: 60, abandon: 1 }]);
    expect(r.actions[0].annual_contribution_delta).toBe(Math.round(-O2));
  });
  it('removal is incremental: order base costs stay when other items remain', () => {
    const without = 100 - 30 - (0.029 * 100 + 0.3) - 8.0 - 3.0; // O1 with only A; O2/O3 vanish
    const r = runScenario(m, P, [{ id: 'X', kind: 'pause_skus', skus: ['TEE'], months: 12 }]);
    expect(r.actions[0].annual_contribution_delta).toBe(Math.round(without - (O1 + O2 + O3)));
    const b = basketAttach(m, evaluate(m, P), P, 'TEE');
    expect(b.incremental_cm_if_removed).toBeCloseTo(O1 + O2 + O3 - without, 6);
    expect(b.attach_rate_multi_item).toBeCloseTo(1, 9);
  });
  it('discount rule rescales the discount and applies retention', () => {
    // fixture has no WELCOME30 orders, so the rule is a no-op
    const r = runScenario(m, P, [{ id: 'X', kind: 'discount_rule', code: 'WELCOME30', new_pct: 0.15, retention: 0.5 }]);
    expect(r.actions[0].annual_contribution_delta).toBe(0);
  });
});

describe('utilities', () => {
  it('allocateCents sums exactly', () => {
    const a = allocateCents(1001, [3, 3, 3]);
    expect(a.reduce((x, y) => x + y, 0)).toBe(1001);
  });
  it('mulberry32(42) is deterministic', () => {
    const a = mulberry32(42), b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
