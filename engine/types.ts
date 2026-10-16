// Raw source tables, field names mimic each system of record.
export type ShopifyOrder = {
  order_id: string;
  customer_id: string;
  created_at: string;
  channel: string;
  discount_code: string | null;
  discount_amount: number;
  subtotal: number; // after discounts, before shipping and tax (Shopify subtotal_price)
  shipping_charged: number;
  line_items: { sku: string; qty: number; unit_price: number }[];
};
export type ShopifyRefund = {
  refund_id: string;
  order_id: string;
  sku: string;
  qty: number;
  amount: number;
  reason: string;
  refunded_at: string;
};
export type ShopifyProduct = { sku: string; style: string; category: string; size: string; color: string; list_price: number; status: string };
export type ShopifyCustomer = { customer_id: string; created_at: string; acquisition_channel: string };
export type QbCogs = { sku: string; fob_cost: number; inbound_freight_per_unit: number; duty_rate: number; landed_cost: number };
export type QbOpex = { month: string; account: string; vendor: string; amount: number };
export type TplShipment = { order_id: string; shipped_at: string; outbound_cost: number; pick_pack_cost: number };
export type TplReturn = { refund_id: string; processing_cost: number; return_label_cost: number; restocked: boolean };
export type InventoryRow = { sku: string; on_hand: number; weekly_sales_velocity: number; supplier: string; lead_time_days: number; moq: number };
export type StockoutRow = { sku: string; out_of_stock_from: string; back_in_stock_at: string };
export type Supplier = { supplier_id: string; name: string; country: string; lead_time_days: number; moq: number; on_time_rate: number };

export type RawData = {
  shopify_orders: ShopifyOrder[];
  shopify_refunds: ShopifyRefund[];
  shopify_products: ShopifyProduct[];
  shopify_customers: ShopifyCustomer[];
  quickbooks_cogs: QbCogs[];
  quickbooks_opex: QbOpex[];
  threepl_shipments: TplShipment[];
  threepl_returns: TplReturn[];
  inventory: InventoryRow[];
  inventory_stockouts: StockoutRow[];
  suppliers: Supplier[];
};

export type SkuInfo = {
  sku: string;
  style: string;
  styleCode: string;
  category: string;
  size: string;
  color: string;
  price: number;
  landed: number;
  supplier: string;
};

export type Allocation = 'revenue' | 'units';
export type Params = {
  allocation: Allocation;
  returnMultiplier: number;
  freightPerOrder: number | null; // null = as billed by the 3PL
  threshold: number;
};
