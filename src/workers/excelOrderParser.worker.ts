import * as XLSX from 'xlsx';
import { parseDeliveryDate } from '../lib/deliveryDate.ts';

type DeliveryCategory = 'Hortifrutigranjeiro' | 'Estocáveis' | 'Dietas e Fórmulas' | 'Proteínas' | 'Limpeza' | 'CESTA BASICA';
interface DeliveryPointInput { id: string; code: string; name: string }
interface DeliveryItem { product: string; unit: string; quantity: number; notes?: string }
interface ParsedDelivery { id: string; deliveryPointId: string; items: DeliveryItem[] }
interface ExcelOrderMetadata { deliveryDate: string; consumptionPeriod: string; category?: DeliveryCategory; categoryText: string; generalNotes: string }
interface ParseExcelRequest { buffer: ArrayBuffer; deliveryPoints: DeliveryPointInput[] }
interface ParseExcelResponse { result?: { metadata: ExcelOrderMetadata; deliveries: ParsedDelivery[] }; error?: string; progress?: string }

const CATEGORIES: DeliveryCategory[] = ['Hortifrutigranjeiro', 'Estocáveis', 'Dietas e Fórmulas', 'Proteínas', 'Limpeza', 'CESTA BASICA'];
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

const isTotalRow = (product: string) => /^(?:TOTAL(?: GERAL)?|SUB ?TOTAL)\s*:?$/.test(normalizeKey(product));

