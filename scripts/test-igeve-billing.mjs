import assert from 'node:assert/strict';
import { isIgeveOperation, billingDateInRange, invoiceTotal, lineTotal, companyTotals, validateInvoice, sortBillingRows, locationTotals, locationBillingInvoices, billingPriceKey, createLocationBillingInvoice, locationInvoiceConflict, effectiveBillingInvoices, billingCategoryMatches, billingInvoiceCategoryMatches } from '../src/lib/igeveBilling.ts';
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

// Regression: the local report must find source deliveries even when no billing was saved.
const reportOperations = [
  { id: 'maceio', name: 'Operação Maceió', city: 'Maceió' },
  { id: 'boituva', name: 'Operação Boituva', city: 'Boituva' },
  { id: 'other', name: 'Outra operação', city: 'São Paulo' },
];
const reportPoints = [point, { id: 'point-2', name: 'Outra escola', operationId: 'maceio' }];
const delivery = { id: 'delivery', deliveryPointId: point.id, items: [{ product: 'Arroz', unit: 'KG', quantity: 3 }] };
const octoberOrder = { ...source, deliveryDate: '2026-10-28', importedAt: '2026-10-27T22:23:00Z', deliveries: [delivery] };
const reportSource = {
  orders: [octoberOrder, { ...octoberOrder, id: 'monthly', deliveryDate: '2026-10', deliveries: [{ ...delivery, deliveryPointId: 'point-2' }] }, { ...octoberOrder, id: 'september', deliveryDate: '2026-09-30' }, { ...octoberOrder, id: 'november', deliveryDate: '2026-11-01' }, { ...octoberOrder, id: 'outside', operationId: 'other' }],
  operations: reportOperations, points: reportPoints,
  prices: { [billingPriceKey('Arroz', 'KG')]: { salePrice: 2.55 } }, invoices: [],
  start: '2026-10-01', end: '2026-10-31', draftDate: '2026-11-02',
};
const reportSnapshot = structuredClone(reportSource);
const unsavedOctober = locationBillingInvoices(reportSource);
assert.equal(unsavedOctober.length, 2, 'Retorna romaneios diários e mensais sem faturamentos salvos');
assert.equal(unsavedOctober[0].deliveryDate, '2026-10-28');
assert.equal(unsavedOctober[0].date, '2026-11-02', 'Data de preparação não muda o período de entrega');
assert.equal(invoiceTotal(unsavedOctober[0]), 7.65);
assert.equal(unsavedOctober[0].control, '27102026-1923');
assert.equal(locationTotals(unsavedOctober, reportSource.orders, reportPoints).length, 2);
const billedInNovember = { ...base, date: '2026-11-02', items: [{ ...base.items[0], price: 20 }] };
const complementInNovember = { ...extra, date: '2026-11-03' };
const withSaved = locationBillingInvoices({ ...reportSource, invoices: [billedInNovember, complementInNovember] });
assert.equal(withSaved.length, 3, 'Substitui a origem pelo salvo e inclui o complemento sem duplicação');
assert.equal(withSaved.find(invoice => invoice.id === base.id).items[0].price, 20, 'Preserva preços editados no faturamento salvo');
assert.equal(withSaved.filter(invoice => invoice.sourceOrderId === base.sourceOrderId && !invoice.parentId).length, 1);
assert.equal(withSaved.find(invoice => invoice.parentId).deliveryDate, '2026-10-28', 'Complementos seguem a entrega de origem');
assert.equal(locationTotals(withSaved, reportSource.orders, reportPoints).find(row => row.destination === 'Escola').total, 70);
assert.equal(locationBillingInvoices({ ...reportSource, invoices: [billedInNovember, complementInNovember], company: base.company }).length, 2, 'Empresa filtra salvos; romaneios sem empresa ficam fora da seleção específica');
assert.equal(locationBillingInvoices({ ...reportSource, category: 'DIETA' }).length, 0);
assert.equal(locationBillingInvoices({ ...reportSource, operationId: 'boituva' }).length, 0);
assert.equal(locationBillingInvoices({ ...reportSource, start: '2026-10-29', end: '2026-10-15' }).length, 0);
assert.equal(locationBillingInvoices({ ...reportSource, prices: {} }).length, 2, 'Falta de preço não oculta os romaneios');
assert.equal(invoiceTotal(locationBillingInvoices({ ...reportSource, prices: {} })[0]), 0);
const novemberResult = locationBillingInvoices({ ...reportSource, start: '2026-11-01', end: '2026-11-30', invoices: [billedInNovember, complementInNovember] });
assert.equal(novemberResult.length, 1, 'Não puxa entregas de outubro pela data de faturamento de novembro');
assert.equal(novemberResult[0].sourceOrderId, 'november');
const removedSource = { ...billedInNovember, sourceOrderId: 'deleted', deliveryDate: '2026-10-12' };
assert.ok(locationBillingInvoices({ ...reportSource, invoices: [removedSource] }).some(invoice => invoice.sourceOrderId === 'deleted'), 'Preserva o histórico com data de entrega quando a origem foi removida');
assert.deepEqual(reportSource, reportSnapshot, 'Consultar não grava nem altera pedidos, preços ou faturamentos');
console.log('OK: regressão do período de entrega, origem sem faturamento, preços salvos, complementos e ausência de duplicações.');

