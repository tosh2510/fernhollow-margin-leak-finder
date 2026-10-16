// Every parameter used to generate Fernhollow's synthetic data and to run the
// margin engine lives here. The app renders ASSUMPTION_TABLE on the About page.
// Where a realism call was needed, the conservative, defensible number was
// chosen and the reasoning is written next to it.

export const SEED = 42;

export const WINDOW = {
  start: '2025-10-01', // day 0
  end: '2026-09-30', // day 364 (inclusive)
  days: 365,
  syncedAt: '2026-10-16T06:00:00Z', // "last synced" for the mirror; refunds lag orders
  asOf: '2026-09-30', // inventory snapshot date
};

export const SIZES = ['XS', 'S', 'M', 'L', 'XL'] as const;
// Size curve from the brief (8/20/32/26/14). Applied per customer, with a 12%
// chance any given line is bought in an adjacent size (gifting, fit preference).
export const SIZE_CURVE = [0.08, 0.2, 0.32, 0.26, 0.14];

export type StyleDef = {
  code: string;
  style: string;
  category: string;
  price: number;
  colors: string[];
  colorWeights: number[];
  fob: number;
  freight: number; // inbound freight per unit, sea, landed into a US 3PL
  duty: number; // effective duty rate on FOB
  supplier: string;
  baseReturn: number; // unit return rate before planted effects
  popularity: number; // relative unit share among non-tee styles
  seasonality: number[]; // Oct..Sep multipliers
};

// Landed cost = FOB × (1 + duty) + inbound freight. Duty rates are blended
// effective rates (MFN + additional tariffs) inside the 16–28% band the brief
// specifies; in reality they should come from the customs broker per HTS code
// and origin, because the 2025–26 tariff regime moves.
export const STYLES: StyleDef[] = [
  {
    code: 'TEE', style: 'Core Tee', category: 'Tops', price: 28,
    colors: ['White', 'Black', 'Heather Grey'], colorWeights: [0.4, 0.35, 0.25],
    // Deliberately low-margin traffic SKU: 240gsm organic jersey, Portugal-made,
    // priced against mass-market basics. FOB $15.95 → ~32% gross margin at list.
    fob: 15.95, freight: 0.45, duty: 0.165, supplier: 'SUP-01',
    baseReturn: 0.09, popularity: 0,
    seasonality: [0.9, 1.0, 1.1, 0.8, 0.8, 0.95, 1.05, 1.15, 1.2, 1.15, 1.0, 0.9],
  },
  {
    code: 'POL', style: 'Knit Polo', category: 'Tops', price: 78,
    colors: ['Navy', 'White'], colorWeights: [0.6, 0.4],
    fob: 18.6, freight: 0.7, duty: 0.197, supplier: 'SUP-02',
    baseReturn: 0.19, popularity: 0.17,
    seasonality: [0.8, 0.8, 0.9, 0.7, 0.75, 1.0, 1.15, 1.25, 1.3, 1.25, 1.1, 0.95],
  },
  {
    code: 'CHN', style: 'Chino', category: 'Bottoms', price: 98,
    colors: ['Khaki', 'Navy', 'Olive'], colorWeights: [0.45, 0.35, 0.2],
    fob: 23.4, freight: 0.95, duty: 0.166, supplier: 'SUP-03',
    baseReturn: 0.29, popularity: 0.22,
    seasonality: [1.1, 1.1, 1.1, 1.0, 0.95, 1.0, 1.0, 0.9, 0.85, 0.85, 1.0, 1.1],
  },
  {
    code: 'LIN', style: 'Linen Shirt', category: 'Tops', price: 88,
    colors: ['White', 'Sky'], colorWeights: [0.55, 0.45],
    fob: 21.0, freight: 0.6, duty: 0.18, supplier: 'SUP-04',
    baseReturn: 0.24, popularity: 0.12,
    seasonality: [0.35, 0.25, 0.3, 0.3, 0.5, 0.9, 1.4, 1.9, 2.2, 2.1, 1.5, 0.8],
  },
  {
    code: 'WRP', style: 'Wrap Dress', category: 'Dresses', price: 148,
    colors: ['Black', 'Terracotta'], colorWeights: [0.55, 0.45],
    fob: 39.0, freight: 0.9, duty: 0.22, supplier: 'SUP-05',
    baseReturn: 0.28, popularity: 0.13,
    seasonality: [0.9, 1.0, 1.15, 0.8, 0.9, 1.05, 1.15, 1.15, 1.1, 1.0, 0.95, 0.9],
  },
  {
    code: 'SLP', style: 'Slip Dress', category: 'Dresses', price: 128,
    colors: ['Champagne'], colorWeights: [1],
    fob: 30.0, freight: 0.8, duty: 0.22, supplier: 'SUP-05',
    baseReturn: 0.35, popularity: 0.07,
    seasonality: [0.8, 0.9, 1.3, 0.7, 0.8, 1.0, 1.2, 1.3, 1.25, 1.1, 0.9, 0.8],
  },
  {
    code: 'OVR', style: 'Overshirt', category: 'Outerwear', price: 118,
    colors: ['Stone'], colorWeights: [1],
    fob: 27.5, freight: 1.1, duty: 0.2, supplier: 'SUP-03',
    baseReturn: 0.2, popularity: 0.1,
    seasonality: [1.4, 1.3, 1.2, 1.0, 1.0, 1.15, 1.0, 0.7, 0.55, 0.6, 1.0, 1.3],
  },
  {
    code: 'KNT', style: 'Merino Crew', category: 'Knitwear', price: 138,
    colors: ['Oatmeal', 'Moss'], colorWeights: [0.62, 0.38],
    fob: 35.0, freight: 1.2, duty: 0.24, supplier: 'SUP-06',
    baseReturn: 0.21, popularity: 0.18,
    seasonality: [1.4, 2.0, 2.2, 1.6, 1.1, 0.65, 0.35, 0.2, 0.15, 0.2, 0.5, 1.0],
  },
];