const aggregateItems = (items: DeliveryItem[]) => {
  const grouped = new Map<string, DeliveryItem>();
  items.filter(item => item.product && !isTotalRow(item.product) && item.quantity > 0).forEach(item => {
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

// Match only a unique registered place; address is intentionally not required.
const findPointUncached = (points: DeliveryPointInput[], label: string) => {
  const simple = normalizeLabel(label);
  if (!simple) return undefined;
  const unique = (matches: DeliveryPointInput[]) => matches.length === 1 ? matches[0] : undefined;
  const exact = points.filter(point => [point.code, point.name].some(value => normalizeLabel(value) === simple));
  if (exact.length) return unique(exact);
  const numericCode = (value: string) => /^\d+$/.test(value) ? value.replace(/^0+(?=\d)/, '') : '';
  const code = numericCode(simple);
  if (code) {
    const numeric = points.filter(point => numericCode(normalizeLabel(point.code)) === code);
    if (numeric.length) return unique(numeric);
  }
  const schoolName = (value: string) => normalizeLabel(value)
    .replace(/^(?:ESCOLA MUNICIPAL|ESCOLA ESTADUAL|ESCOLA|E M E F|EMEF|E M|EM) /, '');
  const name = schoolName(label);
  const names = points.filter(point => schoolName(point.name) === name);
  if (names.length) return unique(names);
  // A complete school name is more specific than a neighborhood alias from
  // another sector. Equal-strength candidates must still remain ambiguous.
  const contained = points.map(point => ({
    point,
    score: Math.max(0, ...[point.code, point.name].map(normalizeLabel)
      .filter(alias => alias.length >= 5 && ` ${simple} `.includes(` ${alias} `))
      .map(alias => alias.length)),
  })).filter(candidate => candidate.score > 0);
  const bestScore = Math.max(0, ...contained.map(candidate => candidate.score));
  return unique(contained.filter(candidate => candidate.score === bestScore).map(candidate => candidate.point));
};

// Normalize each distinct label once, even in large row-based workbooks.
const pointCache = new WeakMap<DeliveryPointInput[], Map<string, DeliveryPointInput | undefined>>();
const findPoint = (points: DeliveryPointInput[], label: string) => {
  let cache = pointCache.get(points);
  if (!cache) { cache = new Map(); pointCache.set(points, cache); }
  if (!cache.has(label)) cache.set(label, findPointUncached(points, label));
  return cache.get(label);
};

// Some Excel files declare a million-row range because of formatting alone.
// Visit stored values, avoiding an allocation/scan of that entire empty range.
export const valueRows = (sheet: XLSX.WorkSheet): unknown[][] => {
  const rows = new Map<number, unknown[]>();
  for (const key of Object.keys(sheet)) {
    if (key.startsWith('!')) continue;
    const cell = sheet[key];
    if (!cell || cell.v === undefined || cell.v === null || cell.v === '') continue;
    const { r, c } = XLSX.utils.decode_cell(key);
    const row = rows.get(r) || [];
    row[c] = cell.v;
    rows.set(r, row);
  }
  return [...rows.entries()].sort(([a], [b]) => a - b).map(([, row]) => row);
};

const headerKey = (value: unknown) => normalizeKey(value).replace(/[.:]+$/g, '').trim();
const productHeaders = new Set(['PRODUTO', 'PRODUTOS', 'DESCRICAO', 'DESCRICAO DO PRODUTO', 'DESCRICAO DOS PRODUTOS', 'ITEM', 'ALIMENTO', 'ALIMENTOS']);
const unitHeaders = new Set(['UN', 'UND', 'UNID', 'UNIDADE', 'UNIDADES', 'EMBALAGEM', 'MEDIDA']);
const quantityHeaders = new Set(['QTD', 'QTDE', 'QUANT', 'QUANTIDADE', 'QUANTIDADE SOLICITADA', 'QTD SOLICITADA']);
const locationHeaders = new Set(['NOME DA ESCOLA', 'LOCAL DE ENTREGA', 'UNIDADE ESCOLAR', 'ESCOLA', 'LOCAL', 'DESTINO', 'CODIGO', 'CODIGO DO LOCAL', 'CODIGO DA ESCOLA']);

const parseDate = (value: unknown) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  return parseDeliveryDate(displayText(value));
};

const extractMetadata = (rows: unknown[][]): ExcelOrderMetadata => {
  const result: ExcelOrderMetadata = { deliveryDate: '', consumptionPeriod: '', categoryText: '', generalNotes: '' };
  rows.slice(0, 20).forEach(row => row.forEach((cell, index) => {
    const label = normalizeKey(cell).split(':')[0].trim();
    const text = displayText(cell);
    const value = (text.includes(':') ? text.split(':').slice(1).join(':').trim() : '') || row.slice(index + 1).find(candidate => displayText(candidate));
    if (['DATA DE ENTREGA', 'DATA DA ENTREGA', 'MES/ANO', 'MES ANO', 'MES DE ENTREGA', 'MES/ANO DE ENTREGA'].includes(label) && !result.deliveryDate) {
      const date = parseDate(value);
      result.deliveryDate = ['DATA DE ENTREGA', 'DATA DA ENTREGA'].includes(label) ? date : date.slice(0, 7);
    }
    else if (['PERIODO DE CONSUMO', 'DATA DO CONSUMO'].includes(label) && !result.consumptionPeriod) result.consumptionPeriod = displayText(value);
    else if (label === 'CATEGORIA' && !result.categoryText) {
      result.categoryText = displayText(value);
      result.category = CATEGORIES.find(category => normalizeKey(category) === normalizeKey(value));
    } else if ((label === 'OBSERVACAO' || label === 'OBSERVACOES') && !result.generalNotes) result.generalNotes = displayText(value);
  }));
  return result;
};

const parseUnitSheet = (sheetName: string, rows: unknown[][], points: DeliveryPointInput[]): ParsedDelivery | null => {
  const headerRow = rows.findIndex(row => row.some(cell => productHeaders.has(headerKey(cell))) && row.some(cell => quantityHeaders.has(headerKey(cell))));
  if (headerRow < 0) return null;
  const headers = rows[headerRow].map(headerKey);
  const productIndex = headers.findIndex(header => productHeaders.has(header));
  const unitIndex = headers.findIndex(header => unitHeaders.has(header));
  const quantityIndex = headers.findIndex(header => quantityHeaders.has(header));
  const notesIndex = headers.findIndex(header => ['OBS', 'OBSERVACAO', 'OBSERVACOES'].includes(header));
  if (productIndex < 0 || quantityIndex < 0) return null;
  if (headers.some(header => locationHeaders.has(header))) return null;
  const items = aggregateItems(rows.slice(headerRow + 1).map(row => ({ product: displayText(row[productIndex]), unit: displayText(unitIndex >= 0 ? row[unitIndex] : 'UN') || 'UN', quantity: toNumber(row[quantityIndex]), notes: displayText(notesIndex >= 0 ? row[notesIndex] : '') })));
  if (!items.length) return null;
  const labels: string[] = [];
  for (const row of rows.slice(0, headerRow)) {
    row.forEach((cell, index) => {
      const text = displayText(cell);
      const [label, ...inline] = text.split(':');
      if (!locationHeaders.has(headerKey(label))) return;
      const value = inline.join(':').trim() || row.slice(index + 1).map(displayText).find(Boolean) || '';
      if (value) labels.push(value);
    });
  }
  const matches = labels.map(label => findPoint(points, label)).filter((point): point is DeliveryPointInput => Boolean(point));
  if (new Set(matches.map(point => point.id)).size > 1) return null;
  const genericSheet = /^(?:PLANILHA|SHEET)\s*\d*$/i.test(sheetName);
  const point = matches[0] || (!labels.length ? findPoint(points, sheetName) : undefined) ||
    (!labels.length && genericSheet && points.length === 1 ? points[0] : undefined);
  // An explicit, unmatched place must never be assigned to another registration.
  if (!point) return null;

  return { id: makeId(), deliveryPointId: point.id, items };
};

const parseTableSheet = (rows: unknown[][], points: DeliveryPointInput[], unresolved: Set<string>) => {
  const headerRow = rows.findIndex(row => row.some(cell => productHeaders.has(headerKey(cell))) &&
    row.some(cell => unitHeaders.has(headerKey(cell)) || quantityHeaders.has(headerKey(cell))));
  if (headerRow < 0) return [];
  const headers = rows[headerRow];
  const normalized = headers.map(headerKey);
  const productIndex = normalized.findIndex(header => productHeaders.has(header));
  const unitIndex = normalized.findIndex(header => unitHeaders.has(header));
  const quantityIndex = normalized.findIndex(header => quantityHeaders.has(header));
  const locationIndexes = normalized.flatMap((header, index) => locationHeaders.has(header) ? [index] : []);
  const deliveries: ParsedDelivery[] = [];
  const notesIndex = normalized.findIndex(header => ['OBS', 'OBSERVACAO', 'OBSERVACOES'].includes(header));
  if (quantityIndex >= 0 && locationIndexes.length) {
    for (const row of rows.slice(headerRow + 1)) {
      const item = { product: displayText(row[productIndex]), unit: displayText(row[unitIndex]) || 'UN', quantity: toNumber(row[quantityIndex]), notes: displayText(row[notesIndex]) };
      if (!item.product || isTotalRow(item.product) || item.quantity <= 0) continue;
      const labels = locationIndexes.map(index => displayText(row[index])).filter(Boolean);
      const matches = labels.map(label => findPoint(points, label)).filter((point): point is DeliveryPointInput => Boolean(point));
      if (new Set(matches.map(point => point.id)).size !== 1) { unresolved.add(labels.join(' / ') || 'Local não informado'); continue; }
      deliveries.push({ id: makeId(), deliveryPointId: matches[0].id, items: [item] });
    }
    return deliveries;
  }
  if (unitIndex < 0) return [];
  for (const [index, header] of headers.entries()) {
    const label = displayText(header);
    if (index === productIndex || index === unitIndex || !label || ignoredHeaders.has(normalizeKey(label)) || quantityHeaders.has(headerKey(label))) continue;
    const items = aggregateItems(rows.slice(headerRow + 1).map(row => ({ product: displayText(row[productIndex]), unit: displayText(row[unitIndex]) || 'UN', quantity: toNumber(row[index]) })));
    if (!items.length) continue;
    const point = findPoint(points, label);
    if (!point) { unresolved.add(label); continue; }
    deliveries.push({ id: makeId(), deliveryPointId: point.id, items });
  }
  return deliveries;
};

const workerScope = self as unknown as { onmessage: ((event: MessageEvent<ParseExcelRequest>) => void) | null; postMessage: (message: ParseExcelResponse) => void };
workerScope.onmessage = event => {
  try {
    const workbook = XLSX.read(event.data.buffer, { type: 'array', cellDates: true, cellNF: true, cellText: false });
    let metadata: ExcelOrderMetadata = { deliveryDate: '', consumptionPeriod: '', categoryText: '', generalNotes: '' };
    const deliveries: ParsedDelivery[] = [];
    const unresolved = new Set<string>();
    workbook.SheetNames.forEach((sheetName, index) => {
      workerScope.postMessage({ progress: `Lendo aba ${index + 1} de ${workbook.SheetNames.length}: ${sheetName}...` });
      const worksheet = workbook.Sheets[sheetName];
      // Keep month precision when Excel stores a date with a month/year display format.
      Object.entries(worksheet).forEach(([key, cell]) => {
        if (key.startsWith('!') || !cell || !cell.z) return;
        const dateFormat = String(cell.z).replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
        if (/m/i.test(dateFormat) && /y/i.test(dateFormat) && !/d/i.test(dateFormat)) {
          const month = parseDeliveryDate(XLSX.utils.format_cell(cell));
          if (month) worksheet[key] = { t: 's', v: month };
        }
      });
      const rows = valueRows(worksheet);
      if (!rows.length) return;
      const sheet = extractMetadata(rows);
      metadata = { deliveryDate: metadata.deliveryDate || sheet.deliveryDate, consumptionPeriod: metadata.consumptionPeriod || sheet.consumptionPeriod, category: metadata.category || sheet.category, categoryText: metadata.categoryText || sheet.categoryText, generalNotes: metadata.generalNotes || sheet.generalNotes };
      const unit = parseUnitSheet(sheetName, rows, event.data.deliveryPoints);
      if (unit) deliveries.push(unit);
      else {
        deliveries.push(...parseTableSheet(rows, event.data.deliveryPoints, unresolved));
        const quantityRow = rows.findIndex(row => row.some(cell => quantityHeaders.has(headerKey(cell))) && row.some(cell => productHeaders.has(headerKey(cell))));
        const quantityColumn = quantityRow < 0 ? -1 : rows[quantityRow].findIndex(cell => quantityHeaders.has(headerKey(cell)));
        const hasPositiveItems = rows.slice(quantityRow + 1).some(row => toNumber(row[quantityColumn]) > 0);
        const hasQuantityHeader = rows.some(row => row.some(cell => quantityHeaders.has(headerKey(cell))) && row.some(cell => productHeaders.has(headerKey(cell))));
        const hasRowLocations = rows.some(row => row.some(cell => locationHeaders.has(headerKey(cell))) && row.some(cell => productHeaders.has(headerKey(cell))));
        if (hasPositiveItems && hasQuantityHeader && !hasRowLocations) unresolved.add(`Aba ${sheetName} (local não identificado)`);
      }
    });
    if (unresolved.size) throw new Error(`Importação interrompida para evitar dados incompletos. Locais não identificados na operação selecionada: ${[...unresolved].slice(0, 8).join('; ')}${unresolved.size > 8 ? ` e mais ${unresolved.size - 8}` : ''}. Selecione a operação correta e confira os nomes ou códigos dos locais.`);
    workerScope.postMessage({ result: { metadata, deliveries: normalizeDeliveries(deliveries) } });
  } catch (error) {
    workerScope.postMessage({ error: error instanceof Error ? error.message : 'Não foi possível ler a planilha.' });
  }
};
