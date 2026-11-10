import type { RubricInvoiceContext } from './igeveRubrics.ts';
import { getOrderControlNumber } from './orderControlNumber.ts';

export const BILLING_PREFIX = 'gom_igeve_invoice_';
export const SOURCE_KEYS = ['gom_delivery_operations', 'gom_delivery_points', 'gom_delivery_operation_orders'];
export interface BillingOperation { id: string; name: string; city: string }
export interface BillingPoint { id: string; name: string; operationId: string; code?: string; address?: string; neighborhood?: string }
export interface BillingItem { id: string; product: string; unit: string; quantity: number; price: number; billedQuantity?: number; category?: string; addedForBilling?: boolean }
export interface BillingOrder {
  id: string; operationId: string; category: string; deliveryDate: string; importedAt: string; consumptionPeriod?: string;
  deliveries: { id: string; deliveryPointId: string; items: { product: string; unit: string; quantity: number }[] }[];
}
export interface LocationInvoiceContext {
  groupKey: string; start: string; end: string; category: string; categories?: string[];
  sourceIds: string[]; deliveryKeys: string[]; count: number;
}
export interface BillingInvoice {
  id: string; parentId?: string; deliveryPointId?: string; deliveryDate?: string; sourceOrderId: string; sourceDeliveryId: string;
  batchFreight?: Record<string, number>;
  freight?: { operationId: string; category: string; amount: number };
  location?: LocationInvoiceContext;
  rubric?: RubricInvoiceContext;
  control: string; operationId: string; operation: string; destination: string; category: string;
  company: string; cnpj: string; date: string; notes: string; items: BillingItem[];
}
export const billingInvoiceType = (invoice: BillingInvoice) => invoice.location ? 'Por local' : invoice.rubric?.kind === 'carry' ? 'Aproveitamento anterior' : invoice.rubric?.kind === 'complement' ? 'Complemento de rubrica' : invoice.parentId ? 'Complemento' : 'Romaneio';
export interface SavedInvoice { invoice: BillingInvoice; version: string }
export const normalizeBillingText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
// NF-e suppliers add "IG." to descriptions; it is not part of the product name.
export const billingProductName = (value: string) => value.replace(/\bIG\.\s*/gi, '').replace(/\s+/g, ' ').trim();
export function billingProductIdentity(product: string, unit: string): [string, string] {
  let name = normalizeBillingText(billingProductName(product));
  let measure = normalizeBillingText(unit || 'UN').replace(/\s+/g, '');
  const weight = (value: string) => {
    const match = value.match(/^(\d+(?:[.,]\d+)?)?(KG|G|GR|L|ML)$/);
    if (!match) return null;
    const amount = Number((match[1] || '1').replace(',', '.')) * (match[2] === 'KG' || match[2] === 'L' ? 1000 : 1);
    return `${amount}${['L', 'ML'].includes(match[2]) ? 'ML' : 'G'}`;
  };
  const pack = name.match(/(?:^|\s)(\d+(?:[.,]\d+)?\s*(?:KG|GR|G|ML|L))$/);
  const packageUnit = pack ? weight(pack[1].replace(/\s+/g, '')) : null;
  const unitWeight = weight(measure);
  if (pack && packageUnit && (unitWeight === packageUnit || ['UN', 'UND', 'UNID', 'UNIDADE'].includes(measure))) {
    name = name.slice(0, pack.index).trim(); measure = packageUnit;
  } else if (unitWeight) measure = unitWeight;
  else if (['UND', 'UNID', 'UNIDADE'].includes(measure)) measure = 'UN';
  return [name, measure];
}
export const isIgeveOperation = (operation: BillingOperation) =>
  ['MACEIO', 'GUAIANASES', 'GAUIANASES', 'GUAIANAZES', 'BOITUVA', 'MONGAGUA', 'RIO DE JANEIRO'].some(city =>
    (` ${normalizeBillingText(`${operation.name} ${operation.city}`)} `).includes(` ${city} `));
