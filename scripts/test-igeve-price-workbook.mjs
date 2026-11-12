import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { billingOperationPriceKey, billingPricesFromEntries, billingUnitPrice } from '../src/lib/igeveBilling.ts';
import { applyIgeveWorkbookPrices, readIgevePriceWorkbook } from '../src/lib/igevePriceWorkbook.ts';

const destination = { operation: 'RIO DE JANEIRO', category: 'PAPELARIA' };
const header = ['Operação', 'Categoria', 'Produto', 'Unidade', 'Preço unitário (R$)'];
const row = (product, unit, price) => [destination.operation, destination.category, product, unit, price];
const workbook = rows => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Preços para revisão'], [], ...rows]), 'Preços');
  return book;
};
const sample = workbook([
  header,
  row('Balão bubble', 'UND', 0),
  row('Papel A4', 'PCT', 'R$ 1.234,56'),
  row('Tesoura', 'UN', '12.75'),
  row('Cola', 'UN', 2.35),
  row('Lápis', 'CX', ''),
  row('Cartolina', 'UN', -2),
  row('Pincel', '', 2),
  ['BOITUVA', 'PAPELARIA', 'Tinta', 'UN', 2],
  row('Total', '', 5000),
]);
for (const bookType of ['xlsx', 'biff8']) {
  const result = readIgevePriceWorkbook(XLSX.write(sample, { type: 'array', bookType }), destination);
  assert.deepEqual(result.items.map(item => item.price), [0, 1234.56, 12.75, 2.35]);
  assert.match(result.warnings[0], /1 linha\(s\) sem preço/);
  assert.match(result.warnings[1], /linha 9/);
  assert.match(result.warnings[2], /linha 10.*produto e a unidade/);
  assert.match(result.warnings[3], /linha 11.*difere/);
  const entries = result.items.map(item => ({
    ...item, operationId: 'rio', category: destination.category, salePrice: item.price,
    key: billingOperationPriceKey('rio', destination.category, item.product, item.unit),
  }));
  const prices = billingPricesFromEntries(entries);
  assert.equal(billingUnitPrice(prices, 'rio', 'PAPELARIA', 'PAPEL A4', 'PCT'), 1234.56);
  assert.equal(billingUnitPrice(prices, 'boituva', 'PAPELARIA', 'PAPEL A4', 'PCT'), 0);
}
const read = rows => readIgevePriceWorkbook(XLSX.write(workbook(rows), { type: 'array' }), destination);
assert.throws(() => read([['Produto', 'Preço']]), /Não encontrei as colunas/);
assert.throws(() => read([header, row('Cola', 'UN', '')]), /Nenhum preço unitário preenchido/);
assert.throws(() => read([header, row('Cola', 'UN', '12,345')]), /até duas casas decimais/);
const draft = {
  operationId: 'rio', category: 'PAPELARIA, Limpeza',
  items: [
    { id: '1', category: 'PAPELARIA', product: 'BALÃO BUBBLE', unit: 'UN', price: 2, quantity: 5, billedQuantity: 4 },
    { id: '2', category: 'PAPELARIA', product: 'PAPEL A4', unit: 'CX', price: 12, quantity: 1 },
    { id: '3', category: 'Limpeza', product: 'BALÃO BUBBLE', unit: 'UN', price: 7, quantity: 2 },
  ],
};
const pricesForDraft = read([header, row('Balão bubble', 'UND', 0), row('Papel A4', 'PCT', 10)]).items;
const { invoice, updated, missing, ignored } = applyIgeveWorkbookPrices(draft, 'PAPELARIA', pricesForDraft);
assert.deepEqual({ updated, missing, ignored }, { updated: 1, missing: 1, ignored: 1 });
assert.deepEqual(invoice.items.map(item => item.price), [0, 12, 7]);
assert.equal(invoice.items[0].billedQuantity, 4);
assert.equal(draft.items[0].price, 2);
assert.throws(() => applyIgeveWorkbookPrices(draft, 'PAPELARIA', [...pricesForDraft, { ...pricesForDraft[0], price: 3 }]), /preços diferentes/);
console.log('OK: XLSX e XLS, preços brasileiros, zero, linhas inválidas e escopo do faturamento.');
