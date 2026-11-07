import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { DEFAULT_DOCUMENT_SUPPLIERS, emptyNfeDocument, validCnpj } from '../src/lib/igeveDocuments.ts';
import { createIgeveDocumentPdf } from '../src/lib/igeveDocumentPdf.ts';

const supplier = DEFAULT_DOCUMENT_SUPPLIERS.find(s => s.id === 'manu');
assert.ok(supplier);
assert.equal(supplier.layout, 'manu');
assert.equal(validCnpj(supplier.cnpj), true);
const products = [
  ['PATINHO MOÍDO', 30, 66], ['PATINHO EM CUBOS', 40, 66], ['FRANGO EM CUBOS', 45, 38.4],
  ['PERNIL EM CUBOS', 30, 38.4], ['FILÉ DE PEIXE - PANGA', 26, 70.68], ['LINGUIÇA TOSCANA', 5, 42],
  ['COXA DE FRANGO DESOSSADO', 10, 38.4],
];
const doc = { ...emptyNfeDocument(), number: '927461805', issuerCnpj: '66.321.676/0001-95',
  recipient: 'INSTITUTO DE GESTAO EDUCACIONAL E VALORIZACAO DO ENSINO - IGEVE', recipientCnpj: '28.413.401/0012-45',
  unitId: 'igeve-unit-2', unitName: 'CEI IGEVE MENDONÇA', address: 'RUA DR LOURENCO DE MENDONCA, 107 - JARDIM AUGUSTA - SAO PAULO/SP - CEP 08452-330', confirmed: true,
  items: products.map(([product, quantity, price], index) => ({ id: String(index), code: `SOURCE${index}`, product, unit: 'KG', quantity, price, brand: '', notes: '' })),
};
const quotation = { supplierId: supplier.id, date: '2026-08-15', reference: 'NF-e 927461805', markupPercent: 0, automaticPrices: true,
  prices: Object.fromEntries(doc.items.map(item => [item.id, item.price])) };
doc.quotations = [quotation];
const snapshot = structuredClone(doc);
const result = createIgeveDocumentPdf(doc, supplier, 'quote', quotation);
assert.equal(result.filename, 'MA-ORÇAMENTO-CEI_IGEVE_MENDONCA.pdf');
assert.equal(result.pdf.getNumberOfPages(), 1, 'Modelo de sete itens cabe em uma página');
const bytes = new Uint8Array(result.pdf.output('arraybuffer'));
mkdirSync('tmp/pdfs/igeve-documents', { recursive: true });
writeFileSync('tmp/pdfs/igeve-documents/manu-reference-sample.pdf', bytes);
const loading = getDocument({ data: bytes });
const parsed = await loading.promise;
try {
  const page = await parsed.getPage(1);
  const text = (await page.getTextContent()).items.filter(item => 'str' in item).map(item => item.str).join(' ');
  for (const value of [supplier.name, supplier.cnpj, supplier.contact, 'TOTAL GERAL', 'R$ 9.931,68', 'Pix / Dep. Bancário', '90 dias', '15/08/2026', doc.unitName, 'Assinatura do representante autorizado']) assert.ok(text.includes(value), value);
  for (const [name] of products) assert.ok(text.includes(name), name);
  for (const value of ['927461805', 'SOURCE0', 'Assinado digitalmente', '137.849.718-06']) assert.equal(text.includes(value), false, value);
} finally { await loading.destroy(); }
assert.deepEqual(doc, snapshot);
console.log('OK: Manu cadastrada, dados comerciais, modelo com sete produtos e total R$ 9.931,68, sem códigos do emitente ou assinatura prévia.');