export const BILLING_CATEGORIES = ['Hortifrutigranjeiro', 'Estocáveis', 'Dietas e Fórmulas', 'Proteínas', 'Limpeza', 'CESTA BASICA'] as const;
export const billingCategoryOptions = (additional: string[]) => [...new Set([...BILLING_CATEGORIES, ...additional].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
export type BillingCategorySelection = string | string[];
export const selectedBillingCategories = (selection: BillingCategorySelection) => [...new Set((Array.isArray(selection) ? selection : [selection]).filter(Boolean))].sort();
export const billingCategoryMatches = (category: string, selection: BillingCategorySelection) => {
  const selected = selectedBillingCategories(selection);
  return !selected.length || selected.includes(category);
};
export const billingInvoiceCategoryMatches = (invoice: BillingInvoice, selection: BillingCategorySelection) => {
  const categories = invoice.location?.categories || (invoice.rubric ? invoice.items.map(item => item.category || invoice.category) : [invoice.category]);
  return categories.some(category => billingCategoryMatches(category, selection));
};
export const billingPriceKey = (product: string, unit: string) => `${normalizeBillingText(product)}|${normalizeBillingText(unit || 'UN')}`;
export const BILLING_PRICE_PREFIX = 'gom_igeve_price_';
export interface BillingPriceEntry {
  key: string; operationId: string; category: string; product: string; unit: string; salePrice: number | null;
  identityVersion?: 1;
  source?: { filename: string; hash: string; invoice: string; importedAt: string };
}
export interface SavedBillingPrice { entry: BillingPriceEntry; version: string }
export const billingOperationPriceKey = (operationId: string, category: string, product: string, unit: string) =>
  `${BILLING_PRICE_PREFIX}${encodeURIComponent(JSON.stringify([operationId, normalizeBillingText(category), ...billingProductIdentity(product, unit)]))}`;
export const parseBillingPrice = (value: string): number | null => {
  if (!value.trim()) return null;
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0 || Math.abs(price * 100 - Math.round(price * 100)) > 1e-6) throw new Error('Informe um preço maior ou igual a zero, com até duas casas decimais.');
  return Math.round(price * 100) / 100;
};
export function billingPriceCatalog(orders: BillingOrder[], operations: BillingOperation[], invoices: BillingInvoice[], saved: BillingPriceEntry[]): BillingPriceEntry[] {
  const validOperations = new Set(operations.filter(isIgeveOperation).map(operation => operation.id));
  const catalog = new Map<string, BillingPriceEntry>();
  const add = (operationId: string, category: string, product: string, unit: string) => {
    if (!validOperations.has(operationId) || !category.trim() || !product.trim()) return;
    const key = billingOperationPriceKey(operationId, category, product, unit);
    if (!catalog.has(key)) catalog.set(key, { key, operationId, category, product: billingProductName(product), unit: unit.trim() || 'UN', salePrice: null });
  };
  for (const order of orders) for (const delivery of order.deliveries) for (const item of delivery.items) add(order.operationId, order.category, item.product, item.unit);
  for (const invoice of invoices) for (const item of invoice.items) {
    const category = item.category || (!invoice.location ? invoice.category : invoice.location.categories?.length === 1 ? invoice.location.categories[0] : invoice.location.category && !invoice.location.category.includes(',') ? invoice.location.category : '');
    if (category) add(invoice.operationId, category, item.product, item.unit);
  }
  for (const entry of canonicalBillingPrices(saved)) if (validOperations.has(entry.operationId)) {
    const original = catalog.get(entry.key);
    catalog.set(entry.key, { ...entry, product: original?.product || billingProductName(entry.product), unit: original?.unit || entry.unit });
  }
  return [...catalog.values()].sort((a, b) => a.operationId.localeCompare(b.operationId) || a.category.localeCompare(b.category, 'pt-BR') || a.product.localeCompare(b.product, 'pt-BR') || a.unit.localeCompare(b.unit, 'pt-BR'));
}
// Read legacy keys without rewriting stored invoices or dropping their price sources.
export function canonicalBillingPrices(entries: BillingPriceEntry[]): BillingPriceEntry[] {
  const selected = new Map<string, BillingPriceEntry>();
  for (const entry of entries) {
    const key = billingOperationPriceKey(entry.operationId, entry.category, entry.product, entry.unit);
    const previous = selected.get(key);
    if (previous) {
      const canonical = Number(entry.identityVersion === 1) - Number(previous.identityVersion === 1);
      if (canonical < 0) continue;
      if (!canonical) {
        if (previous.salePrice !== null && entry.salePrice === null) continue;
        if ((previous.salePrice === null) === (entry.salePrice === null) && (previous.source?.importedAt || '') > (entry.source?.importedAt || '')) continue;
      }
    }
    selected.set(key, entry);
  }
  return [...selected.entries()].map(([key, entry]) => ({ ...entry, key, product: billingProductName(entry.product) }));
}
export const billingPricesFromEntries = (entries: BillingPriceEntry[]): BillingPrices => Object.fromEntries(canonicalBillingPrices(entries)
  .filter(entry => entry.salePrice !== null && Number.isFinite(entry.salePrice) && entry.salePrice >= 0)
  .map(entry => [entry.key, { salePrice: entry.salePrice! }]));
export const billingUnitPrice = (prices: BillingPrices, operationId: string, category: string, product: string, unit: string) =>
  prices[billingOperationPriceKey(operationId, category, product, unit)]?.salePrice ?? 0;
export const billingTablePrice = (prices: BillingPrices, invoice: BillingInvoice, item: BillingItem) =>
  prices[billingOperationPriceKey(invoice.operationId, item.category || invoice.category, item.product, item.unit)]?.salePrice;
export function applyBillingTablePrices(invoice: BillingInvoice, prices: BillingPrices) {
  let updated = 0;
  let missing = 0;
  const items = invoice.items.map(item => {
    const price = billingTablePrice(prices, invoice, item);
    if (price === undefined) { missing++; return { ...item }; }
    updated++;
    return { ...item, price };
  });
  return { invoice: { ...invoice, items }, updated, missing };
}

export function billingProductsToAdd(invoice: BillingInvoice, entries: BillingPriceEntry[]) {
  const categories = invoice.location ? invoice.location.categories || invoice.items.map(item => item.category || invoice.category)
    : invoice.rubric && invoice.rubric.kind !== 'reduction' ? [] : [invoice.category];
  const existing = new Set(invoice.items.map(item => billingOperationPriceKey(invoice.operationId, item.category || invoice.category, item.product, item.unit)));
  return canonicalBillingPrices(entries).filter(entry => entry.operationId === invoice.operationId &&
    (!categories.length || categories.some(category => normalizeBillingText(category) === normalizeBillingText(entry.category))) &&
    !existing.has(entry.key))
    .sort((a, b) => a.product.localeCompare(b.product, 'pt-BR') || a.category.localeCompare(b.category, 'pt-BR') || a.unit.localeCompare(b.unit, 'pt-BR'));
}

export function addBillingTableProduct(invoice: BillingInvoice, entries: BillingPriceEntry[], key: string, quantity: number, id: string): BillingInvoice {
  const entry = billingProductsToAdd(invoice, entries).find(entry => entry.key === key);
  if (!entry) throw new Error('Selecione um produto da tabela da operação e categoria que ainda não esteja neste faturamento.');
  if (!Number.isFinite(quantity) || quantity <= 0 || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-6) {
    throw new Error('Informe uma quantidade maior que zero, com até três casas decimais.');
  }
  const adjustable = !!invoice.location || invoice.rubric?.kind === 'reduction';
  const item: BillingItem = { id, product: entry.product, unit: entry.unit, category: entry.category, price: entry.salePrice ?? 0,
    quantity: adjustable ? 0 : quantity, ...(adjustable ? { billedQuantity: quantity } : {}), addedForBilling: true };
  return { ...invoice, items: [...invoice.items, item] };
}
export const billingQuantityAdjustment = (item: BillingItem) =>
  Math.round(((item.billedQuantity ?? item.quantity) - item.quantity) * 1e6) / 1e6;

export function applyBillingQuantityAdjustment(item: BillingItem, input: string): BillingItem {
  const value = input.trim();
  if (value && !/^[+-]?(?:\d+(?:[.,]\d{1,3})?|[.,]\d{1,3})$/.test(value)) {
    throw new Error('Informe o ajuste em quantidade, como -10 ou +10, com até três casas decimais.');
  }
  const adjustment = value ? Number(value.replace(',', '.')) : 0;
  const billedQuantity = Math.round((item.quantity + adjustment) * 1e6) / 1e6;
  if (!Number.isFinite(billedQuantity) || billedQuantity < 0) {
    throw new Error('O ajuste não pode deixar a quantidade faturada negativa.');
  }
  return { ...item, billedQuantity };
}

export const lineTotal = (item: BillingItem) => Math.round((item.billedQuantity ?? item.quantity) * item.price * 100) / 100;
// Allocate integer cents by largest remainder so the freight is charged exactly once.
export function billingCostLines(invoice: BillingInvoice) {
  const rows = invoice.items.map(item => ({ item, subtotal: lineTotal(item), freight: 0, total: lineTotal(item), unitCost: item.price }));
  if (invoice.batchFreight) {
    for (const row of rows) {
      row.freight = invoice.batchFreight[row.item.id] || 0;
      row.total = (Math.round(row.subtotal * 100) + Math.round(row.freight * 100)) / 100;
      const quantity = row.item.billedQuantity ?? row.item.quantity;
      row.unitCost = quantity > 0 ? row.item.price + row.freight / quantity : row.item.price;
    }
    return rows;
  }
  const freight = invoice.freight;
  if (!freight || freight.operationId !== invoice.operationId || !Number.isFinite(freight.amount) || freight.amount <= 0) return rows;
  const eligible = rows.filter(row => (!freight.category || (row.item.category || invoice.category) === freight.category) && (row.item.billedQuantity ?? row.item.quantity) > 0);
  const base = eligible.reduce((sum, row) => sum + Math.round((row.item.billedQuantity ?? row.item.quantity) * 1000), 0);
  if (!base) return rows;
  const amount = Math.round(freight.amount * 100);
  const shares = eligible.map(row => {
    const exact = amount * Math.round((row.item.billedQuantity ?? row.item.quantity) * 1000) / base;
    return { row, cents: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = amount - shares.reduce((sum, share) => sum + share.cents, 0);
  for (const share of [...shares].sort((a, b) => b.remainder - a.remainder)) {
    if (remaining-- > 0) share.cents++;
  }
  for (const share of shares) {
    share.row.freight = share.cents / 100;
    share.row.total = (Math.round(share.row.subtotal * 100) + share.cents) / 100;
    share.row.unitCost = share.row.total / (share.row.item.billedQuantity ?? share.row.item.quantity);
  }
  return rows;
}
// Filter after allocation so a category export preserves its share of the full invoice freight.
export const billingAdjustmentLines = (invoice: BillingInvoice, category: string) =>
  billingCostLines(invoice).filter(row => (row.item.category || invoice.category) === category && billingQuantityAdjustment(row.item) !== 0);

export const invoiceTotal = (invoice: BillingInvoice) => Math.round(billingCostLines(invoice).reduce((sum, row) => sum + row.total, 0) * 100) / 100;
export const validateInvoice = (invoice: BillingInvoice) => {
  if (!invoice.company.trim()) return 'Informe a empresa para faturamento.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoice.date)) return 'Informe a data do faturamento.';
  if (!invoice.items.length) return 'Adicione pelo menos um produto.';
  if (invoice.items.some(item => (invoice.location || item.billedQuantity !== undefined) && (!Number.isFinite(item.billedQuantity) || item.billedQuantity! < 0))) return 'A quantidade faturada (entregue mais ajuste) deve ser maior ou igual a zero em todos os itens.';
  if (invoice.items.some(item => !item.product.trim() || !item.unit.trim() || !Number.isFinite(item.quantity) ||
    (item.addedForBilling && (invoice.location || invoice.rubric?.kind === 'reduction') ? item.quantity !== 0 : item.quantity <= 0) ||
    !Number.isFinite(item.price) || item.price < 0)) return 'Preencha produto, unidade, quantidade maior que zero e preço válido em todos os itens.';
  if (invoice.freight && !invoice.batchFreight) {
    const { amount, operationId, category } = invoice.freight;
    if (operationId !== invoice.operationId) return 'A operação do frete deve ser a mesma do faturamento.';
    if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100)) || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) return 'Informe um frete maior ou igual a zero, com até duas casas decimais.';
    if (category && !invoice.items.some(item => (item.category || invoice.category) === category)) return 'Selecione uma categoria presente nos produtos do faturamento.';
    if (amount > 0 && !billingCostLines(invoice).some(row => row.freight > 0)) return 'O frete precisa de produtos com quantidade faturada positiva na categoria selecionada.';
  }
  return '';
};
export const companyTotals = (invoices: BillingInvoice[]) => {
  const groups = new Map<string, { company: string; cnpj: string; base: number; complement: number; count: number }>();
  for (const invoice of invoices) {
    const key = invoice.cnpj.replace(/\D/g, '') || normalizeBillingText(invoice.company);
    const row = groups.get(key) || { company: invoice.company, cnpj: invoice.cnpj, base: 0, complement: 0, count: 0 };
    row[invoice.parentId || (invoice.rubric && invoice.rubric.kind !== 'reduction') ? 'complement' : 'base'] += invoiceTotal(invoice);
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

type BillingPrices = Record<string, { salePrice: number }>;
export function createDeliveryBillingInvoice(order: BillingOrder, delivery: BillingOrder['deliveries'][number], operation: BillingOperation | undefined, point: BillingPoint | undefined, prices: BillingPrices, date: string): BillingInvoice {
  return {
    id: `${BILLING_PREFIX}${order.id}_${delivery.id}`, sourceOrderId: order.id, sourceDeliveryId: delivery.id,
    deliveryPointId: delivery.deliveryPointId, deliveryDate: order.deliveryDate,
    control: getOrderControlNumber(order.importedAt), operationId: order.operationId,
    operation: operation?.name || order.operationId, destination: point?.name || delivery.deliveryPointId,
    category: order.category, company: '', cnpj: '', date, notes: '',
    items: delivery.items.map((item, index) => ({ ...item, id: `${delivery.id}_${index}`, category: order.category, price: billingUnitPrice(prices, order.operationId, order.category, item.product, item.unit) })),
  };
}

interface LocationBillingSource {
  orders: BillingOrder[]; operations: BillingOperation[]; points: BillingPoint[];
  prices: BillingPrices; invoices: BillingInvoice[]; start: string; end: string; draftDate: string;
  operationId?: string; category?: BillingCategorySelection; company?: string;
}
export function locationBillingInvoices({ orders, operations, points, prices, invoices, start, end, draftDate, operationId = '', category = '', company = '' }: LocationBillingSource): BillingInvoice[] {
  invoices = invoices.filter(invoice => !invoice.location);
  if (start && end && start > end) return [];
  const operationMap = new Map(operations.filter(isIgeveOperation).map(operation => [operation.id, operation]));
  const pointMap = new Map(points.map(point => [point.id, point]));
  const orderMap = new Map(orders.map(order => [order.id, order]));
  const sourceKey = (invoice: Pick<BillingInvoice, 'sourceOrderId' | 'sourceDeliveryId'>) => JSON.stringify([invoice.sourceOrderId, invoice.sourceDeliveryId]);
  const savedBases = new Map(invoices.filter(invoice => !invoice.parentId).map(invoice => [sourceKey(invoice), invoice]));
  const matches = (invoice: BillingInvoice) => (!operationId || invoice.operationId === operationId) && billingInvoiceCategoryMatches(invoice, category) && (!company || invoice.company === company);
  const result: BillingInvoice[] = [];
  const coveredSources = new Set<string>();
  for (const order of orders) {
    if (!operationMap.has(order.operationId) || (operationId && order.operationId !== operationId) || !billingDateInRange(order.deliveryDate, start, end)) continue;
    for (const delivery of order.deliveries) {
      const key = JSON.stringify([order.id, delivery.id]);
      coveredSources.add(key);
      const existing = savedBases.get(key);
      // Prefer the saved copy; never count both the source and its saved billing.
      const invoice = existing ? { ...existing, deliveryDate: order.deliveryDate, deliveryPointId: existing.deliveryPointId || delivery.deliveryPointId }
        : createDeliveryBillingInvoice(order, delivery, operationMap.get(order.operationId), pointMap.get(delivery.deliveryPointId), prices, draftDate);
      if (matches(invoice)) result.push(invoice);
    }
  }
  for (const invoice of invoices) {
    const order = orderMap.get(invoice.sourceOrderId);
    // Complements follow the delivery period of their source, even if billed later.
    // A saved snapshot can still be reported if its source was removed and it has a delivery date.
    if (!invoice.parentId && coveredSources.has(sourceKey(invoice))) continue;
    const deliveryDate = order?.deliveryDate || invoice.deliveryDate;
    if (!deliveryDate || !operationMap.has(invoice.operationId) || !matches(invoice) || !billingDateInRange(deliveryDate, start, end)) continue;
    const pointId = invoice.deliveryPointId || order?.deliveries.find(delivery => delivery.id === invoice.sourceDeliveryId)?.deliveryPointId;
    result.push({ ...invoice, deliveryDate, deliveryPointId: pointId });
  }
  return result;
}

export function createLocationBillingInvoice(group: LocationBillingTotal, orders: BillingOrder[], prices: BillingPrices, start: string, end: string, category: BillingCategorySelection, date: string): BillingInvoice {
  if (!group.invoices.length) throw new Error('Nenhum romaneio disponível para faturar este local.');
  const sources = new Map(orders.flatMap(order => order.deliveries.map(delivery => [JSON.stringify([order.id, delivery.id]), delivery] as const)));
  const items = new Map<string, BillingItem>();
  const deliveryKeys = new Set<string>();
  for (const invoice of group.invoices) {
    const sourceKey = JSON.stringify([invoice.sourceOrderId, invoice.sourceDeliveryId]);
    // Delivered quantities come from the source, independently of individual billing edits.
    if (!invoice.parentId && deliveryKeys.has(sourceKey)) continue;
    if (!invoice.parentId) deliveryKeys.add(sourceKey);
    const sourceItems = invoice.rubric ? invoice.items : !invoice.parentId ? sources.get(sourceKey)?.items || invoice.items : invoice.items;
    for (const sourceItem of sourceItems) {
      const itemCategory = ('category' in sourceItem ? sourceItem.category as string : '') || invoice.category;
      const key = JSON.stringify([normalizeBillingText(itemCategory), normalizeBillingText(sourceItem.product), normalizeBillingText(sourceItem.unit || 'UN')]);
      const row = items.get(key) || { id: key, product: sourceItem.product, unit: sourceItem.unit || 'UN', quantity: 0, billedQuantity: 0, category: itemCategory, price: billingUnitPrice(prices, invoice.operationId, itemCategory, sourceItem.product, sourceItem.unit) };
      row.quantity = Math.round((row.quantity + sourceItem.quantity) * 1e6) / 1e6;
      row.billedQuantity = Math.round(((row.billedQuantity || 0) + (invoice.rubric && 'billedQuantity' in sourceItem && typeof sourceItem.billedQuantity === 'number' ? sourceItem.billedQuantity : sourceItem.quantity)) * 1e6) / 1e6;
      items.set(key, row);
    }
  }
  const first = group.invoices[0];
  const categories = [...new Set(group.invoices.flatMap(invoice => invoice.rubric ? invoice.items.map(item => item.category || invoice.category) : [invoice.category]))].sort();
  const selection = selectedBillingCategories(category);
  // Preserve existing keys for all-category and single-category invoices.
  const categoryScope = selection.length > 1 ? selection : selection[0] || '';
  const context = { groupKey: group.key, start, end, category: selection.join(', '), categories, sourceIds: group.invoices.map(invoice => invoice.id), deliveryKeys: [...deliveryKeys], count: deliveryKeys.size };
  return {
    id: `${BILLING_PREFIX}local_${encodeURIComponent(JSON.stringify([group.key, start, end, categoryScope]))}`,
    location: context, sourceOrderId: '', sourceDeliveryId: '', operationId: first.operationId,
    deliveryPointId: first.deliveryPointId, operation: group.operation, destination: group.destination,
    control: `LOCAL ${start || 'início'} a ${end || 'fim'}`, category: categories.join(', '),
    company: '', cnpj: '', date, notes: '',
    items: [...items.values()].sort((a, b) => a.product.localeCompare(b.product, 'pt-BR') || a.unit.localeCompare(b.unit, 'pt-BR')),
  };
}

export function locationInvoiceConflict(invoice: BillingInvoice, saved: BillingInvoice[]): boolean {
  if (!invoice.location) return false;
  const keys = new Set(invoice.location.deliveryKeys);
  const ids = new Set(invoice.location.sourceIds);
  return saved.some(other => other.id !== invoice.id && other.location &&
    (other.location.deliveryKeys.some(key => keys.has(key)) || other.location.sourceIds.some(id => ids.has(id))));
}

// A consolidated local invoice replaces its source invoices in financial reports.
export function effectiveBillingInvoices(invoices: BillingInvoice[]): BillingInvoice[] {
  const covered = new Set(invoices.flatMap(invoice => invoice.location?.sourceIds || []));
  return invoices.filter(invoice => invoice.location || !covered.has(invoice.id));
}
