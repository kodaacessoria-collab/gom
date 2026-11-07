import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { UserOptions } from 'jspdf-autotable';
import { decimal2, digits, documentTotal } from './igeveDocuments.ts';
import type { DocumentSupplier, NfeDocument, Quotation } from './igeveDocuments.ts';
import { MANU_QUOTE_LOGO } from './igeveManuLogo.ts';

export function createManuQuotationPdf(doc: NfeDocument, supplier: DocumentSupplier, quotation: Quotation) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const left = 16, width = 178;
  const accent = [1, 3, 5].map(i => parseInt(supplier.color.slice(i, i + 2), 16)) as [number, number, number];
  const total = documentTotal(doc.items, quotation.prices);
  const money = (value: number) => `R$ ${decimal2(value)}`;
  const showCodes = digits(doc.issuerCnpj).length === 14 && digits(doc.issuerCnpj) === digits(supplier.cnpj);
  let y = 50;
  const table = (options: UserOptions) => {
    autoTable(pdf, { startY: y, margin: { left, right: left, top: 28, bottom: 34 }, theme: 'grid',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.8, textColor: [0, 0, 0], lineColor: [60, 60, 60], lineWidth: .15, overflow: 'linebreak' },
      ...options });
    y = (pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  };
  const space = (height: number) => { if (y + height > 261) { pdf.addPage(); y = 30; } };
  const logo = supplier.logo || MANU_QUOTE_LOGO;
  const image = pdf.getImageProperties(logo);
  const ratio = Math.min(29 / image.width, 22 / image.height);
  pdf.addImage(logo, image.fileType, 21, 22, image.width * ratio, image.height * ratio);
  pdf.setFont('times', 'bolditalic'); pdf.setTextColor(...accent); pdf.setFontSize(14);
  const titleWidth = 135;
  if (pdf.getTextWidth(supplier.name) > titleWidth) pdf.setFontSize(Math.max(9, 14 * titleWidth / pdf.getTextWidth(supplier.name)));
  const title = pdf.splitTextToSize(supplier.name, titleWidth) as string[];
  pdf.text(title, 54, 32);
  pdf.setDrawColor(...accent);
  for (const [index, line] of title.entries()) pdf.line(54, 33 + index * 5, 54 + pdf.getTextWidth(line), 33 + index * 5);

  table({ body: [[doc.recipient], [`CNPJ: ${doc.recipientCnpj}`], [`Endereço: ${doc.address || '________________________________________________'}`],
    ...(doc.consumption ? [[`Consumo: ${doc.consumption}`]] : [])],
    styles: { fontSize: 10, fontStyle: 'bold', textColor: [0, 0, 0], cellPadding: 2, lineColor: [0, 0, 0], lineWidth: .15 } });
  y += 12;
  pdf.setFont('times', 'normal'); pdf.setFontSize(11); pdf.setTextColor(0, 0, 0);
  const conditions = pdf.splitTextToSize('Os produtos deverão ser entregues devidamente acondicionados, dentro dos respectivos prazos de validade e em condições adequadas para consumo.', width) as string[];
  pdf.text(conditions, left + 2, y); y += conditions.length * 4.8 + 8;
  const columns = [
    ...(showCodes ? [{ header: 'Cód.', dataKey: 'code' }] : []),
    { header: 'Produto', dataKey: 'product' }, { header: 'Unidade', dataKey: 'unit' },
    { header: 'Qtd.', dataKey: 'quantity' }, { header: 'VL UNITÁRIO', dataKey: 'price' }, { header: 'Valor total', dataKey: 'total' },
  ];
  table({ columns, body: doc.items.map(item => ({ code: item.code, product: item.product, unit: item.unit,
    quantity: decimal2(item.quantity), price: money(quotation.prices[item.id]!), total: money(Math.round((item.quantity * quotation.prices[item.id]! + Number.EPSILON) * 100) / 100) })),
    headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'normal' },
    columnStyles: { code: { cellWidth: 20, fontSize: 8 }, product: { cellWidth: 'auto' }, unit: { cellWidth: 17, halign: 'center' }, quantity: { cellWidth: 19, halign: 'right' }, price: { cellWidth: 30, halign: 'right' }, total: { cellWidth: 33, halign: 'right' } },
    foot: [[{ content: 'TOTAL GERAL', colSpan: columns.length - 1, styles: { halign: 'center' } }, money(total)]],
    footStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'right' }, showFoot: 'lastPage', rowPageBreak: 'avoid',
  });
  y += 12; space(doc.baskets > 0 ? 48 : 34);
  table({ body: [
    ['Valor Total', money(total)], ['Pagamento:', supplier.payment],
    ['Validade:', `${supplier.validity} dias - ${doc.unitName}`], ['Data:', quotation.date.split('-').reverse().join('/')],
    ...(doc.baskets > 0 ? [['Quantidade de cestas', decimal2(doc.baskets)], ['Valor por cesta', money(total / doc.baskets)]] : []),
  ], columnStyles: { 0: { cellWidth: 89, fontStyle: 'bold' }, 1: { cellWidth: 89, fontStyle: 'bold' } },
    didParseCell: data => { if (data.row.index === 3) data.cell.styles.fillColor = [244, 234, 234]; } });
  const notes = [doc.notes, supplier.footer].filter(Boolean).join('\n');
  if (notes) {
    y += 8; pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
    for (const line of pdf.splitTextToSize(`Observações: ${notes}`, width) as string[]) { space(6); pdf.text(line, left, y); y += 4; }
  }
  space(30); y += 16; pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
  pdf.setDrawColor(70, 70, 70); pdf.line(95, y, 190, y);
  pdf.text('Assinatura do representante autorizado', 142.5, y + 5, { align: 'center' });
  for (let p = 1; p <= pdf.getNumberOfPages(); p++) {
    pdf.setPage(p);
    pdf.setTextColor(...accent); pdf.setFont('times', 'bolditalic'); pdf.setFontSize(p > 1 ? 10 : 9);
    if (p > 1) pdf.text(`${supplier.name} | ORÇAMENTO`, left, 16);
    pdf.setFontSize(10);
    const footer = pdf.splitTextToSize([supplier.address, `CNPJ: ${supplier.cnpj}`, supplier.contact].filter(Boolean).join('\n'), width) as string[];
    pdf.text(footer, 105, 272, { align: 'center' });
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(80, 80, 80);
    pdf.text(`${p}/${pdf.getNumberOfPages()}`, 194, 291, { align: 'right' });
  }
  return pdf;
}
