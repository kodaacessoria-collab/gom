import * as XLSX from 'xlsx';
import { normalizeBillingText, parseBillingPrice } from './igeveBilling.ts';
import type { BillingPriceEntry } from './igeveBilling.ts';

type PriceWorkbookDestination = { operation: string } & ({ category: string } | { categories: string[] });

const columns = {
  product: ['PRODUTO', 'NOME DO PRODUTO', 'DESCRICAO', 'DESCRICAO DO PRODUTO', 'ITEM'],
  unit: ['UNIDADE', 'UN', 'UND', 'UNID', 'UM', 'UNIDADE DE MEDIDA'],
  price: ['PRECO', 'PRECO UNITARIO', 'PRECO UNIT', 'PRECO DE VENDA', 'VALOR UNITARIO', 'VALOR UNIT', 'PRECO DE VENDA UNITARIO', 'VALOR UNITARIO DE VENDA'],
  operation: ['OPERACAO'],
  category: ['CATEGORIA'],
};
const cellText = (value: unknown) => String(value ?? '').trim();
const headerText = (value: unknown) => normalizeBillingText(cellText(value))
  .replace(/\s*\(?R\$\)?\s*/g, ' ').replace(/[^A-Z0-9]+/g, ' ').trim();

function spreadsheetPrice(value: unknown): number | null {
  if (typeof value === 'number') return parseBillingPrice(String(value));
  const raw = cellText(value).replace(/^R\$\s*/i, '').trim();
  if (!raw) return null;
  if (!/^(?:\d+(?:[.,]\d{1,2})?|\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?)$/.test(raw)) {
    throw new Error('Informe um preço válido com até duas casas decimais.');
  }
  // Accept Brazilian grouping and decimal commas, as well as decimal points.
  const decimal = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.')
    : /^(?:\d{1,3}\.)+\d{3}$/.test(raw) ? raw.replace(/\./g, '') : raw;
  return parseBillingPrice(decimal);
}

export function readIgevePriceWorkbook(buffer: ArrayBuffer, destination: PriceWorkbookDestination) {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const items: { id: string; product: string; unit: string; price: number; category?: string }[] = [];
  const allowedCategories = new Map(('categories' in destination ? destination.categories : [destination.category])
    .map(category => [normalizeBillingText(category), category]));
  const warnings: string[] = [];
  let foundTable = false;
  let blankPrices = 0;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet['!ref']) continue;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
    const headerRow = rows.findIndex(row => {
      const labels = row.map(headerText);
      return [columns.product, columns.unit, columns.price].every(aliases => labels.some(label => aliases.includes(label)));
    });
    if (headerRow < 0) continue;
    foundTable = true;
    const labels = rows[headerRow].map(headerText);
    const findColumn = (aliases: string[]) => labels.findIndex(label => aliases.includes(label));
    const productColumn = findColumn(columns.product);
    const unitColumn = findColumn(columns.unit);
    const priceColumn = findColumn(columns.price);
    const operationColumn = findColumn(columns.operation);
    const categoryColumn = findColumn(columns.category);
    for (let index = headerRow + 1; index < rows.length; index++) {
      const row = rows[index];
      const product = cellText(row[productColumn]);
      const unit = cellText(row[unitColumn]);
      const priceCell = row[priceColumn];
      const operation = cellText(row[operationColumn]);
      const category = cellText(row[categoryColumn]);
      const selectedCategory = allowedCategories.get(normalizeBillingText(category));
      if (!product && !unit && priceCell == null) continue;
      if (!unit && /^(?:SUB\s*TOTAL|TOTAL)(?:\s+GERAL)?\s*:?$/i.test(product)) continue;
      const line = range.s.r + index + 1;
      const location = `Aba “${name}”, linha ${line}`;
      try {
        if (!cellText(priceCell)) { blankPrices++; continue; }
        if (!product || !unit) throw new Error('Preencha o produto e a unidade.');
        if ((operation && normalizeBillingText(operation) !== normalizeBillingText(destination.operation)) ||
            (category && !selectedCategory)) {
          throw new Error('A operação ou categoria da linha difere da tabela selecionada.');
        }
        const price = spreadsheetPrice(priceCell);
        if (price === null) throw new Error('Preencha o preço unitário.');
        items.push({ id: `${name}:${line}`, product, unit, price, category: selectedCategory });
      } catch (error) {
        warnings.push(`${location}. ${(error as Error).message}`);
      }
    }
  }
  if (!foundTable) throw new Error('Não encontrei as colunas Produto, Unidade e Preço unitário (R$). Baixe o modelo para conferir o formato.');
  if (!items.length) throw new Error(warnings[0] || 'Nenhum preço unitário preenchido. Informe pelo menos um preço e selecione o arquivo novamente.');
  if (blankPrices) warnings.unshift(`${blankPrices} linha(s) sem preço foram ignoradas.`);
  return { items, warnings };
}

export function downloadIgevePriceWorkbook(entries: BillingPriceEntry[], destination: { operation: string }) {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Operação', 'Categoria', 'Produto', 'Unidade', 'Preço unitário (R$)'],
    ...entries.map(entry => [destination.operation, entry.category, entry.product, entry.unit]),
  ]);
  sheet['!cols'] = [{ wch: 28 }, { wch: 24 }, { wch: 64 }, { wch: 14 }, { wch: 22 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Preços');
  XLSX.writeFile(workbook, 'modelo-precos-igeve.xlsx');
}
