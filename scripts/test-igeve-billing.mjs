import assert from 'node:assert/strict';
import { isIgeveOperation, billingTablePrice, billingTablePriceMatch, applyBillingTablePrices, billingCostLines, billingAdjustmentLines, billingQuantityAdjustment, applyBillingQuantityAdjustment, billingDateInRange, invoiceTotal, lineTotal, companyTotals, validateInvoice, sortBillingRows, locationTotals, locationBillingInvoices, billingOperationPriceKey, billingPriceCatalog, billingPricesFromEntries, parseBillingPrice, billingUnitPrice, createDeliveryBillingInvoice, createLocationBillingInvoice, refreshLocationBillingInvoices, locationInvoiceConflict, effectiveBillingInvoices, billingCategoryMatches, billingInvoiceCategoryMatches, billingCategoryOptions } from '../src/lib/igeveBilling.ts';
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
  prices: { [billingOperationPriceKey('maceio', 'Estocáveis', 'Arroz', 'KG')]: { salePrice: 2.55 } }, invoices: [],
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
assert.equal(riceKg.billedQuantity, 10, 'Quantidade faturada inicial usa a quantidade entregue, com diferença zero');
assert.equal(riceKg.price, 2.55);
assert.equal(consolidated.location.count, 2);
const adjusted = { ...consolidated, company: 'Empresa de teste', items: consolidated.items.map(item => item.id === riceKg.id ? { ...item, billedQuantity: 8, price: 6 } : { ...item, billedQuantity: 0, price: 100 }) };
assert.equal(invoiceTotal(adjusted), 48, 'Total usa ajuste faturamento vezes preço, sem cobrar quantidade entregue');
const manualItem = { id: 'manual', category: 'Estocáveis', product: 'Sal', unit: 'KG', quantity: 0, billedQuantity: 2, price: 5, addedForBilling: true };
const savedLocal = { invoice: { ...adjusted, items: [...adjusted.items, manualItem] }, version: 'v1' };
const updatedOrders = [octoberOrder, { ...rawSecond, deliveries: [{ ...rawSecond.deliveries[0], id: 'recreated-delivery', items: [
  { product: 'Arroz', unit: 'KG', quantity: 12 }, { product: 'Feijão', unit: 'UN', quantity: 4 },
] }] }];
const updatedPrices = { ...reportSource.prices, [billingOperationPriceKey('maceio', 'Estocáveis', 'Feijão', 'UN')]: { salePrice: 3 } };
const [refreshedLocal] = refreshLocationBillingInvoices([savedLocal], updatedOrders, updatedPrices);
assert.equal(refreshedLocal.invoice.id, savedLocal.invoice.id);
assert.equal(refreshedLocal.version, 'v1');
assert.equal(refreshedLocal.invoice.company, savedLocal.invoice.company);
assert.deepEqual(refreshedLocal.invoice.items.map(item => [item.product, item.unit, item.quantity, item.billedQuantity, item.price]), [
  ['Arroz', 'KG', 15, 13, 6], ['Feijão', 'UN', 4, 4, 3], ['Sal', 'KG', 0, 2, 5],
], 'Atualiza quantidades, adiciona e remove itens, e preserva o ajuste, preço e produto avulso');
assert.equal(invoiceTotal(refreshedLocal.invoice), 100);
assert.ok(refreshedLocal.invoice.location.deliveryKeys.includes(JSON.stringify([rawSecond.id, 'recreated-delivery'])));
const updatedSources = locationBillingInvoices({ ...reportSource, orders: updatedOrders });
assert.deepEqual(effectiveBillingInvoices([...localSource, ...updatedSources, refreshedLocal.invoice]), [refreshedLocal.invoice], 'A entrega antiga e a entrega com novo ID não aparecem como faturamentos pendentes');
assert.deepEqual(refreshLocationBillingInvoices([refreshedLocal], updatedOrders, updatedPrices), [refreshedLocal], 'Atualizar duas vezes não duplica itens ou reaplica o ajuste');
assert.deepEqual(refreshLocationBillingInvoices([savedLocal], [], updatedPrices), [savedLocal], 'Preserva o faturamento se a origem não puder ser encontrada');
assert.equal(savedLocal.invoice.items.find(item => item.id === riceKg.id).quantity, 10, 'Consultar o faturamento não grava as novas quantidades');
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
assert.equal(multiLocal.items.reduce((sum, item) => sum + item.quantity, 0), 6, 'Soma somente as entregas das categorias escolhidas');
assert.equal(multiLocal.id, makeMulti(['Estocáveis', 'DIETA', 'DIETA']).id, 'Ordem de seleção e repetições não criam outro faturamento');
assert.deepEqual(multiLocal.location.categories, ['DIETA', 'Estocáveis']);
assert.equal(billingInvoiceCategoryMatches(multiLocal, ['LIMPEZA']), false);
assert.equal(billingInvoiceCategoryMatches(multiLocal, ['DIETA', 'Estocáveis']), true);
assert.equal(billingInvoiceCategoryMatches(base, ['DIETA', 'Estocáveis']), true);
assert.equal(makeMulti([]).id, makeMulti('').id, 'Preserva faturamentos antigos de todas as categorias');
assert.equal(makeMulti(['DIETA']).id, makeMulti('DIETA').id, 'Preserva faturamentos antigos de categoria única');
assert.deepEqual(JSON.parse(JSON.stringify(multiLocal)).location.categories, multiLocal.location.categories);
console.log('OK: seleção de múltiplas categorias, soma filtrada e compatibilidade das chaves de faturamentos salvos.');

