import * as XLSX from 'xlsx';

interface ParseExcelRequest {
  buffer: ArrayBuffer;
}

interface ParsedExcelSheet {
  name: string;
  rows: unknown[][];
}

interface ParseExcelResponse {
  sheets?: ParsedExcelSheet[];
  error?: string;
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<ParseExcelRequest>) => void) | null;
  postMessage: (message: ParseExcelResponse) => void;
};

workerScope.onmessage = event => {
  try {
    const workbook = XLSX.read(event.data.buffer, { type: 'array', cellDates: true });
    const sheets = workbook.SheetNames.map(name => ({
      name,
      rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], {
        header: 1,
        defval: '',
        blankrows: false,
      }) as unknown[][],
    }));

    workerScope.postMessage({ sheets });
  } catch (error) {
    workerScope.postMessage({
      error: error instanceof Error ? error.message : 'Não foi possível ler a planilha.',
    });
  }
};
