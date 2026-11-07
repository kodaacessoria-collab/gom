import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';
import { DEFAULT_DOCUMENT_SUPPLIERS, DEFAULT_IGEVE_UNITS, decimal2, createAutomaticQuotation, quotationPrices, documentFilename, documentTotal, emptyNfeDocument, round2, parseBrazilianNumber, unitsForCnpj, validCnpj, validDocumentDate, validateNfeDocument } from '../src/lib/igeveDocuments.ts';
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

// Centered description heading, fiscal codes and wrapped products as in the OM DANFE.
const omHeader = header(160).map(w => w.text === 'DESCRIÇÃO DOS PRODUTOS' ? word(w.text, 130, 160, 100) : w);
const om = parseNfePages([{ words: [
  word('RECEBEMOS DE OM LOGISTICA E DISTRIBUICAO LTDA OS PRODUTOS CONSTANTES NA NOTA FISCAL', 10, 10),
  word('Nº 21', 450, 30), word('68.673.515/0001-96', 10, 45),
  word('DESTINATÁRIO / REMETENTE', 10, 60), word('NOME / RAZÃO SOCIAL', 10, 70), word('CNPJ / CPF', 350, 70), word('DATA EMISSÃO', 480, 70),
  word('INSTITUTO DE GESTAO EDUCACIONAL', 10, 85), word('28.413.401/0012-45', 350, 85), word('23/10/2026', 480, 85),
  word('ENDEREÇO', 10, 100), word('BAIRRO / DISTRITO', 350, 100), word('RUA DR LOURENCO DE MENDONCA, 107', 10, 115), word('JARDIM AUGUSTA', 350, 115),
  word('CEP', 10, 130), word('MUNICÍPIO', 100, 130), word('UF', 400, 130), word('08452-330', 10, 145), word('SAO PAULO', 100, 145), word('SP', 400, 145),
  ...omHeader, ...line(190, 'IG. ACUCAR', '3,00', '6,20', '8177893'), word('1KG', 55, 204),
] }, { words: [...line(30, 'IG. ARROZ', '9,00', '8,00', '8203304')] }]);
assert.equal(om.document.number, '21');
assert.equal(om.document.issuedAt, '2026-10-23');
assert.equal(om.document.issuer, 'OM LOGISTICA E DISTRIBUICAO LTDA');
assert.equal(om.document.recipient, 'INSTITUTO DE GESTAO EDUCACIONAL');
assert.equal(om.document.address, 'RUA DR LOURENCO DE MENDONCA, 107 - JARDIM AUGUSTA - SAO PAULO/SP - CEP 08452-330');
assert.equal(om.document.items.length, 2);
assert.equal(om.document.items[0].code, '8177893');
assert.equal(om.document.items[0].product, 'IG. ACUCAR 1KG');
assert.equal(om.document.items[1].product, 'IG. ARROZ');
const mergedRun = parseNfePages([{ words: [...omHeader, word('8177893 IG. ACUCAR', 10, 190, 102), ...line(190, '', '3,00', '6,20').filter(w => w.x >= 265)] }]);
assert.equal(mergedRun.document.items[0].code, '8177893');
assert.equal(mergedRun.document.items[0].product, 'IG. ACUCAR');
// A continuation page may have the issuer's header and no product headings.
// Footer sections on page 1 must not discard the layout for page 2.
const continuation = parseNfePages([
  { words: [...omHeader, ...line(190, 'OLEO DE SOJA', '8,00', '9,80'), word('DADOS ADICIONAIS', 10, 250)] },
  { words: [word('RUA DO EMITENTE', 80, 30), word('FONE: (19) 9999-0000', 80, 45),
    ...Array.from({ length: 12 }, (_, i) => line(100 + i * 20, `PRODUTO CONTINUACAO ${i + 1}`, '2,00', '3,50', String(i + 2))).flat(),
    word('CALCULO DO ISSQN', 10, 360), ...line(390, 'NAO IMPORTAR TRIBUTOS', '1,00', '999,00')] },
]);
assert.equal(continuation.document.items.length, 13);
assert.equal(continuation.document.items[0].product, 'OLEO DE SOJA');
assert.equal(continuation.document.items[12].product, 'PRODUTO CONTINUACAO 12');
const noFooter = parseNfePages([
  { words: [...omHeader, ...line(190, 'OLEO DE SOJA', '8,00', '9,80')] },
  { words: [word('RUA DO EMITENTE', 80, 30), ...line(100, 'SAL', '6,00', '2,90')] },
]);
assert.deepEqual(noFooter.document.items.map(i => i.product), ['OLEO DE SOJA', 'SAL']);
// Compact DANFE coordinates: centered headings, joined NCM/CST, integer quantities,
// right-aligned prices and units of different widths, with 27 + 12 products.
const compactHeader = [word('CÓDIGO', 39.6, 492.2, 20.3), word('DESCRIÇÃO DOS PRODUTOS / SERVIÇOS', 94.2, 492.2, 102),
  word('NCM/SH', 218.3, 492.2, 19.7), word('CST/', 249.8, 488.7, 11.4), word('CFOP', 270.8, 492.2, 13.9),
  word('UNID', 292.6, 492.2, 12.2), word('QUANT.', 319.1, 492.2, 19.2), word('VL UNITÁRIO', 357, 492.2, 31.9), word('VALOR TOTAL', 409.7, 492.2, 36.9)];
