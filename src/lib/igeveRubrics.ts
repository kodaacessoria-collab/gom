import { BILLING_PREFIX, effectiveBillingInvoices, invoiceTotal, lineTotal, locationBillingInvoices, locationTotals, normalizeBillingText } from './igeveBilling.ts';
import type { BillingInvoice, BillingItem, BillingOperation, BillingOrder, BillingPoint, BillingPriceEntry } from './igeveBilling.ts';

export const RUBRIC_PREFIX = 'gom_igeve_rubric_';
export interface MonthlyRubric { key: string; operationId: string; pointId: string; month: string; amount: number; previousAdjustment: number; adjustmentNotes: string }
export interface SavedRubric { rubric: MonthlyRubric; version: string }
export const rubricKey = (operationId: string, pointId: string, month: string) => `${RUBRIC_PREFIX}${encodeURIComponent(JSON.stringify([operationId, pointId, month]))}`;
export const rubricOperationKind = (operation: BillingOperation) => {
  const text = ` ${normalizeBillingText(`${operation.name} ${operation.city}`)} `;
  if (text.includes(' MACEIO ')) return 'local';
  if (['BOITUVA', 'GUAIANASES', 'GAUIANASES', 'GUAIANAZES'].some(city => text.includes(` ${city} `))) return 'operation';
  return null;
};
export const shiftRubricMonth = (month: string, offset: number) => {
  const date = new Date(`${month}-01T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + offset); return date.toISOString().slice(0, 7);
};
export const rubricMonthEnd = (month: string) => `${month}-${new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()}`;
const cents = (value: number) => Math.round(value * 100);
export const rubricBalance = (rubric: MonthlyRubric, invoices: BillingInvoice[]) => {
  const total = cents(invoices.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0));
  const used = total + cents(rubric.previousAdjustment);
  const remaining = cents(rubric.amount) - used;
  return { total: total / 100, used: used / 100, remaining: remaining / 100, status: remaining < 0 ? 'exceeded' : remaining === 0 ? 'matched' : used >= cents(rubric.amount) * .9 ? 'near' : 'available' };
};
export function rubricMonthInvoices(orders: BillingOrder[], operations: BillingOperation[], points: BillingPoint[], prices: Parameters<typeof locationBillingInvoices>[0]['prices'], saved: BillingInvoice[], month: string) {
  const start = `${month}-01`, end = rubricMonthEnd(month);
  const source = locationBillingInvoices({ orders, operations, points, prices, invoices: saved, start, end, draftDate: end });
  // Consolidated copies replace their sources before totaling, including old point IDs recovered by locationTotals.
  const consolidated = saved.filter(invoice => invoice.location && invoice.location.start <= end && invoice.location.end >= start);
  return effectiveBillingInvoices([...source, ...consolidated]);
}
export function rubricScopeInvoices(invoices: BillingInvoice[], rubric: MonthlyRubric, orders: BillingOrder[], points: BillingPoint[]) {
  const operationInvoices = invoices.filter(invoice => invoice.operationId === rubric.operationId);
  if (!rubric.pointId) return operationInvoices;
  return locationTotals(operationInvoices, orders, points).filter(group => group.key === JSON.stringify([rubric.operationId, ['id', rubric.pointId]])).flatMap(group => group.invoices);
}

export interface RubricInvoiceContext { key: string; month: string; kind: 'reduction' | 'complement' | 'carry'; sourceId?: string; originalItems?: BillingItem[]; deferred?: BillingItem[] }
export function reductionSuggestion(invoice: BillingInvoice, excess: number, rubric: MonthlyRubric): BillingInvoice {
  const result = structuredClone(invoice);
  const originalItems = invoice.rubric?.originalItems || structuredClone(invoice.items);
  let remaining = cents(excess);
  // Whole units first for discrete units; fractional units use the existing 0.001 precision.
  const sorted = [...result.items].sort((a, b) => lineTotal(b) - lineTotal(a));
  for (const item of sorted) {
    if (remaining <= 0 || item.price <= 0) continue;
    const quantity = item.billedQuantity ?? item.quantity;
    const step = /^(UN|UND|UNID|PC|PCT|CX)$/i.test(item.unit) ? 1 : .001;
    const remove = Math.min(quantity, Math.ceil((remaining / 100 / item.price) / step - 1e-9) * step);
    const before = cents(lineTotal(item));
    item.billedQuantity = Math.max(0, Math.round((quantity - remove) * 1000) / 1000);
    remaining -= before - cents(lineTotal(item));
  }
  result.rubric = { key: rubric.key, month: rubric.month, kind: 'reduction', originalItems };
  return withDeferredItems(result);
}
export function withDeferredItems(invoice: BillingInvoice): BillingInvoice {
  if (invoice.rubric?.kind !== 'reduction') return invoice;
  const deferred = (invoice.rubric.originalItems || []).flatMap(original => {
    const item = invoice.items.find(row => row.id === original.id);
    const quantity = Math.round(((original.billedQuantity ?? original.quantity) - (item ? item.billedQuantity ?? item.quantity : 0)) * 1000) / 1000;
    return quantity > 0 ? [{ ...original, quantity, billedQuantity: undefined }] : [];
  });
  return { ...invoice, rubric: { ...invoice.rubric, deferred } };
}
export const rubricCategory = (value: string) => {
  const text = normalizeBillingText(value);
  if (text.includes('HORT')) return 'Hortifrúti';
  if (text.includes('PROTE')) return 'Proteínas';
  if (text.includes('DIET') || text.includes('FORMUL')) return 'Dietas e Fórmulas';
  if (text.includes('ESTOC')) return 'Estocáveis';
  return '';
};
export function complementSuggestion(catalog: BillingPriceEntry[], rubric: MonthlyRubric, balance: number): BillingItem[] {
  const groups = new Map<string, BillingPriceEntry[]>();
  for (const entry of catalog) {
    const category = rubricCategory(entry.category);
    if (entry.operationId !== rubric.operationId || !category || !entry.salePrice || entry.salePrice <= 0) continue;
    groups.set(category, [...groups.get(category) || [], entry]);
  }
  let remaining = cents(balance);
  const items: BillingItem[] = [];
  let groupIndex = 0;
  for (const entries of groups.values()) {
    const allowance = Math.floor(remaining / (groups.size - groupIndex++));
    let budget = allowance;
    for (const entry of [...entries].sort((a, b) => a.salePrice! - b.salePrice!)) {
      const step = /^(UN|UND|UNID|PC|PCT|CX)$/i.test(entry.unit) ? 1 : .001;
      const quantity = Math.floor((budget / 100 / entry.salePrice!) / step + 1e-9) * step;
      const item = { id: `rubric-${items.length}`, product: entry.product, unit: entry.unit, quantity: Math.round(quantity * 1000) / 1000, price: entry.salePrice!, category: entry.category };
      const value = cents(lineTotal(item));
      if (quantity <= 0 || value <= 0 || value > budget) continue;
      items.push(item); budget -= value; remaining -= value;
      if (!budget) break;
    }
  }
  return items;
}
export function createRubricInvoice(rubric: MonthlyRubric, operation: BillingOperation, point: BillingPoint | undefined, items: BillingItem[], kind: 'complement' | 'carry', sourceId = ''): BillingInvoice {
  const id = `${BILLING_PREFIX}rubric_${encodeURIComponent(JSON.stringify([rubric.key, kind, sourceId]))}`;
  return {
    id, sourceOrderId: id, sourceDeliveryId: point?.id || 'operation', operationId: operation.id, operation: operation.name,
    deliveryPointId: point?.id, destination: point?.name || 'Toda a operação',
    deliveryDate: `${rubric.month}-01`, date: rubricMonthEnd(rubric.month),
    control: `${kind === 'carry' ? 'SALDO ANTERIOR' : 'COMPLEMENTO RUBRICA'} ${rubric.month}`,
    category: [...new Set(items.map(item => item.category).filter(Boolean))].join(', '),
    company: '', cnpj: '', notes: kind === 'carry' ? 'Itens retirados do faturamento anterior para aproveitamento neste mês.' : 'Complemento sugerido para a rubrica mensal. Conferir produtos e quantidades.',
    items: structuredClone(items), rubric: { key: rubric.key, month: rubric.month, kind, sourceId },
  };
}
