import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { decimal2, digits, documentReference, documentTotal, round2 } from './igeveDocuments.ts';
import type { DocumentSupplier, NfeDocument, Quotation } from './igeveDocuments.ts';
import { addQuoteSignature } from './igeveQuoteSignature.ts';
import { VERAS_LOGO } from './igeveVerasLogo.ts';

const green = '#0b513d';
const ink = '#16332b';
const pale = '#eaf3ed';
const border = '#a5bcb0';
const left = 15;
const right = 195;
const width = right - left;
const bottom = 279;
const date = (value: string) => value.split('-').reverse().join('/');
const quantity = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

export function createVerasPdf(doc: NfeDocument, supplier: DocumentSupplier, quotation?: Quotation, signature?: string) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const reference = documentReference(doc.number);
  const title = quotation ? 'ORÇAMENTO' : 'ROMANEIO DE ENTREGA';
  const text = (value: string | string[], x: number, y: number, size: number, bold = false) => {
    pdf.setTextColor(ink).setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size);
    pdf.text(value, x, y, { lineHeightFactor: 1.35 });
  };
  const lines = (value: string, size: number, maxWidth: number, bold = false): string[] => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size);
    return pdf.splitTextToSize(value, maxWidth) as string[];
  };

  const letterhead = () => {
    pdf.addImage(VERAS_LOGO, 'JPEG', 19, 11, 32, 29.5);
    let headerY = 17.5;
    const header = (value: string, size = 10, bold = false) => {
      const wrapped = lines(value, size, right - 60, bold);
      text(wrapped, 60, headerY, size, bold);
      headerY += wrapped.length * 5.4;
    };
    header('VERAS DISTRIBUIDORA DE VÍSCERAS LTDA.', 13, true);
    const isHeadOffice = digits(supplier.cnpj) === '39323523000104';
    header(`CNPJ ${supplier.cnpj}${isHeadOffice ? '  |  IE 243695373' : ''}`);
    if (isHeadOffice) {
      header('Rua Eliete Rolemberg de Figueiredo, 5-C • Clima Bom');
      header('Maceió/AL • CEP 05707-110');
      header('(82) 3324-2079  |  visceralal@gmail.com');
    } else {
      if (supplier.address) header(supplier.address);
      if (supplier.contact) header(supplier.contact);
    }
    const ruleY = Math.max(47.5, headerY + 3);
    pdf.setDrawColor(green).setLineWidth(0.25).line(left, ruleY, right, ruleY);
    return ruleY;
  };

  const headingY = letterhead() + 11.5;
  const continuationTop = headingY + 9;
  text(quotation ? [title, reference].filter(Boolean).join(' - ') : title, left, headingY, 25, true);
  let y = headingY + 9.5;
  if (quotation) {
    text('Data do orçamento', left, y, 9.5, true);
    text(date(quotation.date), 51, y, 10);
  } else {
    text('Nº do romaneio', left, y, 9.5, true);
    text(reference, 44, y, 10);
    text('Data da entrega', 122, y, 9.5, true);
    text(date(doc.deliveryDate), 151, y, 10);
    pdf.setDrawColor(border).setLineWidth(0.2).line(42, y + 3, 81, y + 3);
    pdf.line(149.5, y + 3, right, y + 3);
  }
  y += 8;

  const recipient = lines(quotation ? doc.recipient : doc.unitName, 11, quotation ? 170 : 88, true);
  const details = lines(quotation ? `CNPJ ${doc.recipientCnpj}` : doc.address || '________________________________________', 10, quotation ? 170 : 78);
  const cardHeight = Math.max(30, 16 + recipient.length * 5.3 + (quotation ? details.length * 4.8 : 0), 11 + details.length * 4.8);
  pdf.setFillColor(pale).rect(left, y, width, cardHeight, 'F');
  text('DESTINATÁRIO', 19, y + 6, 9, true);
  text(recipient, 19, y + 13, 11, true);
  if (quotation) {
    text(details, 19, y + 13 + recipient.length * 5.3, 10);
  } else {
    text('LOCAL DE ENTREGA', 112.5, y + 6, 9, true);
    text(details, 112.5, y + 13, 10);
  }
  y += cardHeight + 5;
  if (doc.consumption) {
    const consumption = lines(doc.consumption, 9.5, 143);
    text('Período de consumo', left, y, 9.5, true);
    text(consumption, 50, y, 9.5);
    y += consumption.length * 4.6;
  }

  const quoteCodes = quotation && digits(doc.issuerCnpj) === digits(supplier.cnpj);
  autoTable(pdf, {
    startY: y + 4,
    margin: { left, right: 15, top: continuationTop, bottom: 18 },
    head: [quotation
      ? [quoteCodes ? 'CÓD.' : 'ITEM', 'DESCRIÇÃO DO PRODUTO', 'UN.', 'QTD.', 'VL. UNIT.', 'TOTAL']
      : ['ITEM', 'DESCRIÇÃO DO PRODUTO', 'UN.', 'QTD.', 'RECEBIDO']],
    body: doc.items.map((item, index) => {
      const sequence = String(index + 1).padStart(2, '0');
      const product = [item.product, item.notes].filter(Boolean).join('\n');
      const fields = [quoteCodes ? item.code || sequence : sequence, product, item.unit, quantity(item.quantity)];
      if (!quotation) return [...fields, ''];
      const price = quotation.prices[item.id]!;
      return [...fields, decimal2(price), decimal2(round2(item.quantity * price))];
    }),
    theme: 'grid',
    styles: { fontSize: 9.5, cellPadding: 2.8, overflow: 'linebreak', valign: 'middle', textColor: ink, lineColor: border, lineWidth: 0.15, minCellHeight: 12 },
    headStyles: { fillColor: green, textColor: '#ffffff', fontSize: 8.5, minCellHeight: 0 },
    alternateRowStyles: { fillColor: pale },
    columnStyles: quotation
      ? { 0: { cellWidth: 17 }, 1: { cellWidth: 86 }, 2: { cellWidth: 15 }, 3: { cellWidth: 16, halign: 'right' }, 4: { cellWidth: 23, halign: 'right' }, 5: { cellWidth: 23, halign: 'right' } }
      : { 0: { cellWidth: 13.5 }, 1: { cellWidth: 105.5 }, 2: { cellWidth: 19 }, 3: { cellWidth: 18.5, halign: 'right', fontStyle: 'bold' }, 4: { cellWidth: 23.5, halign: 'right' } },
    didDrawPage: ({ pageNumber }) => {
      if (pageNumber > 1) {
        letterhead();
        text([title, reference].filter(Boolean).join(' - '), left, headingY, 13, true);
      }
    },
  });
  y = (pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 9;

  const reserve = (height: number) => {
    if (y + height <= bottom) return;
    pdf.addPage();
    letterhead();
    text([title, reference].filter(Boolean).join(' - '), left, headingY, 13, true);
    y = continuationTop;
  };

  const notes = [doc.notes, supplier.footer].filter(Boolean).join('\n');
  if (quotation) {
    const total = documentTotal(doc.items, quotation.prices);
    reserve(10);
    text(`VALOR TOTAL: R$ ${decimal2(total)}`, left, y, 13, true);
    y += 7;
    const conditions = [
      doc.baskets > 0 ? `Quantidade de cestas: ${quantity(doc.baskets)} | Valor por cesta: R$ ${decimal2(total / doc.baskets)}` : '',
      supplier.payment ? `Condições de pagamento: ${supplier.payment}` : '',
      supplier.validity > 0 ? `Validade da proposta: ${supplier.validity} dias` : '',
      notes ? `Observações: ${notes}` : '',
    ].filter(Boolean);
    for (const condition of conditions) {
      for (const line of lines(condition, 9, width)) {
        reserve(5);
        text(line, left, y, 9);
        y += 5;
      }
    }
    reserve(signature ? 39 : 22);
    if (signature) {
      addQuoteSignature(pdf, signature, 55, y + 2);
      y += 17;
    }
    pdf.setDrawColor(border).setLineWidth(0.2).line(left, y + 15, 95, y + 15);
    text('Assinatura do representante autorizado', left, y + 20, 8.5);
  } else {
    const noteLines = notes ? lines(notes, 9, width - 6) : [];
    const noteBoxHeight = Math.max(16, 5 + noteLines.length * 4.4);
    if (noteBoxHeight <= 90) {
      reserve(noteBoxHeight + 49);
      y = Math.max(y, 214 - (noteBoxHeight - 16));
      text('OBSERVAÇÕES OU DIVERGÊNCIAS', left, y, 9, true);
      pdf.setDrawColor(border).setLineWidth(0.2).rect(left, y + 2.5, width, noteBoxHeight);
      if (noteLines.length) text(noteLines, left + 3, y + 8.5, 9);
      y += noteBoxHeight + 11;
    } else {
      reserve(11);
      text('OBSERVAÇÕES OU DIVERGÊNCIAS', left, y, 9, true);
      y += 6;
      for (const line of noteLines) {
        reserve(5);
        text(line, left, y, 9);
        y += 4.4;
      }
      y += 5;
    }
    reserve(38);
    text('CONFIRMAÇÃO DE RECEBIMENTO', left, y, 9, true);
    text('Nome do recebedor', left, y + 8, 9, true);
    text('Data e hora do recebimento', 125, y + 8, 9, true);
    text('Documento ou matrícula', 125, y + 24, 9, true);
    pdf.setDrawColor(border).setLineWidth(0.2).line(left, y + 17, 119, y + 17);
    pdf.line(125, y + 17, right, y + 17);
    pdf.line(left, y + 33, 119, y + 33);
    pdf.line(125, y + 33, right, y + 33);
    text('Assinatura do recebedor', left, y + 38, 8.5);
  }

  const pages = pdf.getNumberOfPages();
  if (pages > 1) {
    for (let page = 1; page <= pages; page++) {
      pdf.setPage(page);
      pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(ink);
      pdf.text(`${page}/${pages}`, right, 288, { align: 'right' });
    }
  }
  return pdf;
}
