import { digits, parseBrazilianNumber, round2, validCnpj, validDocumentDate } from './igeveDocuments.ts';
import { pdfRows } from './nfePdfImport.ts';
import type { NfeDocument } from './igeveDocuments.ts';
import type { PdfWord } from './nfePdfImport.ts';

interface PrintWord extends PdfWord { confidence?: number }
export interface ScannedItem { id: string; product: string; unit: string; quantity: string }
export interface ScannedDelivery {
  page: number;
  number: string;
  control: boolean;
  consumption: string;
  category: string;
  date: string;
  recipientCnpj: string;
  issuerCnpj: string;
  unitName: string;
  district: string;
  address: string;
  items: ScannedItem[];
  continuation: boolean;
}

const normalized = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
const numeric = /^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/;
export function officialQuantity(value: string) {
  const text = value.trim();
  const quantity = numeric.test(text) ? parseBrazilianNumber(text) : NaN;
  return Number.isFinite(quantity) && quantity > 0 && round2(quantity) === quantity ? quantity : NaN;
}

const columns = [
  ['code', /^(?:COD(?:IGO)?[.:-]?|ITEM)$/],
  ['product', /^(?:PRODUTOS?|DESCRI[CÇ][AÃ]O|DISCRIMINA[CÇ][AÃ]O|MERCADORIA)(?:\s*[/–-]\s*(?:PRODUTO|DESCRI[CÇ][AÃ]O))?$/],
  ['unit', /^(?:U[.]?N[.]?|UND[.]?|UNID[.]?|UNIDADE|MEDIDA)$/],
  ['official', /^(?:QUANTIDADE|QUANT[.]?|QTDE[.]?|QTD[.]?)$/],
  ['total', /^(?:TOTAL PREVISTO|QTD(?:E|\.)? (?:PREVISTA|SOLICITADA|OFICIAL|PROGRAMADA)|QUANTIDADE (?:PREVISTA|SOLICITADA|OFICIAL|PROGRAMADA))$/],
  ['other', /^(?:RECEBID[AO]|ENTREGUE|AJUSTAD[AO]|CONFERENCIA|DIVERGENCIA|OBS(?:ERVA[CÇ][OÕ]ES)?[.]?|NCM(?:\/SH)?|CST|CSOSN|CFOP|TOTAL|VALOR|V[.]?(?:UNIT|TOTAL)[.]?|POR CESTA)$/],
] as const;

interface ColumnPosition { key: typeof columns[number][0]; x: number; end: number; center: number }

function field(lines: string[], label: string) {
  const pattern = new RegExp('^(?:' + label + ')\\s*[:–-]\\s*(.+)$', 'i');
  return lines.map(line => line.match(pattern)?.[1].trim()).find(Boolean) ?? '';
}

