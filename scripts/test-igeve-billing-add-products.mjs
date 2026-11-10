import assert from 'node:assert/strict';
import { addBillingTableProduct, billingProductsToAdd, billingOperationPriceKey, billingAdjustmentLines, applyBillingQuantityAdjustment, invoiceTotal, validateInvoice } from '../src/lib/igeveBilling.ts';

const entry = (product, category = 'Estocáveis', operationId = 'guaianases', unit = 'UN', salePrice = 12.9) => ({
  key: billingOperationPriceKey(operationId, category, product, unit), operationId, category, product, unit, salePrice,
});
const entries = [entry('Arroz'), entry('Amido', 'Estocáveis', 'guaianases', '200G'), entry('Amido', 'Estocáveis', 'guaianases', '1KG'),
  entry('Fórmula', 'Dietas e Fórmulas'), entry('Carne', 'Proteínas'), entry('Outra operação', 'Estocáveis', 'rio'), entry('Sem preço', 'Estocáveis', 'guaianases', 'UN', null), entry('Gratuito', 'Estocáveis', 'guaianases', 'UN', 0)];
const invoice = { id: 'local', operationId: 'guaianases', category: 'Dietas e Fórmulas, Estocáveis', company: 'OM LOG', date: '2026-11-10',
  location: { categories: ['Estocáveis', 'Dietas e Fórmulas'] },
  items: [{ id: 'original', product: 'Arroz', unit: 'UN', category: 'Estocáveis', quantity: 2, billedQuantity: 2, price: 10 }] };
const snapshot = structuredClone(invoice);
const available = billingProductsToAdd(invoice, entries);
assert.equal(available.length, 5);
assert.ok(available.every(row => row.operationId === invoice.operationId && row.product !== 'Arroz' && row.category !== 'Proteínas'));
const amido = entries[1];
const added = addBillingTableProduct(invoice, entries, amido.key, 3.5, 'new');
assert.deepEqual(invoice, snapshot, 'Não altera a entrega nem o rascunho original');
assert.deepEqual(added.items[1], { id: 'new', product: 'Amido', unit: '200G', category: 'Estocáveis', price: 12.9, quantity: 0, billedQuantity: 3.5, addedForBilling: true });
assert.equal(invoiceTotal(added), 65.15);
assert.equal(validateInvoice(added), '');
assert.deepEqual(billingAdjustmentLines(added, 'Estocáveis').map(row => row.item.id), ['new']);
assert.equal(billingAdjustmentLines(added, 'Dietas e Fórmulas').length, 0);
assert.equal(billingProductsToAdd(added, entries).filter(row => row.product === 'Amido').length, 1, 'Mantém outra embalagem disponível');
assert.throws(() => addBillingTableProduct(added, entries, amido.key, 1, 'duplicate'));
assert.throws(() => addBillingTableProduct(invoice, entries, entries[5].key, 1, 'other-op'));
assert.throws(() => addBillingTableProduct(invoice, entries, entries[4].key, 1, 'other-category'));
for (const quantity of [0, -1, NaN, Infinity, 0.0001]) assert.throws(() => addBillingTableProduct(invoice, entries, amido.key, quantity, 'invalid'));
assert.throws(() => applyBillingQuantityAdjustment(added.items[1], '-1'));
assert.equal(validateInvoice({ ...added, items: [applyBillingQuantityAdjustment(added.items[1], '')] }), '');
assert.ok(validateInvoice({ ...added, items: [{ ...invoice.items[0], quantity: 0 }] }), 'Zero entregue exige identificação de produto adicionado');
const reopened = JSON.parse(JSON.stringify(added));
assert.equal(validateInvoice(reopened), '');
assert.equal(billingProductsToAdd(reopened, entries).some(row => row.key === amido.key), false);
const single = { ...invoice, location: undefined, category: 'Estocáveis' };
const normal = addBillingTableProduct(single, entries, amido.key, 2, 'normal');
assert.equal(normal.items[1].quantity, 2);
assert.equal(normal.items[1].billedQuantity, undefined);
assert.equal(validateInvoice(normal), '');
assert.equal(addBillingTableProduct(invoice, entries, entries[6].key, 1, 'pending').items[1].price, 0);
assert.equal(addBillingTableProduct(invoice, entries, entries[7].key, 1, 'zero').items[1].price, 0);
console.log('OK: inclusão pela tabela, operação/categoria/unidade, duplicação, entrega zero, ajustes, totais, validação e persistência.');