const fullCategoryOptions = billingCategoryOptions([]);
assert.equal(fullCategoryOptions.length, 6, 'Exibe todas as categorias mesmo sem pedidos carregados');
for (const category of ['Hortifrutigranjeiro', 'Estocáveis', 'Dietas e Fórmulas', 'Proteínas', 'Limpeza', 'CESTA BASICA']) {
  assert.ok(fullCategoryOptions.includes(category));
}
assert.equal(billingCategoryOptions(['CESTA BASICA']).length, 6, 'Somente cesta nos pedidos não limita o catálogo');
assert.equal(billingCategoryOptions(['Estocáveis', 'Categoria antiga', '']).length, 7, 'Mantém categorias adicionais dos registros sem duplicar as padrão');
const threeSelections = ['Estocáveis', 'Dietas e Fórmulas', 'Proteínas'];
assert.deepEqual(fullCategoryOptions.filter(category => billingCategoryMatches(category, threeSelections)).sort(), [...threeSelections].sort());
assert.equal(fullCategoryOptions.filter(category => billingCategoryMatches(category, [])).length, 6);
console.log('OK: catálogo completo de categorias, categorias históricas e seleção de uma, várias ou todas.');

const priceOrders = [octoberOrder, { ...octoberOrder, id: 'repeat', deliveries: [{ ...delivery, items: [{ product: ' arroz ', unit: 'kg', quantity: 1 }] }] }, dietOrder, { ...octoberOrder, id: 'boituva-price', operationId: 'boituva' }];
const productCatalog = billingPriceCatalog(priceOrders, reportOperations, [], []);
assert.equal(productCatalog.length, 3, 'Pré-cadastra produto por operação/categoria/unidade e elimina repetições');
assert.ok(productCatalog.every(entry => entry.salePrice === null), 'Catálogo começa com preços a preencher');
const priceSnapshot = structuredClone(priceOrders);
const definedPrices = productCatalog.map(entry => ({ ...entry, salePrice: entry.operationId === 'boituva' ? 9 : entry.category === 'DIETA' ? 7 : 5 }));
const operationPrices = billingPricesFromEntries(definedPrices);
assert.equal(billingUnitPrice(operationPrices, 'maceio', 'Estocáveis', 'Arroz', 'KG'), 5);
assert.equal(billingUnitPrice(operationPrices, 'boituva', 'Estocáveis', 'Arroz', 'KG'), 9, 'Mesmo produto usa outro preço em outra operação');
assert.equal(billingUnitPrice(operationPrices, 'maceio', 'DIETA', 'Arroz', 'KG'), 7, 'Mesmo produto usa outro preço em outra categoria');
assert.equal(billingUnitPrice(operationPrices, 'maceio', 'Estocáveis', 'Arroz', 'UN'), 0, 'Não usa preço de outra unidade');
assert.equal(billingUnitPrice(operationPrices, 'maceio', 'Limpeza', 'Arroz', 'KG'), 0, 'Não usa preço de outra categoria');
assert.equal(billingOperationPriceKey('maceio', 'Estocáveis', 'Arroz', 'KG'), billingOperationPriceKey('maceio', 'ESTOCAVEIS', ' arroz ', 'kg'));
const newInvoice = createDeliveryBillingInvoice(octoberOrder, delivery, reportOperations[0], point, operationPrices, reportSource.draftDate);
assert.equal(newInvoice.items[0].price, 5);
assert.equal(invoiceTotal(newInvoice), 15);
const repricedSources = locationBillingInvoices({ ...reportSource, orders: [octoberOrder, dietOrder], prices: operationPrices });
const repricedLocal = createLocationBillingInvoice(locationTotals(repricedSources, [octoberOrder, dietOrder], reportPoints)[0], [octoberOrder, dietOrder], operationPrices, reportSource.start, reportSource.end, [], reportSource.draftDate);
assert.equal(repricedLocal.items.length, 2, 'Categorias com preços próprios ficam em linhas distintas no faturamento por local');
assert.equal(invoiceTotal(repricedLocal), 36, 'Cada quantidade usa o preço da categoria correta: 3×5 + 3×7');
assert.equal(locationBillingInvoices({ ...reportSource, invoices: [billedInNovember], prices: operationPrices }).find(invoice => invoice.id === billedInNovember.id).items[0].price, 20, 'Não altera preços de faturamentos salvos');
assert.equal(billingPriceCatalog([], reportOperations, [], definedPrices).length, 3, 'Preços salvos preservam catálogo mesmo se a origem for removida');
const zeroPrice = { ...definedPrices[0], salePrice: 0 };
assert.equal(billingPricesFromEntries([zeroPrice])[zeroPrice.key].salePrice, 0, 'Preço zero é válido');
assert.equal(Object.keys(billingPricesFromEntries([{ ...zeroPrice, salePrice: null }])).length, 0, 'Preço pendente não é cadastrado como zero');
assert.equal(parseBillingPrice(''), null);
assert.equal(parseBillingPrice('0'), 0);
assert.equal(parseBillingPrice('12.34'), 12.34);
for (const value of ['-1', 'Infinity', 'NaN', '1.234']) assert.throws(() => parseBillingPrice(value));
assert.deepEqual(priceOrders, priceSnapshot, 'Montar o catálogo não altera os romaneios');
console.log('OK: catálogo automático, preços por operação/categoria/unidade, preço zero, campos pendentes e preenchimento dos faturamentos.');

assert.equal(billingUnitPrice({ 'ARROZ|KG': { salePrice: 999 } }, 'maceio', 'Estocáveis', 'Arroz', 'KG'), 0, 'Nunca busca preço global para uma operação/categoria sem preço cadastrado');

