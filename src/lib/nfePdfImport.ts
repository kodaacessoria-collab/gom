import { parseBrazilianNumber, round2, emptyNfeDocument } from './igeveDocuments.ts';
import type { NfeDocument, NfeItem } from './igeveDocuments.ts';

export interface PdfWord { text: string; x: number; y: number; width: number }
export interface PdfTextPage { words: PdfWord[] }
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
export function pdfRows(words: PdfWord[]) {
  const rows: { y: number; words: PdfWord[] }[] = [];
  for (const word of [...words].filter(w => w.text.trim()).sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.findLast(row => Math.abs(row.y - word.y) < 2.5);
    if (row) row.words.push(word); else rows.push({ y: word.y, words: [word] });
  }
  return rows.map(row => ({ ...row, words: row.words.sort((a, b) => a.x - b.x) }));
}
interface Column { x: number; width: number; key: 'code' | 'product' | 'unit' | 'quantity' | 'price' | 'other' }
function columnKey(label: string): Column['key'] | null {
  const s = norm(label).replace(/[.\s/_-]+/g, ' ').trim();
  if (/DESCRI|DISCRIMIN/.test(s)) return 'product';
  if (/^(COD|CODIGO)/.test(s)) return 'code';
  if (/^(UN|UND|UNID|UNIDADE)$/.test(s)) return 'unit';
  if (/QUANT|^QTD/.test(s)) return 'quantity';
  if (/(V|VAL|VALOR|VL).*UNIT|PRECO.*UNIT/.test(s)) return 'price';
  if (/NCM|CST|CSOSN|CFOP|TOTAL|BASE|B C|ICMS|IPI|ALIQUOTA|DESCONTO/.test(s)) return 'other';
  return null;
}
function tableColumns(rows: ReturnType<typeof pdfRows>, start: number) {
  const cluster = rows.slice(Math.max(0, start - 2), start + 4).filter(r => Math.abs(r.y - rows[start].y) < 22);
  const columns: Column[] = [];
  for (const row of cluster) for (const w of row.words) {
    let key = columnKey(w.text);
    // PDF generators sometimes split VALOR and UNITÁRIO onto two lines.
    if (!key && /^UNIT[ÁA]RIO$/i.test(w.text)) {
      const above = cluster.flatMap(r => r.words).find(a => a.y < w.y && Math.abs(a.x - w.x) < 12 && /^(V[.]?|VAL[.]?|VL[.]?|VALOR)$/i.test(a.text));
      if (above) key = 'price';
    }
    if (key && !columns.some(c => c.key === key && Math.abs(c.x - w.x) < 15)) columns.push({ x: w.x, width: w.width, key });
  }
  return columns.sort((a, b) => a.x - b.x);
}
export function parseNfePages(pages: PdfTextPage[]): { document: NfeDocument; warnings: string[] } {
  const doc = emptyNfeDocument();
  const warnings = new Set<string>();
  const lines = pages.flatMap(page => pdfRows(page.words).map(r => r.words.map(w => w.text).join(' ')));
  const allText = lines.join('\n');
  const first = pages[0] ? pdfRows(pages[0].words) : [];
  const cnpjPattern = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b|\b\d{14}\b/g;
  const recipientIndex = first.findIndex(r => /DESTINAT[ÁA]RIO\s*\/?\s*REMETENTE|DESTINAT[ÁA]RIO/.test(norm(r.words.map(w => w.text).join(' '))));
  const recipientRows = recipientIndex >= 0 ? first.slice(recipientIndex + 1, recipientIndex + 7) : [];
  // Only the recipient block may supply a recipient CNPJ; never guess from issuer/tax data.
  const recipientCnpjs = [...new Set(recipientRows.flatMap(r => r.words.map(w => w.text).join(' ').match(cnpjPattern) || []))];
  if (recipientCnpjs.length === 1) doc.recipientCnpj = recipientCnpjs[0];
  else warnings.add('Confira o CNPJ do destinatário: não foi possível identificá-lo com segurança.');
  const issuerCnpjs = recipientIndex >= 0 ? first.slice(0, recipientIndex).flatMap(r => r.words.map(w => w.text).join(' ').match(cnpjPattern) || []) : [];
  const distinctIssuer = [...new Set(issuerCnpjs)];
  if (distinctIssuer.length === 1) doc.issuerCnpj = distinctIssuer[0];
  const number = allText.match(/(?:N[º°o.]\s*|N[ÚU]MERO\s*:?\s*)(\d[\d.]{0,14})\b/i);
  if (number) doc.number = number[1].replace(/\./g, '');
  const emissionIndex = lines.findIndex(l => /DATA\s+(?:D[AE]\s+)?EMISS[ÃA]O/i.test(l));
  const issue = emissionIndex >= 0 ? lines.slice(emissionIndex, emissionIndex + 4).join(' ').match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/) : null;
  if (issue) doc.issuedAt = `${issue[3]}-${issue[2]}-${issue[1]}`;
  // Read values inside their labelled fields instead of relying on a fixed row count.
  function fieldBelow(pattern: RegExp) {
    for (let r = 0; r < first.length; r++) {
      const row = first[r];
      const label = row.words.find(w => pattern.test(norm(w.text)));
      if (!label) continue;
      const right = row.words.find(w => w.x > label.x + label.width + 3)?.x ?? Infinity;
      const value = first.slice(r + 1).find(next => next.y > row.y + 2 && next.y - row.y < 28);
      return value?.words.filter(w => w.x >= label.x - 4 && w.x < right - 3).map(w => w.text).join(' ').trim() || '';
    }
    return '';
  }
  const recipient = fieldBelow(/^NOME\s*\/?\s*RAZAO SOCIAL$/);
  if (recipient) doc.recipient = recipient;
  doc.address = fieldBelow(/^ENDERECO$/);
  const district = fieldBelow(/^BAIRRO\s*\/?\s*DISTRITO$/);
  const city = fieldBelow(/^MUNICIPIO$/);
  const state = fieldBelow(/^UF$/);
  const zip = fieldBelow(/^CEP$/);
  if (doc.address) doc.address = [doc.address, district, [city, state].filter(Boolean).join('/'), zip ? `CEP ${zip}` : ''].filter(Boolean).join(' - ');
  const receipt = allText.match(/RECEBEMOS DE\s+(.+?)\s+(?:OS\s+)?PRODUTOS/i);
  if (receipt) doc.issuer = receipt[1].trim().replace(/\s+DOS$/, '');
  if (!doc.issuer) {
    const danfe = first.flatMap(r => r.words).find(w => /^DANFE$/.test(norm(w.text)));
    if (danfe) {
      const name = first.filter(r => Math.abs(r.y - danfe.y) < 18).flatMap(r => r.words).filter(w => w.x + w.width < danfe.x && /[A-Z]{3}/.test(norm(w.text)) && !/RECEBEMOS|ASSINATURA|RECEBIMENTO/.test(norm(w.text)));
      doc.issuer = name.map(w => w.text).join(' ').trim();
    }
  }
  const parsed: NfeItem[] = [];
  let columns: Column[] = [];
  for (const page of pages) {
    const rows = pdfRows(page.words);
    let headerBottom = -1;
    let tableActive = columns.length > 0;
    let lastItemY: number | undefined;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const text = row.words.map(w => w.text).join(' ');
      if (/DESCRI|DISCRIMIN/.test(norm(text))) {
        const candidate = tableColumns(rows, r);
        if (['product', 'unit', 'quantity', 'price'].every(key => candidate.some(c => c.key === key))) {
          columns = candidate;
          tableActive = true;
          lastItemY = undefined;
          headerBottom = row.y;
          continue;
        }
      }
      // Keep the layout for continuation pages that do not repeat the table header.
      // A footer ends this page's table, not the following page's table.
      if (/DADOS ADICIONAIS|INFORMACOES COMPLEMENTARES|CALCULO DO ISSQN|RESERVADO AO FISCO|TRANSPORTADOR|VALOR TOTAL DA NOTA/.test(norm(text))) { tableActive = false; lastItemY = undefined; continue; }
      if (!tableActive || !columns.length || row.y <= headerBottom) continue;
      const cells: Partial<Record<Column['key'], string>> = {};
      const codeColumn = columns.find(c => c.key === 'code');
      const productColumn = columns.find(c => c.key === 'product')!;
      // Description headings can be centered far to the right of the actual text.
      const productStart = codeColumn ? Math.min(productColumn.x, codeColumn.x + codeColumn.width + 3) : productColumn.x;
      const productEnd = columns.find(c => c.x > productColumn.x)?.x ?? Infinity;
      for (const original of row.words) {
        // PDF.js may combine the code, description and fiscal cells in one text run.
        const pieces = [...original.text.matchAll(/\S+/g)];
        const insideDescription = original.x >= productStart - 2 && original.x + original.width < productEnd - 4;
        const spansColumns = !insideDescription && [...columns.map(c => c.x), productStart, productEnd].some(x => x > original.x + 4 && x < original.x + original.width - 4);
        const words = spansColumns && pieces.length > 1 ? pieces.map(m => ({ ...original, text: m[0], x: original.x + original.width * m.index / original.text.length, width: original.width * m[0].length / original.text.length })) : [original];
        for (const w of words) {
          const numeric = /^\d+(?:[.,]\d+)*$/.test(w.text.trim());
          const center = w.x + w.width / 2;
          let col: Column | undefined;
          if (!numeric && w.x >= productStart - 2 && w.x < productEnd - 4) col = productColumn;
          else if (numeric && w.x >= productStart && w.x + w.width < productEnd - 4) col = productColumn;
          else if (numeric) col = columns.reduce((best, c) => Math.abs(c.x + c.width / 2 - center) < Math.abs(best.x + best.width / 2 - center) ? c : best);
          else col = columns.findLast(c => w.x >= c.x - 4);
          if (col && col.key !== 'other') cells[col.key] = `${cells[col.key] || ''} ${w.text}`.trim();
        }
      }
      const quantity = parseBrazilianNumber(cells.quantity || '');
      const price = parseBrazilianNumber(cells.price || '');
      if (cells.product && cells.unit && Number.isFinite(quantity) && quantity > 0 && Number.isFinite(price) && price >= 0) {
        if (round2(quantity) !== quantity || round2(price) !== price) warnings.add('Há valores com mais de duas casas na NF-e. A lista usa duas casas; confira os arredondamentos e o total.');
        parsed.push({ id: crypto.randomUUID(), code: cells.code || '', product: cells.product, unit: cells.unit, quantity: round2(quantity), price: round2(price), brand: '', notes: '' });
        lastItemY = row.y;
      } else if (cells.product && !cells.code && !cells.unit && !cells.quantity && !cells.price && lastItemY !== undefined && row.y - lastItemY < 24 && !/DESCRI|PRODUTO|SERVI[CÇ]O|^FOLHA/.test(norm(cells.product))) {
        parsed[parsed.length - 1].product += ` ${cells.product}`;
        lastItemY = row.y;
      } else if (cells.product && cells.code && cells.unit && (cells.quantity || cells.price)) {
        warnings.add('Há linhas de produtos que não puderam ser importadas por completo. Confira quantidades e preços com o PDF original.');
      }
    }
  }
  doc.items = parsed;
  const totalText = fieldBelow(/^VALOR TOTAL DOS PRODUTOS$/);
  const expectedTotal = parseBrazilianNumber(totalText);
  const actualTotal = parsed.reduce((sum, item) => sum + round2(item.quantity * item.price), 0);
  if (Number.isFinite(expectedTotal) && Math.abs(round2(actualTotal) - expectedTotal) > 0.01) warnings.add(`O total dos itens importados (${round2(actualTotal).toFixed(2)}) difere do total de produtos da NF-e (${expectedTotal.toFixed(2)}). Confira se todos os itens e páginas foram importados.`);
  if (!parsed.length) warnings.add('Nenhum item foi identificado automaticamente. Este PDF pode ser digitalizado ou ter outro formato. Inclua os itens manualmente e confira a nota.');
  warnings.add('Confira número, CNPJ do destinatário, produtos, quantidades e preços com o PDF original antes de gerar documentos.');
  return { document: doc, warnings: [...warnings] };
}

export async function importNfePdf(file: File) {
  if (file.size > 20 * 1024 * 1024) throw new Error('A NF-e deve ter até 20 MB.');
  if (!file.name.toLowerCase().endsWith('.pdf')) throw new Error('Selecione uma NF-e em PDF.');
  const data = await file.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(v => v.toString(16).padStart(2, '0')).join('');
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
  GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();
  const loading = getDocument({ data: new Uint8Array(data) });
  const pdf = await loading.promise;
  try {
    if (pdf.numPages > 100) throw new Error('A NF-e deve ter até 100 páginas.');
    const pages: PdfTextPage[] = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      pages.push({ words: content.items.filter(item => 'str' in item).map(item => ({ text: item.str, x: item.transform[4], y: page.view[3] - item.transform[5], width: item.width })) });
    }
    const result = parseNfePages(pages);
    return { ...result, document: { ...result.document, sourceName: file.name, sourceHash: hash, importedAt: new Date().toISOString() } };
  } finally { await loading.destroy(); }
}
