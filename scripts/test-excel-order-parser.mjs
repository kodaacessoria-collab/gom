import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

let response;
globalThis.self = { postMessage(value) { response = value; } };
await import('../src/workers/excelOrderParser.worker.ts');

// No address or neighborhood is supplied to the importer.
const points = [
  { id: 'jose', code: '001', name: 'Escola Municipal José da Silva' },
  { id: 'maria', code: '002', name: 'Escola Municipal Maria de Souza' },
];
const parse = (rows, name = 'Planilha1', registrations = points) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  self.onmessage({ data: {
    buffer: XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }),
    deliveryPoints: registrations,
  } });
  assert(!response.error, response.error);
  return response.result;
};
const metadata = [['Categoria: Cesta Básica'], ['Data de Entrega: 26/10/2026']];
for (const [name, label] of [
  ['inline school name', 'Local de entrega: E.M. José da Silva'],
  ['numeric code', 'Código da escola: 1'],
  ['exact name', 'Escola: Escola Municipal José da Silva'],
]) {
  const result = parse([...metadata, [label], ['Descrição do produto', 'Un.', 'Qtde.'], ['CESTA BASICA', 'UN', 10]]);
  assert.equal(result.deliveries[0]?.deliveryPointId, 'jose', name);
  assert.equal(result.deliveries[0]?.items[0].quantity, 10, name);
  assert.equal(result.metadata.category, 'CESTA BASICA');
  assert.equal(result.metadata.deliveryDate, '2026-10-26');
}
const original = parse([...metadata, ['LOCAL DE ENTREGA', points[0].name], ['PRODUTO', 'UND', 'QTD', 'OBS.'], ['ARROZ', 'KG', 2, 'Conferir']]);
assert.equal(original.deliveries[0]?.items[0].notes, 'Conferir');
const matrix = parse([...metadata, ['Descrição', 'UN', 1, '002', 'TOTAL'], ['CESTA BASICA', 'UN', 10, 20, 30]]);
assert.deepEqual(matrix.deliveries.map(delivery => [delivery.deliveryPointId, delivery.items[0].quantity]), [['jose', 10], ['maria', 20]]);
const bySheet = parse([...metadata, ['PRODUTO', 'UND', 'QTD'], ['CESTA BASICA', 'UN', 7]], '001');
assert.equal(bySheet.deliveries[0]?.deliveryPointId, 'jose');
const generic = parse([...metadata, ['PRODUTO', 'UND', 'QTD'], ['ARROZ', 'KG', 2]], 'Planilha1', points.slice(0, 1));
assert.equal(generic.deliveries[0]?.deliveryPointId, 'jose');
const unknown = parse([...metadata, ['LOCAL DE ENTREGA', 'Escola Desconhecida'], ['PRODUTO', 'UND', 'QTD'], ['ARROZ', 'KG', 2]], 'Planilha1', points.slice(0, 1));
assert.equal(unknown.deliveries.length, 0);
const ambiguous = parse([...metadata, ['LOCAL', 'José da Silva'], ['PRODUTO', 'UND', 'QTD'], ['ARROZ', 'KG', 2]], 'Planilha1', [...points, { id: 'duplicate', code: '003', name: 'EM José da Silva' }]);
assert.equal(ambiguous.deliveries.length, 0);
const zero = parse([...metadata, ['PRODUTO', 'UND', 'QTD'], ['ARROZ', 'KG', 0]], '001');
assert.equal(zero.deliveries.length, 0);
console.log('OK: locais sem endereço, cabeçalhos, códigos numéricos, nomes, matriz, metadados e identificação sem ambiguidades.');

for (const value of ['10/2026', '2026-10', 'out/2026', 'Outubro de 2026']) {
  const result = parse([['Mês/Ano', value], ['Categoria', 'CESTA BASICA'], ['Local', '001'], ['PRODUTO', 'UN', 'QTD'], ['CESTA BASICA', 'UN', 10]]);
  assert.equal(result.metadata.deliveryDate, '2026-10', value);
}
// Excel date serial displayed as month/year must retain monthly precision.
{
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['Data de Entrega', 46311], ['Local', '001'], ['PRODUTO', 'UN', 'QTD'], ['CESTA BASICA', 'UN', 10]]);
  sheet.B1.z = 'mm/yyyy';
  XLSX.utils.book_append_sheet(workbook, sheet, 'Planilha1');
  self.onmessage({ data: { buffer: XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }), deliveryPoints: points } });
  assert.equal(response.result.metadata.deliveryDate, '2026-10');
}
const { parseDeliveryDate, deliveryDateInRange } = await import('../src/lib/deliveryDate.ts');
assert.equal(parseDeliveryDate('26/10/2026'), '2026-10-26');
assert.equal(parseDeliveryDate('31/02/2026'), '');
assert.equal(parseDeliveryDate('13/2026'), '');
assert.equal(parseDeliveryDate('29/02/2028'), '2028-02-29');
assert(deliveryDateInRange('2026-10', '2026-10-15', '2026-10-20'));
assert(deliveryDateInRange('2026-10', '2026-10-01', '2026-10-26'));
assert(!deliveryDateInRange('2026-10', '2026-11-01', '2026-11-30'));
assert(!deliveryDateInRange('2026-10', '2026-09-01', '2026-09-30'));
assert(deliveryDateInRange('2028-02', '2028-02-29', '2028-02-29'));
assert(!deliveryDateInRange('2026-10-26', '2026-10-01', '2026-10-25'));
console.log('OK: mês/ano em texto e Excel, datas completas, validação e filtros por sobreposição.');
