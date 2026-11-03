import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { transpileModule, ModuleKind } from 'typescript';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { isMaceioBasicBasket } from '../src/lib/basicBasket.ts';

// Usa o mesmo gerador da aplicação, substituindo somente o carregamento do asset pelo Vite.
const image = await readFile(new URL('../src/assets/caninde-logo.png', import.meta.url));
const source = (await readFile(new URL('../src/lib/canindePdf.ts', import.meta.url), 'utf8'))
  .replace("import referenceUrl from '../assets/caninde-logo.png';", `const referenceUrl = 'data:image/png;base64,${image.toString('base64')}';`)
  .replace("from './basicBasket'", "from '../src/lib/basicBasket.ts'");
await mkdir(new URL('../tmp/', import.meta.url), { recursive: true });
const moduleUrl = new URL('../tmp/caninde-qa.mjs', import.meta.url);
await writeFile(moduleUrl, transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext } }).outputText);
globalThis.FileReader = class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then(bytes => {
      this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
      this.onload();
    }).catch(error => { this.error = error; this.onerror(); });
  }
};

try {
  const { addCanindeDelivery, addCanindeHeader } = await import(moduleUrl.href);
  const maceio = { id: 'maceio', city: 'Maceió', name: 'Operação Maceió' };
  assert.ok(isMaceioBasicBasket(maceio, { category: 'Cesta Básica' }));
  assert.ok(!isMaceioBasicBasket(maceio, { category: 'Limpeza' }));
  assert.ok(!isMaceioBasicBasket({ id: 'boituva', city: 'Boituva', name: 'Operação Boituva' }, { category: 'CESTA BASICA' }));
  const data = {
    location: 'Garça Torta', address: 'Vila Santa Maria, 149 - Garça Torta - Maceió/AL - CEP 57017-186',
    competence: 'SETEMBRO DE 2026', control: 'TESTE-43', deliveryDate: '2026-10-12',
    receiverCnpj: '28.413.401/0041-80', invoice: { number: '1159', series: '001', issuedAt: '2026-10-12', collaborationTerm: '01/2026' },
    items: [{ product: 'CESTA BASICA', unit: 'UN', quantity: 40 }, { product: 'CESTA BASICA', unit: 'UN', quantity: 3 }],
  };
  const textOf = async doc => {
    const task = getDocument({ data: new Uint8Array(doc.output('arraybuffer')), useSystemFonts: true });
    const pdf = await task.promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) pages.push((await (await pdf.getPage(i)).getTextContent()).items.map(item => item.str).join(' '));
    await task.destroy();
    return pages;
  };
  const doc = new jsPDF();
  await addCanindeDelivery(doc, data);
  assert.equal(doc.getNumberOfPages(), 1, 'O modelo normal cabe em uma página A4');
  const text = (await textOf(doc)).join(' ');
  for (const expected of ['Garça Torta', '1159', '28.413.401/0041-80', '129 kg', '86 un.', 'Assinatura do representante', 'TESTE-43']) assert.ok(text.includes(expected), expected);
  assert.ok(!text.includes('OLIVEIRA MENDES'));
  await mkdir(new URL('../tmp/pdfs/', import.meta.url), { recursive: true });
  await writeFile(new URL('../tmp/pdfs/caninde-romaneio.pdf', import.meta.url), Buffer.from(doc.output('arraybuffer')));
  const blank = new jsPDF();
  await addCanindeDelivery(blank, { ...data, invoice: undefined, receiverCnpj: undefined });
  const blankText = (await textOf(blank)).join(' ');
  assert.ok(!blankText.includes('1159'), 'Não reutiliza a NF do exemplo');
  assert.ok(!blankText.includes('28.413.401/0041-80'), 'Não reutiliza CNPJ de outra unidade');
  const overflow = new jsPDF();
  await addCanindeDelivery(overflow, { ...data, notes: 'Observação de recebimento e conferência. '.repeat(90) });
  const overflowPages = await textOf(overflow);
  assert.ok(overflowPages.length > 1);
  assert.ok(overflowPages.at(-1).includes('Data da assinatura'), 'Assinatura preservada após observações longas');
  const report = new jsPDF({ orientation: 'landscape' });
  await addCanindeHeader(report, { title: 'RELATÓRIO SINTÉTICO DE PEDIDOS - OPERAÇÃO MACEIÓ', subtitle: 'Categoria: CESTA BASICA | Período: 01/10/2026 a 31/10/2026', footer: '1 pedido | 1 local' });
  autoTable(report, { startY: 39, head: [['Local', 'Categoria', 'Cestas']], body: [['Garça Torta', 'CESTA BASICA', 43]], headStyles: { fillColor: [19, 55, 71] } });
  await writeFile(new URL('../tmp/pdfs/caninde-relatorio.pdf', import.meta.url), Buffer.from(report.output('arraybuffer')));
  console.log('Canindé: escopo, composição, totais, dados opcionais, paginação e PDFs de amostra verificados.');
} finally {
  await unlink(moduleUrl);
}