export function parseScannedPage(words: PrintWord[], page: number): ScannedDelivery {
  const rows = pdfRows(words);
  const lines = rows.map(row => row.words.map(word => word.text).join(' ').trim());
  const header = rows.findIndex((row, index) => {
    const text = normalized(lines[index]);
    return row.words.length >= 3 && /PRODUTO|DESCRICAO|DISCRIMINACAO|MERCADORIA/.test(text)
      && /\b(?:QUANT(?:IDADE)?|QTDE?|TOTAL PREVISTO)\b/.test(text)
      && /\b(?:UN(?:D|ID|IDADE)?|MEDIDA)\b/.test(text);
  });
  const metadata = header < 0 ? lines : lines.slice(0, header);
  const text = metadata.join('\n');
  const number = text.match(/\b(?:NF(?:-?E|S)?|NOTA FISCAL(?: DE ORIGEM)?|ROMANEIO(?: DE ENTREGA)?)\b\s*(?:[-–:]\s*)?(?:N[º°O.]?\s*[:.]?\s*)?(\d[\d.]{0,14})\b/i)
    ?? (/\bDANFE\b/i.test(text) ? text.match(/\bN[º°O.]\s*(\d[\d.]{0,14})\b/i) : null);
  const control = !number && text.match(/\bCONTROLE\s*:\s*(\d{6,10}\s*[-–]\s*\d{3,6})\b/i);
  const titleDate = text.match(/\bROMANEIO[^\n]*(?:\n[^\n]*)?\b(\d{2})\/(\d{2})\/(\d{4})\b/i);
  const listedDate = field(metadata, 'DATA(?: DE ENTREGA)?').match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  const printedDate = listedDate || titleDate;
  const date = printedDate ? `${printedDate[3]}-${printedDate[2]}-${printedDate[1]}` : '';
  const consumption = field(metadata, 'CONSUMO').match(/\b\d{2}\/\d{2}\/\d{4}\s+a\s+\d{2}\/\d{2}\/\d{4}\b/i)?.[0] ?? '';
  const unitName = field(metadata, 'UNIDADE DE (?:ATENDIMENTO|ENTREGA)|LOCAL(?: DE ENTREGA)?|ESCOLA|DESTINO')
    .replace(/\s*[|¦]\s*C[ÓO]DIGO.*$/i, '').trim();
  const category = text.match(/\bROMANEIO\s*[-–]\s*([^\n–-]{2,60})\s*[-–]/i)?.[1].trim() ?? '';
  const addressField = field(metadata, 'ENDERE[ÇC]O(?: DE ENTREGA)?');
  const addressLine = metadata.findIndex(line => /^ENDERE[ÇC]O\s*:/i.test(line));
  const inlineDistrict = addressField.match(/\bBAIRRO\s*:\s*(.*)$/i);
  const nextLine = metadata[addressLine + 1] ?? '';
  const wrappedDistrict = addressLine >= 0 && !/CONTROLE|C[ÓO]DIGO|\d{2}\/\d{2}/i.test(nextLine) ? nextLine : '';
  const district = field(metadata, 'BAIRRO(?:\\s*/\\s*DISTRITO)?')
    || inlineDistrict?.[1].trim() || (inlineDistrict ? wrappedDistrict : wrappedDistrict.match(/\bBAIRRO\s*:\s*(.+)/i)?.[1]) || '';
  const address = addressField.split(/\s*[|¦]\s*BAIRRO\s*:/i)[0].trim();
  const cnpjs = [...text.matchAll(/\b(?:\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})\b/g)].filter(match => validCnpj(match[0]));
  const recipientStart = normalized(text).search(/DESTINAT[ÁA]RIO|CNPJ DO (?:DESTINATARIO|CLIENTE)|\bCLIENTE\b/);
  const issuerCnpj = cnpjs.find(match => recipientStart < 0 || match.index < recipientStart)?.[0] ?? '';
  const recipientCnpj = recipientStart >= 0 ? cnpjs.find(match => match.index >= recipientStart)?.[0] ?? '' : '';
  const continuation = /\b(?:FOLHA|PAG(?:INA|\.))\s*(\d+)\s*(?:\/|DE)\s*\d+/i.exec(normalized(text))?.[1];
  const items: ScannedItem[] = [];

  if (header >= 0) {
    const headings = rows[header].words;
    const positions: ColumnPosition[] = [];
    for (let index = 0; index < headings.length; index++) {
      const current = headings[index];
      const next = headings[index + 1];
      const phrase = normalized([current.text, next?.text].filter(Boolean).join(' '));
      const label = normalized(current.text).trim();
      const compound = next && next.x - current.x - current.width < 19 && columns.find(([, pattern]) => pattern.test(phrase));
      const key = compound ? compound[0] : columns.find(([, pattern]) => pattern.test(label))?.[0];
      if (key) {
        const qualified = normalized(next?.text ?? '');
        const measured = key === 'official' && /^(?:RECEBID[AO]|ENTREGUE|AJUSTAD[AO]|CONFERID[AO]|REALIZAD[AO])$/.test(qualified)
          && next.x - current.x - current.width < 19;
        const end = compound || measured ? headings[++index] : current;
        positions.push({ key: measured ? 'other' : key, x: current.x, end: end.x + end.width, center: (current.x + end.x + end.width) / 2 });
      }
    }
    const product = positions.find(column => column.key === 'product');
    const unit = positions.find(column => column.key === 'unit');
    const preferred = positions.filter(column => column.key === 'total');
    const generic = positions.filter(column => column.key === 'official');
    const official = preferred.length === 1 ? preferred[0] : !preferred.length && generic.length === 1 ? generic[0] : undefined;
    if (product && unit && official && official.x > unit.x) {
      const code = positions.find(column => column.key === 'code' && column.x < product.x);
      const lowerProduct = code ? code.end + 2 : -Infinity;
      const firstAfterProduct = positions.find(column => column.x > product.x)!;
      const upperProduct = firstAfterProduct.x - 3;
      for (let index = header + 1; index < rows.length; index++) {
        const line = normalized(lines[index]);
        if (/^(?:OBSERVA[CÇ][OÕ]ES|ASSINATURA|RECEBEMOS|RECEBIMENTO|RECEBEDOR|DIVERGENCIAS|DATA DE RECEBIMENTO|NOME DE QUEM RECEBEU|RG\s*:|DADOS ADICIONAIS|INFORMACOES COMPLEMENTARES|TOTAL\b|VALOR TOTAL|SUBTOTAL)/.test(line)) break;
        const cells = rows[index].words;
        const description = cells.filter(word => word.x + word.width / 2 >= lowerProduct && word.x + word.width / 2 < upperProduct);
        const productText = description.map(word => word.text).join(' ');
        if (!/\p{L}{2}/u.test(productText)) continue;
        const cell = (column: typeof official) => cells.filter(word => {
          const center = word.x + word.width / 2;
          return center >= upperProduct && positions.reduce((nearest, candidate) =>
            Math.abs(candidate.center - center) < Math.abs(nearest.center - center) ? candidate : nearest) === column;
        });
        const measure = cell(unit).map(word => word.text).join(' ');
        const values = cell(official) as PrintWord[];
        const aligned = control ? values.filter(value => Math.abs(value.x - official.x) <= 8) : values;
        if (!measure && !values.length) {
          if (items.length && rows[index].y - rows[index - 1].y < 17) items[items.length - 1].product += ` ${productText}`;
          continue;
        }
        const candidate = aligned.length === 1 ? aligned[0] : undefined;
        const quantity = candidate && (candidate.confidence ?? 100) >= 85 && numeric.test(candidate.text)
          && Number.isFinite(officialQuantity(candidate.text)) ? candidate.text : '';
        items.push({ id: crypto.randomUUID(), product: productText, unit: measure, quantity });
      }
    }
  }
  return { page, number: control ? control[1].replace(/\s/g, '').replace('–', '-') : digits(number?.[1] ?? ''),
    control: !!control, consumption, category, date: validDocumentDate(date) ? date : '', issuerCnpj, recipientCnpj,
    unitName, district, address, items, continuation: Number(continuation) > 1 };
}