// Freight follows total units, regardless of how many different products or their prices.
const freightInvoice = { ...structuredClone(base), freight: { operationId: base.operationId, category: '', amount: 200 }, items: Array.from({ length: 15 }, (_, index) => ({ id: `freight-${index}`, product: `Produto ${index + 1}`, unit: 'UN', quantity: index === 14 ? 300 : 50, price: index + 1, category: index < 7 ? 'Estocáveis' : 'Proteínas' })) };
const freightSnapshot = structuredClone(freightInvoice);
const freightLines = billingCostLines(freightInvoice);
assert.equal(freightInvoice.items.reduce((sum, item) => sum + item.quantity, 0), 1000);
assert.equal(freightLines[0].freight, 10);
assert.equal(freightLines[14].freight, 60);
assert.ok(freightLines.every(row => Math.abs(row.unitCost - row.item.price - .2) < 1e-9), 'Cada um dos 1000 itens recebe R$ 0,20, independente do preço');
assert.equal(freightLines.reduce((sum, row) => sum + Math.round(row.freight * 100), 0), 20000);
assert.equal(invoiceTotal(freightInvoice), freightInvoice.items.reduce((sum, item) => sum + lineTotal(item), 0) + 200);
assert.equal(validateInvoice(freightInvoice), '');
assert.deepEqual(freightInvoice, freightSnapshot, 'Calcular não altera preços ou quantidades originais');
assert.deepEqual(billingCostLines(JSON.parse(JSON.stringify(freightInvoice))), freightLines, 'Salvar e reabrir mantém o rateio');
const categoryFreight = { ...freightInvoice, freight: { ...freightInvoice.freight, category: 'Estocáveis', amount: 35 } };
assert.ok(billingCostLines(categoryFreight).slice(0, 7).every(row => row.freight === 5));
assert.ok(billingCostLines(categoryFreight).slice(7).every(row => row.freight === 0), 'Não inclui produtos de outra categoria');
const splitCents = { ...freightInvoice, freight: { ...freightInvoice.freight, amount: .01 }, items: freightInvoice.items.slice(0, 3) };
assert.deepEqual(billingCostLines(splitCents).map(row => row.freight), [.01, 0, 0], 'Centavo residual distribuído uma única vez e de forma estável');
const fractional = { ...splitCents, freight: { ...splitCents.freight, amount: 1 }, items: [{ ...base.items[0], quantity: .5, price: 0 }, { ...base.items[0], id: '2', quantity: 1.5, billedQuantity: 1, price: 10 }, { ...base.items[0], id: '3', billedQuantity: 0 }] };
assert.deepEqual(billingCostLines(fractional).map(row => row.freight), [.33, .67, 0], 'Respeita quantidade fracionada, ajuste zero e produto de preço zero');
assert.equal(validateInvoice(fractional), '');
assert.equal(billingCostLines({ ...freightInvoice, freight: undefined }).reduce((sum, row) => sum + row.freight, 0), 0, 'Remover frete restaura os totais originais');
for (const amount of [-1, NaN, Infinity, 1.234]) assert.ok(validateInvoice({ ...freightInvoice, freight: { ...freightInvoice.freight, amount } }));
assert.ok(validateInvoice({ ...freightInvoice, freight: { ...freightInvoice.freight, operationId: 'outra' } }));
assert.ok(validateInvoice({ ...freightInvoice, freight: { ...freightInvoice.freight, category: 'inexistente' } }));
assert.ok(validateInvoice({ ...freightInvoice, items: freightInvoice.items.map(item => ({ ...item, billedQuantity: 0 })) }), 'Impede frete sem quantidade para ratear');
assert.equal(companyTotals([freightInvoice])[0].base, invoiceTotal(freightInvoice), 'Relatórios financeiros incluem frete exatamente uma vez');
console.log('OK: frete em 15 produtos/1000 itens, rateio por quantidade, categorias, centavos, frações, ajuste zero, validação e persistência.');

const tableDraft = { ...structuredClone(repricedLocal), items: repricedLocal.items.map(item => ({ ...item, price: 0 })) };
const tableSnapshot = structuredClone(tableDraft);
const refreshed = applyBillingTablePrices(tableDraft, operationPrices);
assert.equal(refreshed.updated, 2);
assert.equal(refreshed.missing, 0);
assert.equal(invoiceTotal(refreshed.invoice), 36, 'Busca o preço de cada categoria do consolidado, independente do valor antigo');
assert.deepEqual(tableDraft, tableSnapshot, 'Revisar preços não altera a cópia salva antes da confirmação');
const priceZero = { ...operationPrices, [billingOperationPriceKey(tableDraft.operationId, tableDraft.items[0].category, tableDraft.items[0].product, tableDraft.items[0].unit)]: { salePrice: 0 } };
assert.equal(billingTablePrice(priceZero, tableDraft, tableDraft.items[0]), 0, 'Preço zero cadastrado é encontrado');
assert.equal(billingTablePrice({}, tableDraft, tableDraft.items[0]), undefined, 'Ausência é diferente de zero cadastrado');
const manualPriceDraft = { ...tableDraft, items: tableDraft.items.map(item => ({ ...item, price: 12 })) };
assert.ok(applyBillingTablePrices(manualPriceDraft, {}).invoice.items.every(item => item.price === 12), 'Preserva valor informado quando o produto não tem preço na tabela');
assert.equal(applyBillingTablePrices(manualPriceDraft, {}).missing, 2);
assert.equal(billingTablePrice(operationPrices, { ...tableDraft, operationId: 'outra' }, tableDraft.items[0]), undefined);
assert.equal(billingTablePrice(operationPrices, tableDraft, { ...tableDraft.items[0], unit: 'PACOTE' }), undefined);
console.log('OK: atualização explícita dos preços salvos, consolidados com múltiplas categorias, zero cadastrado, pendências e preservação de valores sem correspondência.');

const foreignTableId = 'outra-operacao';
const [firstTableItem, secondTableItem] = manualPriceDraft.items;
const foreignPrices = {
  ...operationPrices,
  [billingOperationPriceKey(foreignTableId, firstTableItem.category, firstTableItem.product, firstTableItem.unit)]: { salePrice: 0 },
  [billingOperationPriceKey(foreignTableId, secondTableItem.category, secondTableItem.product, 'PACOTE')]: { salePrice: 99 },
};
const foreignResult = applyBillingTablePrices(manualPriceDraft, foreignPrices, foreignTableId);
assert.equal(foreignResult.updated, 1);
assert.equal(foreignResult.missing, 1);
assert.deepEqual(foreignResult.invoice.items.map(item => item.price), [0, 12]);
assert.equal(foreignResult.invoice.operationId, manualPriceDraft.operationId);
assert.deepEqual(foreignResult.invoice.location, manualPriceDraft.location);
const reopened = JSON.parse(JSON.stringify(foreignResult.invoice));
assert.equal(reopened.priceTableOperationId, foreignTableId);
assert.equal(billingTablePrice(foreignPrices, reopened, reopened.items[0]), 0);
assert.equal(billingTablePrice(foreignPrices, reopened, reopened.items[1]), undefined);
assert.deepEqual(applyBillingTablePrices(reopened, foreignPrices, 'sem-tabela').invoice, reopened);
const ownTableAgain = applyBillingTablePrices(reopened, foreignPrices, manualPriceDraft.operationId);
assert.equal(ownTableAgain.invoice.priceTableOperationId, undefined);
assert.equal(invoiceTotal(ownTableAgain.invoice), 36);
console.log('OK: escolha da tabela de outra operação, reabertura e retorno à tabela original.');

