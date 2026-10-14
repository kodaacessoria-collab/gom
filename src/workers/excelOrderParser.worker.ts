import * as XLSX from 'xlsx';

type DeliveryCategory = 'Hortifrutigranjeiro' | 'Estocáveis' | 'Dietas e Fórmulas' | 'Proteínas' | 'Limpeza';
interface DeliveryPointInput { id: string; code: string; name: string }
interface DeliveryItem { product: string; unit: string; quantity: number; notes?: string }
interface ParsedDelivery { id: string; deliveryPointId: string; items: DeliveryItem[] }
interface ExcelOrderMetadata { deliveryDate: string; consumptionPeriod: string; category?: DeliveryCategory; categoryText: string; generalNotes: string }
interface ParseExcelRequest { buffer: ArrayBuffer; deliveryPoints: DeliveryPointInput[] }
interface ParseExcelResponse { result?: { metadata: ExcelOrderMetadata; deliveries: ParsedDelivery[] }; error?: string }

const CATEGORIES: DeliveryCategory[] = ['Hortifrutigranjeiro', 'Estocáveis', 'Dietas e Fórmulas', 'Proteínas', 'Limpeza'];
const normalizeText = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
const displayText = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalizeKey = (value: unknown) => normalizeText(value).toUpperCase();
const normalizeLabel = (value: unknown) => normalizeKey(value).replace(/\([^)]*\)/g, ' ').replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const toNumber = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? '').replace(/\./g, '').replace(',', '.').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};
const itemKey = (item: DeliveryItem) => `${normalizeKey(item.product)}|${normalizeKey(item.unit || 'UN')}|${normalizeKey(item.notes || '')}`;
const makeId = () => `delivery_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const ignoredHeaders = new Set(['TOTAL', 'COLUNAS1', 'COLUNAS2', 'COLUNAS3', 'VERDURAS', 'LEGUMES', 'HORTIFRUTI', 'HORTIFRUTIGRANJEIRO', ...CATEGORIES.map(normalizeKey)]);

const aggregateItems = (items: DeliveryItem[]) => {
  const grouped = new Map<string, DeliveryItem>();
  items.filter(item => item.product && item.quantity > 0).forEach(item => {
    const current = grouped.get(itemKey(item));
    if (current) current.quantity += item.quantity;
    else grouped.set(itemKey(item), { ...item });
  });
  return Array.from(grouped.values()).sort((a, b) => a.product.localeCompare(b.product));
};

const normalizeDeliveries = (deliveries: ParsedDelivery[]) => {
  const grouped = new Map<string, ParsedDelivery>();
  deliveries.forEach(delivery => {
    const current = grouped.get(delivery.deliveryPointId);
    if (current) current.items.push(...delivery.items);
    else grouped.set(delivery.deliveryPointId, { ...delivery, items: [...delivery.items] });
  });
  return Array.from(grouped.values()).map(delivery => ({ ...delivery, items: aggregateItems(delivery.items) })).filter(delivery => delivery.items.length > 0);
};

const findPoint = (points: DeliveryPointInput[], label: string) => {
  const key = normalizeKey(label);
  const simple = normalizeLabel(label);
  const exact = points.find(point => normalizeKey(point.code) === key || normalizeKey(point.name) === key || normalizeLabel(point.code) === simple || normalizeLabel(point.name) === simple);
  if (exact) return exact;
  return [...points]
    .sort((a, b) => Math.max(normalizeLabel(b.code).length, normalizeLabel(b.name).length) - Math.max(normalizeLabel(a.code).length, normalizeLabel(a.name).length))
    .find(point => [normalizeLabel(point.code), normalizeLabel(point.name)].filter(alias => alias.length >= 5).some(alias => simple.includes(alias) || alias.includes(simple)));
};

const parseDate = (value: unknown) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const text = displayText(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : '';
};

const extractMetadata = (rows: unknown[][]): ExcelOrderMetadata => {
  const result: ExcelOrderMetadata = { deliveryDate: '', consumptionPeriod: '', categoryText: '', generalNotes: '' };
  rows.slice(0, 20).forEach(row => row.forEach((cell, index) => {
    const label = normalizeKey(cell).replace(/\s*:\s*$/, '');
    const text = displayText(cell);
    const value = (text.includes(':') ? text.split(':').slice(1).join(':').trim() : '') || row.slice(index + 1).find(candidate => displayText(candidate));
    if (label === 'DATA DE ENTREGA' && !result.deliveryDate) result.deliveryDate = parseDate(value);
    else if (label === 'PERIODO DE CONSUMO' && !result.consumptionPeriod) result.consumptionPeriod = displayText(value);
    else if (label === 'CATEGORIA' && !result.categoryText) {
      result.categoryText = displayText(value);
      result.category = CATEGORIES.find(category => normalizeKey(category) === normalizeKey(value));
    } else if ((label === 'OBSERVACAO' || label === 'OBSERVACOES') && !result.generalNotes) result.generalNotes = displayText(value);
  }));
  return result;
};

const parseUnitSheet = (sheetName: string, rows: unknown[][], points: DeliveryPointInput[]): ParsedDelivery | null => {
  const headerRow = rows.findIndex(row => row.some(cell => normalizeKey(cell) === 'PRODUTO') && row.some(cell => ['QTD', 'QTDE', 'QUANTIDADE'].includes(normalizeKey(cell))));
  if (headerRow < 0) return null;
  const headers = rows[headerRow].map(normalizeKey);
  const productIndex = headers.findIndex(header => header === 'PRODUTO');
  const unitIndex = headers.findIndex(header => ['UND', 'UNIDADE', 'EMBALAGEM'].includes(header));
  const quantityIndex = headers.findIndex(header => ['QTD', 'QTDE', 'QUANTIDADE'].includes(header));
  const notesIndex = headers.findIndex(header => header === 'OBS' || header === 'OBS.');
  if (productIndex < 0 || quantityIndex < 0) return null;
  const items = aggregateItems(rows.slice(headerRow + 1).map(row => ({ product: displayText(row[productIndex]), unit: displayText(unitIndex >= 0 ? row[unitIndex] : 'UN') || 'UN', quantity: toNumber(row[quantityIndex]), notes: displayText(notesIndex >= 0 ? row[notesIndex] : '') })));
  if (!items.length) return null;
  let deliveryLabel = '';
  for (const row of rows.slice(0, 15)) {
    const index = row.findIndex(cell => ['NOME DA ESCOLA', 'LOCAL DE ENTREGA', 'UNIDADE ESCOLAR'].includes(normalizeKey(cell)));
    if (index >= 0) deliveryLabel = row.slice(index + 1).map(displayText).find(Boolean) || '';
    if (deliveryLabel) break;
  }
  const sheetKey = normalizeKey(sheetName);
  const point = (deliveryLabel ? findPoint(points, deliveryLabel) : undefined) || findPoint(points, sheetName) || points.find(candidate => sheetKey.includes(normalizeKey(candidate.code)));
  if (!point && (points.length !== 1 || ignoredHeaders.has(sheetKey))) return null;
  return { id: makeId(), deliveryPointId: point?.id || points[0].id, items };
};

const parseMatrixSheet = (rows: unknown[][], points: DeliveryPointInput[]) => {
  const headerRow = rows.findIndex(row => row.some(cell => normalizeKey(cell) === 'PRODUTO') && row.some(cell => ['EMBALAGEM', 'UND', 'UNIDADE'].includes(normalizeKey(cell))));
  if (headerRow < 0) return [];
  const headers = rows[headerRow];
  const normalized = headers.map(normalizeKey);
  const productIndex = normalized.findIndex(header => header === 'PRODUTO');
  const unitIndex = normalized.findIndex(header => ['EMBALAGEM', 'UND', 'UNIDADE'].includes(header));
  if (productIndex < 0 || unitIndex < 0) return [];
  return headers.map((header, index) => ({ header: displayText(header), index }))
    .filter(column => column.index !== productIndex && column.index !== unitIndex && column.header && (findPoint(points, column.header) || !ignoredHeaders.has(normalizeKey(column.header))))
    .map(column => {
      const point = findPoint(points, column.header);
      if (!point) return null;
      const items = aggregateItems(rows.slice(headerRow + 1).map(row => ({ product: displayText(row[productIndex]), unit: displayText(row[unitIndex]) || 'UN', quantity: toNumber(row[column.index]) })));
      return items.length ? { id: makeId(), deliveryPointId: point.id, items } : null;
    }).filter((delivery): delivery is ParsedDelivery => Boolean(delivery));
};

const workerScope = self as unknown as { onmessage: ((event: MessageEvent<ParseExcelRequest>) => void) | null; postMessage: (message: ParseExcelResponse) => void };
workerScope.onmessage = event => {
  try {
    const workbook = XLSX.read(event.data.buffer, { type: 'array', cellDates: true });
    let metadata: ExcelOrderMetadata = { deliveryDate: '', consumptionPeriod: '', categoryText: '', generalNotes: '' };
    const deliveries: ParsedDelivery[] = [];
    workbook.SheetNames.forEach(sheetName => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', blankrows: false }) as unknown[][];
      if (!rows.length) return;
      const sheet = extractMetadata(rows);
      metadata = { deliveryDate: metadata.deliveryDate || sheet.deliveryDate, consumptionPeriod: metadata.consumptionPeriod || sheet.consumptionPeriod, category: metadata.category || sheet.category, categoryText: metadata.categoryText || sheet.categoryText, generalNotes: metadata.generalNotes || sheet.generalNotes };
      const unit = parseUnitSheet(sheetName, rows, event.data.deliveryPoints);
      if (unit) deliveries.push(unit);
      else deliveries.push(...parseMatrixSheet(rows, event.data.deliveryPoints));
    });
    workerScope.postMessage({ result: { metadata, deliveries: normalizeDeliveries(deliveries) } });
  } catch (error) {
    workerScope.postMessage({ error: error instanceof Error ? error.message : 'Não foi possível ler a planilha.' });
  }
};
