import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

let response;
globalThis.self = { postMessage(value) { response = value; } };
const { valueRows } = await import('../src/workers/excelOrderParser.worker.ts');

// No address or neighborhood is supplied to the importer.
const points = [
  { id: 'jose', code: '001', name: 'Escola Municipal José da Silva' },
  { id: 'maria', code: '002', name: 'Escola Municipal Maria de Souza' },
];
const parse = (rows, name = 'Planilha1', registrations = points, expectedError = '') => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  self.onmessage({ data: {
    buffer: XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }),
    deliveryPoints: registrations,
  } });
  if (expectedError) { assert.match(response.error || '', new RegExp(expectedError)); return; }
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
parse([...metadata, ['LOCAL DE ENTREGA', 'Escola Desconhecida'], ['PRODUTO', 'UND', 'QTD'], ['ARROZ', 'KG', 2]], 'Planilha1', points.slice(0, 1), 'operação selecionada');
parse([...metadata, ['LOCAL', 'José da Silva'], ['PRODUTO', 'UND', 'QTD'], ['ARROZ', 'KG', 2]], 'Planilha1', [...points, { id: 'duplicate', code: '003', name: 'EM José da Silva' }], 'operação selecionada');
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

const flat = parse([...metadata, ['LOCAL', 'PRODUTO', 'UND', 'QTD'], ['001', 'ARROZ', 'KG', 2], ['002', 'FEIJÃO', 'KG', 3], ['001', 'ARROZ', 'KG', 4]]);
assert.deepEqual(flat.deliveries.map(d => [d.deliveryPointId, d.items[0].quantity]), [['jose', 6], ['maria', 3]]);
parse([...metadata, ['PRODUTO', 'UND', '001', 'Local desconhecido', 'TOTAL'], ['ARROZ', 'KG', 2, 3, 5]], 'Planilha1', points, 'Local desconhecido');
// Formatting may inflate the declared Excel range to the final row and column.
{
  const sheet = XLSX.utils.aoa_to_sheet([...metadata, ['PRODUTO', 'UND', '001'], ['ARROZ', 'KG', 2]]);
  sheet['!ref'] = 'A1:XFD1048576';
  const start = performance.now();
  assert.equal(valueRows(sheet).at(-1)[2], 2);
  assert(performance.now() - start < 1000, 'A faixa vazia não deve atrasar a leitura');
}
console.log('OK: locais por linha, bloqueio de importação parcial e faixa vazia gigante.');

parse([...metadata, ['LOCAL', 'Escola Desconhecida'], ['PRODUTO', 'UND', 'QTD'], ['ARROZ', 'KG', 1]], '001', points, 'operação selecionada');
// A valid sheet must not hide an unmatched delivery on another sheet.
{
  const workbook = XLSX.utils.book_new();
  for (const [name, label] of [['A', '001'], ['B', 'Escola Desconhecida']]) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([...metadata, ['LOCAL', label], ['PRODUTO', 'UND', 'QTD'], ['ARROZ', 'KG', 2]]), name);
  }
  self.onmessage({ data: { buffer: XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }), deliveryPoints: points } });
  assert.match(response.error, /Aba B/);
  assert(!response.result);
}
console.log('OK: divergência entre cabeçalho e aba, e bloqueio de perda de dados entre abas.');

const totalRow = parse([...metadata, ['LOCAL', '001'], ['PRODUTO', 'UND', 'QTD', 'OBSERVAÇÃO'], ['ARROZ', 'KG', 2, 'Entregar cedo'], ['TOTAL', '', 2]]);
assert.equal(totalRow.deliveries[0].items.length, 1, 'Total da planilha não é produto');
assert.equal(totalRow.deliveries[0].items[0].notes, 'Entregar cedo');

// A full school name must win over a shorter neighborhood registration in
// the basket sector, regardless of registration order.
const school = { id: 'school', code: '1A', name: 'CMEI Professora Anne Cleide Pimentel Bezerra' };
const neighborhood = { id: 'basket', code: '007', name: 'ANTARES' };
for (const registrations of [[school, neighborhood], [neighborhood, school]]) {
  const result = parse([...metadata, ['PRODUTO', 'UND', 'CMEI Professora Anne Cleide Pimentel Bezerra - ANTARES'], ['ARROZ', 'KG', 10]], 'Pedido', registrations);
  assert.equal(result.deliveries[0].deliveryPointId, 'school');
}
parse([...metadata, ['PRODUTO', 'UND', 'CMEI Professora Anne Cleide Pimentel Bezerra - ANTARES'], ['ARROZ', 'KG', 10]], 'Pedido', [school, { ...school, id: 'duplicate', code: '1B' }, neighborhood], 'operação selecionada');
console.log('OK: nomes completos têm prioridade sobre bairros; duplicados continuam bloqueados.');

// Real registration uses a city suffix omitted by PEDIDO SP DIETAS.xlsx.
const rubi = { id: 'rubi', code: '1A', name: 'CEI Rubi - Guainazes' };
const mendonca = { id: 'mendonca', code: '1B', name: 'CEI Mendonça (Guaianazes)' };
const spPoints = [rubi, mendonca];
const spMetadata = [['Categoria', 'Dietas e Fórmulas'], ['Data de Entrega', '30/10/2026']];
const spMatrix = parse([...spMetadata, ['PRODUTO', 'UND', 'CEI Rubi', 'CEI Mendonça'], ['FÓRMULA', 'LT', 4, 6]], 'Pedido', spPoints);
assert.deepEqual(spMatrix.deliveries.map(d => [d.deliveryPointId, d.items[0].quantity]), [['rubi', 4], ['mendonca', 6]]);
assert.equal(spMatrix.metadata.category, 'Dietas e Fórmulas');
const spRows = parse([...spMetadata, ['LOCAL', 'PRODUTO', 'UND', 'QTD'], ['CEI Rubi', 'FÓRMULA', 'LT', 4]], 'Pedido', spPoints);
assert.equal(spRows.deliveries[0].deliveryPointId, 'rubi');
const spUnit = parse([...spMetadata, ['LOCAL', 'CEI Rubi'], ['PRODUTO', 'UND', 'QTD'], ['FÓRMULA', 'LT', 4]], 'Pedido', spPoints);
assert.equal(spUnit.deliveries[0].deliveryPointId, 'rubi');
const abbreviatedRows = [...spMetadata, ['PRODUTO', 'UND', 'CEI Rubi'], ['FÓRMULA', 'LT', 4]];
parse(abbreviatedRows, 'Pedido', [{ ...rubi, name: 'CEI Rubiana' }], 'CEI Rubi');
parse(abbreviatedRows, 'Pedido', [{ ...rubi, name: 'CEI Rubiácea' }], 'CEI Rubi');
for (const registrations of [
  [rubi, { ...rubi, id: 'other', code: '2A', name: 'CEI Rubi - Centro' }],
  [{ ...rubi, id: 'other', code: '2A', name: 'CEI Rubi - Centro' }, rubi],
]) parse(abbreviatedRows, 'Pedido', registrations, 'CEI Rubi');
const exactRubi = parse(abbreviatedRows, 'Pedido', [...spPoints, { id: 'exact', code: '2A', name: 'CEI Rubi' }]);
assert.equal(exactRubi.deliveries[0].deliveryPointId, 'exact');
console.log('OK: CEI Rubi com sufixo no cadastro em matriz, linhas e unidade; nomes semelhantes e abreviações ambíguas continuam bloqueados.');