const sharedOperations = [
  { id: 'a', name: 'Operação Gauianases (SP)', city: '' },
  { id: 'b', name: 'Operação - Boituva (SP)', city: '' },
  { id: 'm', name: 'Operação Mongaguá (SP)', city: '' },
];
const priceEntry = (operationId, category, product, unit, salePrice) => ({
  key: billingOperationPriceKey(operationId, category, product, unit), operationId, category, product, unit, salePrice,
});
const sharedEntries = [
  priceEntry('a', 'Hortifrutigranjeiro', 'Suco (350ml)', 'UN', 7.5),
  priceEntry('a', 'Estocáveis', 'Arroz', 'KG', 9),
  priceEntry('b', 'Estocáveis', 'Arroz', 'KG', 0),
  priceEntry('b', 'Dietas e Fórmulas', 'Fórmula 400g', 'UN', 24),
];
const sharedPrices = billingPricesFromEntries(sharedEntries, sharedOperations);
const sharedDraft = { ...base, operationId: 'b' };
const juice = { ...base.items[0], category: 'Hortifrúti', product: 'IG. Suco 350 ML', unit: 'UND' };
assert.deepEqual(billingTablePriceMatch(sharedPrices, sharedDraft, juice), { salePrice: 7.5, operationId: 'a' });
assert.equal(billingTablePrice(sharedPrices, sharedDraft, { ...juice, product: 'Suco 500ml' }), undefined);
assert.equal(billingTablePrice(sharedPrices, sharedDraft, { ...juice, unit: 'CX' }), undefined);
assert.equal(billingTablePrice(sharedPrices, sharedDraft, { ...juice, category: 'Estocáveis' }), undefined);
assert.equal(billingTablePrice(sharedPrices, { ...sharedDraft, operationId: 'm' }, juice), undefined);
assert.equal(billingTablePrice(sharedPrices, sharedDraft, base.items[0]), 0);
assert.equal(billingTablePrice(sharedPrices, { ...sharedDraft, priceTableOperationId: 'a' }, base.items[0]), 9);
assert.equal(billingUnitPrice(sharedPrices, 'a', 'Fórmulas', 'Fórmula', '0,4KG'), 24);
const sharedResult = applyBillingTablePrices({ ...sharedDraft, items: [juice, base.items[0]] }, sharedPrices);
assert.equal(sharedResult.updated, 2);
assert.deepEqual(sharedResult.invoice.items.map(item => item.price), [7.5, 0]);
const ambiguousPrices = billingPricesFromEntries([...sharedEntries,
  priceEntry('a', 'Hortifrutigranjeiros', 'Suco', '350ML', 11),
], sharedOperations);
assert.equal(billingTablePrice(ambiguousPrices, sharedDraft, juice), undefined);
console.log('OK: preços compartilhados entre Guaianases e Boituva, prioridade local, categorias equivalentes e embalagens.');



const categoryAdjustment = {
  ...structuredClone(base), category: 'Estocáveis, Proteínas',
  freight: { operationId: base.operationId, category: '', amount: 10 },
  items: [
    { id: 'rice', product: 'Arroz', category: 'Estocáveis', unit: 'KG', quantity: 5, billedQuantity: 2, price: 3 },
    { id: 'zero', product: 'Feijão', category: 'Estocáveis', unit: 'KG', quantity: 4, billedQuantity: 0, price: 8 },
    { id: 'meat', product: 'Carne', category: 'Proteínas', unit: 'KG', quantity: 8, billedQuantity: 3, price: 10 },
  ],
};
const adjustmentSnapshot = structuredClone(categoryAdjustment);
const stockAdjustment = billingAdjustmentLines(categoryAdjustment, 'Estocáveis');
assert.deepEqual(stockAdjustment.map(row => row.item.id), ['rice', 'zero']);
assert.equal(stockAdjustment[0].item.quantity, 5, 'Preserva quantidade entregue');
assert.equal(stockAdjustment[0].item.billedQuantity, 2, 'Usa o ajuste faturado');
assert.deepEqual(stockAdjustment.map(row => row.freight), [4, 0], 'Mantém apenas a parcela do frete da categoria, sem redistribuir o frete inteiro');
assert.equal(stockAdjustment.reduce((sum, row) => sum + row.total, 0), 10, 'Total inclui somente produtos e frete da categoria');
assert.equal(billingAdjustmentLines(categoryAdjustment, 'Proteínas')[0].total, 36);
assert.deepEqual(billingAdjustmentLines(categoryAdjustment, 'Limpeza'), []);
assert.equal(billingAdjustmentLines(base, 'Estocáveis').length, 0, 'Itens sem ajuste não entram no romaneio');
assert.equal(billingAdjustmentLines({ ...base, items: [{ ...base.items[0], billedQuantity: 2 }] }, 'Estocáveis').length, 1, 'Compatível com item ajustado sem categoria própria');
assert.equal(billingAdjustmentLines({ ...categoryAdjustment, items: [...categoryAdjustment.items, { ...categoryAdjustment.items[0], id: 'unchanged', billedQuantity: 5 }] }, 'Estocáveis').length, 2, 'Exclui os itens cuja quantidade não foi alterada');
assert.deepEqual(billingAdjustmentLines({ ...categoryAdjustment, batchFreight: { rice: 1.23, zero: 0, meat: 4.56 } }, 'Estocáveis').map(row => row.freight), [1.23, 0], 'Preserva o frete do conjunto de romaneios');
assert.deepEqual(categoryAdjustment, adjustmentSnapshot, 'Exportação não altera os dados de origem');
console.log('OK: romaneio de ajuste por categoria, quantidades zeradas, totais e frete preservado.');

