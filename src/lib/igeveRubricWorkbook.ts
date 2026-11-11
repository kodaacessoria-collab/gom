import * as XLSX from 'xlsx';
import { normalizeBillingText } from './igeveBilling.ts';
import { rubricProposal } from './igeveRubrics.ts';
import type { MonthlyRubric } from './igeveRubrics.ts';

export interface RubricWorkbookRow {
  school: string;
  amount: number;
  proportional: NonNullable<MonthlyRubric['proportional']>;
}

const columns = ['ESCOLA / LOCAL', 'RUBRICA DE REFERENCIA', 'PROTEINAS ATUALIZADAS', 'BASE HORTIFRUTI', 'BASE ESTOCAVEIS', 'BASE FORMULAS'];

export function readRubricWorkbook(file: ArrayBuffer): RubricWorkbookRow[] {
  const workbook = XLSX.read(file, { type: 'array' });
  for (const sheet of Object.values(workbook.Sheets)) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
    const headers = rows.map(row => row.map(cell => normalizeBillingText(String(cell ?? ''))));
    const headerIndex = headers.findIndex(row => columns.every(column => row.includes(column)));
    if (headerIndex < 0) continue;

    const [schoolIndex, referenceIndex, proteinIndex, hortiIndex, stockIndex, formulaIndex] = columns.map(column => headers[headerIndex].indexOf(column));
    const result: RubricWorkbookRow[] = [];
    const schools = new Set<string>();
    for (const row of rows.slice(headerIndex + 1)) {
      const school = String(row[schoolIndex] ?? '').trim();
      if (!school || normalizeBillingText(school) === 'TOTAL GERAL') break;
      const values = [referenceIndex, proteinIndex, hortiIndex, stockIndex, formulaIndex].map(index => row[index]);
      if (values.every(value => value == null)) break;
      if (!values.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) {
        throw new Error(`Confira os valores numéricos da escola ${school} no Excel. Use zero quando a categoria não tiver base.`);
      }
      const [amount, proteinsBilled, horti, stock, formulas] = values as number[];
      const proportional = { proteinsBilled, bases: { 'Hortifrúti': horti, 'Estocáveis': stock, 'Dietas e Fórmulas': formulas } };
      if (!rubricProposal({ key: '', operationId: '', pointId: '', month: '', amount, proportional, previousAdjustment: 0, adjustmentNotes: '' })) {
        throw new Error(`A rubrica de ${school} precisa cobrir Proteínas e ter base para distribuir o saldo.`);
      }
      const schoolKey = normalizeBillingText(school);
      if (schools.has(schoolKey)) throw new Error(`A escola ${school} aparece mais de uma vez na planilha.`);
      schools.add(schoolKey);
      result.push({ school, amount, proportional });
    }
    if (result.length) return result;
  }
  throw new Error('A planilha precisa conter Escola / local, Rubrica de referência, Proteínas atualizadas e as bases das três categorias.');
}
