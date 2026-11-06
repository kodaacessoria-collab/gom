import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';
import { DEFAULT_DOCUMENT_SUPPLIERS, DEFAULT_IGEVE_UNITS, decimal2, documentFilename, documentTotal, emptyNfeDocument, round2, parseBrazilianNumber, unitsForCnpj, validCnpj, validDocumentDate, validateNfeDocument } from '../src/lib/igeveDocuments.ts';
import { parseNfePages } from '../src/lib/nfePdfImport.ts';
import { createIgeveDocumentPdf } from '../src/lib/igeveDocumentPdf.ts';

assert.equal(decimal2(3), '3,00');
assert.equal(parseBrazilianNumber('1.234,5678'), 1234.5678);
assert.equal(parseBrazilianNumber('R$ 55,99'), 55.99);
assert.ok(Number.isNaN(parseBrazilianNumber('12,34,56')));
assert.ok(Number.isNaN(parseBrazilianNumber('12foo')));
assert.equal(round2(1.005), 1.01);
assert.equal(validDocumentDate('2026-02-30'), false);
assert.equal(validDocumentDate('2026-11-06'), true);
assert.equal(validCnpj('28.413.401/0041-80'), true);
assert.equal(validCnpj('28.413.401/0041-81'), false);
assert.equal(validCnpj('00000000000000'), false);
assert.equal(unitsForCnpj('28413401000192', DEFAULT_IGEVE_UNITS).length, 2);
assert.equal(unitsForCnpj('28.413.401/0050-70', DEFAULT_IGEVE_UNITS).length, 3);
assert.equal(unitsForCnpj('', DEFAULT_IGEVE_UNITS).length, 0);
assert.equal(unitsForCnpj('28.413.401/0041-80', DEFAULT_IGEVE_UNITS)[0].name, 'GARÇA TORTA');
for (const s of DEFAULT_DOCUMENT_SUPPLIERS.filter(s => s.cnpj)) assert.equal(validCnpj(s.cnpj), true, s.name);
for (const u of DEFAULT_IGEVE_UNITS) assert.equal(validCnpj(u.cnpj), true, u.name);

const word = (text, x, y, width = text.length * 4) => ({ text, x, y, width });
const header = y => [word('CÓDIGO', 10, y), word('DESCRIÇÃO DOS PRODUTOS', 55, y), word('NCM/SH', 265, y), word('CST', 310, y), word('CFOP', 340, y), word('UNID.', 375, y), word('QUANT.', 410, y), word('VALOR UNITÁRIO', 460, y), word('VALOR TOTAL', 540, y)];
const line = (y, product, qty, price, code = '001') => [word(code, 10, y), word(product, 55, y), word('10063021', 265, y), word('060', 310, y), word('5102', 340, y), word('KG', 375, y), word(qty, 410, y), word(price, 460, y), word('100,00', 540, y)];
const page1 = { words: [word('DANFE - TESTE', 10, 10), word('Nº 000.000.658', 200, 20), word('66.321.676/0001-95', 10, 30), word('DESTINATÁRIO / REMETENTE', 10, 55), word('NOME / RAZÃO SOCIAL', 10, 65), word('CNPJ / CPF', 350, 65), word('IGEVE', 10, 80), word('28.413.401/0041-80', 350, 80), word('DATA DA EMISSÃO', 450, 95), word('06/11/2026', 450, 110), ...header(160), ...line(190, 'ARROZ', '3,00', '2,5550'), word('PARBOLIZADO 1KG', 55, 205), ...line(230, 'FEIJÃO', '2,00', '4,50'), word('DADOS ADICIONAIS', 10, 260), ...line(280, 'NÃO É UM ITEM', '1,00', '999,00')] };
const page2 = { words: [...header(30), ...line(60, 'ÓLEO', '4,00', '10,00', '003')] };
const parsed = parseNfePages([page1, page2]);
assert.equal(parsed.document.items.length, 3);
assert.equal(parsed.document.items[0].product, 'ARROZ PARBOLIZADO 1KG');
assert.equal(parsed.document.items[0].price, 2.56);
assert.equal(parsed.document.items[2].product, 'ÓLEO');
assert.equal(parsed.document.number, '000000658');
assert.equal(parsed.document.recipientCnpj, '28.413.401/0041-80');
assert.equal(parsed.document.issuerCnpj, '66.321.676/0001-95');
assert.equal(parsed.document.issuedAt, '2026-11-06');
assert.ok(parsed.warnings.some(w => w.includes('arredondamentos')));
assert.equal(parseNfePages([{ words: [word('66.321.676/0001-95', 1, 1)] }]).document.recipientCnpj, '');
assert.equal(parseNfePages([{ words: [] }]).document.items.length, 0);
const splitHead = header(100).flatMap(w => w.text === 'VALOR UNITÁRIO' ? [word('VALOR', w.x, 92, 25), word('UNITÁRIO', w.x, 104, 40)] : [{ ...w, y: w.text === 'UNID.' ? 92 : w.y }]);
assert.equal(parseNfePages([{ words: [...splitHead, ...line(140, 'TESTE CABEÇALHO', '12,00', '3,50')] }]).document.items.length, 1);
const centeredLine = line(190, 'QUANTIDADE ALINHADA À DIREITA', '3,00', '2,55').map(w => w.text === '3,00' ? { ...w, x: 404, width: 20 } : w);
assert.equal(parseNfePages([{ words: [...header(160), ...centeredLine] }]).document.items[0].quantity, 3);

