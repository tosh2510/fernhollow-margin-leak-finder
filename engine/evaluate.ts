// One evaluator for every number in the product: baseline waterfall, slider
// what-ifs and scenario actions. Order-level costs are computed per order and
// then *allocated* to lines only for attribution; totals never depend on the
// allocation method.
import { FEES, SHIPPING, RETURNS } from '../data-gen/assumptions';
import type { Model } from './model';
import type { Params } from './types';

export const DEFAULT_PARAMS = (m: Model): Params => ({
  allocation: 'revenue',
  returnMultiplier: 1,
  freightPerOrder: null,
  threshold: m.baseThreshold,
});

/** Per-order / per-line levers that scenario actions set. */
export type Overrides = {
  orderWeight?: Float64Array; // expected share of the order that still happens (0..1)
  linePresence?: Float64Array; // probability the line is still sold (0..1)
  lineDiscFactor?: Float64Array; // multiply the allocated discount
  skuReturnMult?: Float64Array; // per-SKU multiplier on the return rate
  thresholdAbandon?: number; // share of newly-charged orders lost
};

export const COMPONENTS = [
  'gross', 'discounts', 'refunds', 'cogs', 'writeoffs', 'fees', 'shipping', 'pickpack', 'returnCosts',
] as const;
export type Component = (typeof COMPONENTS)[number];

export type EvalResult = {
  // per line, already weighted by order weight × presence
  gross: Float64Array; discounts: Float64Array; refunds: Float64Array; cogs: Float64Array;
  writeoffs: Float64Array; fees: Float64Array; shipping: Float64Array; pickpack: Float64Array;
  returnCosts: Float64Array; cm: Float64Array;
  units: Float64Array; returnedUnits: Float64Array;
  // per order
  orderCm: Float64Array; orderWeightEff: Float64Array; orderShipCharged: Float64Array; orderOutbound: Float64Array;
  freightScale: number;
};

