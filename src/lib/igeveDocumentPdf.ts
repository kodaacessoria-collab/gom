import { createRioNutriPdf } from './igeveRioNutriPdf.ts';
import { jsPDF } from 'jspdf';
import { createQuotationPdf } from './igeveQuotePdf.ts';
import { autoTable } from 'jspdf-autotable';
import { decimal2, documentFilename, validateNfeDocument } from './igeveDocuments.ts';
import type { DocumentSupplier, NfeDocument, Quotation } from './igeveDocuments.ts';

const date = (s: string) => s.split('-').reverse().join('/');
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
export function createIgeveDocumentPdf(doc: NfeDocument, supplier: DocumentSupplier, kind: 'quote' | 'delivery', quotation?: Quotation) {
  const error = validateNfeDocument({ ...doc, quotations: quotation ? [quotation] : doc.quotations }, [supplier], kind);
  if (error) throw new Error(error);
  if (kind === 'quote' && (!quotation || quotation.supplierId !== supplier.id)) throw new Error('Cotação não corresponde ao fornecedor.');
  if (!/^#[0-9a-f]{6}$/i.test(supplier.color)) throw new Error('Confira a cor do modelo.');
  if (supplier.layout === 'rionutri') return { pdf: createRioNutriPdf(doc, supplier, kind === 'quote' ? quotation : undefined), filename: documentFilename(supplier, doc, kind) };
  if (kind === 'quote') return { pdf: createQuotationPdf(doc, supplier, quotation!), filename: documentFilename(supplier, doc, kind) };
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const color = rgb(supplier.color);
  const left = 14, width = 182;
  let y = 18;
  const text = (value: string, size = 9, bold = false, x = left, maxWidth = width, centered = false) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(value || ' ', maxWidth) as string[];
    pdf.text(lines, centered ? 105 : x, y, centered ? { align: 'center' } : {}); y += lines.length * size * .42 + 2;
  };
  const pageSpace = (height: number) => { if (y + height > 272) { pdf.addPage(); y = 32; } };
  if (supplier.logo) {
    const props = pdf.getImageProperties(supplier.logo);
    const logoWidth = Math.min(42, 16 * props.width / props.height);
    const logoHeight = Math.min(16, 42 * props.height / props.width);
    pdf.addImage(supplier.logo, props.fileType, left, y - 5, logoWidth, logoHeight); y += logoHeight + 3;
  }
  pdf.setTextColor(...color);
  text(supplier.name, supplier.layout === 'om' ? 17 : 14, true, left, width, supplier.layout === 'om');
  pdf.setTextColor(35, 35, 35);
  text(`CNPJ: ${supplier.cnpj}`, 9);
  if (supplier.address) text(supplier.address, 8);
  if (supplier.contact) text(supplier.contact, 8);
  y += 2;
  const title = 'ROMANEIO DE ENTREGA';
  pdf.setDrawColor(...color); pdf.setLineWidth(.5); pdf.line(left, y, 196, y); y += 7;
  text(title, 13, true);
  text(`Data de entrega: ${date(doc.deliveryDate)}`, 9);
  const fields = [
    ['Cliente', doc.recipient], ['CNPJ do destinatário', doc.recipientCnpj], ['Unidade de atendimento', doc.unitName],
    ['Endereço de entrega', doc.address || '________________________________________________'],
    ...(doc.consumption ? [['Referência de consumo', doc.consumption]] : []),
  ];
  autoTable(pdf, { startY: y, margin: { left, right: left, bottom: 25, top: 32 }, theme: supplier.layout === 'caninde' ? 'striped' : 'plain',
    body: fields, styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' }, columnStyles: { 0: { cellWidth: 40, fontStyle: 'bold' }, 1: { cellWidth: 142 } },
  });
  y = (pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  if (doc.baskets > 0) { pageSpace(12); text(`Quantidade de cestas: ${decimal2(doc.baskets)}`, 10, true); }
  const basketDelivery = kind === 'delivery' && supplier.layout === 'caninde' && doc.baskets > 0;
  const head = basketDelivery ? [['Cód.', 'Produto / descrição', 'Un.', 'Por cesta', 'Total previsto', 'Conferência']]
    : [['Cód.', 'Produto / descrição', 'Un.', 'Quantidade', 'Observações']];
  const body = doc.items.map(item => basketDelivery
    ? [item.code, item.product, item.unit, decimal2(item.quantity / doc.baskets), decimal2(item.quantity), item.notes]
    : [item.code, item.product, item.unit, decimal2(item.quantity), item.notes]);
  autoTable(pdf, { startY: y, margin: { left, right: left, top: 32, bottom: 25 }, head, body,
    theme: supplier.layout === 'red' || supplier.layout === 'delicias' ? 'plain' : 'striped',
    styles: { fontSize: 8, cellPadding: 2.4, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: color, textColor: supplier.layout === 'nobre' ? [20, 20, 20] : [255, 255, 255] },
    columnStyles: basketDelivery ? { 0: { cellWidth: 16 }, 1: { cellWidth: 80 }, 2: { cellWidth: 12 }, 3: { cellWidth: 22, halign: 'right' }, 4: { cellWidth: 26, halign: 'right' }, 5: { cellWidth: 26 } }
        : { 0: { cellWidth: 16 }, 1: { cellWidth: 94 }, 2: { cellWidth: 14 }, 3: { cellWidth: 25, halign: 'right' }, 4: { cellWidth: 33 } },
  });
  y = (pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  const notes = [doc.notes, supplier.footer].filter(Boolean).join('\n');
  if (notes) {
    const lines = pdf.splitTextToSize(`Observações: ${notes}`, width) as string[];
    pdf.setFontSize(8); pdf.setFont('helvetica', 'normal');
    for (const line of lines) { pageSpace(5); pdf.text(line, left, y); y += 4; }
    y += 4;
  }
  pageSpace(kind === 'delivery' ? 54 : 32);
  y += 6;
  if (kind === 'delivery') {
    text('Data de recebimento: ____/____/________    Horário: ____:____', 9);
    text('Recebedor: ______________________________________________________', 9);
    text('RG / CPF / matrícula: ______________________________________________', 9);
    text('Divergências: _____________________________________________________', 9);
  }
  y += 5;
  text('_________________________________________________________________', 9);
  text('Assinatura do recebedor', 9);
  const count = pdf.getNumberOfPages();
  for (let p = 1; p <= count; p++) {
    pdf.setPage(p); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(90, 90, 90);
    if (p > 1) { pdf.text(pdf.splitTextToSize(`${supplier.name} | ${title}`, width), left, 15); }
    pdf.setDrawColor(210, 210, 210); pdf.line(left, 278, 196, 278);
    pdf.text(pdf.splitTextToSize(doc.unitName, 152), left, 283);
    pdf.text(`${p}/${count}`, 196, 283, { align: 'right' });
  }
  return { pdf, filename: documentFilename(supplier, doc, kind) };
}
