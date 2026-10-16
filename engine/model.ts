// The unified layer: raw source tables are joined into one columnar model.
// The CLI builds it from /data/*.json; the browser rebuilds it from a compact
// encoding of the same model. Both run the identical finalize() below.
import { allocateCents, dateToDay } from './util';
import { SHIPPING } from '../data-gen/assumptions';
import type { RawData, SkuInfo, InventoryRow, StockoutRow, Supplier } from './types';

export type Compact = {
  skus: SkuInfo[];
  channels: string[];
  codes: string[]; // index 0 = no code
  custIds: string[];
  custAcq: number[]; // channel index
  custCreatedDay: number[]; // negative = pre-window customer
  oIds: string[];
  oCust: number[];
  oDay: number[];
  oCh: number[];
  oCode: number[];
  oDiscC: number[];
  oShipC: number[];
  oOutC: number[];
  oPickC: number[];
  oLines: number[]; // flat: n, sku, qty, sku, qty, ...
  ret: number[]; // flat per returned line: lineIdx, retQty, restockQty, refundC, labelC, procC
  inventory: InventoryRow[];
  stockouts: StockoutRow[];
  suppliers: Supplier[];
  baseThreshold: number;
  flatShipping: number;
};

export type Model = {
  skus: SkuInfo[];
  skuIndex: Record<string, number>;
  channels: string[];
  codes: string[];
  custIds: string[];
  custAcq: number[];
  custCreatedDay: number[];
  custIsNew: boolean[];
  custFirstCode: number[]; // code index of the customer's first in-window order (new customers)
  custFirstOrder: number[];
  nOrders: number;
  oIds: string[];
  oCust: number[];
  oDay: number[];
  oCh: number[];
  oCode: number[];
  oGross: number[]; // dollars
  oDisc: number[];
  oSubtotal: number[];
  oShip: number[]; // shipping charged
  oOut: number[]; // outbound cost
  oPick: number[];
  oUnits: number[];
  oZone: number[]; // derived 3PL zone factor
  oStart: number[];
  oEnd: number[];
  nLines: number;
  lOrder: number[];
  lSku: number[];
  lQty: number[];
  lGross: number[];
  lDisc: number[];
  lRet: number[];
  lRestock: number[];
  lRefund: number[];
  lLabel: number[];
  lProc: number[];
  skuReturnRate: number[];
  avgLabelPerReturnedUnit: number;
  avgOutbound: number;
  inventory: InventoryRow[];
  stockouts: StockoutRow[];
  suppliers: Supplier[];
  baseThreshold: number;
  flatShipping: number;
  compact: Compact;
};