export const SUPPLIERS = [
  { supplier_id: 'SUP-01', name: 'Ribeira Jersey Lda', country: 'Portugal', lead_time_days: 45, moq: 300, on_time_rate: 0.93 },
  { supplier_id: 'SUP-02', name: 'Kaveri Knit Mills', country: 'India', lead_time_days: 52, moq: 300, on_time_rate: 0.86 },
  { supplier_id: 'SUP-03', name: 'Song Lam Garment Co.', country: 'Vietnam', lead_time_days: 58, moq: 400, on_time_rate: 0.9 },
  { supplier_id: 'SUP-04', name: 'Coimbatore Linen Works', country: 'India', lead_time_days: 55, moq: 250, on_time_rate: 0.84 },
  { supplier_id: 'SUP-05', name: 'Ege Jersey Tekstil', country: 'Turkey', lead_time_days: 42, moq: 200, on_time_rate: 0.91 },
  { supplier_id: 'SUP-06', name: 'Huzhou Fine Knit', country: 'China', lead_time_days: 60, moq: 300, on_time_rate: 0.88 },
];

// Seasonality of order volume, Oct..Sep. Q4 peak (BFCM + holiday).
export const MONTH_WEIGHTS = [0.88, 1.3, 1.42, 0.72, 0.66, 0.85, 0.95, 1.0, 1.04, 0.98, 0.9, 0.82];

// Promotions (sitewide codes). Days are offsets from WINDOW.start.
export const PROMOS = [
  { code: 'BFCM25', pct: 0.25, from: 54, to: 61, uplift: 2.6 }, // Nov 24 – Dec 1
  { code: 'HOLIDAY20', pct: 0.2, from: 68, to: 80, uplift: 1.5 }, // Dec 8 – Dec 20
  { code: 'EMAIL15', pct: 0.15, from: 160, to: 164, uplift: 1.6 }, // Mar 10 – Mar 14
  { code: 'SUMMER20', pct: 0.2, from: 280, to: 292, uplift: 1.8 }, // Jul 8 – Jul 20
];
// Share of full-price-minded customers' orders inside a promo window that use the code.
export const PROMO_CODE_USE = 0.4;
// Evergreen automatic multi-buy on the core tee: 2 for $50 ($6 off per pair).
// Applies only when no code is used (codes and automatic discounts don't stack).
// Treated as standing pricing, not a promotion, in cohort analysis.
export const TEE_MULTIBUY = { code: 'TEE2FOR50', pairPrice: 50 };
export const EVERGREEN_CODES = ['TEE2FOR50'];