const doc = { ...emptyNfeDocument(), ...parsed.document, number: '658', issuer: 'CANINDÉ', unitId: 'igeve-unit-24', unitName: 'GARÇA TORTA', address: 'ENDEREÇO DE TESTE, 123 - MACEIÓ/AL', deliverySupplierId: 'caninde', deliveryDate: '2026-11-06', confirmed: true, consumption: 'NOVEMBRO/2026', baskets: 2, notes: 'TESTE DE SOFTWARE - DADOS FICTÍCIOS. Sem validade comercial.' };
const quote = id => ({ supplierId: id, date: '2026-11-06', reference: 'COTAÇÃO FICTÍCIA PARA TESTE', prices: Object.fromEntries(doc.items.map(i => [i.id, i.price])) });
doc.quotations = [quote('caninde'), quote('red')];
const snapshot = structuredClone(doc);
assert.equal(validateNfeDocument(doc, DEFAULT_DOCUMENT_SUPPLIERS, 'quote'), '');
assert.equal(validateNfeDocument(doc, DEFAULT_DOCUMENT_SUPPLIERS, 'delivery'), '');
assert.ok(validateNfeDocument({ ...doc, confirmed: false }, DEFAULT_DOCUMENT_SUPPLIERS, 'quote'));
assert.ok(validateNfeDocument({ ...doc, recipient: '' }, DEFAULT_DOCUMENT_SUPPLIERS, 'delivery'));
assert.ok(validateNfeDocument({ ...doc, quotations: [{ ...doc.quotations[0], reference: '' }] }, DEFAULT_DOCUMENT_SUPPLIERS, 'quote'));
assert.ok(validateNfeDocument({ ...doc, quotations: [{ ...doc.quotations[0], date: '2099-01-01' }] }, DEFAULT_DOCUMENT_SUPPLIERS, 'quote'));
assert.ok(validateNfeDocument({ ...doc, quotations: [doc.quotations[0], doc.quotations[0]] }, DEFAULT_DOCUMENT_SUPPLIERS, 'quote'));
assert.ok(validateNfeDocument({ ...doc, quotations: [{ ...doc.quotations[0], prices: {} }] }, DEFAULT_DOCUMENT_SUPPLIERS, 'quote'));
assert.ok(validateNfeDocument({ ...doc, quotations: [{ ...doc.quotations[0], prices: { ...doc.quotations[0].prices, [doc.items[0].id]: -1 } }] }, DEFAULT_DOCUMENT_SUPPLIERS, 'quote'));
assert.ok(validateNfeDocument({ ...doc, items: [{ ...doc.items[0], quantity: .001 }] }, DEFAULT_DOCUMENT_SUPPLIERS, 'quote'));
assert.ok(validateNfeDocument({ ...doc, deliveryDate: '2026-02-30' }, DEFAULT_DOCUMENT_SUPPLIERS, 'delivery'));
assert.equal(documentTotal(doc.items), 56.68);
assert.equal(documentFilename(DEFAULT_DOCUMENT_SUPPLIERS[0], doc, 'quote'), 'CD-ORÇAMENTO_658-GARCA_TORTA.pdf');
assert.equal(documentFilename(DEFAULT_DOCUMENT_SUPPLIERS[0], { ...doc, number: '../../658' }, 'delivery'), 'CD-ROMANEIO_658-GARCA_TORTA.pdf');
assert.deepEqual(doc, snapshot);

mkdirSync('tmp/pdfs/igeve-documents', { recursive: true });
for (const supplier of DEFAULT_DOCUMENT_SUPPLIERS) {
  const s = supplier.cnpj ? supplier : { ...supplier, cnpj: '66.321.676/0001-95' };
  const q = quote(s.id);
  const sample = { ...doc, quotations: [q], deliverySupplierId: s.id };
  for (const kind of ['quote', 'delivery']) {
    const out = createIgeveDocumentPdf(sample, s, kind, q);
    assert.ok(out.pdf.getNumberOfPages() >= 1);
    writeFileSync(`tmp/pdfs/igeve-documents/${s.id}-${kind}.pdf`, new Uint8Array(out.pdf.output('arraybuffer')));
  }
}
const long = { ...structuredClone(doc), notes: doc.notes + '\n' + 'Texto de observação para verificar paginação e margens. '.repeat(150), items: Array.from({ length: 120 }, (_, i) => ({ ...doc.items[i % 3], id: String(i), product: 'PRODUTO COM DESCRIÇÃO LONGA PARA TESTE DE QUEBRA DE LINHA - ' + i })) };
long.quotations = [{ ...quote('caninde'), prices: Object.fromEntries(long.items.map(i => [i.id, i.price])) }];
const longPdf = createIgeveDocumentPdf(long, DEFAULT_DOCUMENT_SUPPLIERS[0], 'quote', long.quotations[0]);
assert.ok(longPdf.pdf.getNumberOfPages() > 3);
writeFileSync('tmp/pdfs/igeve-documents/long-quote.pdf', new Uint8Array(longPdf.pdf.output('arraybuffer')));
assert.throws(() => createIgeveDocumentPdf({ ...doc, confirmed: false }, DEFAULT_DOCUMENT_SUPPLIERS[0], 'quote', doc.quotations[0]));
assert.deepEqual(doc, snapshot, 'PDF não altera os dados salvos');

// Synthetic DANFE fixture used by the browser integration test. No real invoice is modified.
const fixture = new jsPDF({ unit: 'pt', format: [650, 850] });
for (const [index, p] of [page1, page2].entries()) {
  if (index) fixture.addPage();
  fixture.setFontSize(8);
  for (const w of p.words) fixture.text(w.text, w.x, w.y);
}
writeFileSync('tmp/pdfs/igeve-documents/nfe-fixture.pdf', new Uint8Array(fixture.output('arraybuffer')));
console.log('OK: extração por colunas, múltiplas páginas, decimais, CNPJ/unidade, validação de cotações, nomes de arquivos e PDFs de seis modelos.');
