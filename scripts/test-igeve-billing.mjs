import assert from 'node:assert/strict';
import { isIgeveOperation, billingDateInRange, invoiceTotal, lineTotal, companyTotals, validateInvoice, sortBillingRows } from '../src/lib/igeveBilling.ts';
for (const city of ['Maceió', 'Gauianases', 'Guaianases', 'Guaianazes', 'Boituva', 'Mongaguá', 'Rio de Janeiro']) {
  assert.equal(isIgeveOperation({ id: city, name: `Operação ${city}`, city }), true, city);
}
assert.equal(isIgeveOperation({ id: 'x', name: 'Operação São Paulo', city: 'São Paulo' }), false);
assert.equal(isIgeveOperation({ id: 'x', name: 'Maceiozinho', city: '' }), false);
const base = { id: 'base', sourceOrderId: 'order', sourceDeliveryId: 'delivery', control: '001', operationId: 'maceio', operation: 'Maceió', destination: 'Escola', category: 'Estocáveis', company: 'Empresa A', cnpj: '12.345.678/0001-90', date: '2026-10-29', notes: '', items: [{ id: '1', product: 'Arroz', unit: 'KG', quantity: 3, price: 2.55 }] };
const snapshot = structuredClone(base);
const extra = { ...structuredClone(base), id: 'extra', parentId: 'base', cnpj: '12345678000190', items: [{ id: '2', product: 'Feijão', unit: 'KG', quantity: 2, price: 5 }] };
assert.equal(lineTotal(base.items[0]), 7.65);
assert.equal(invoiceTotal(extra), 10);
const totals = companyTotals([base, extra, { ...base, id: 'other', company: 'Empresa B', cnpj: '00000000000100' }]);
assert.equal(totals.length, 2);
assert.deepEqual(totals[0], { company: 'Empresa A', cnpj: base.cnpj, base: 7.65, complement: 10, count: 2 });
assert.equal(validateInvoice(base), '');
assert.ok(validateInvoice({ ...base, company: '' }));
assert.ok(validateInvoice({ ...base, items: [] }));
assert.ok(validateInvoice({ ...base, items: [{ ...base.items[0], quantity: 0 }] }));
assert.ok(validateInvoice({ ...base, items: [{ ...base.items[0], price: -1 }] }));
assert.ok(validateInvoice({ ...base, items: [{ ...base.items[0], quantity: NaN }] }));
assert.deepEqual(base, snapshot, 'Cálculos não devem modificar os registros originais');
console.log('OK: operações IGEVE, arredondamento, complementos, agrupamento por empresa e validação.');

assert.equal(billingDateInRange('2026-10', '2026-10-15', '2026-10-29'), true);
assert.equal(billingDateInRange('2026-09', '2026-10-01', '2026-10-29'), false);

const rows = [
  { name: 'Escola 10', operation: 'Maceió', date: '2026-11-01', total: 100 },
  { name: 'Escola 2', operation: 'Maceió', date: '2026-10-31', total: 9.5 },
  { name: 'Árvore', operation: 'Boituva', date: '2027-01-01', total: 20 },
];
const originalRows = structuredClone(rows);
const sortBy = (column, direction) => sortBillingRows(rows, { column, direction }, (row, key) => row[key]);
assert.deepEqual(sortBy('name', 'asc').map(row => row.name), ['Árvore', 'Escola 2', 'Escola 10']);
assert.deepEqual(sortBy('name', 'desc').map(row => row.name), ['Escola 10', 'Escola 2', 'Árvore']);
assert.deepEqual(sortBy('total', 'asc').map(row => row.total), [9.5, 20, 100]);
assert.deepEqual(sortBy('total', 'desc').map(row => row.total), [100, 20, 9.5]);
assert.deepEqual(sortBy('date', 'asc').map(row => row.date), ['2026-10-31', '2026-11-01', '2027-01-01']);
assert.deepEqual(sortBy('date', 'desc').map(row => row.date), ['2027-01-01', '2026-11-01', '2026-10-31']);
assert.deepEqual(sortBillingRows(rows, { column: 'operation', direction: 'asc' }, row => [row.operation, row.name]).map(row => row.name), ['Árvore', 'Escola 2', 'Escola 10']);
assert.deepEqual(sortBy('operation', 'asc').slice(1).map(row => row.name), ['Escola 10', 'Escola 2'], 'Empates preservam a ordem original');
assert.deepEqual(rows, originalRows, 'Ordenação não altera os dados de origem');
assert.deepEqual(sortBillingRows(rows, undefined, () => ''), originalRows);
assert.deepEqual(sortBillingRows([], { column: 'name', direction: 'asc' }, row => row.name), []);
console.log('OK: ordenação crescente/decrescente de texto, datas, valores, colunas compostas e preservação dos registros.');
