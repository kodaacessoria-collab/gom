export const BILLING_PREFIX = 'gom_igeve_invoice_';
export const SOURCE_KEYS = ['gom_delivery_operations', 'gom_delivery_points', 'gom_delivery_operation_orders', 'gom_delivery_product_prices'];
export interface BillingOperation { id: string; name: string; city: string }
export interface BillingPoint { id: string; name: string; operationId: string }
export interface BillingItem { id: string; product: string; unit: string; quantity: number; price: number }
export interface BillingOrder {
  id: string; operationId: string; category: string; deliveryDate: string; importedAt: string;
  deliveries: { id: string; deliveryPointId: string; items: { product: string; unit: string; quantity: number }[] }[];
}
export interface BillingInvoice {
  id: string; parentId?: string; deliveryPointId?: string; sourceOrderId: string; sourceDeliveryId: string;
  control: string; operationId: string; operation: string; destination: string; category: string;
  company: string; cnpj: string; date: string; notes: string; items: BillingItem[];
}
export interface SavedInvoice { invoice: BillingInvoice; version: string }
export const normalizeBillingText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
export const isIgeveOperation = (operation: BillingOperation) =>
  ['MACEIO', 'GUAIANASES', 'GAUIANASES', 'GUAIANAZES', 'BOITUVA', 'MONGAGUA', 'RIO DE JANEIRO'].some(city =>
    (` ${normalizeBillingText(`${operation.name} ${operation.city}`)} `).includes(` ${city} `));
export const billingPriceKey = (product: string, unit: string) => `${normalizeBillingText(product)}|${normalizeBillingText(unit || 'UN')}`;
export const lineTotal = (item: BillingItem) => Math.round(item.quantity * item.price * 100) / 100;
export const invoiceTotal = (invoice: BillingInvoice) => invoice.items.reduce((sum, item) => sum + lineTotal(item), 0);
export const validateInvoice = (invoice: BillingInvoice) => {
  if (!invoice.company.trim()) return 'Informe a empresa para faturamento.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoice.date)) return 'Informe a data do faturamento.';
  if (!invoice.items.length) return 'Adicione pelo menos um produto.';
  if (invoice.items.some(item => !item.product.trim() || !item.unit.trim() || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.price) || item.price < 0)) return 'Preencha produto, unidade, quantidade maior que zero e preço válido em todos os itens.';
  return '';
};
export const companyTotals = (invoices: BillingInvoice[]) => {
  const groups = new Map<string, { company: string; cnpj: string; base: number; complement: number; count: number }>();
  for (const invoice of invoices) {
    const key = invoice.cnpj.replace(/\D/g, '') || normalizeBillingText(invoice.company);
    const row = groups.get(key) || { company: invoice.company, cnpj: invoice.cnpj, base: 0, complement: 0, count: 0 };
    row[invoice.parentId ? 'complement' : 'base'] += invoiceTotal(invoice);
    row.count++;
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => a.company.localeCompare(b.company));
};

// Month-only deliveries overlap any selected day in that month.
export const billingDateInRange = (value: string, start: string, end: string) => {
  const monthly = /^\d{4}-\d{2}$/.test(value);
  const first = monthly ? `${value}-01` : value;
  const last = monthly ? `${value}-${new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)), 0).getDate()}` : value;
  return (!start || last >= start) && (!end || first <= end);
};

export interface BillingSort { column: string; direction: 'asc' | 'desc' }
type SortValue = string | number;
const billingCollator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
export function sortBillingRows<T>(rows: T[], sort: BillingSort | undefined, value: (row: T, column: string) => SortValue | SortValue[]): T[] {
  if (!sort) return rows;
  return [...rows].sort((a, b) => {
    const left = [value(a, sort.column)].flat();
    const right = [value(b, sort.column)].flat();
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      const x = left[index] ?? '';
      const y = right[index] ?? '';
      const comparison = typeof x === 'number' && typeof y === 'number' ? x - y : billingCollator.compare(String(x), String(y));
      if (comparison) return sort.direction === 'asc' ? comparison : -comparison;
    }
    return 0;
  });
}

export interface LocationBillingTotal {
  key: string; operation: string; destination: string; count: number; complementCount: number;
  base: number; complement: number; total: number; invoices: BillingInvoice[];
}

export function locationTotals(invoices: BillingInvoice[], orders: BillingOrder[] = [], points: BillingPoint[] = []): LocationBillingTotal[] {
  const sources = new Map(orders.flatMap(order => order.deliveries.map(delivery =>
    [JSON.stringify([order.id, delivery.id]), delivery.deliveryPointId] as const)));
  const pointNames = new Map<string, string | null>();
  for (const point of points) {
    const key = JSON.stringify([point.operationId, normalizeBillingText(point.name)]);
    pointNames.set(key, pointNames.has(key) ? null : point.id);
  }
  const groups = new Map<string, LocationBillingTotal>();
  for (const invoice of invoices) {
    // Recover the stable point ID for invoices saved before deliveryPointId was stored.
    const pointId = invoice.deliveryPointId || sources.get(JSON.stringify([invoice.sourceOrderId, invoice.sourceDeliveryId])) || pointNames.get(JSON.stringify([invoice.operationId, normalizeBillingText(invoice.destination)]));
    const key = JSON.stringify([invoice.operationId, pointId ? ['id', pointId] : ['name', normalizeBillingText(invoice.destination)]]);
    const row = groups.get(key) || {
      key, operation: invoice.operation, destination: invoice.destination,
      count: 0, complementCount: 0, base: 0, complement: 0, total: 0, invoices: [],
    };
    const field = invoice.parentId ? 'complement' : 'base';
    row[field] = Math.round((row[field] + invoiceTotal(invoice)) * 100) / 100;
    row[invoice.parentId ? 'complementCount' : 'count']++;
    row.total = Math.round((row.base + row.complement) * 100) / 100;
    row.invoices.push(invoice);
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => a.operation.localeCompare(b.operation, 'pt-BR') || a.destination.localeCompare(b.destination, 'pt-BR'));
}