export const CUSTOMERS = {
  // Brief asked for ~4,000 customers AND $3.5–4.5M at a $110–160 AOV; those are
  // inconsistent (~15k orders × $130 ≈ $2M). Revenue/AOV were kept; customer and
  // order counts were scaled to match (see DECISIONS.md).
  newCustomers: 9000,
  existingCustomers: 4800, // active pre-window customers who order in the window
  welcomeShareOfAll: 0.18, // ~18% of all customers acquired via WELCOME30
  acquisitionChannels: ['paid_social', 'search', 'organic', 'email'] as const,
  // Mix for non-WELCOME30 new customers.
  channelMix: [0.4, 0.27, 0.23, 0.1],
  // WELCOME30 is distributed via paid social and the email pop-up.
  welcomeChannelMix: [0.7, 0.05, 0.05, 0.2],
  // Repeat behaviour within the window.
  fullPriceRepeatP: 0.45, // P(at least one more order)
  fullPriceRepeatContinue: 0.38, // P(another order | had one)
  welcomeConverterShare: 0.22, // WELCOME30 customers who become full-price buyers
  welcomeConverterRepeatP: 0.5,
  welcomeDealSeekerRepeatP: 0.3, // repeats only inside promo windows
  existingOrdersMean: 2.4, // in-window orders for existing customers (≥1)
  repeatGapDays: 70, // mean gap between orders
};

export const BASKET = {
  // Units in a non-tee-only basket before the tee attach decision.
  coreUnitsDist: [0.62, 0.26, 0.09, 0.03], // 1,2,3,4 units
  teeOnlyShare: 0.14, // baskets that are tees only
  teeOnlyUnitsDist: [0.3, 0.55, 0.15], // 1,2,3 tees
  // P(add a tee to a core basket) by core units 1,2,3,4: the tee is an add-on to fuller baskets.
  teeAttachByCoreUnits: [0.1, 0.34, 0.45, 0.5],
  sizeDeviationP: 0.12,
};

export const SHIPPING = {
  freeThreshold: 50, // planted: far below the ~$130 AOV
  flatRateCharged: 7.95, // what customers pay below the threshold
  // 3PL outbound cost: base + per extra unit, × zone factor U(0.92, 1.18).
  outboundBase: 8.0,
  outboundPerExtraUnit: 1.15,
  zoneMin: 0.92,
  zoneMax: 1.18,
  outboundCap: 14,
};

export const FEES = {
  paymentPct: 0.029,
  paymentFixed: 0.3,
  pickPackBase: 3.0,
  pickPackPerExtraUnit: 0.75,
  returnProcessingPerUnit: 7.25, // 3PL rate card (brief: $6–9)
  returnLabelMin: 7.6, // prepaid return label per return package
  returnLabelMax: 9.4,
};

export const RETURNS = {
  restockRate: 0.87, // returned units restocked; rest written off at landed cost
  // Planted leak 1: wrap dress M/L runs small.
  wrapFitSizes: ['M', 'L'],
  wrapFitReturn: 0.63,
  wrapOtherReturn: 0.25,
  wrapRestockRate: 0.58, // jersey dresses come back tried-on; lower restock
  reasons: ['size_too_small', 'size_too_large', 'changed_mind', 'not_as_pictured', 'quality', 'arrived_late'],
  baseReasonMix: [0.21, 0.21, 0.3, 0.12, 0.1, 0.06],
  wrapFitReasonMix: [0.7, 0.04, 0.12, 0.07, 0.05, 0.02],
  lagDaysMin: 7,
  lagDaysMax: 28,
};

