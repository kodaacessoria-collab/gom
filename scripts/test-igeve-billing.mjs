import assert from 'node:assert/strict';
import { isIgeveOperation, billingDateInRange, invoiceTotal, lineTotal, companyTotals, validateInvoice, sortBillingRows, locationTotals } from '../src/lib/igeveBilling.ts';
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

const second = { ...structuredClone(base), id: 'second', sourceOrderId: 'order-2', category: 'DIETA', company: 'Empresa B', items: [{ ...base.items[0], price: 10 }] };
const otherOperation = { ...structuredClone(base), id: 'boituva', operationId: 'boituva', operation: 'Boituva' };
const otherLocation = { ...structuredClone(base), id: 'other-location', destination: 'Outra escola' };
const locationInput = [base, second, extra, otherOperation, otherLocation];
const locationSnapshot = structuredClone(locationInput);
const locations = locationTotals(locationInput);
assert.equal(locations.length, 3, 'Não deve misturar operações ou locais distintos');
const school = locations.find(row => row.operation === 'Maceió' && row.destination === 'Escola');
assert.equal(school.count, 2, 'Conta os romaneios base sem incluir complementos');
assert.equal(school.complementCount, 1);
assert.equal(school.base, 37.65, 'Soma todos os romaneios do local, de categorias e empresas diferentes');
assert.equal(school.complement, 10);
assert.equal(school.total, 47.65);
assert.deepEqual(school.invoices.map(invoice => invoice.id), ['base', 'second', 'extra']);
assert.deepEqual(locationInput, locationSnapshot, 'Agrupar não altera os faturamentos salvos');
assert.deepEqual(locationTotals([]), []);
assert.equal(locationTotals([base, { ...extra, destination: '  ESCÓLA  ' }]).length, 1, 'Normaliza o nome quando o ID não está disponível');
const point = { id: 'point-1', operationId: base.operationId, name: base.destination };
const source = { id: base.sourceOrderId, operationId: base.operationId, category: base.category, deliveryDate: base.date, importedAt: '', deliveries: [{ id: base.sourceDeliveryId, deliveryPointId: point.id, items: [] }] };
const renamed = { ...second, deliveryPointId: point.id, destination: 'Escola renomeada' };
assert.equal(locationTotals([base, renamed], [source]).length, 1, 'Agrupa pelo ID mesmo após renomear o local');
assert.equal(locationTotals([base, renamed], [], [point]).length, 1, 'Recupera o local de faturamentos antigos pelo cadastro');
assert.equal(locationTotals([{ ...base, deliveryPointId: 'point-1' }, { ...second, deliveryPointId: 'point-2' }]).length, 2, 'Mantém locais com IDs distintos separados, mesmo com nomes iguais');
assert.equal(locationTotals([extra])[0].count, 0, 'Complemento pode aparecer sozinho em um período');
assert.equal(locationTotals([extra])[0].total, 10);
const cents = [0.1, 0.2].map((price, index) => ({ ...base, id: `cents-${index}`, items: [{ ...base.items[0], quantity: 1, price }] }));
assert.equal(locationTotals(cents)[0].total, 0.3, 'Mantém os centavos exatos na soma');
const filteredByCategory = locationTotals(locationInput.filter(invoice => invoice.category === 'DIETA'));
assert.equal(filteredByCategory.length, 1);
assert.equal(filteredByCategory[0].total, 30, 'Consolida somente os faturamentos que passaram pelos filtros');
assert.equal(sortBillingRows(locations, { column: 'total', direction: 'desc' }, row => row.total)[0].total, 47.65);
assert.equal(locations.reduce((sum, row) => sum + Math.round(row.total * 100), 0), locationInput.reduce((sum, invoice) => sum + Math.round(invoiceTotal(invoice) * 100), 0), 'Total agrupado corresponde à soma de todos os romaneios e complementos');
console.log('OK: faturamento por operação/local, múltiplos romaneios, complementos, filtros, centavos e compatibilidade com registros antigos.');
