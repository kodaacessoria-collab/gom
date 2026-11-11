import { BILLING_PREFIX, billingCostLines, effectiveBillingInvoices, invoiceTotal, lineTotal, locationBillingInvoices, locationTotals, normalizeBillingText } from './igeveBilling.ts';
import type { BillingInvoice, BillingItem, BillingOperation, BillingOrder, BillingPoint, BillingPriceEntry } from './igeveBilling.ts';

export const RUBRIC_PREFIX = 'gom_igeve_rubric_';
export interface MonthlyRubric { key: string; operationId: string; pointId: string; month: string; amount: number; previousAdjustment: number; adjustmentNotes: string; proportional?: ProportionalRubric }
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
  const total = rubric.proportional
    ? cents(rubric.proportional.proteinsBilled) + invoices.reduce((sum, invoice) =>
      sum + billingCostLines(invoice).reduce((subtotal, row) =>
        subtotal + (rubricCategory(row.item.category || invoice.category) === 'Proteínas' ? 0 : cents(row.total)), 0), 0)
    : cents(invoices.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0));
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

export const RUBRIC_BILLING_CATEGORIES = ['Hortifrúti', 'Estocáveis', 'Dietas e Fórmulas'] as const;
export type RubricBillingCategory = typeof RUBRIC_BILLING_CATEGORIES[number];
type RubricAmounts = Record<RubricBillingCategory, number>;

export interface ProportionalRubric {
  proteinsBilled: number;
  bases: RubricAmounts;
}

export interface RubricDiscount {
  rubricKey: string;
  month: string;
  categories: { category: RubricBillingCategory; target: number; gross: number; excess: number }[];
  total: number;
}

export function rubricProposal(rubric: MonthlyRubric): RubricAmounts | null {
  const plan = rubric.proportional;
  if (!plan) return null;
  const inputs = [rubric.amount, plan.proteinsBilled, ...RUBRIC_BILLING_CATEGORIES.map(category => plan.bases[category])];
  if (inputs.some(value => !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(cents(value))) || rubric.amount <= 0) return null;

  const remaining = cents(rubric.amount) - cents(plan.proteinsBilled) - cents(rubric.previousAdjustment);
  const base = RUBRIC_BILLING_CATEGORIES.reduce((sum, category) => sum + cents(plan.bases[category]), 0);
  if (remaining < 0 || !Number.isSafeInteger(remaining) || !Number.isSafeInteger(base) || (!base && remaining)) return null;

  const share = (category: RubricBillingCategory) => base
    ? Number((BigInt(remaining) * BigInt(cents(plan.bases[category])) + BigInt(base) / 2n) / BigInt(base))
    : 0;
  const horti = share('Hortifrúti');
  const formulas = share('Dietas e Fórmulas');
  // Estocáveis absorbs the rounding difference, as in the workbook.
  const estocaveis = remaining - horti - formulas;
  return { 'Hortifrúti': horti / 100, 'Estocáveis': Math.max(0, estocaveis) / 100, 'Dietas e Fórmulas': (formulas + Math.min(0, estocaveis)) / 100 };
}

export function rubricCategoryTotals(invoices: BillingInvoice[]) {
  const totals: RubricAmounts = { 'Hortifrúti': 0, 'Estocáveis': 0, 'Dietas e Fórmulas': 0 };
  for (const invoice of invoices) {
    for (const row of billingCostLines(invoice)) {
      const category = rubricCategory(row.item.category || invoice.category);
      if (category && category !== 'Proteínas') totals[category] += cents(row.total);
    }
  }
  return totals;
}

export function rubricInvoiceDiscount(rubric: MonthlyRubric, invoice: BillingInvoice, previous: BillingInvoice[]): RubricDiscount | undefined {
  const proposal = rubricProposal(rubric);
  if (!proposal) return undefined;

  const current = rubricCategoryTotals([invoice]);
  const prior = rubricCategoryTotals(previous);
  for (const other of previous) {
    if (other.rubricDiscount?.rubricKey !== rubric.key) continue;
    for (const row of other.rubricDiscount.categories) prior[row.category] -= cents(row.excess);
  }
  const categories = RUBRIC_BILLING_CATEGORIES.filter(category => current[category] > 0).map(category => {
    const target = cents(proposal[category]);
    const available = Math.max(0, target - Math.max(0, prior[category]));
    return { category, target: proposal[category], gross: current[category] / 100, excess: Math.max(0, current[category] - available) / 100 };
  });
  const total = categories.reduce((sum, row) => sum + cents(row.excess), 0) / 100;
  return total ? { rubricKey: rubric.key, month: rubric.month, categories: categories.filter(row => row.excess > 0), total } : undefined;
}

export function rubricDiscountNote(discount?: RubricDiscount, category?: string) {
  const rows = discount?.categories.filter(row => !category || row.category === rubricCategory(category));
  if (!rows?.length) return '';
  const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const details = rows.map(row => `${row.category} excedeu ${money(row.excess)} (meta mensal ${money(row.target)})`).join(' | ');
  const total = rows.reduce((sum, row) => sum + cents(row.excess), 0) / 100;
  return `Desconto final a aplicar: ${money(total)}. ${details}.`;
}
