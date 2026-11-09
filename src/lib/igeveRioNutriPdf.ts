import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { decimal2, digits, documentTotal } from './igeveDocuments.ts';
import type { DocumentSupplier, NfeDocument, Quotation } from './igeveDocuments.ts';
import { RIO_NUTRI_LOGO } from './igeveRioNutriLogo.ts';

export function createRioNutriPdf(doc: NfeDocument, supplier: DocumentSupplier, quotation?: Quotation) {
  const pdf = new jsPDF();
  const quote = !!quotation;
  const title = quote ? 'ORÇAMENTO' : 'ROMANEIO DE ENTREGA';
  const accent: [number, number, number] = [0, 135, 119];
  const navy: [number, number, number] = [18, 47, 80];
  let y = 16;
  const text = (value: string, size = 9, bold = false, x = 15, width = 180) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(value, width) as string[];
    pdf.text(lines, x, y); y += lines.length * size * .42 + 2;
  };
  const space = (height: number) => { if (y + height > 275) { pdf.addPage(); y = 30; } };
  pdf.addImage(supplier.logo || RIO_NUTRI_LOGO, 15, 14, 66, 22);
  pdf.setTextColor(...navy);
  text(supplier.name, 11, true, 92, 103);
  text(`CNPJ: ${supplier.cnpj}`, 8, false, 92, 103);
  text(supplier.address, 8, false, 92, 103);
  text(supplier.contact, 7, false, 92, 103);
  y = Math.max(y + 3, 44);
  pdf.setDrawColor(...accent); pdf.line(15, y, 195, y); y += 8;
  text(title, 20, true);
  text(quote ? `Data da cotação: ${quotation.date.split('-').reverse().join('/')}` : `NF-e: ${doc.number} | Data da entrega: ${doc.deliveryDate.split('-').reverse().join('/')}`);
  if (doc.consumption) text(`Referência: ${doc.consumption}`);
  autoTable(pdf, { startY: y, margin: { left: 15, right: 15, top: 30, bottom: 25 }, theme: 'plain',
    body: [[`DESTINATÁRIO\n${doc.recipient}\nCNPJ: ${doc.recipientCnpj}\n${doc.unitName}`, `ENDEREÇO DO DESTINATÁRIO\n${doc.address || 'A preencher'}`]],
    styles: { fontSize: 9, cellPadding: 4, textColor: navy, fillColor: [238, 245, 245], overflow: 'linebreak' }, columnStyles: { 0: { cellWidth: 105 }, 1: { cellWidth: 75 } } });
  y = (pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  const ownCodes = quote && digits(doc.issuerCnpj).length === 14 && digits(doc.issuerCnpj) === digits(supplier.cnpj);
  autoTable(pdf, { startY: y, margin: { left: 15, right: 15, top: 30, bottom: 25 },
    head: [[...(ownCodes ? ['Cód.'] : quote ? [] : ['ITEM']), 'DESCRIÇÃO DO PRODUTO', 'UN.', 'QTD.', ...(quote ? ['VL. UNIT.', 'TOTAL'] : ['RECEBIDO'])]],
    body: doc.items.map((item, i) => [...(ownCodes ? [item.code] : quote ? [] : [String(i + 1)]), item.product, item.unit, decimal2(item.quantity), ...(quote ? [decimal2(quotation.prices[item.id]!), decimal2(Math.round(item.quantity * quotation.prices[item.id]! * 100) / 100)] : [''])]),
    theme: 'striped', styles: { fontSize: 8, cellPadding: 2.4, overflow: 'linebreak', textColor: navy }, headStyles: { fillColor: accent, textColor: [255, 255, 255] }, alternateRowStyles: { fillColor: [238, 245, 245] } });
  y = (pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  if (quote) {
    space(30); text(`VALOR TOTAL: R$ ${decimal2(documentTotal(doc.items, quotation.prices))}`, 13, true);
    if (doc.baskets) text(`Cestas: ${decimal2(doc.baskets)} | Valor por cesta: R$ ${decimal2(documentTotal(doc.items, quotation.prices) / doc.baskets)}`);
    for (const line of pdf.splitTextToSize(`Pagamento: ${supplier.payment} | Validade: ${supplier.validity} dias`, 180) as string[]) { space(5); text(line, 8); }
  } else {
    space(68); pdf.setTextColor(...accent); text('RECEBIMENTO E CONFERÊNCIA', 11, true); pdf.setTextColor(...navy);
    text('Conferir as quantidades recebidas e registrar eventuais divergências.', 9);
    text('Observações: __________________________________________________________');
    text('______________________________________________________________________');
    y += 3; text('Recebedor: ______________________________ Documento: __________________');
    text('Data: ____/____/________    Hora: ____:____');
  }
  for (const line of pdf.splitTextToSize([doc.notes, supplier.footer].filter(Boolean).join('\n'), 180) as string[]) { space(5); text(line, 8); }
  space(24); y += 12;
  if (quote) { text('_________________________________________________', 9); text('Assinatura do representante autorizado do fornecedor', 8); }
  else { text('_______________________________                     _______________________________'); text('Assinatura do recebedor                                    Assinatura do responsável pela entrega', 8); }
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p); pdf.setFontSize(8); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...navy);
    if (p > 1) pdf.text(`${supplier.name} | ${title}`, 15, 16);
    pdf.setDrawColor(200, 215, 220); pdf.line(15, 281, 195, 281);
    pdf.setFontSize(7); pdf.text(`RIO NUTRI DISTRIBUIÇÃO | ${title}`, 15, 286); pdf.text(`${p}/${pages}`, 195, 286, { align: 'right' });
  }
  return pdf;
}