// Planted leak 4: six core M/L SKUs with historical stockouts and thin cover now.
export const STOCKOUTS = [
  { sku: 'CHN-KHA-M', periods: [[62, 88], [251, 266]] },
  { sku: 'CHN-KHA-L', periods: [[66, 86], [255, 270]] },
  { sku: 'CHN-NAV-M', periods: [[70, 90]] },
  { sku: 'CHN-NAV-L', periods: [[72, 89], [300, 312]] },
  { sku: 'POL-NAV-M', periods: [[230, 252]] },
  { sku: 'POL-NAV-L', periods: [[236, 255]] },
] as { sku: string; periods: [number, number][] }[];
export const STOCKOUT_SUBSTITUTION = 0.25; // customer picks another colour instead

// Planted leak 6: one knitwear colourway over-bought.
export const SLOW_KNIT_COLOR = 'Moss';

// ---- Engine / analysis assumptions --------------------------------------
export const ENGINE = {
  defaultAllocation: 'revenue' as 'revenue' | 'units',
  safetyZ: 1.65, // 95% cycle service level
  reviewWeeks: 10, // cycle stock to cover after the PO lands
  carryingCostAnnual: 0.22, // of landed cost per year, for overstock
  thresholdAbandonRate: 0.12, // share of newly-charged orders lost when threshold rises
  thresholdTradeUpRate: 0, // basket-building upside NOT counted (conservative)
  stockoutSubstitution: STOCKOUT_SUBSTITUTION,
  sliderRanges: {
    returnMultiplier: [0.7, 1.3, 0.05],
    freightPerOrder: [7, 14, 0.25],
    freeShippingThreshold: [25, 150, 5],
  },
};

export type AssumptionRow = { group: string; name: string; value: string; why: string };

const pct = (x: number) => `${(x * 100).toFixed(1).replace(/\.0$/, '')}%`;

