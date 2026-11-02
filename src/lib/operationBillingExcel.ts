import * as XLSX from 'xlsx';
import { zipSync } from 'fflate';
import { deliveryDateInRange } from './deliveryDate.ts';
import { getOrderControlNumber } from './orderControlNumber.ts';

interface BillingDeliveryItem { product: string; unit: string; quantity: number }
export interface OperationBillingOrder {
  id: string; operationId: string; category: string; deliveryDate: string; importedAt: string;
  generalNotes?: string; deliveries: { items: BillingDeliveryItem[] }[];
}
type ProductPrices = Record<string, { costPrice: number; salePrice: number }>;
const normalizeKey = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const stockKey = (product: string, unit: string) => `${normalizeKey(product)}|${normalizeKey(unit || 'UN')}`;
const dateLabel = (value: string) => value ? value.split('-').reverse().join('/') : '-';
const safeName = (value: string) => Array.from(value, character => character.charCodeAt(0) < 32 ? ' ' : character).join('').replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');

export function selectOperationBillingOrders<T extends OperationBillingOrder>(orders: T[], operationId: string, start: string, end: string, category: string): T[] {
  if (start && end && start > end) return [];
  return orders.filter(order => order.operationId === operationId && (category === 'Todas' || order.category === category) && deliveryDateInRange(order.deliveryDate, start, end));
}

export function buildOperationBillingSummary(orders: OperationBillingOrder[]) {
  const dates = [...new Set(orders.map(order => order.deliveryDate))].sort();
  const products = new Map<string, { product: string; unit: string; quantities: Record<string, number>; total: number }>();
  for (const order of orders) for (const delivery of order.deliveries) for (const item of delivery.items) {
    if (!item.product || !Number.isFinite(item.quantity) || item.quantity <= 0) continue;
    const key = stockKey(item.product, item.unit);
    const row = products.get(key) || { product: item.product, unit: item.unit, quantities: {}, total: 0 };
    row.quantities[order.deliveryDate] = (row.quantities[order.deliveryDate] || 0) + item.quantity;
    row.total += item.quantity;
    products.set(key, row);
  }
  const rows = [...products.values()].sort((a, b) => a.product.localeCompare(b.product) || a.unit.localeCompare(b.unit));
  const dateTotals = Object.fromEntries(dates.map(date => [date, rows.reduce((sum, row) => sum + (row.quantities[date] || 0), 0)]));
  return { dates, rows, orderCount: orders.length, deliveryCount: orders.reduce((sum, order) => sum + order.deliveries.length, 0), dateTotals, grandTotal: rows.reduce((sum, row) => sum + row.total, 0) };
}

export function buildOperationBillingWorkbook(summary: ReturnType<typeof buildOperationBillingSummary>, operationName: string, category: string, scopeLabel: string, prices: ProductPrices, notes?: string) {
  const data: (string | number)[][] = [
    [`Faturamento dos produtos entregues - ${operationName}`],
    ['Operação', operationName, 'Categoria', category],
    ['Seleção', scopeLabel],
    ['Pedidos considerados', summary.orderCount, 'Entregas somadas', summary.deliveryCount],
    ...(notes?.trim() ? [['Observações', notes.trim()]] : []),
    [],
  ];
  const headerRow = data.length;
  data.push(['Produto entregue', 'UND', 'Quantidade', 'Preço de custo', 'Preço de venda', 'Total da venda']);
  data.push(...summary.rows.map(row => {
    const price = prices[stockKey(row.product, row.unit)] || { costPrice: 0, salePrice: 0 };
    return [row.product, row.unit, row.total, price.costPrice, price.salePrice, row.total * price.salePrice];
  }));
  const totalRow = data.length;
  data.push(['TOTAL GERAL', '', summary.grandTotal, '', '', summary.rows.reduce((sum, row) => sum + row.total * (prices[stockKey(row.product, row.unit)]?.salePrice || 0), 0)]);
  const sheet = XLSX.utils.aoa_to_sheet(data);
  for (let row = headerRow + 1; row <= totalRow; row++) {
    for (const column of [3, 4, 5]) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell) cell.z = 'R$ #,##0.00';
    }
    if (row < totalRow) sheet[`F${row + 1}`].f = `C${row + 1}*E${row + 1}`;
  }
  for (const column of ['C', 'F']) sheet[`${column}${totalRow + 1}`].f = summary.rows.length ? `SUM(${column}${headerRow + 2}:${column}${totalRow})` : '0';
  sheet['!cols'] = [{ wch: 42 }, { wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
  if (summary.rows.length) sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: headerRow, c: 0 }, e: { r: totalRow - 1, c: 5 } }) };
  sheet['!pageSetup'] = { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 };
  sheet['!margins'] = { left: 0.15, right: 0.15, top: 0.25, bottom: 0.25, header: 0.1, footer: 0.1 };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Faturamento');
  return workbook;
}

export async function buildPeriodBillingArchive(orders: OperationBillingOrder[], operation: { id: string; name: string }, start: string, end: string, category: string, prices: ProductPrices) {
  const selected = selectOperationBillingOrders(orders, operation.id, start, end, category)
    .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate) || a.importedAt.localeCompare(b.importedAt) || a.id.localeCompare(b.id));
  if (!selected.length) throw new Error('Nenhum romaneio encontrado para o período e a categoria selecionados.');
  const files: Record<string, Uint8Array> = {};
  for (let index = 0; index < selected.length; index++) {
    const order = selected[index];
    const control = getOrderControlNumber(order.importedAt);
    const scope = `Romaneio - Controle ${control} - ${dateLabel(order.deliveryDate)} - ${order.category}`;
    const workbook = buildOperationBillingWorkbook(buildOperationBillingSummary([order]), operation.name, order.category, scope, prices, order.generalNotes);
    const filename = `${String(index + 1).padStart(3, '0')} - ${safeName(operation.name).slice(0, 60)} - ${safeName(order.deliveryDate)} - ${safeName(order.category).slice(0, 40)} - Controle ${safeName(control)}.xlsx`;
    files[filename] = new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true }));
    if (index % 10 === 9) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return { bytes: zipSync(files, { level: 0 }), count: selected.length, filename: `${safeName(`ROMANEIOS SEPARADOS - ${operation.name.slice(0, 60)} - ${start || 'inicio'} a ${end || 'fim'}`)}.zip` };
}