// The operations template prints white column labels over a green strip.
function normalizeGreenHeader(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const { width, height } = canvas;
  const image = context.getImageData(0, 0, width, height);
  const { data } = image;
  const isGreen = (offset: number) => data[offset + 1] > data[offset] + 18 && data[offset + 1] > data[offset + 2] + 5;
  let changed = false;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    let first = -1;
    let last = -1;
    let green = 0;
    for (let x = 0; x < width; x += 4) {
      if (isGreen(row + x * 4)) {
        if (first < 0) first = x;
        last = x;
        green += 4;
      }
    }
    if (green < width * 0.3 || green < (last - first) * 0.75) continue;
    for (let x = first; x <= last; x++) {
      const offset = row + x * 4;
      const aboveBackground = Math.min(data[offset], data[offset + 1], data[offset + 2]) > 145;
      data[offset] = data[offset + 1] = data[offset + 2] = aboveBackground ? 0 : 255;
    }
    changed = true;
  }
  if (changed) context.putImageData(image, 0, 0);
}

export async function readScannedDeliveries(file: File, onPage: (page: number, total: number) => void) {
  if (!/\.pdf$/i.test(file.name) || file.size > 20 * 1024 * 1024) throw new Error('Selecione um PDF de até 20 MB.');
  const data = await file.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
  GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();
  const loading = getDocument({ data: new Uint8Array(data), stopAtErrors: true });
  let worker: import('tesseract.js').Worker | undefined;
  let ocrUnavailable = false;
  try {
    const pdf = await loading.promise;
    if (pdf.numPages > 100) throw new Error('Selecione um PDF com até 100 páginas.');
    const deliveries: ScannedDelivery[] = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      onPage(pageNo, pdf.numPages);
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const words = content.items.flatMap(item => {
        if (!('str' in item)) return [];
        const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        return item.str.split(/\s{2,}/).length === 1 ? [{ text: item.str, x, y, width: item.width }] : [];
      });
      let delivery = parseScannedPage(words, pageNo);
      if (!delivery.items.length && !ocrUnavailable) try {
        if (!worker) {
          const [{ createWorker, OEM, PSM }, { default: workerPath }, { default: corePath }] = await Promise.all([
            import('tesseract.js'), import('tesseract.js/dist/worker.min.js?url'),
            import('tesseract.js-core/tesseract-core-lstm.wasm.js?url'),
          ]);
          let rejectStartup: (reason: Error) => void = () => {};
          const startupError = new Promise<never>((_, reject) => { rejectStartup = reject; });
          const starting = createWorker('por', OEM.LSTM_ONLY, {
            workerPath, corePath, workerBlobURL: false,
            errorHandler: reason => rejectStartup(new Error(String(reason))),
          });
          const timeout = setTimeout(() => rejectStartup(new Error('Tempo limite ao iniciar o OCR.')), 30_000);
          try {
            worker = await Promise.race([starting, startupError]);
          } catch (error) {
            void starting.then(lateWorker => lateWorker.terminate(), () => {});
            throw error;
          } finally {
            clearTimeout(timeout);
          }
          await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
        }
        const scale = 2400 / Math.max(viewport.width, viewport.height);
        const render = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(render.width);
        canvas.height = Math.ceil(render.height);
        try {
          await page.render({ canvas, viewport: render }).promise;
          normalizeGreenHeader(canvas);
          const recognize = async () => {
            const result = await worker!.recognize(canvas, {}, { blocks: true, text: false });
            const recognized = result.data.blocks?.flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.flatMap(line =>
              line.words.map(word => ({ text: word.text, x: word.bbox.x0 / scale,
                y: (line.baseline.y0 + (line.baseline.y1 - line.baseline.y0) * (word.bbox.x0 - line.baseline.x0) / Math.max(1, line.baseline.x1 - line.baseline.x0)) / scale,
                width: (word.bbox.x1 - word.bbox.x0) / scale, confidence: word.confidence }))))) ?? [];
            return parseScannedPage(recognized, pageNo);
          };
          delivery = await recognize();
          if (!delivery.items.length) {
            const { PSM } = await import('tesseract.js');
            await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
            try {
              const retry = await recognize();
              if (retry.items.length) delivery = retry;
            } finally {
              await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
            }
          }
        } finally {
          canvas.width = canvas.height = 0;
        }
      } catch {
        ocrUnavailable = true;
      }
      const previous = deliveries.at(-1);
      if (delivery.continuation && previous && delivery.items.length
        && (!delivery.number || !previous.number || digits(delivery.number) === digits(previous.number))
        && (!delivery.unitName || !previous.unitName || normalized(delivery.unitName) === normalized(previous.unitName))) {
        previous.items.push(...delivery.items);
      } else {
        deliveries.push(delivery);
      }
      page.cleanup();
    }
    return { deliveries, hash, ocrUnavailable };
  } finally {
    try { await worker?.terminate(); } finally { await loading.destroy(); }
  }
}