export function evaluate(m: Model, params: Params, ov: Overrides = {}): EvalResult {
  const L = m.nLines, O = m.nOrders;
  const r: EvalResult = {
    gross: new Float64Array(L), discounts: new Float64Array(L), refunds: new Float64Array(L), cogs: new Float64Array(L),
    writeoffs: new Float64Array(L), fees: new Float64Array(L), shipping: new Float64Array(L), pickpack: new Float64Array(L),
    returnCosts: new Float64Array(L), cm: new Float64Array(L), units: new Float64Array(L), returnedUnits: new Float64Array(L),
    orderCm: new Float64Array(O), orderWeightEff: new Float64Array(O), orderShipCharged: new Float64Array(O),
    orderOutbound: new Float64Array(O),
    freightScale: params.freightPerOrder == null ? 1 : params.freightPerOrder / m.avgOutbound,
  };
  const T = params.threshold;
  const baseT = m.baseThreshold;
  const abandon = ov.thresholdAbandon ?? 0;
  const procRate = FEES.returnProcessingPerUnit;
  const alloc = new Float64Array(16);

  for (let o = 0; o < O; o++) {
    const s = m.oStart[o], e = m.oEnd[o];
    let w = ov.orderWeight ? ov.orderWeight[o] : 1;
    if (w <= 0) continue;
    let pEmpty = 1, eUnits = 0, sub = 0;
    for (let l = s; l < e; l++) {
      const p = ov.linePresence ? ov.linePresence[l] : 1;
      const disc = m.lDisc[l] * (ov.lineDiscFactor ? ov.lineDiscFactor[l] : 1);
      pEmpty *= 1 - p;
      eUnits += p * m.lQty[l];
      sub += p * (m.lGross[l] - disc);
    }
    const pN = 1 - pEmpty;
    if (pN <= 0) continue;
    const subIfExists = sub / pN;
    // Shipping charged under the evaluated threshold.
    const charged = subIfExists < T - 1e-9 ? m.flatShipping : 0;
    // Orders that were free at the historical threshold but now pay: some abandon.
    if (charged > 0 && m.oSubtotal[o] >= baseT - 1e-9 && T > baseT) w *= 1 - abandon;
    const unitsIfExists = eUnits / pN;
    const outbound = pN * Math.min(SHIPPING.outboundCap, m.oZone[o] * (SHIPPING.outboundBase + SHIPPING.outboundPerExtraUnit * (unitsIfExists - 1))) * r.freightScale;
    const pick = pN * (FEES.pickPackBase + FEES.pickPackPerExtraUnit * (unitsIfExists - 1));
    const shipCharged = pN * charged;
    const feeOrder = pN * FEES.paymentFixed + FEES.paymentPct * shipCharged;
    const orderCosts = { shipping: outbound - shipCharged, pickpack: pick, fees: feeOrder };

    // allocation weights
    let wsum = 0;
    const n = e - s;
    for (let k = 0; k < n; k++) {
      const l = s + k;
      const p = ov.linePresence ? ov.linePresence[l] : 1;
      const disc = m.lDisc[l] * (ov.lineDiscFactor ? ov.lineDiscFactor[l] : 1);
      alloc[k] = params.allocation === 'revenue' ? p * (m.lGross[l] - disc) : p * m.lQty[l];
      wsum += alloc[k];
    }
    let ocm = 0;
    for (let k = 0; k < n; k++) {
      const l = s + k;
      const p = ov.linePresence ? ov.linePresence[l] : 1;
      const share = wsum > 0 ? alloc[k] / wsum : 1 / n;
      const qty = m.lQty[l];
      const sku = m.skus[m.lSku[l]];
      const df = ov.lineDiscFactor ? ov.lineDiscFactor[l] : 1;
      const disc = m.lDisc[l] * df;
      const net = m.lGross[l] - disc;
      const netUnit = net / qty;
      const refundScale = m.lGross[l] - m.lDisc[l] > 0 ? net / (m.lGross[l] - m.lDisc[l]) : 1;
      // Returns: scale actual returns down, or add expected extra returns from kept units.
      const mult = params.returnMultiplier * (ov.skuReturnMult ? ov.skuReturnMult[m.lSku[l]] : 1);
      const R = m.skuReturnRate[m.lSku[l]];
      const ret0 = m.lRet[l];
      let retU: number, refund: number, writeU: number, label: number;
      if (mult <= 1) {
        retU = ret0 * mult;
        refund = m.lRefund[l] * refundScale * mult;
        writeU = (ret0 - m.lRestock[l]) * mult;
        label = m.lLabel[l] * mult;
      } else {
        const extraP = R < 1 ? Math.min(1, ((mult - 1) * R) / (1 - R)) : 0;
        const extra = (qty - ret0) * extraP;
        retU = ret0 + extra;
        refund = m.lRefund[l] * refundScale + extra * netUnit;
        const rr = sku.styleCode === 'WRP' ? RETURNS.wrapRestockRate : RETURNS.restockRate;
        writeU = ret0 - m.lRestock[l] + extra * (1 - rr);
        label = m.lLabel[l] + extra * m.avgLabelPerReturnedUnit;
      }
      const f = w * p;
      r.gross[l] = f * m.lGross[l];
      r.discounts[l] = f * disc;
      r.refunds[l] = f * refund;
      r.cogs[l] = f * (qty - retU) * sku.landed;
      r.writeoffs[l] = f * writeU * sku.landed;
      r.fees[l] = f * FEES.paymentPct * net + w * share * orderCosts.fees;
      r.shipping[l] = w * share * orderCosts.shipping;
      r.pickpack[l] = w * share * orderCosts.pickpack;
      r.returnCosts[l] = f * (retU * procRate + label);
      r.units[l] = f * qty;
      r.returnedUnits[l] = f * retU;
      const cm = r.gross[l] - r.discounts[l] - r.refunds[l] - r.cogs[l] - r.writeoffs[l] - r.fees[l] - r.shipping[l] - r.pickpack[l] - r.returnCosts[l];
      r.cm[l] = cm;
      ocm += cm;
    }
    r.orderCm[o] = ocm;
    r.orderWeightEff[o] = w * pN;
    r.orderShipCharged[o] = w * shipCharged;
    r.orderOutbound[o] = w * outbound;
  }
  return r;
}

export function totalCm(r: EvalResult): number {
  let t = 0;
  for (let i = 0; i < r.orderCm.length; i++) t += r.orderCm[i];
  return t;
}