const sixtyDelivered = { ...base.items[0], quantity: 60, price: 6 };
for (const [input, expected] of [['', 60], ['0', 60], ['-10', 50], ['+10', 70], ['-60', 0], ['+0,5', 60.5], ['-.125', 59.875]]) {
  const item = applyBillingQuantityAdjustment(sixtyDelivered, input);
  assert.equal(item.quantity, 60, 'A entrega original fica preservada');
  assert.equal(item.billedQuantity, expected, `60 entregues e ajuste ${input} = ${expected} faturados`);
  assert.equal(lineTotal(item), Math.round(expected * 6 * 100) / 100);
  assert.equal(billingQuantityAdjustment(item), expected - 60);
}
assert.equal(applyBillingQuantityAdjustment({ ...sixtyDelivered, billedQuantity: 50 }, '').billedQuantity, 60, 'Limpar o ajuste restaura a quantidade entregue');
assert.equal(billingQuantityAdjustment({ ...sixtyDelivered, billedQuantity: 50 }), -10, 'Registros anteriores são exibidos como diferença, sem mudar o valor faturado');
for (const input of ['-61', '-', '+', 'abc', 'Infinity', '1e3', '1.2345']) assert.throws(() => applyBillingQuantityAdjustment(sixtyDelivered, input), undefined, input);
console.log('OK: ajuste vazio, positivo, negativo, decimal, zeramento, compatibilidade e bloqueio de quantidade final negativa.');
import assert from 'node:assert/strict';
import { isIgeveOperation, billingTablePrice, billingTablePriceMatch, applyBillingTablePrices, billingCostLines, billingAdjustmentLines, billingQuantityAdjustment, applyBillingQuantityAdjustment, billingDateInRange, invoiceTotal, lineTotal, companyTotals, validateInvoice, sortBillingRows, locationTotals, locationBillingInvoices, billingOperationPriceKey, billingPriceCatalog, billingPricesFromEntries, parseBillingPrice, billingUnitPrice, createDeliveryBillingInvoice, createLocationBillingInvoice, locationInvoiceConflict, effectiveBillingInvoices, billingCategoryMatches, billingInvoiceCategoryMatches, billingCategoryOptions } from '../src/lib/igeveBilling.ts';
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
  prices: { [billingOperationPriceKey('maceio', 'Estocáveis', 'Arroz', 'KG')]: { salePrice: 2.55 } }, invoices: [],
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
assert.equal(riceKg.billedQuantity, 10, 'Quantidade faturada inicial usa a quantidade entregue, com diferença zero');
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
assert.equal(multiLocal.items.reduce((sum, item) => sum + item.quantity, 0), 6, 'Soma somente as entregas das categorias escolhidas');
assert.equal(multiLocal.id, makeMulti(['Estocáveis', 'DIETA', 'DIETA']).id, 'Ordem de seleção e repetições não criam outro faturamento');
assert.deepEqual(multiLocal.location.categories, ['DIETA', 'Estocáveis']);
assert.equal(billingInvoiceCategoryMatches(multiLocal, ['LIMPEZA']), false);
assert.equal(billingInvoiceCategoryMatches(multiLocal, ['DIETA', 'Estocáveis']), true);
assert.equal(billingInvoiceCategoryMatches(base, ['DIETA', 'Estocáveis']), true);
assert.equal(makeMulti([]).id, makeMulti('').id, 'Preserva faturamentos antigos de todas as categorias');
assert.equal(makeMulti(['DIETA']).id, makeMulti('DIETA').id, 'Preserva faturamentos antigos de categoria única');
assert.deepEqual(JSON.parse(JSON.stringify(multiLocal)).location.categories, multiLocal.location.categories);
console.log('OK: seleção de múltiplas categorias, soma filtrada e compatibilidade das chaves de faturamentos salvos.');

const fullCategoryOptions = billingCategoryOptions([]);
assert.equal(fullCategoryOptions.length, 6, 'Exibe todas as categorias mesmo sem pedidos carregados');
for (const category of ['Hortifrutigranjeiro', 'Estocáveis', 'Dietas e Fórmulas', 'Proteínas', 'Limpeza', 'CESTA BASICA']) {
  assert.ok(fullCategoryOptions.includes(category));
}
assert.equal(billingCategoryOptions(['CESTA BASICA']).length, 6, 'Somente cesta nos pedidos não limita o catálogo');
assert.equal(billingCategoryOptions(['Estocáveis', 'Categoria antiga', '']).length, 7, 'Mantém categorias adicionais dos registros sem duplicar as padrão');
const threeSelections = ['Estocáveis', 'Dietas e Fórmulas', 'Proteínas'];
assert.deepEqual(fullCategoryOptions.filter(category => billingCategoryMatches(category, threeSelections)).sort(), [...threeSelections].sort());
assert.equal(fullCategoryOptions.filter(category => billingCategoryMatches(category, [])).length, 6);
console.log('OK: catálogo completo de categorias, categorias históricas e seleção de uma, várias ou todas.');