export const ASSUMPTION_TABLE: AssumptionRow[] = [
  { group: 'Scope', name: 'Window', value: `${WINDOW.start} → ${WINDOW.end}`, why: '12 months; mirror synced 16 Oct 2026 so late-September returns are captured.' },
  { group: 'Scope', name: 'Customers', value: `${CUSTOMERS.newCustomers.toLocaleString()} new + ${CUSTOMERS.existingCustomers.toLocaleString()} existing`, why: 'Sized so AOV, units/order and revenue all land in target ranges (brief’s 4k customers was inconsistent with $3.5–4.5M).' },
  { group: 'Scope', name: 'Size curve', value: 'XS 8 / S 20 / M 32 / L 26 / XL 14', why: 'Brief. 12% of lines bought in an adjacent size.' },
  ...STYLES.map((s) => ({
    group: 'Product',
    name: `${s.style} (${s.code})`,
    value: `$${s.price} list · FOB $${s.fob.toFixed(2)} · duty ${pct(s.duty)} · freight $${s.freight.toFixed(2)} → landed $${(s.fob * (1 + s.duty) + s.freight).toFixed(2)}`,
    why: s.code === 'TEE'
      ? 'Traffic SKU priced against mass basics; ~32% GM at list by design.'
      : `GM at list ${pct(1 - (s.fob * (1 + s.duty) + s.freight) / s.price)}; base unit return rate ${pct(s.baseReturn)}.`,
  })),
  { group: 'Product', name: 'Duty', value: '16.5–24% effective', why: 'Blended MFN + additional tariffs; real rates must come from the broker per HTS/origin.' },
  { group: 'Pricing', name: 'Tee multi-buy', value: '2 for $50 (automatic, no stacking)', why: 'Evergreen basics offer; a tee pair lands exactly on the $50 free-shipping threshold.' },
  { group: 'Fulfilment', name: 'Free-shipping threshold', value: `$${SHIPPING.freeThreshold} (subtotal after discounts)`, why: 'Planted: far below AOV.' },
  { group: 'Fulfilment', name: 'Shipping charged below threshold', value: `$${SHIPPING.flatRateCharged}`, why: 'Flat rate; treated as a recovery against outbound cost in the waterfall.' },
  { group: 'Fulfilment', name: 'Outbound cost', value: `$${SHIPPING.outboundBase} + $${SHIPPING.outboundPerExtraUnit}/extra unit × zone ${SHIPPING.zoneMin}–${SHIPPING.zoneMax}, cap $${SHIPPING.outboundCap}`, why: 'Ground parcel, 1–3 lb apparel; lands in the brief’s $7–14 range.' },
  { group: 'Fulfilment', name: 'Pick & pack', value: `$${FEES.pickPackBase.toFixed(2)}/order + $${FEES.pickPackPerExtraUnit}/extra unit`, why: 'Brief; typical 3PL rate card.' },
  { group: 'Fulfilment', name: 'Payment fees', value: `${pct(FEES.paymentPct)} + $${FEES.paymentFixed.toFixed(2)} on amount charged`, why: 'Brief. Not refunded on returns (Shopify Payments behaviour).' },
  { group: 'Returns', name: 'Return processing', value: `$${FEES.returnProcessingPerUnit}/unit`, why: '3PL rate card, inside the brief’s $6–9.' },
  { group: 'Returns', name: 'Return label', value: `$${FEES.returnLabelMin}–${FEES.returnLabelMax} per package`, why: 'Free returns; one prepaid label per return package.' },
  { group: 'Returns', name: 'Restock rate', value: `${pct(RETURNS.restockRate)} (wrap dress ${pct(RETURNS.wrapRestockRate)})`, why: 'Unrestocked units written off at landed cost. Jersey dresses come back tried-on more often.' },
  { group: 'Returns', name: 'Refund basis', value: 'Unit price net of allocated discount', why: 'Shipping is not refunded.' },
  { group: 'Allocation', name: 'Order-level costs', value: 'Revenue share (toggle: units)', why: 'Net outbound shipping, pick-pack and the order part of payment fees are spread across lines by line net sales. Units is the alternative. Company totals and incremental proposal impacts do not depend on this choice.' },
  { group: 'Allocation', name: 'Discounts', value: 'Revenue share', why: 'Mirrors Shopify discount allocations.' },
  { group: 'Allocation', name: 'Return labels', value: 'By returned units within the package', why: 'Label cost follows the units that were sent back.' },
  { group: 'Gross margin', name: 'Definition', value: '(Sales after discounts − landed COGS of shipped units) / sales after discounts', why: 'Before returns, fulfilment and fees; the waterfall covers the rest.' },
  { group: 'Inventory', name: 'Safety stock', value: `z=${ENGINE.safetyZ} × σ(weekly units) × √(lead time weeks)`, why: '95% cycle service level.' },
  { group: 'Inventory', name: 'Order-up-to', value: `ROP + ${ENGINE.reviewWeeks} weeks cycle stock; MOQ applied per style-colour`, why: 'Supplier MOQs are per colourway across sizes; top-ups follow the size curve.' },
  { group: 'Inventory', name: 'Stockout substitution', value: pct(STOCKOUT_SUBSTITUTION), why: 'Share of stocked-out demand that switched colour; the rest is lost.' },
  { group: 'Inventory', name: 'Carrying cost', value: `${pct(ENGINE.carryingCostAnnual)} of landed / year`, why: 'Capital + storage + shrink; conservative mid-range.' },
  { group: 'Scenario', name: 'Threshold abandon rate', value: pct(ENGINE.thresholdAbandonRate), why: 'Share of orders that newly pay shipping and are lost instead. Low confidence; test before rollout.' },
  { group: 'Scenario', name: 'Threshold trade-up', value: 'Not counted', why: 'Basket-building to clear a higher threshold is real but excluded to keep the estimate conservative.' },
  { group: 'Scenario', name: 'Line removal', value: 'Incremental', why: 'Removing a SKU saves its direct costs and per-unit fulfilment, not the order base costs, unless the order disappears.' },
];
