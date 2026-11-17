import type { jsPDF } from 'jspdf';
import { digits } from './igeveDocuments.ts';

export const quoteSignatureCompanies = {
  caninde: 'Canindé',
  manu: 'Manu',
  lucas: 'OM Log / LM — Lucas Mendes de Oliveira',
  red: 'RED — Anderson',
  veras: 'Veras',
} as const;

export type QuoteSignatureCompany = keyof typeof quoteSignatureCompanies;
export type QuoteSignatures = Partial<Record<QuoteSignatureCompany, string>>;

export const signatureStorageKey = 'igeve-quote-signatures';

export function readQuoteSignatures(): QuoteSignatures {
  try {
    const stored = JSON.parse(localStorage.getItem(signatureStorageKey) || '{}');
    return Object.fromEntries(Object.keys(quoteSignatureCompanies).flatMap(key => {
      const image = stored?.[key];
      return typeof image === 'string' && /^data:image\/(png|jpeg);base64,/.test(image) ? [[key, image]] : [];
    }));
  } catch {
    return {};
  }
}

export function quoteSignatureCompany(cnpj: string): QuoteSignatureCompany | undefined {
  switch (digits(cnpj).slice(0, 8)) {
    case '66321676': return 'caninde';
    case '17979701': return 'manu';
    case '68673515':
    case '66036822': return 'lucas';
    case '12484640': return 'red';
    case '39323523': return 'veras';
  }
}

export function documentSignature(cnpj: string, kind: 'quote' | 'delivery', signatures: QuoteSignatures = {}) {
  const company = quoteSignatureCompany(cnpj);
  if (company && (kind === 'quote' || company === 'caninde' || company === 'manu')) return signatures[company];
}

export function addQuoteSignature(pdf: jsPDF, signature: string, center: number, top: number) {
  const { width, height, fileType } = pdf.getImageProperties(signature);
  const scale = Math.min(76 / width, 22 / height);
  pdf.addImage(signature, fileType, center - width * scale / 2, top + (22 - height * scale) / 2, width * scale, height * scale);
}

export function addDeliverySupplierSignature(pdf: jsPDF, signature: string, center: number, top: number) {
  addQuoteSignature(pdf, signature, center, top);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.text('Imagem de assinatura do fornecedor', center, top + 27, { align: 'center' });
}