const priceOrders = [octoberOrder, { ...octoberOrder, id: 'repeat', deliveries: [{ ...delivery, items: [{ product: ' arroz ', unit: 'kg', quantity: 1 }] }] }, dietOrder, { ...octoberOrder, id: 'boituva-price', operationId: 'boituva' }];
const productCatalog = billingPriceCatalog(priceOrders, reportOperations, [], []);
assert.equal(productCatalog.length, 3, 'Pré-cadastra produto por operação/categoria/unidade e elimina repetições');
assert.ok(productCatalog.every(entry => entry.salePrice === null), 'Catálogo começa com preços a preencher');
const priceSnapshot = structuredClone(priceOrders);
const definedPrices = productCatalog.map(entry => ({ ...entry, salePrice: entry.operationId === 'boituva' ? 9 : entry.category === 'DIETA' ? 7 : 5 }));
const operationPrices = billingPricesFromEntries(definedPrices);
assert.equal(billingUnitPrice(operationPrices, 'maceio', 'Estocáveis', 'Arroz', 'KG'), 5);
assert.equal(billingUnitPrice(operationPrices, 'boituva', 'Estocáveis', 'Arroz', 'KG'), 9, 'Mesmo produto usa outro preço em outra operação');
assert.equal(billingUnitPrice(operationPrices, 'maceio', 'DIETA', 'Arroz', 'KG'), 7, 'Mesmo produto usa outro preço em outra categoria');
assert.equal(billingUnitPrice(operationPrices, 'maceio', 'Estocáveis', 'Arroz', 'UN'), 0, 'Não usa preço de outra unidade');
assert.equal(billingUnitPrice(operationPrices, 'maceio', 'Limpeza', 'Arroz', 'KG'), 0, 'Não usa preço de outra categoria');
assert.equal(billingOperationPriceKey('maceio', 'Estocáveis', 'Arroz', 'KG'), billingOperationPriceKey('maceio', 'ESTOCAVEIS', ' arroz ', 'kg'));
const newInvoice = createDeliveryBillingInvoice(octoberOrder, delivery, reportOperations[0], point, operationPrices, reportSource.draftDate);
assert.equal(newInvoice.items[0].price, 5);
assert.equal(invoiceTotal(newInvoice), 15);
const repricedSources = locationBillingInvoices({ ...reportSource, orders: [octoberOrder, dietOrder], prices: operationPrices });
const repricedLocal = createLocationBillingInvoice(locationTotals(repricedSources, [octoberOrder, dietOrder], reportPoints)[0], [octoberOrder, dietOrder], operationPrices, reportSource.start, reportSource.end, [], reportSource.draftDate);
assert.equal(repricedLocal.items.length, 2, 'Categorias com preços próprios ficam em linhas distintas no faturamento por local');
assert.equal(invoiceTotal(repricedLocal), 36, 'Cada quantidade usa o preço da categoria correta: 3×5 + 3×7');
assert.equal(locationBillingInvoices({ ...reportSource, invoices: [billedInNovember], prices: operationPrices }).find(invoice => invoice.id === billedInNovember.id).items[0].price, 20, 'Não altera preços de faturamentos salvos');
assert.equal(billingPriceCatalog([], reportOperations, [], definedPrices).length, 3, 'Preços salvos preservam catálogo mesmo se a origem for removida');
const zeroPrice = { ...definedPrices[0], salePrice: 0 };
assert.equal(billingPricesFromEntries([zeroPrice])[zeroPrice.key].salePrice, 0, 'Preço zero é válido');
assert.equal(Object.keys(billingPricesFromEntries([{ ...zeroPrice, salePrice: null }])).length, 0, 'Preço pendente não é cadastrado como zero');
assert.equal(parseBillingPrice(''), null);
assert.equal(parseBillingPrice('0'), 0);
assert.equal(parseBillingPrice('12.34'), 12.34);
for (const value of ['-1', 'Infinity', 'NaN', '1.234']) assert.throws(() => parseBillingPrice(value));
assert.deepEqual(priceOrders, priceSnapshot, 'Montar o catálogo não altera os romaneios');
console.log('OK: catálogo automático, preços por operação/categoria/unidade, preço zero, campos pendentes e preenchimento dos faturamentos.');

assert.equal(billingUnitPrice({ 'ARROZ|KG': { salePrice: 999 } }, 'maceio', 'Estocáveis', 'Arroz', 'KG'), 0, 'Nunca busca preço global para uma operação/categoria sem preço cadastrado');

// Freight follows total units, regardless of how many different products or their prices.
const freightInvoice = { ...structuredClone(base), freight: { operationId: base.operationId, category: '', amount: 200 }, items: Array.from({ length: 15 }, (_, index) => ({ id: `freight-${index}`, product: `Produto ${index + 1}`, unit: 'UN', quantity: index === 14 ? 300 : 50, price: index + 1, category: index < 7 ? 'Estocáveis' : 'Proteínas' })) };
const freightSnapshot = structuredClone(freightInvoice);
const freightLines = billingCostLines(freightInvoice);
assert.equal(freightInvoice.items.reduce((sum, item) => sum + item.quantity, 0), 1000);
assert.equal(freightLines[0].freight, 10);
assert.equal(freightLines[14].freight, 60);
assert.ok(freightLines.every(row => Math.abs(row.unitCost - row.item.price - .2) < 1e-9), 'Cada um dos 1000 itens recebe R$ 0,20, independente do preço');
assert.equal(freightLines.reduce((sum, row) => sum + Math.round(row.freight * 100), 0), 20000);
assert.equal(invoiceTotal(freightInvoice), freightInvoice.items.reduce((sum, item) => sum + lineTotal(item), 0) + 200);
assert.equal(validateInvoice(freightInvoice), '');
assert.deepEqual(freightInvoice, freightSnapshot, 'Calcular não altera preços ou quantidades originais');
assert.deepEqual(billingCostLines(JSON.parse(JSON.stringify(freightInvoice))), freightLines, 'Salvar e reabrir mantém o rateio');
const categoryFreight = { ...freightInvoice, freight: { ...freightInvoice.freight, category: 'Estocáveis', amount: 35 } };
assert.ok(billingCostLines(categoryFreight).slice(0, 7).every(row => row.freight === 5));
assert.ok(billingCostLines(categoryFreight).slice(7).every(row => row.freight === 0), 'Não inclui produtos de outra categoria');
const splitCents = { ...freightInvoice, freight: { ...freightInvoice.freight, amount: .01 }, items: freightInvoice.items.slice(0, 3) };
assert.deepEqual(billingCostLines(splitCents).map(row => row.freight), [.01, 0, 0], 'Centavo residual distribuído uma única vez e de forma estável');
const fractional = { ...splitCents, freight: { ...splitCents.freight, amount: 1 }, items: [{ ...base.items[0], quantity: .5, price: 0 }, { ...base.items[0], id: '2', quantity: 1.5, billedQuantity: 1, price: 10 }, { ...base.items[0], id: '3', billedQuantity: 0 }] };
assert.deepEqual(billingCostLines(fractional).map(row => row.freight), [.33, .67, 0], 'Respeita quantidade fracionada, ajuste zero e produto de preço zero');
assert.equal(validateInvoice(fractional), '');
assert.equal(billingCostLines({ ...freightInvoice, freight: undefined }).reduce((sum, row) => sum + row.freight, 0), 0, 'Remover frete restaura os totais originais');
for (const amount of [-1, NaN, Infinity, 1.234]) assert.ok(validateInvoice({ ...freightInvoice, freight: { ...freightInvoice.freight, amount } }));
assert.ok(validateInvoice({ ...freightInvoice, freight: { ...freightInvoice.freight, operationId: 'outra' } }));
assert.ok(validateInvoice({ ...freightInvoice, freight: { ...freightInvoice.freight, category: 'inexistente' } }));
assert.ok(validateInvoice({ ...freightInvoice, items: freightInvoice.items.map(item => ({ ...item, billedQuantity: 0 })) }), 'Impede frete sem quantidade para ratear');
assert.equal(companyTotals([freightInvoice])[0].base, invoiceTotal(freightInvoice), 'Relatórios financeiros incluem frete exatamente uma vez');
console.log('OK: frete em 15 produtos/1000 itens, rateio por quantidade, categorias, centavos, frações, ajuste zero, validação e persistência.');

