import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import * as XLSX from 'xlsx';

const workerFile = readdirSync('dist/assets').find(name => /^excelOrderParser\.worker-.*\.js$/.test(name));
assert(workerFile, 'Gere a versão de produção antes deste teste.');
let response;
let progressCount = 0;
const scope = { postMessage(message) {
  if (message.progress) progressCount += 1;
  else response = message;
} };
vm.runInNewContext(readFileSync(`dist/assets/${workerFile}`, 'utf8'), {
  self: scope, console, Date, ArrayBuffer, Uint8Array, TextDecoder, TextEncoder,
}, { timeout: 5000 });

function parseWorkbook(workbook, points) {
  response = undefined;
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const start = performance.now();
  scope.onmessage({ data: { buffer, deliveryPoints: points } });
  assert(response, 'O worker deve responder.');
  assert(!response.error, response.error);
  return { ...response.result, elapsedMs: Math.round(performance.now() - start) };
}

const points = Array.from({ length: 100 }, (_, id) => ({ id: String(id), code: String(id + 1), name: `Escola ${id + 1}` }));
const rows = [
  ['Data de Entrega', '27/10/2026'], ['Categoria', 'Estocáveis'],
  ['PRODUTO', 'UND', ...points.map(point => point.name)],
  ...Array.from({ length: 300 }, (_, product) => [`Produto ${product}`, 'KG', ...points.map((_, column) => product + column + 1)]),
];
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Pedido');
const result = parseWorkbook(workbook, points);
assert.equal(result.deliveries.length, 100);
assert.equal(result.metadata.deliveryDate, '2026-10-27');
assert.equal(result.metadata.category, 'Estocáveis');
for (const delivery of result.deliveries) {
  assert.equal(delivery.items.length, 300);
  for (const item of delivery.items) {
    const product = Number(item.product.replace('Produto ', ''));
    assert.equal(item.quantity, product + Number(delivery.deliveryPointId) + 1);
  }
}
assert(progressCount > 0);
console.log(`OK produção: 100 locais, 300 produtos, 30.000 quantidades conferidas em ${result.elapsedMs} ms.`);

// Optional real order: registrations here come from the file, not the live database.
const filePath = process.argv[2];
if (filePath) {
  const realWorkbook = XLSX.read(readFileSync(filePath), { type: 'buffer' });
  assert.equal(realWorkbook.SheetNames.length, 1, 'Este teste real confere a matriz de uma única aba.');
  const sheet = realWorkbook.Sheets[realWorkbook.SheetNames[0]];
  const realRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headerRow = realRows.findIndex(row => row[0] === 'PRODUTO' && row[1] === 'UND');
  assert(headerRow >= 0);
  const fileRegistrations = realRows[headerRow].slice(2).map((name, index) => ({ id: String(index), code: String(index + 1), name }));
  const registered = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], 'utf8')).gom_delivery_points : fileRegistrations;
  const expectedCodes = process.argv[4]?.split(',');
  const registrations = expectedCodes ? expectedCodes.map(code => {
    const point = registered.find(candidate => candidate.code === code);
    assert(point, `Código esperado ${code} deve existir no cadastro`);
    return point;
  }) : fileRegistrations;
  const expected = new Map();
  let itemCount = 0;
  for (const row of realRows.slice(headerRow + 1)) {
    registrations.forEach((point, index) => {
      const quantity = row[index + 2];
      if (typeof quantity !== 'number' || quantity <= 0 || !row[0]) return;
      const key = `${point.id}|${String(row[0]).replace(/\s+/g, ' ').trim()}|${String(row[1]).replace(/\s+/g, ' ').trim()}`;
      expected.set(key, (expected.get(key) || 0) + quantity);
      itemCount += 1;
    });
  }
  const actual = parseWorkbook(realWorkbook, registered);
  const received = new Map();
  for (const delivery of actual.deliveries) {
    for (const item of delivery.items) received.set(`${delivery.deliveryPointId}|${item.product}|${item.unit}`, item.quantity);
  }
  assert.equal(received.size, expected.size);
  for (const [key, quantity] of expected) assert.equal(received.get(key), quantity, key);
  console.log(`OK arquivo real: ${actual.deliveries.length} locais, ${itemCount} quantidades positivas conferidas em ${actual.elapsedMs} ms.`);
}
