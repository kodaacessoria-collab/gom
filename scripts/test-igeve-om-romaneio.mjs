import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createOmBillingRomaneio, isOmLogBilling, romaneioFilename } from '../src/lib/igeveOmRomaneio.ts';

const logo = `data:image/png;base64,${readFileSync('src/assets/igeve-logo.png').toString('base64')}`;
const names = ['ARROZ INTEGRAL', 'CACAU 100%', 'COLORAL', 'ERVILHA SECA', 'EXTRATO DE TOMATE', 'FARINHA DE MILHO FLOCÃO', 'FARINHA DE TRIGO', 'FEIJÃO CARIOCA', 'FEIJÃO PRETO', 'FERMENTO PARA PÃES', 'FUBÁ', 'MACARRÃO PARAFUSO', 'SAL', 'VINAGRE'];
const invoice = {
  id: 'test', sourceOrderId: 'order', sourceDeliveryId: 'delivery', control: 'LOCAL 2026-10-01 a 2026-10-31',
  operationId: 'guaianases', operation: 'Operação Guaianases (SP)', destination: 'CEI Modelo',
  category: 'Estocáveis', company: 'OM LOGISTICA E DISTRIBUICAO LTDA', cnpj: '68.673.515/0001-96',
  date: '2026-11-10', deliveryDate: '2026-10-16', notes: '',
  items: names.map((product, i) => ({ id: `item-${i}`, product, category: 'Estocáveis', unit: i % 2 ? '200G' : 'KILO', quantity: 20, billedQuantity: i === 13 ? 17 : 20 + i + 1, price: 6 })),
};
const options = { logo, point: { id: 'point', name: invoice.destination, operationId: invoice.operationId, code: '1A', address: 'Rua de exemplo, 38', neighborhood: 'Jardim Modelo' }, consumption: 'Outubro/2026' };
const snapshot = structuredClone(invoice);
assert.equal(isOmLogBilling(invoice), true);
assert.equal(isOmLogBilling({ company: 'OM LOGÍSTICA E DISTRIBUIÇÃO LTDA', cnpj: '' }), true);
assert.equal(isOmLogBilling({ company: 'Outra empresa', cnpj: '' }), false);
assert.equal(isOmLogBilling({ company: invoice.company, cnpj: '12345678000100' }), false, 'CNPJ de outra empresa não pode receber modelo OM');
assert.throws(() => createOmBillingRomaneio({ ...invoice, company: 'Outra empresa', cnpj: '12345678000100' }, 'Estocáveis', options), /exclusivo/);
assert.throws(() => createOmBillingRomaneio({ ...invoice, items: invoice.items.map(item => ({ ...item, billedQuantity: item.quantity })) }, 'Estocáveis', options), /Nenhum item ajustado/);
mkdirSync('tmp/pdfs/om-romaneio', { recursive: true });
const pdf = createOmBillingRomaneio({ ...invoice, items: [...invoice.items,
  { ...invoice.items[0], id: 'unchanged', product: 'PRODUTO SEM AJUSTE', billedQuantity: 20 },
  { ...invoice.items[0], id: 'other', product: 'OUTRA CATEGORIA', category: 'Proteínas' },
] }, 'Estocáveis', options);
assert.equal(pdf.getNumberOfPages(), 1);
assert.ok(pdf.internal.pageSize.getHeight() > pdf.internal.pageSize.getWidth(), 'A4 retrato');
const bytes = new Uint8Array(pdf.output('arraybuffer'));
writeFileSync('tmp/pdfs/om-romaneio/modelo.pdf', bytes);
const parsed = await getDocument({ data: bytes, useSystemFonts: true }).promise;
const text = (await (await parsed.getPage(1)).getTextContent()).items.map(item => item.str).join(' ').replace(/\s+/g, ' ');
for (const expected of ['ROMANEIO', 'ESTOCÁVEIS', 'CEI Modelo', 'Código: 1A', 'Rua de exemplo, 38', 'Jardim Modelo', '16/10/2026', 'Outubro/2026', 'UND / MEDIDA', '+1', '-3', 'Data de recebimento:', 'Nome de quem recebeu:', 'Assinatura:']) assert.ok(text.includes(expected), expected);
for (const excluded of ['PRODUTO SEM AJUSTE', 'OUTRA CATEGORIA', 'R$', 'Preço', 'de ajuste']) assert.ok(!text.includes(excluded), excluded);
assert.ok(!romaneioFilename(invoice, 'Estocáveis').includes('ajuste'));
const long = createOmBillingRomaneio({ ...invoice, items: Array.from({length: 100}, (_, i) => ({ ...invoice.items[i % 14], id: `long-${i}`, product: `PRODUTO ${i} COM DESCRIÇÃO LONGA PARA CONFERIR QUEBRA DE LINHA NA TABELA` })) }, 'Estocáveis', options);
assert.ok(long.getNumberOfPages() > 1);
writeFileSync('tmp/pdfs/om-romaneio/varias-paginas.pdf', new Uint8Array(long.output('arraybuffer')));
assert.deepEqual(invoice, snapshot);
console.log('OK: modelo OM Log em A4 retrato, logo IGEVE, campos de entrega e recebimento, somente itens ajustados, quantidades com sinal, várias páginas e exclusividade por empresa.');