const tableDraft = { ...structuredClone(repricedLocal), items: repricedLocal.items.map(item => ({ ...item, price: 0 })) };
const tableSnapshot = structuredClone(tableDraft);
const refreshed = applyBillingTablePrices(tableDraft, operationPrices);
assert.equal(refreshed.updated, 2);
assert.equal(refreshed.missing, 0);
assert.equal(invoiceTotal(refreshed.invoice), 36, 'Busca o preço de cada categoria do consolidado, independente do valor antigo');
assert.deepEqual(tableDraft, tableSnapshot, 'Revisar preços não altera a cópia salva antes da confirmação');
const priceZero = { ...operationPrices, [billingOperationPriceKey(tableDraft.operationId, tableDraft.items[0].category, tableDraft.items[0].product, tableDraft.items[0].unit)]: { salePrice: 0 } };
assert.equal(billingTablePrice(priceZero, tableDraft, tableDraft.items[0]), 0, 'Preço zero cadastrado é encontrado');
assert.equal(billingTablePrice({}, tableDraft, tableDraft.items[0]), undefined, 'Ausência é diferente de zero cadastrado');
const manualPriceDraft = { ...tableDraft, items: tableDraft.items.map(item => ({ ...item, price: 12 })) };
assert.ok(applyBillingTablePrices(manualPriceDraft, {}).invoice.items.every(item => item.price === 12), 'Preserva valor informado quando o produto não tem preço na tabela');
assert.equal(applyBillingTablePrices(manualPriceDraft, {}).missing, 2);
assert.equal(billingTablePrice(operationPrices, { ...tableDraft, operationId: 'outra' }, tableDraft.items[0]), undefined);
assert.equal(billingTablePrice(operationPrices, tableDraft, { ...tableDraft.items[0], unit: 'PACOTE' }), undefined);
console.log('OK: atualização explícita dos preços salvos, consolidados com múltiplas categorias, zero cadastrado, pendências e preservação de valores sem correspondência.');

const foreignTableId = 'outra-operacao';
const [firstTableItem, secondTableItem] = manualPriceDraft.items;
const foreignPrices = {
  ...operationPrices,
  [billingOperationPriceKey(foreignTableId, firstTableItem.category, firstTableItem.product, firstTableItem.unit)]: { salePrice: 0 },
  [billingOperationPriceKey(foreignTableId, secondTableItem.category, secondTableItem.product, 'PACOTE')]: { salePrice: 99 },
};
const foreignResult = applyBillingTablePrices(manualPriceDraft, foreignPrices, foreignTableId);
assert.equal(foreignResult.updated, 1);
assert.equal(foreignResult.missing, 1);
assert.deepEqual(foreignResult.invoice.items.map(item => item.price), [0, 12]);
assert.equal(foreignResult.invoice.operationId, manualPriceDraft.operationId);
assert.deepEqual(foreignResult.invoice.location, manualPriceDraft.location);
const reopened = JSON.parse(JSON.stringify(foreignResult.invoice));
assert.equal(reopened.priceTableOperationId, foreignTableId);
assert.equal(billingTablePrice(foreignPrices, reopened, reopened.items[0]), 0);
assert.equal(billingTablePrice(foreignPrices, reopened, reopened.items[1]), undefined);
assert.deepEqual(applyBillingTablePrices(reopened, foreignPrices, 'sem-tabela').invoice, reopened);
const ownTableAgain = applyBillingTablePrices(reopened, foreignPrices, manualPriceDraft.operationId);
assert.equal(ownTableAgain.invoice.priceTableOperationId, undefined);
assert.equal(invoiceTotal(ownTableAgain.invoice), 36);
console.log('OK: escolha da tabela de outra operação, reabertura e retorno à tabela original.');