export function compactFromRaw(raw: RawData, baseThreshold: number, flatShipping: number): Compact {
  const cogs = new Map(raw.quickbooks_cogs.map((c) => [c.sku, c]));
  const inv = new Map(raw.inventory.map((r) => [r.sku, r]));
  const skus: SkuInfo[] = raw.shopify_products.map((p) => ({
    sku: p.sku,
    style: p.style,
    styleCode: p.sku.split('-')[0],
    category: p.category,
    size: p.size,
    color: p.color,
    price: p.list_price,
    landed: cogs.get(p.sku)!.landed_cost,
    supplier: inv.get(p.sku)?.supplier ?? '',
  }));
  const skuIdx = new Map(skus.map((s, i) => [s.sku, i]));
  const channels: string[] = [];
  const chIdx = (c: string) => {
    let i = channels.indexOf(c);
    if (i < 0) { channels.push(c); i = channels.length - 1; }
    return i;
  };
  const codes: string[] = [''];
  const codeIdx = (c: string | null) => {
    if (!c) return 0;
    let i = codes.indexOf(c);
    if (i < 0) { codes.push(c); i = codes.length - 1; }
    return i;
  };
  const custIds = raw.shopify_customers.map((c) => c.customer_id);
  const custMap = new Map(custIds.map((c, i) => [c, i]));
  const custAcq = raw.shopify_customers.map((c) => chIdx(c.acquisition_channel));
  const custCreatedDay = raw.shopify_customers.map((c) => dateToDay(c.created_at));
  const ship = new Map(raw.threepl_shipments.map((s) => [s.order_id, s]));

  const c: Compact = {
    skus, channels, codes, custIds, custAcq, custCreatedDay,
    oIds: [], oCust: [], oDay: [], oCh: [], oCode: [], oDiscC: [], oShipC: [], oOutC: [], oPickC: [], oLines: [], ret: [],
    inventory: raw.inventory, stockouts: raw.inventory_stockouts, suppliers: raw.suppliers, baseThreshold, flatShipping,
  };
  const lineKey = new Map<string, number>();
  let li = 0;
  for (const o of raw.shopify_orders) {
    c.oIds.push(o.order_id);
    c.oCust.push(custMap.get(o.customer_id)!);
    c.oDay.push(dateToDay(o.created_at));
    c.oCh.push(chIdx(o.channel));
    c.oCode.push(codeIdx(o.discount_code));
    c.oDiscC.push(Math.round(o.discount_amount * 100));
    c.oShipC.push(Math.round(o.shipping_charged * 100));
    const s = ship.get(o.order_id)!;
    c.oOutC.push(Math.round(s.outbound_cost * 100));
    c.oPickC.push(Math.round(s.pick_pack_cost * 100));
    c.oLines.push(o.line_items.length);
    for (const l of o.line_items) {
      c.oLines.push(skuIdx.get(l.sku)!, l.qty);
      lineKey.set(o.order_id + '|' + l.sku, li++);
    }
  }
  const tplRet = new Map(raw.threepl_returns.map((r) => [r.refund_id, r]));
  const agg = new Map<number, number[]>();
  for (const r of raw.shopify_refunds) {
    const idx = lineKey.get(r.order_id + '|' + r.sku);
    if (idx === undefined) throw new Error('refund without line ' + r.refund_id);
    const t = tplRet.get(r.refund_id)!;
    const a = agg.get(idx) ?? [0, 0, 0, 0, 0];
    a[0] += r.qty;
    a[1] += t.restocked ? r.qty : 0;
    a[2] += Math.round(r.amount * 100);
    a[3] += Math.round(t.return_label_cost * 100);
    a[4] += Math.round(t.processing_cost * 100);
    agg.set(idx, a);
  }
  for (const [idx, a] of [...agg.entries()].sort((x, y) => x[0] - y[0])) c.ret.push(idx, ...a);
  return c;
}