const compactLine = (y, index) => [word(String(8100000 + index), 19, y, 25.2), word(`PRODUTO TESTE ${index}`, 79, y, 75.6),
  word('17019900 0102', 210.7, y, 53.2), word('5102', 268.6, y, 16.8), word(index % 2 ? 'KILO' : 'PCT', 289.6, y, 16.8),
  word('2', 325.9, y, 4.2), word('6,20', 381.2, y, 16.8), word('12,40', 436, y, 21)];
const compact = parseNfePages([
  { words: [...compactHeader, ...Array.from({ length: 27 }, (_, i) => compactLine(502.6 + i * 12, i)).flat()] },
  { words: [word('RUA DO EMITENTE', 79, 56, 75), ...Array.from({ length: 12 }, (_, i) => compactLine(259.6 + i * 12, i + 27)).flat()] },
]);
assert.equal(compact.document.items.length, 39);
for (const [i, item] of compact.document.items.entries()) {
  assert.deepEqual([item.code, item.product, item.quantity, item.price], [String(8100000 + i), `PRODUTO TESTE ${i}`, 2, 6.2]);
}
const inconsistent = parseNfePages([{ words: [word('VALOR TOTAL DOS PRODUTOS', 450, 10), word('3.024,10', 450, 24), ...header(160), ...line(190, 'TESTE', '1,00', '10,00')] }]);
assert.ok(inconsistent.warnings.some(w => w.includes('difere do total')));
const autoDoc = { ...om.document, quotations: [] };
const issuerQuote = createAutomaticQuotation(autoDoc, DEFAULT_DOCUMENT_SUPPLIERS[2], DEFAULT_DOCUMENT_SUPPLIERS);
assert.equal(issuerQuote.markupPercent, 0);
assert.equal(issuerQuote.prices[autoDoc.items[0].id], 6.2);
autoDoc.quotations.push(issuerQuote);
const partner1 = createAutomaticQuotation(autoDoc, DEFAULT_DOCUMENT_SUPPLIERS[0], DEFAULT_DOCUMENT_SUPPLIERS);
autoDoc.quotations.push(partner1);
const partner2 = createAutomaticQuotation(autoDoc, DEFAULT_DOCUMENT_SUPPLIERS[1], DEFAULT_DOCUMENT_SUPPLIERS);
assert.equal(partner1.markupPercent, 8.75);
assert.equal(partner1.prices[autoDoc.items[0].id], 6.74);
assert.equal(partner1.prices[autoDoc.items[1].id], 8.7);
assert.equal(partner2.markupPercent, 12.35);
assert.equal(partner2.prices[autoDoc.items[0].id], 6.97);
assert.equal(partner2.prices[autoDoc.items[1].id], 8.99);
autoDoc.quotations.push(partner2);
assert.throws(() => createAutomaticQuotation(autoDoc, DEFAULT_DOCUMENT_SUPPLIERS[3], DEFAULT_DOCUMENT_SUPPLIERS));
autoDoc.quotations = [partner2];
assert.equal(createAutomaticQuotation(autoDoc, DEFAULT_DOCUMENT_SUPPLIERS[0], DEFAULT_DOCUMENT_SUPPLIERS).markupPercent, 8.75);
assert.equal(quotationPrices([{ ...autoDoc.items[0], price: 100 }], 8.75)[autoDoc.items[0].id], 108.75);

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