const sharedOperations = [
  { id: 'a', name: 'Operação Gauianases (SP)', city: '' },
  { id: 'b', name: 'Operação - Boituva (SP)', city: '' },
  { id: 'm', name: 'Operação Mongaguá (SP)', city: '' },
];
const priceEntry = (operationId, category, product, unit, salePrice) => ({
  key: billingOperationPriceKey(operationId, category, product, unit), operationId, category, product, unit, salePrice,
});
const sharedEntries = [
  priceEntry('a', 'Hortifrutigranjeiro', 'Suco (350ml)', 'UN', 7.5),
  priceEntry('a', 'Estocáveis', 'Arroz', 'KG', 9),
  priceEntry('b', 'Estocáveis', 'Arroz', 'KG', 0),
  priceEntry('b', 'Dietas e Fórmulas', 'Fórmula 400g', 'UN', 24),
];
const sharedPrices = billingPricesFromEntries(sharedEntries, sharedOperations);
const sharedDraft = { ...base, operationId: 'b' };
const juice = { ...base.items[0], category: 'Hortifrúti', product: 'IG. Suco 350 ML', unit: 'UND' };
assert.deepEqual(billingTablePriceMatch(sharedPrices, sharedDraft, juice), { salePrice: 7.5, operationId: 'a' });
assert.equal(billingTablePrice(sharedPrices, sharedDraft, { ...juice, product: 'Suco 500ml' }), undefined);
assert.equal(billingTablePrice(sharedPrices, sharedDraft, { ...juice, unit: 'CX' }), undefined);
assert.equal(billingTablePrice(sharedPrices, sharedDraft, { ...juice, category: 'Estocáveis' }), undefined);
assert.equal(billingTablePrice(sharedPrices, { ...sharedDraft, operationId: 'm' }, juice), undefined);
assert.equal(billingTablePrice(sharedPrices, sharedDraft, base.items[0]), 0);
assert.equal(billingTablePrice(sharedPrices, { ...sharedDraft, priceTableOperationId: 'a' }, base.items[0]), 9);
assert.equal(billingUnitPrice(sharedPrices, 'a', 'Fórmulas', 'Fórmula', '0,4KG'), 24);
const sharedResult = applyBillingTablePrices({ ...sharedDraft, items: [juice, base.items[0]] }, sharedPrices);
assert.equal(sharedResult.updated, 2);
assert.deepEqual(sharedResult.invoice.items.map(item => item.price), [7.5, 0]);
const ambiguousPrices = billingPricesFromEntries([...sharedEntries,
  priceEntry('a', 'Hortifrutigranjeiros', 'Suco', '350ML', 11),
], sharedOperations);
assert.equal(billingTablePrice(ambiguousPrices, sharedDraft, juice), undefined);
console.log('OK: preços compartilhados entre Guaianases e Boituva, prioridade local, categorias equivalentes e embalagens.');



const categoryAdjustment = {
  ...structuredClone(base), category: 'Estocáveis, Proteínas',
  freight: { operationId: base.operationId, category: '', amount: 10 },
  items: [
    { id: 'rice', product: 'Arroz', category: 'Estocáveis', unit: 'KG', quantity: 5, billedQuantity: 2, price: 3 },
    { id: 'zero', product: 'Feijão', category: 'Estocáveis', unit: 'KG', quantity: 4, billedQuantity: 0, price: 8 },
    { id: 'meat', product: 'Carne', category: 'Proteínas', unit: 'KG', quantity: 8, billedQuantity: 3, price: 10 },
  ],
};
const adjustmentSnapshot = structuredClone(categoryAdjustment);
const stockAdjustment = billingAdjustmentLines(categoryAdjustment, 'Estocáveis');
assert.deepEqual(stockAdjustment.map(row => row.item.id), ['rice', 'zero']);
assert.equal(stockAdjustment[0].item.quantity, 5, 'Preserva quantidade entregue');
assert.equal(stockAdjustment[0].item.billedQuantity, 2, 'Usa o ajuste faturado');
assert.deepEqual(stockAdjustment.map(row => row.freight), [4, 0], 'Mantém apenas a parcela do frete da categoria, sem redistribuir o frete inteiro');
assert.equal(stockAdjustment.reduce((sum, row) => sum + row.total, 0), 10, 'Total inclui somente produtos e frete da categoria');
assert.equal(billingAdjustmentLines(categoryAdjustment, 'Proteínas')[0].total, 36);
assert.deepEqual(billingAdjustmentLines(categoryAdjustment, 'Limpeza'), []);
assert.equal(billingAdjustmentLines(base, 'Estocáveis').length, 0, 'Itens sem ajuste não entram no romaneio');
assert.equal(billingAdjustmentLines({ ...base, items: [{ ...base.items[0], billedQuantity: 2 }] }, 'Estocáveis').length, 1, 'Compatível com item ajustado sem categoria própria');
assert.equal(billingAdjustmentLines({ ...categoryAdjustment, items: [...categoryAdjustment.items, { ...categoryAdjustment.items[0], id: 'unchanged', billedQuantity: 5 }] }, 'Estocáveis').length, 2, 'Exclui os itens cuja quantidade não foi alterada');
assert.deepEqual(billingAdjustmentLines({ ...categoryAdjustment, batchFreight: { rice: 1.23, zero: 0, meat: 4.56 } }, 'Estocáveis').map(row => row.freight), [1.23, 0], 'Preserva o frete do conjunto de romaneios');
assert.deepEqual(categoryAdjustment, adjustmentSnapshot, 'Exportação não altera os dados de origem');
console.log('OK: romaneio de ajuste por categoria, quantidades zeradas, totais e frete preservado.');

const sixtyDelivered = { ...base.items[0], quantity: 60, price: 6 };
for (const [input, expected] of [['', 60], ['0', 60], ['-10', 50], ['+10', 70], ['-60', 0], ['+0,5', 60.5], ['-.125', 59.875]]) {
  const item = applyBillingQuantityAdjustment(sixtyDelivered, input);
  assert.equal(item.quantity, 60, 'A entrega original fica preservada');
  assert.equal(item.billedQuantity, expected, `60 entregues e ajuste ${input} = ${expected} faturados`);
  assert.equal(lineTotal(item), Math.round(expected * 6 * 100) / 100);
  assert.equal(billingQuantityAdjustment(item), expected - 60);
}
assert.equal(applyBillingQuantityAdjustment({ ...sixtyDelivered, billedQuantity: 50 }, '').billedQuantity, 60, 'Limpar o ajuste restaura a quantidade entregue');
assert.equal(billingQuantityAdjustment({ ...sixtyDelivered, billedQuantity: 50 }), -10, 'Registros anteriores são exibidos como diferença, sem mudar o valor faturado');
for (const input of ['-61', '-', '+', 'abc', 'Infinity', '1e3', '1.2345']) assert.throws(() => applyBillingQuantityAdjustment(sixtyDelivered, input), undefined, input);
console.log('OK: ajuste vazio, positivo, negativo, decimal, zeramento, compatibilidade e bloqueio de quantidade final negativa.');
