import { BILLING_PREFIX, billingCategoryMatches, billingDateInRange, createDeliveryBillingInvoice, normalizeBillingText, selectedBillingCategories } from './igeveBilling.ts';
import type { BillingCategorySelection, BillingInvoice, BillingItem, BillingOperation, BillingOrder, BillingPoint } from './igeveBilling.ts';

export const FREIGHT_PREFIX = 'gom_igeve_freight_';
export interface BillingFreight { key: string; operationId: string; categories: string[]; start: string; end: string; amount: number }
export interface SavedFreight { freight: BillingFreight; version: string }
export const freightKey = (operationId: string, categories: BillingCategorySelection, start: string, end: string) => `${FREIGHT_PREFIX}${encodeURIComponent(JSON.stringify([operationId, selectedBillingCategories(categories), start, end]))}`;
const productKey = (item: BillingItem, category: string) => JSON.stringify([normalizeBillingText(item.category || category), normalizeBillingText(item.product), normalizeBillingText(item.unit)]);
export interface FreightSource { orders: BillingOrder[]; operations: BillingOperation[]; points: BillingPoint[]; invoices: BillingInvoice[]; prices: Parameters<typeof createDeliveryBillingInvoice>[4]; date: string }

// Use exactly the source deliveries shown by the operation/category/delivery-period filters.
export function freightSourceInvoices(source: FreightSource, scope: Pick<BillingFreight, 'operationId' | 'categories' | 'start' | 'end'>) {
  const saved = new Map(source.invoices.filter(invoice => !invoice.location && !invoice.parentId).map(invoice => [invoice.id, invoice]));
  if (scope.start && scope.end && scope.start > scope.end) return [];
  return source.orders.filter(order => source.operations.some(operation => operation.id === order.operationId) && (!scope.operationId || order.operationId === scope.operationId) && billingCategoryMatches(order.category, scope.categories) && billingDateInRange(order.deliveryDate, scope.start, scope.end)).flatMap(order => order.deliveries.map(delivery => saved.get(`${BILLING_PREFIX}${order.id}_${delivery.id}`) || createDeliveryBillingInvoice(order, delivery, source.operations.find(operation => operation.id === order.operationId), source.points.find(point => point.id === delivery.deliveryPointId), source.prices, source.date)));
}

export function allocateFilteredFreight(invoices: BillingInvoice[], amount: number) {
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100)) || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) throw new Error('Informe um frete maior ou igual a zero, com até duas casas decimais.');
  const rows = invoices.flatMap(invoice => invoice.items.map(item => ({ invoice, item, quantity: Math.max(0, Math.round((item.billedQuantity ?? item.quantity) * 1000)), cents: 0 })));
  const quantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  if (amount > 0 && !quantity) throw new Error('Nenhuma quantidade positiva nos romaneios filtrados para ratear o frete.');
  const cents = Math.round(amount * 100);
  const shares = rows.map(row => {
    const exact = quantity ? cents * row.quantity / quantity : 0;
    row.cents = Math.floor(exact);
    return { row, remainder: exact - row.cents };
  });
  let remainder = cents - rows.reduce((sum, row) => sum + row.cents, 0);
  for (const share of [...shares].sort((a, b) => b.remainder - a.remainder)) if (remainder-- > 0) share.row.cents++;
  return { rows, quantity: quantity / 1000, amount, unitFreight: quantity ? amount / (quantity / 1000) : 0 };
}

export function freightScopesOverlap(a: BillingFreight, b: BillingFreight) {
  return a.key !== b.key && a.amount > 0 && b.amount > 0 && a.operationId === b.operationId && (!a.end || !b.start || a.end >= b.start) && (!b.end || !a.start || b.end >= a.start) && (!a.categories.length || !b.categories.length || a.categories.some(category => b.categories.includes(category)));
}

// Freight is stored once per filtered scope. Derived allocations never alter billing prices.
export function billingFreightApplier(source: FreightSource, freights: BillingFreight[]) {
  const allocations = new Map<string, Map<string, number>>();
  for (const freight of freights.filter(freight => freight.amount > 0)) {
    const invoices = freightSourceInvoices(source, freight);
    const selection = allocateFilteredFreight(invoices, 0);
    if (!selection.quantity) continue;
    for (const row of allocateFilteredFreight(invoices, freight.amount).rows) {
      const items = allocations.get(row.invoice.id) || new Map<string, number>();
      const key = productKey(row.item, row.invoice.category);
      items.set(key, (items.get(key) || 0) + row.cents);
      allocations.set(row.invoice.id, items);
    }
  }
  return (invoice: BillingInvoice): BillingInvoice => {
    const maps = (invoice.location?.sourceIds || [invoice.id]).map(id => allocations.get(id)).filter((map): map is Map<string, number> => !!map);
    if (!maps.length) {
      const result = { ...invoice }; delete result.batchFreight; return result;
    }
    const amounts = new Map<string, number>();
    for (const map of maps) for (const [key, cents] of map) amounts.set(key, (amounts.get(key) || 0) + cents);
    const batchFreight: Record<string, number> = {};
    for (const [key, cents] of amounts) {
      const matching = invoice.items.filter(item => productKey(item, invoice.category) === key);
      // Also handles duplicate product lines in a delivery and products aggregated by local.
      for (const row of allocateFilteredFreight([{ ...invoice, items: matching }], matching.some(item => (item.billedQuantity ?? item.quantity) > 0) ? cents / 100 : 0).rows) batchFreight[row.item.id] = row.cents / 100;
    }
    return { ...invoice, batchFreight };
  };
}
