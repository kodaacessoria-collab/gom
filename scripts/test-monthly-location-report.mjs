import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildMonthlyLocationReport, getReportMonth } from '../src/lib/monthlyLocationReport.ts';
import { buildMonthlyLocationPdf, buildMonthlyLocationWorkbook } from '../src/lib/monthlyLocationExport.ts';

const points = ['a', 'b', 'empty'].map(id => ({ id, operationId: 'maceio', name: `Local ${id}`, address: 'Rua de teste, 10', neighborhood: 'Centro' }));
const order = (id, date, quantity, options = {}) => ({
  id, operationId: 'maceio', category: 'Estocáveis', deliveryDate: date,
  deliveries: [{ id: `delivery-${id}`, deliveryPointId: 'a', items: [{ product: 'Arroz', unit: 'KG', quantity }] }], ...options,
});
const orders = [
  order('first', '2026-10-01', 3), order('last', '2026-10-31', 4), order('month-only', '2026-10', 5),
  order('september', '2026-09-30', 999), order('november', '2026-11-01', 999), order('invalid', '2026-10-32', 999),
  order('other-op', '2026-10-10', 999, { operationId: 'boituva' }),
  order('other-category', '2026-10-03', 2, { category: 'CESTA BASICA' }),
  order('second-location', '2026-10-07', 0, { deliveries: [{ id: 'b1', deliveryPointId: 'b', items: [{ product: 'Arroz', unit: 'KG', quantity: 7 }, { product: 'Arroz', unit: 'UN', quantity: 2 }] }] }),
  order('duplicate-lines', '2026-10-15', 0, { deliveries: [{ id: 'a1', deliveryPointId: 'a', items: [{ product: ' arroz ', unit: 'kg', quantity: 1.5 }, { product: 'Arroz', unit: 'KG', quantity: 0.5 }, { product: 'Inválido', unit: 'UN', quantity: NaN }, { product: 'Zero', unit: 'UN', quantity: 0 }, { product: 'Negativo', unit: 'UN', quantity: -1 }] }] }),
];
const before = structuredClone(orders);
const all = buildMonthlyLocationReport(orders, points, 'maceio', '2026-10');
assert.equal(all.length, 2, 'Não inclui local sem entregas');
assert.equal(all[0].rows.find(row => row.category === 'Estocáveis').quantity, 14, 'Inclui primeiro e último dia e pedido mensal, sem misturar outros meses/operações');
assert.equal(all[0].rows.find(row => row.category === 'CESTA BASICA').quantity, 2, 'Mantém categorias separadas');
assert.equal(all[0].orderCount, 5);
assert.equal(all[0].deliveryCount, 5);
assert.deepEqual(all[1].rows.map(row => [row.unit, row.quantity]), [['KG', 7], ['UN', 2]], 'Unidades diferentes não são somadas');
assert.deepEqual(buildMonthlyLocationReport(orders, points, 'maceio', '2026-10', 'Todas', ['b']).map(group => group.id), ['b']);
assert.equal(buildMonthlyLocationReport(orders, points, 'maceio', '2026-10', 'Todas', ['a', 'b']).length, 2);
assert.equal(buildMonthlyLocationReport(orders, points, 'maceio', '2026-10', 'Todas', []).length, 0);
assert.equal(buildMonthlyLocationReport(orders, points, 'maceio', '2026-10', 'cesta básica')[0].rows.length, 1);
assert.equal(buildMonthlyLocationReport(orders, points, 'maceio', '').length, 0);
assert.equal(getReportMonth('2026-13'), null);
assert.equal(getReportMonth('2024-02').end, '2024-02-29');
assert.equal(getReportMonth('2026-02').end, '2026-02-28');
assert.equal(getReportMonth('2026-12').label, 'Dezembro/2026');
assert.equal(buildMonthlyLocationReport(orders, [], 'maceio', '2026-10')[0].name, 'Local não cadastrado (a)', 'Preserva entregas cujo local não está mais cadastrado');
assert.deepEqual(orders, before, 'Não altera os pedidos originais');

const scope = { operation: 'Operação Maceió', monthLabel: 'Outubro/2026', category: 'Todas as categorias', groups: all };
const bytes = XLSX.write(buildMonthlyLocationWorkbook(scope), { type: 'buffer', bookType: 'xlsx' });
const workbook = XLSX.read(bytes, { type: 'buffer' });
const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Produtos por local'], { header: 1 });
assert.equal(rows[2][1], 'Outubro/2026');
assert.equal(rows[4][1], 2);
assert.deepEqual(rows[6], ['Local', 'Endereço', 'Categoria', 'Produto', 'Unidade', 'Quantidade']);
assert.equal(rows.length, 11);
assert.equal(typeof rows[7][5], 'number');
const headers = [];
const header = async (doc, group, continuation) => {
  headers.push([group.id, continuation]);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('RELATÓRIO MENSAL DE PRODUTOS POR LOCAL', 14, 15);
  doc.setFontSize(9); doc.text('Operação Maceió | Outubro/2026 | Mês completo', 14, 24);
};
const pdf = await buildMonthlyLocationPdf(scope, header);
assert.equal(pdf.getNumberOfPages(), 2, 'Cada local começa em uma página');
assert.deepEqual(headers, [['a', false], ['b', false]]);
const readPages = async doc => {
  const task = getDocument({ data: new Uint8Array(doc.output('arraybuffer')), useSystemFonts: true });
  const document = await task.promise;
  const result = [];
  for (let i = 1; i <= document.numPages; i++) result.push((await (await document.getPage(i)).getTextContent()).items.map(item => item.str).join(' '));
  await task.destroy();
  return result;
};
const pages = await readPages(pdf);
assert.ok(pages[0].includes('Local a') && !pages[0].includes('Local b'));
assert.ok(pages[1].includes('Local b') && pages[1].includes('Página 2 de 2'));
headers.length = 0;
const overflow = await buildMonthlyLocationPdf({ ...scope, groups: [{ ...all[0], rows: Array.from({ length: 110 }, (_, i) => ({ category: 'Estocáveis', product: `Produto ${i + 1} para teste de paginação`, unit: 'KG', quantity: i + 1 })) }] }, header);
assert.ok(overflow.getNumberOfPages() > 1);
assert.equal(headers.length, overflow.getNumberOfPages(), 'Timbre repetido em todas as páginas');
assert.ok(headers.slice(1).every(([, continuation]) => continuation));
for (const page of await readPages(overflow)) assert.ok(page.includes('Local a') && page.includes('Categoria') && page.includes('Outubro/2026'));
await assert.rejects(buildMonthlyLocationPdf({ ...scope, groups: [] }, header));
await mkdir(new URL('../tmp/pdfs/', import.meta.url), { recursive: true });
await writeFile(new URL('../tmp/pdfs/monthly-locations.pdf', import.meta.url), Buffer.from(pdf.output('arraybuffer')));
await writeFile(new URL('../tmp/pdfs/monthly-locations-overflow.pdf', import.meta.url), Buffer.from(overflow.output('arraybuffer')));
await writeFile(new URL('../tmp/monthly-locations.xlsx', import.meta.url), bytes);
console.log('OK: mês inteiro, datas mensais, categorias, unidades, seleção individual/múltipla/todos, Excel e PDF com paginação.');