const rawSecond = { ...octoberOrder, id: 'order-two', deliveries: [{ ...delivery, id: 'delivery-two', items: [{ product: ' arroz ', unit: 'kg', quantity: 7 }, { product: 'Arroz', unit: 'UN', quantity: 2 }] }] };
const localOrders = [octoberOrder, rawSecond];
const localSource = locationBillingInvoices({ ...reportSource, orders: localOrders, invoices: [billedInNovember] });
const localGroup = locationTotals(localSource, localOrders, reportPoints)[0];
const localSnapshot = structuredClone({ localGroup, localOrders });
const consolidated = createLocationBillingInvoice(localGroup, localOrders, reportSource.prices, reportSource.start, reportSource.end, '', reportSource.draftDate);
assert.equal(consolidated.items.length, 2, 'Agrupa produto/unidade sem misturar unidades distintas');
const riceKg = consolidated.items.find(item => item.unit === 'KG');
assert.equal(riceKg.quantity, 10, 'Quantidade entregue soma a origem, independente da edição individual');
assert.equal(riceKg.billedQuantity, 10, 'Ajuste inicial usa a quantidade entregue');
assert.equal(riceKg.price, 2.55);
assert.equal(consolidated.location.count, 2);
const adjusted = { ...consolidated, company: 'Empresa de teste', items: consolidated.items.map(item => item.id === riceKg.id ? { ...item, billedQuantity: 8, price: 6 } : { ...item, billedQuantity: 0, price: 100 }) };
assert.equal(invoiceTotal(adjusted), 48, 'Total usa ajuste faturamento vezes preço, sem cobrar quantidade entregue');
assert.equal(lineTotal({ ...riceKg, billedQuantity: 0, price: 100 }), 0, 'Ajuste zero não volta à quantidade entregue');
assert.equal(validateInvoice(adjusted), '');
for (const badQuantity of [-1, NaN, Infinity, undefined]) {
  assert.ok(validateInvoice({ ...adjusted, items: [{ ...riceKg, billedQuantity: badQuantity }] }), `Rejeita ajuste inválido: ${badQuantity}`);
}
assert.equal(invoiceTotal(JSON.parse(JSON.stringify(adjusted))), 48, 'Quantidade ajustada e preço sobrevivem ao salvamento e à reabertura');
assert.equal(createLocationBillingInvoice(localGroup, localOrders, {}, reportSource.start, reportSource.end, '', reportSource.draftDate).id, consolidated.id, 'Mesmo local/período reabre a mesma chave');
const otherScope = createLocationBillingInvoice(localGroup, localOrders, {}, '2026-10-15', reportSource.end, '', reportSource.draftDate);
assert.equal(locationInvoiceConflict(otherScope, [adjusted]), true, 'Não cria outro consolidado incluindo os mesmos romaneios');
assert.equal(locationInvoiceConflict(adjusted, [adjusted]), false, 'Permite editar o consolidado existente');
assert.equal(locationInvoiceConflict(base, [adjusted]), false);
assert.deepEqual(effectiveBillingInvoices([billedInNovember, adjusted]), [adjusted], 'Relatório não soma consolidado e sua origem duas vezes');
assert.equal(companyTotals(effectiveBillingInvoices([billedInNovember, adjusted]))[0].base, 48);
assert.equal(locationBillingInvoices({ ...reportSource, orders: localOrders, invoices: [billedInNovember, adjusted] }).length, 2, 'Não trata o consolidado como outro romaneio de origem');
assert.deepEqual({ localGroup, localOrders }, localSnapshot, 'Consolidação preserva as entregas originais');
assert.throws(() => createLocationBillingInvoice({ ...localGroup, invoices: [] }, [], {}, '', '', '', reportSource.draftDate));
console.log('OK: produtos somados por unidade, quantidade entregue preservada, ajuste zero, totais, persistência e ausência de dupla cobrança.');

