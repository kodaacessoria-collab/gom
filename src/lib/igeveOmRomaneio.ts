import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { billingAdjustmentLines, billingQuantityAdjustment, normalizeBillingText } from './igeveBilling.ts';
import type { BillingInvoice, BillingPoint } from './igeveBilling.ts';

export const isOmLogBilling = (invoice: Pick<BillingInvoice, 'company' | 'cnpj'>) => {
  const cnpj = invoice.cnpj.replace(/\D/g, '');
  return cnpj ? cnpj === '68673515000196' : /^OM\s+LOG(?:ISTICA)?\b/.test(normalizeBillingText(invoice.company));
};

const dateLabel = (date: string) => date.split('-').reverse().join('/');
export const romaneioFilename = (invoice: BillingInvoice, category: string) => {
  const safe = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 90);
  return `romaneio-${safe(category)}-${safe(invoice.destination)}-${safe(invoice.control)}.pdf`;
};

// OM Log reference: A4 portrait, IGEVE letterhead, green item table and blank receipt fields.
export function createOmBillingRomaneio(invoice: BillingInvoice, category: string, options: { point?: BillingPoint; logo: string; consumption?: string }) {
  if (!isOmLogBilling(invoice)) throw new Error('Este modelo de romaneio é exclusivo da OM Log.');
  const rows = billingAdjustmentLines(invoice, category);
  if (!rows.length) throw new Error('Nenhum item ajustado nesta categoria. Informe um ajuste diferente de zero para gerar o romaneio.');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const blue: [number, number, number] = [0, 51, 102];
  const left = 15, right = 195, width = right - left;
  const operation = invoice.operation.replace(/^Opera[çc][ãa]o\s*/i, '').replace(/\s*\(([A-Z]{2})\)\s*$/, '/$1');
  const heading = `ROMANEIO - OPERAÇÃO ${operation.toLocaleUpperCase('pt-BR')}`;
  function header(continuation = false) {
    pdf.setTextColor(...blue); pdf.setFont('courier', 'bold'); pdf.setFontSize(11);
    pdf.addImage(options.logo, 'PNG', left, 13, 20, 18);
    pdf.text(pdf.splitTextToSize(heading, 152), 41, 17);
    pdf.setFontSize(10);
    pdf.text(pdf.splitTextToSize(category.toLocaleUpperCase('pt-BR'), 152), 41, 28);
    pdf.setDrawColor(200, 213, 224); pdf.setLineWidth(.25); pdf.line(left, 38, right, 38);
    if (continuation) {
      pdf.setFontSize(8); pdf.setFont('courier', 'normal');
      pdf.text(pdf.splitTextToSize(`Local: ${invoice.destination}`, width), left, 44);
    }
  }
  header();
  let y = 45;
  function text(value: string, bold = false, size = 10) {
    pdf.setTextColor(...blue); pdf.setFont('courier', bold ? 'bold' : 'normal'); pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(value, width) as string[];
    for (const line of lines) {
      if (y > 240) { pdf.addPage(); header(true); y = 54; pdf.setFont('courier', bold ? 'bold' : 'normal'); pdf.setFontSize(size); }
      pdf.text(line, left, y); y += 5;
    }
    y += 2;
  }
  text(`Local: ${invoice.destination} | Código: ${options.point?.code || ''}`, true);
  text(`Endereço: ${options.point?.address || ''} | Bairro: ${options.point?.neighborhood || ''}`);
  y += 8;
  const delivery = invoice.location
    ? [invoice.location.start, invoice.location.end].filter(Boolean).map(dateLabel).filter((value, index, all) => all.indexOf(value) === index).join(' a ')
    : dateLabel(invoice.deliveryDate || '');
  text(`Data de entrega: ${delivery}`);
  text(`Consumo: ${options.consumption || ''}`);
  y += 7;
  text(`Observação geral: ${invoice.notes || ''}`);
  y += 5;
  if (y > 230) { pdf.addPage(); header(true); y = 54; }
  const firstTablePage = pdf.getNumberOfPages();
  autoTable(pdf, {
    startY: y, margin: { left, right: left, top: 50, bottom: 43 },
    head: [['Produto', 'UND / MEDIDA', 'QTD', 'OBS.']],
    body: rows.map(({ item }) => [item.product, item.unit, billingQuantityAdjustment(item).toLocaleString('pt-BR', { maximumFractionDigits: 6, signDisplay: 'exceptZero' }), '']),
    theme: 'grid', rowPageBreak: 'avoid',
    styles: { font: 'courier', fontSize: 8, cellPadding: 1.1, textColor: blue, lineColor: [170, 183, 195], lineWidth: .15, overflow: 'linebreak' },
    headStyles: { fillColor: [0, 153, 115], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10, cellPadding: 2 },
    alternateRowStyles: { fillColor: [244, 247, 247] },
    columnStyles: { 0: { cellWidth: 100 }, 1: { cellWidth: 40 }, 2: { cellWidth: 20, halign: 'right' }, 3: { cellWidth: 20 } },
    willDrawPage: data => { if (data.pageNumber > 1 || pdf.getNumberOfPages() > firstTablePage) header(true); },
  });
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page); pdf.setTextColor(...blue); pdf.setDrawColor(...blue); pdf.setLineWidth(.15);
    pdf.setFont('courier', 'normal'); pdf.setFontSize(9);
    pdf.text('Data de recebimento: ____/____/________', left, 271);
    pdf.text('Nome de quem recebeu:', left, 280); pdf.line(59, 280.5, 158, 280.5);
    pdf.text('RG:', left, 289); pdf.line(23, 289.5, 56, 289.5);
    pdf.text('Assinatura:', 58, 289); pdf.line(81, 289.5, 140, 289.5);
    if (pages > 1) { pdf.setFontSize(7); pdf.text(`${page}/${pages}`, right, 289, { align: 'right' }); }
  }
  return pdf;
}
