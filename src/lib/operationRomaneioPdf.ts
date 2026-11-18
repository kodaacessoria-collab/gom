import type { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { addPdfHeader } from './pdfBranding';
import type { PdfLogoVariant } from './pdfBranding';

export interface OperationRomaneioConfig {
  name: string;
  city: string;
  uf?: string;
  logoVariant?: PdfLogoVariant;
  bidNumber?: string;
  supplyAuthorization?: string;
}

interface RomaneioHeader {
  category: string;
  dateLabel: string;
  consumption?: string;
  subtitle?: string;
}

interface Romaneio extends RomaneioHeader {
  destination?: string;
  point?: { code?: string; address?: string; neighborhood?: string };
  control: string;
  controlLabel?: string;
  notes?: string;
  items: { product: string; unit: string; quantity: string; notes?: string }[];
}

export function isLmRomaneioCompany({ cnpj, company }: { cnpj: string; company: string }) {
  const digits = cnpj.replace(/\D/g, '');
  if (digits) return digits === '66036822000130';
  const name = company.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  return /^(?:LM|L M)(?: DE OLIVEIRA(?: COMERCIAL(?: LTDA)?)?)?$/.test(name);
}

export function operationRomaneioTitle(operation: OperationRomaneioConfig, category: string, date: string) {
  const location = [operation.city, operation.uf].filter(Boolean).join('/');
  const name = location ? `${operation.name} (${location})` : operation.name;
  return ['ROMANEIO', category.toUpperCase(), name.toUpperCase(), date || '-'].filter(Boolean).join(' - ');
}

export function addOperationRomaneioHeader(doc: jsPDF, operation: OperationRomaneioConfig, details: RomaneioHeader) {
  const subtitle = [
    operation.bidNumber ? `Ata: ${operation.bidNumber}` : '',
    operation.supplyAuthorization ? `Autorizacao: ${operation.supplyAuthorization}` : '',
    details.consumption ? `Consumo: ${details.consumption}` : '',
  ].filter(Boolean).join(' | ');
  return addPdfHeader(doc, {
    title: operationRomaneioTitle(operation, details.category, details.dateLabel),
    subtitle: subtitle || 'Documentacao de entrega',
    footer: details.subtitle,
    logoVariant: operation.logoVariant || 'gom',
    titleFontSize: 14,
  });
}

export async function addOperationRomaneio(doc: jsPDF, operation: OperationRomaneioConfig, romaneio: Romaneio) {
  await addOperationRomaneioHeader(doc, operation, romaneio);
  doc.setFontSize(11);
  doc.text(`Local: ${romaneio.destination || '-'} | Codigo: ${romaneio.point?.code || '-'}`, 14, 39);
  doc.setFont('courier', 'normal');
  const address = `Endereco: ${romaneio.point?.address || '-'} | Bairro: ${romaneio.point?.neighborhood || '-'}`;
  const addressLines = (doc.splitTextToSize(address, 182) as string[]).slice(0, 2);
  doc.text(addressLines, 14, 46);
  let y = 50 + addressLines.length * 5;
  doc.setFont('courier', 'bold');
  const controlLabel = romaneio.controlLabel ?? 'Controle';
  doc.text(controlLabel ? `${controlLabel}: ${romaneio.control}` : romaneio.control, 14, y);
  y += 7;

  if (romaneio.notes) {
    doc.setFont('courier', 'normal');
    const lines = doc.splitTextToSize(`Observacao geral: ${romaneio.notes}`, 182) as string[];
    for (const line of lines) {
      if (y > 270) { doc.addPage('a4', 'portrait'); y = 20; }
      doc.text(line, 14, y);
      y += 4;
    }
    y += 6;
  }

  autoTable(doc, {
    startY: y,
    head: [['Produto', 'UND', 'QTD', 'OBS.']],
    body: romaneio.items.map(item => [item.product, item.unit, item.quantity, item.notes || '']),
    styles: { font: 'courier', fontSize: 11, cellPadding: 1.4 },
    headStyles: { font: 'courier', fontSize: 11, fontStyle: 'bold', fillColor: [5, 150, 105] },
    theme: 'grid',
  });
  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  if (y + 26 > doc.internal.pageSize.getHeight() - 14) {
    doc.addPage('a4', 'portrait');
    doc.setFont('courier', 'bold');
    doc.setFontSize(11);
    doc.text('CONFIRMACAO DE RECEBIMENTO', 14, 20);
    y = 34;
  }

  doc.setFont('courier', 'normal');
  doc.setFontSize(11);
  doc.text('Data de recebimento: ____/____/________', 14, y);
  doc.text('Nome de quem recebeu: _______________________________________________', 14, y + 8);
  doc.text('RG: __________________________   Assinatura: ________________________', 14, y + 16);
}