export async function renderScannedDelivery(doc: NfeDocument, reference: string, isControl: boolean, category: string, district: string) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const pdf = new jsPDF();
  const referenceLabel = isControl ? 'Controle' : 'Nº';
  pdf.setFont('helvetica', 'bold').setFontSize(15);
  pdf.text('ROMANEIO DE ENTREGA', 14, 20);
  autoTable(pdf, {
    startY: 26, theme: 'plain', styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { cellWidth: 33, fontStyle: 'bold' } },
    body: [
      [referenceLabel, reference],
      ['Categoria', category],
      ['Data da entrega', doc.deliveryDate.split('-').reverse().join('/')],
      ['Unidade', doc.unitName],
      ['Bairro', district],
      ...(doc.address ? [['Endereço', doc.address]] : []),
      ...(doc.recipientCnpj ? [['CNPJ', doc.recipientCnpj]] : []),
      ...(doc.consumption ? [['Consumo', doc.consumption]] : []),
    ],
  });
  const afterTable = () => (pdf as typeof pdf & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  autoTable(pdf, {
    startY: afterTable() + 5, theme: 'striped',
    head: [['Produto', 'Unidade', 'Quantidade', 'Observações']],
    body: doc.items.map(item => [item.product, item.unit, item.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 2 }), '']),
    headStyles: { fillColor: [24, 100, 83] },
    styles: { overflow: 'linebreak', fontSize: 9 },
    columnStyles: { 1: { cellWidth: 34 }, 2: { cellWidth: 25, halign: 'right' }, 3: { cellWidth: 37 } },
  });
  let y = afterTable() + 12;
  if (y > 259) { pdf.addPage(); y = 20; }
  pdf.setFont('helvetica', 'normal').setFontSize(9);
  pdf.text([
    'Data de recebimento: ____/____/________',
    'Nome de quem recebeu: __________________________________________________',
    'RG: __________________________   Assinatura: _____________________________',
  ], 14, y, { lineHeightFactor: 2.2 });
  return pdf.output('blob');
}