assert.equal(billingCategoryMatches('DIETA', ['DIETA', 'Estocáveis']), true);
assert.equal(billingCategoryMatches('Estocáveis', ['DIETA', 'Estocáveis']), true);
assert.equal(billingCategoryMatches('LIMPEZA', ['DIETA', 'Estocáveis']), false);
assert.equal(billingCategoryMatches('DIETA', []), true, 'Sem seleção aplica todas as categorias');
const dietOrder = { ...octoberOrder, id: 'diet-order', category: 'DIETA' };
const cleaningOrder = { ...octoberOrder, id: 'cleaning-order', category: 'LIMPEZA' };
const multiOrders = [octoberOrder, dietOrder, cleaningOrder];
const multiInvoices = locationBillingInvoices({ ...reportSource, orders: multiOrders, category: ['Estocáveis', 'DIETA'] });
assert.deepEqual(multiInvoices.map(invoice => invoice.category), ['Estocáveis', 'DIETA']);
assert.equal(locationBillingInvoices({ ...reportSource, orders: multiOrders, category: [] }).length, 3);
const multiGroup = locationTotals(multiInvoices, multiOrders, reportPoints)[0];
const makeMulti = selection => createLocationBillingInvoice(multiGroup, multiOrders, reportSource.prices, reportSource.start, reportSource.end, selection, reportSource.draftDate);
const multiLocal = makeMulti(['DIETA', 'Estocáveis']);
assert.equal(multiLocal.items[0].quantity, 6, 'Soma somente as entregas das categorias escolhidas');
assert.equal(multiLocal.id, makeMulti(['Estocáveis', 'DIETA', 'DIETA']).id, 'Ordem de seleção e repetições não criam outro faturamento');
assert.deepEqual(multiLocal.location.categories, ['DIETA', 'Estocáveis']);
assert.equal(billingInvoiceCategoryMatches(multiLocal, ['LIMPEZA']), false);
assert.equal(billingInvoiceCategoryMatches(multiLocal, ['DIETA', 'Estocáveis']), true);
assert.equal(billingInvoiceCategoryMatches(base, ['DIETA', 'Estocáveis']), true);
assert.equal(makeMulti([]).id, makeMulti('').id, 'Preserva faturamentos antigos de todas as categorias');
assert.equal(makeMulti(['DIETA']).id, makeMulti('DIETA').id, 'Preserva faturamentos antigos de categoria única');
assert.deepEqual(JSON.parse(JSON.stringify(multiLocal)).location.categories, multiLocal.location.categories);
console.log('OK: seleção de múltiplas categorias, soma filtrada e compatibilidade das chaves de faturamentos salvos.');