export function finalize(c: Compact): Model {
  const nOrders = c.oIds.length;
  const m: Model = {
    skus: c.skus,
    skuIndex: Object.fromEntries(c.skus.map((s, i) => [s.sku, i])),
    channels: c.channels, codes: c.codes, custIds: c.custIds, custAcq: c.custAcq, custCreatedDay: c.custCreatedDay,
    custIsNew: c.custCreatedDay.map((d) => d >= 0),
    custFirstCode: new Array(c.custIds.length).fill(-1),
    custFirstOrder: new Array(c.custIds.length).fill(-1),
    nOrders, oIds: c.oIds, oCust: c.oCust, oDay: c.oDay, oCh: c.oCh, oCode: c.oCode,
    oGross: [], oDisc: [], oSubtotal: [], oShip: [], oOut: [], oPick: [], oUnits: [], oZone: [], oStart: [], oEnd: [],
    nLines: 0, lOrder: [], lSku: [], lQty: [], lGross: [], lDisc: [], lRet: [], lRestock: [], lRefund: [], lLabel: [], lProc: [],
    skuReturnRate: [], avgLabelPerReturnedUnit: 0, avgOutbound: 0,
    inventory: c.inventory, stockouts: c.stockouts, suppliers: c.suppliers,
    baseThreshold: c.baseThreshold, flatShipping: c.flatShipping, compact: c,
  };
  let p = 0;
  for (let o = 0; o < nOrders; o++) {
    const n = c.oLines[p++];
    const start = m.lOrder.length;
    const grossC: number[] = [];
    let units = 0;
    for (let k = 0; k < n; k++) {
      const sku = c.oLines[p++];
      const qty = c.oLines[p++];
      m.lOrder.push(o); m.lSku.push(sku); m.lQty.push(qty);
      grossC.push(Math.round(c.skus[sku].price * 100) * qty);
      units += qty;
    }
    const discC = allocateCents(c.oDiscC[o], grossC);
    const gC = grossC.reduce((a, b) => a + b, 0);
    for (let k = 0; k < n; k++) {
      m.lGross.push(grossC[k] / 100); m.lDisc.push(discC[k] / 100);
      m.lRet.push(0); m.lRestock.push(0); m.lRefund.push(0); m.lLabel.push(0); m.lProc.push(0);
    }
    m.oStart.push(start); m.oEnd.push(start + n);
    m.oGross.push(gC / 100); m.oDisc.push(c.oDiscC[o] / 100); m.oSubtotal.push((gC - c.oDiscC[o]) / 100);
    m.oShip.push(c.oShipC[o] / 100); m.oOut.push(c.oOutC[o] / 100); m.oPick.push(c.oPickC[o] / 100); m.oUnits.push(units);
    const nominal = SHIPPING.outboundBase + SHIPPING.outboundPerExtraUnit * (units - 1);
    m.oZone.push(c.oOutC[o] / 100 / nominal);
    const cu = c.oCust[o];
    if (m.custFirstOrder[cu] < 0) { m.custFirstOrder[cu] = o; m.custFirstCode[cu] = c.oCode[o]; }
  }
  m.nLines = m.lOrder.length;
  let labelSum = 0, retUnits = 0;
  for (let i = 0; i < c.ret.length; i += 6) {
    const l = c.ret[i];
    m.lRet[l] = c.ret[i + 1]; m.lRestock[l] = c.ret[i + 2]; m.lRefund[l] = c.ret[i + 3] / 100;
    m.lLabel[l] = c.ret[i + 4] / 100; m.lProc[l] = c.ret[i + 5] / 100;
  }
  // Return labels are billed per package; re-spread each order's label cost over its returned units.
  for (let o = 0; o < nOrders; o++) {
    let lab = 0, ru = 0;
    for (let l = m.oStart[o]; l < m.oEnd[o]; l++) { lab += m.lLabel[l]; ru += m.lRet[l]; }
    if (ru > 0) for (let l = m.oStart[o]; l < m.oEnd[o]; l++) m.lLabel[l] = (lab * m.lRet[l]) / ru;
    labelSum += lab; retUnits += ru;
  }
  m.avgLabelPerReturnedUnit = retUnits ? labelSum / retUnits : 8.5;
  const sold = new Array(c.skus.length).fill(0), ret = new Array(c.skus.length).fill(0);
  for (let l = 0; l < m.nLines; l++) { sold[m.lSku[l]] += m.lQty[l]; ret[m.lSku[l]] += m.lRet[l]; }
  m.skuReturnRate = sold.map((s, i) => (s ? ret[i] / s : 0));
  m.avgOutbound = m.oOut.reduce((a, b) => a + b, 0) / nOrders;
  // Integrity: the shipping-charged rule must reproduce Shopify's data at the base threshold.
  for (let o = 0; o < nOrders; o++) {
    const expect = m.oSubtotal[o] < c.baseThreshold - 1e-9 ? c.flatShipping : 0;
    if (Math.abs(expect - m.oShip[o]) > 0.001) throw new Error(`shipping rule mismatch on ${m.oIds[o]}`);
  }
  return m;
}

export const buildModel = (raw: RawData, baseThreshold: number, flatShipping: number) =>
  finalize(compactFromRaw(raw, baseThreshold, flatShipping));
