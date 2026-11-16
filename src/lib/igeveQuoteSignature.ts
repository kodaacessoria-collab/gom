import type { jsPDF } from 'jspdf';
import { digits } from './igeveDocuments.ts';

export const quoteSignatureCompanies = {
  manu: 'Manu',
  lucas: 'OM Log / LM — Lucas Mendes de Oliveira',
  red: 'RED — Anderson',
} as const;

export type QuoteSignatureCompany = keyof typeof quoteSignatureCompanies;
export type QuoteSignatures = Partial<Record<QuoteSignatureCompany, string>>;

export function quoteSignatureCompany(cnpj: string): QuoteSignatureCompany | undefined {
  switch (digits(cnpj).slice(0, 8)) {
    case '17979701': return 'manu';
    case '68673515':
    case '66036822': return 'lucas';
    case '12484640': return 'red';
  }
}

export function addQuoteSignature(pdf: jsPDF, signature: string, center: number, top: number) {
  const { width, height, fileType } = pdf.getImageProperties(signature);
  const scale = Math.min(76 / width, 22 / height);
  pdf.addImage(signature, fileType, center - width * scale / 2, top + (22 - height * scale) / 2, width * scale, height * scale);
}
