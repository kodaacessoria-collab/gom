import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { UserOptions } from 'jspdf-autotable';
import { decimal2, digits, documentReference, documentTotal } from './igeveDocuments.ts';
import type { DocumentSupplier, NfeDocument, Quotation } from './igeveDocuments.ts';
import { QUOTE_LOGOS } from './igeveQuoteLogos.ts';
import { addQuoteSignature } from './igeveQuoteSignature.ts';
import { createManuQuotationPdf } from './igeveManuQuotePdf.ts';

// Rebuild the reference layouts with current data; never reuse signed pages.
export function createQuotationPdf(doc: NfeDocument, supplier: DocumentSupplier, quotation: Quotation, signature?: string) {
  if (supplier.layout === 'manu') return createManuQuotationPdf(doc, supplier, quotation, signature);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const layout = supplier.layout;
  const cnpjRoot = digits(supplier.cnpj).slice(0, 8);
  // Filiais compartilham a identidade visual da matriz, inclusive em cadastros antigos.
  const pageLayout = cnpjRoot === '12484640' ? 'red' : cnpjRoot === '68673515' ? 'om' : layout;
  const title = ['ORÇAMENTO', documentReference(doc.number)].filter(Boolean).join(' - ');
  const color = (hex: string): [number, number, number] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  const accent = layout === 'lm' ? color('#173e72') : color(supplier.color);
  const pageAccent = pageLayout === 'red' ? color('#ba1428') : pageLayout === 'om' ? color('#254c84') : accent;
  const left = 14, width = 182;
  const total = documentTotal(doc.items, quotation.prices);
  const basket = doc.baskets > 0;
  // A missing issuer CNPJ cannot establish ownership of the source's codes.
  const showCodes = digits(doc.issuerCnpj).length === 14 && digits(doc.issuerCnpj) === digits(supplier.cnpj);
  const date = quotation.date.split('-').reverse().join('/');
  let y = 18;
  const text = (value: string, size = 9, bold = false, x = left, maxWidth = width, align: 'left' | 'center' = 'left') => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(value || ' ', maxWidth) as string[];
    pdf.text(lines, x, y, { align }); y += lines.length * size * .42 + 2;
  };
  const space = (height: number) => { if (y + height > 265) { pdf.addPage(); y = 30; } };
  const table = (options: UserOptions) => {
    autoTable(pdf, { startY: y, margin: { left, right: left, top: 30, bottom: 32 },
      styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' }, ...options });
    y = (pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
  };
  const logo = supplier.logo || QUOTE_LOGOS[pageLayout as keyof typeof QUOTE_LOGOS];
  const addLogo = (x: number, top: number, maxWidth: number, maxHeight: number) => {
    if (!logo) return;
    const props = pdf.getImageProperties(logo);
    const ratio = Math.min(maxWidth / props.width, maxHeight / props.height);
    pdf.addImage(logo, props.fileType, x, top, props.width * ratio, props.height * ratio);
  };
  const client = [ ['CLIENTE', doc.recipient], ['CNPJ', doc.recipientCnpj], ['UNIDADE', doc.unitName], ['ENDEREÇO', doc.address || '________________________________________________'] ];
  if (doc.consumption) client.push(['CONSUMO', doc.consumption]);

  if (pageLayout === 'caninde') {
    pdf.setTextColor(...accent); text(title, 16, true); y += 3;
    table({ theme: 'striped', body: [ ['Fornecedor', supplier.name], ['CNPJ do fornecedor', supplier.cnpj], ['Endereço do fornecedor', supplier.address], ['Data da cotação', date], ...client ],
      columnStyles: { 0: { cellWidth: 40, fillColor: [233, 240, 246] }, 1: { cellWidth: 142 } } });
    text('Itens do pedido', 10);
  } else if (pageLayout === 'nobre') {
    addLogo(left, 15, 35, 15); y = logo ? 36 : 18;
    pdf.setTextColor(25, 65, 60); text(supplier.name, 10, true);
    pdf.setTextColor(35, 35, 35); text(`CNPJ: ${supplier.cnpj}`, 8);
    if (supplier.address) text(supplier.address, 8);
    table({ theme: 'plain', body: [
      ['Cliente', doc.recipient, 'CNPJ', doc.recipientCnpj],
      ['Endereço', doc.address || '-', 'Unidade', doc.unitName],
      ['Proposta', `${title} - ${date}`, 'Qtde. cestas', basket ? decimal2(doc.baskets) : '-'],
      ['Proposta válida', `${supplier.validity} dias`, basket ? 'Vlr. por cesta' : 'Vlr. total', `R$ ${decimal2(basket ? total / doc.baskets : total)}`],
      ['Pagamento', supplier.payment, 'Vlr. total', `R$ ${decimal2(total)}`],
      ...(doc.consumption ? [['Consumo', doc.consumption, '', '']] : []),
    ], columnStyles: { 0: { cellWidth: 28, fontStyle: 'bold' }, 1: { cellWidth: 89 }, 2: { cellWidth: 25, fontStyle: 'bold' }, 3: { cellWidth: 40 } } });
  } else if (pageLayout === 'red') {
    addLogo(left, 14, 26, 22); y = 20;
    pdf.setTextColor(30, 32, 32);
    text(supplier.name, 13, true, logo ? 47 : left, logo ? 114 : 146); y = Math.max(y, 43);
    pdf.setTextColor(...pageAccent); text(title, 12, true);
    pdf.setTextColor(35, 35, 35);
    text(`DATA: ${date}     VALIDADE: ${supplier.validity} dias`, 9);
    table({ theme: 'grid', body: client, styles: { fontSize: 8, cellPadding: 2.5, lineColor: [40, 40, 40], lineWidth: .2 }, columnStyles: { 0: { cellWidth: 25, fontStyle: 'bold' }, 1: { cellWidth: 157 } } });
    text('Proposta comercial, contendo os preços e condições para fornecimento dos itens abaixo.', 8, false, 105, width, 'center');
  } else if (pageLayout === 'lm') {
    addLogo(175, 13, 20, 20);
    pdf.setTextColor(30, 40, 52); text(supplier.name, 13, true, left, logo ? 156 : width);
    text(`CNPJ: ${supplier.cnpj}`, 8, false, left, logo ? 156 : width);
    if (supplier.address) text(supplier.address, 8);
    pdf.setDrawColor(200, 212, 230); pdf.line(left, y, 196, y); y += 16;
    pdf.setTextColor(...accent); text(title, 24, true); y += 5;
    pdf.setTextColor(30, 40, 52); text('DADOS DO CLIENTE', 10, true);
    table({ theme: 'plain', body: client, columnStyles: { 0: { cellWidth: 28, fontStyle: 'bold' }, 1: { cellWidth: 154 } } });
    text(`Data: ${date}`, 9);
  } else if (pageLayout === 'om') {
    addLogo(87, 12, 36, 16); if (logo) y = 34;
    pdf.setTextColor(...pageAccent); text(supplier.name, 15, true, 105, width, 'center');
    pdf.setTextColor(35, 35, 35);
    text(`CNPJ: ${supplier.cnpj}`, 9, false, 105, width, 'center');
    if (supplier.address) text(supplier.address, 8, false, 105, width, 'center');
    y += 4; text(`À ${doc.recipient}`, 10, true);
    table({ theme: 'plain', body: client.slice(1), columnStyles: { 0: { cellWidth: 28, fontStyle: 'bold' }, 1: { cellWidth: 154 } } });
    text(title, 16, true, 105, width, 'center');
    text(`Data: ${date}`, 9);
  } else {
    addLogo(left, 12, 35, 16); if (logo) y = 35;
    text(supplier.name, 14, true); text(`CNPJ: ${supplier.cnpj}`, 9);
    if (supplier.address) text(supplier.address, 8);
    text(title, 15, true);
    text(supplier.validity ? `Data: ${date} | Validade: ${supplier.validity} dias` : `Data: ${date}`, 9);
    table({ theme: 'plain', body: client, columnStyles: { 0: { cellWidth: 28, fontStyle: 'bold' }, 1: { cellWidth: 154 } } });
  }
  pdf.setTextColor(35, 35, 35);
  // Basket templates use the proposal summary for prices, as in the originals.
  const basketSummary = basket && !quotation.mirrorsInvoice && (layout === 'nobre' || layout === 'caninde');
  const hasBrand = layout === 'nobre' || layout === 'generic';
  const columns = [
    ...(showCodes ? [{ header: 'Cód.', dataKey: 'code' }] : []),
    { header: layout === 'lm' ? 'DESCRIÇÃO DOS PRODUTOS / SERVIÇOS' : 'Descrição do produto', dataKey: 'product' },
    ...(hasBrand ? [{ header: 'Marca', dataKey: 'brand' }] : []),
    ...(layout === 'nobre' && basketSummary ? [] : [{ header: 'Un.', dataKey: 'unit' }]), { header: 'Quantidade', dataKey: 'quantity' },
    ...(!basketSummary ? [{ header: 'Valor unitário', dataKey: 'price' }, { header: 'Valor total', dataKey: 'total' }] : []),
  ];
  table({ columns, body: doc.items.map(item => ({ ...(showCodes ? { code: item.code } : {}), product: item.product, brand: item.brand,
    unit: item.unit, quantity: decimal2(item.quantity), price: decimal2(quotation.prices[item.id]!), total: decimal2(Math.round((item.quantity * quotation.prices[item.id]! + Number.EPSILON) * 100) / 100) })),
    theme: layout === 'om' || layout === 'red' ? 'grid' : layout === 'lm' ? 'plain' : 'striped',
    styles: { fontSize: 8, cellPadding: 2.2, overflow: 'linebreak', valign: 'middle', lineColor: [205, 205, 205], lineWidth: layout === 'red' || layout === 'om' ? .15 : 0 },
    headStyles: { fillColor: layout === 'nobre' ? [245, 163, 18] : layout === 'red' || layout === 'lm' || layout === 'om' ? [242, 243, 245] : accent,
      textColor: ['nobre', 'red', 'lm', 'om'].includes(layout) ? [25, 30, 35] : [255, 255, 255], fontStyle: 'bold' },
    columnStyles: { code: { cellWidth: 18 }, product: { cellWidth: 'auto' }, brand: { cellWidth: 24 }, unit: { cellWidth: 12 }, quantity: { cellWidth: 24, halign: 'right' }, price: { cellWidth: 28, halign: 'right' }, total: { cellWidth: 29, halign: 'right' } },
  });
  space(basket ? 45 : 35);
  if (layout === 'caninde') {
    table({ theme: 'striped', body: [...(basket ? [['Quantidade de cestas', decimal2(doc.baskets)], ['Valor por cesta', `R$ ${decimal2(total / doc.baskets)}`]] : []), ['Valor total do pedido', `R$ ${decimal2(total)}`], ['Pagamento', supplier.payment], ['Validade do orçamento', `${supplier.validity} dias`]], columnStyles: { 0: { cellWidth: 110 }, 1: { cellWidth: 72, halign: 'right' } } });
  } else if (layout === 'lm') {
    pdf.setFillColor(241, 243, 247); pdf.roundedRect(left, y, 85, 22, 2, 2, 'F');
    pdf.setFillColor(...accent); pdf.roundedRect(117, y, 79, 22, 2, 2, 'F');
    const top = y; y += 6; text('FORMA DE PAGAMENTO', 9, true, 56, 80, 'center');
    text(supplier.payment, 9, false, 56, 80, 'center'); text(`Validade: ${supplier.validity} dias`, 8, false, 56, 80, 'center');
    y = top + 8; pdf.setTextColor(255, 255, 255); text('VALOR TOTAL', 10, true, 156, 73, 'center');
    text(`R$ ${decimal2(total)}`, 13, true, 156, 73, 'center'); pdf.setTextColor(35, 35, 35); y = top + 29;
    if (basket) text(`Quantidade de cestas: ${decimal2(doc.baskets)} | Valor por cesta: R$ ${decimal2(total / doc.baskets)}`, 9);
  } else {
    if (layout === 'om') text('VALOR DO FORNECIMENTO', 11, true);
    text(`VALOR TOTAL: R$ ${decimal2(total)}`, 13, true, 105, width, 'center');
    if (basket) text(`Quantidade de cestas: ${decimal2(doc.baskets)} | Valor por cesta: R$ ${decimal2(total / doc.baskets)}`, 9, false, 105, width, 'center');
    if (supplier.payment) text(`Condições de pagamento: ${supplier.payment}`, 9, false, 105, width, 'center');
    if (supplier.validity) text(`Validade da proposta: ${supplier.validity} dias`, 9, false, 105, width, 'center');
  }
  const notes = [doc.notes, supplier.footer].filter(Boolean).join('\n');
  if (notes) {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
    for (const line of pdf.splitTextToSize(`Observações: ${notes}`, width) as string[]) { space(6); pdf.text(line, left, y); y += 4; }
    y += 4;
  }
  space(signature ? 43 : 25); y += 10;
  if (signature) {
    addQuoteSignature(pdf, signature, 105, y);
    y += 26;
  } else {
    text('_________________________________________________________', 9, false, 105, width, 'center');
  }
  text(signature ? 'Imagem de assinatura do representante' : 'Assinatura do representante autorizado do fornecedor', 9, false, 105, width, 'center');
  const count = pdf.getNumberOfPages();
  const right = left + width;
  const taxId = `CNPJ: ${supplier.cnpj}`;
  const footerText = (value: string, x: number, top: number, maxWidth: number, align: 'left' | 'center' | 'right' = 'left') => {
    const lines = pdf.splitTextToSize(value, maxWidth) as string[];
    pdf.text(lines, x, top, { align, lineHeightFactor: 1.2 });
  };
  for (let p = 1; p <= count; p++) {
    pdf.setPage(p);
    pdf.setFillColor(...pageAccent); pdf.setDrawColor(...pageAccent); pdf.setLineWidth(.4);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...pageAccent);
    const pagination = `${p}/${count}`;

    if (pageLayout === 'om') {
      pdf.line(left, 6, right, 6); pdf.line(left, 8, right, 8);
      if (p > 1) {
        pdf.setFont('helvetica', 'bold');
        footerText(supplier.name, 105, 15, width, 'center');
        pdf.setFont('helvetica', 'normal');
        pdf.text(title, 105, 24, { align: 'center' });
      }
      pdf.line(left, 272, right, 272); pdf.line(left, 274, right, 274);
      pdf.setFontSize(7);
      footerText([taxId, supplier.address, supplier.contact, doc.unitName].filter(Boolean).join('\n'), 105, 279, width - 24, 'center');
      pdf.text(pagination, right, 291, { align: 'right' });
    } else if (pageLayout === 'red') {
      pdf.setFillColor(30, 32, 32); pdf.triangle(163, 0, 210, 0, 210, 32, 'F');
      pdf.setFillColor(...pageAccent); pdf.triangle(177, 0, 210, 23, 210, 40, 'F');
      if (p > 1) {
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11);
        pdf.text(title, left, 12);
        pdf.setTextColor(30, 32, 32); pdf.setFontSize(8);
        footerText(supplier.name, left, 20, 145);
      }
      pdf.setFillColor(30, 32, 32); pdf.rect(0, 273, 210, 24, 'F');
      pdf.setFillColor(...pageAccent); pdf.triangle(0, 273, 0, 297, 22, 297, 'F');
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(255, 255, 255);
      footerText([taxId, supplier.address, supplier.contact].filter(Boolean).join('\n'), 25, 279, 111);
      footerText(doc.unitName, right, 279, 55, 'right');
      pdf.setFont('helvetica', 'bold'); pdf.text(pagination, right, 292, { align: 'right' });
    } else if (pageLayout === 'nobre') {
      pdf.rect(left, 7, 36, 1.4, 'F');
      if (p > 1) {
        addLogo(left, 11, 32, 14);
        pdf.setTextColor(25, 65, 60); pdf.setFont('helvetica', 'bold');
        footerText(supplier.name, right, 15, 140, 'right');
        pdf.text(title, right, 24, { align: 'right' });
      }
      pdf.rect(left, 272, width, 1.2, 'F');
      pdf.setTextColor(25, 65, 60); pdf.setFontSize(7); pdf.setFont('helvetica', 'normal');
      footerText([taxId, supplier.contact].filter(Boolean).join('\n'), left, 279, 94);
      footerText(doc.unitName, right, 279, 81, 'right');
      pdf.text(pagination, right, 291, { align: 'right' });
    } else if (pageLayout === 'lm') {
      pdf.rect(0, 0, 210, 6, 'F');
      if (p > 1) {
        pdf.setFont('helvetica', 'bold');
        footerText(supplier.name, left, 16, width - 50);
        pdf.text(title, right, 16, { align: 'right' });
        pdf.line(left, 25, right, 25);
      }
      pdf.roundedRect(174, 274, 22, 14, 2, 2, 'F');
      pdf.setFontSize(7);
      footerText([taxId, doc.unitName, supplier.contact].filter(Boolean).join('\n'), left, 278, 151);
      pdf.setTextColor(255, 255, 255); pdf.text(pagination, 185, 282, { align: 'center' });
    } else if (pageLayout === 'caninde') {
      if (p > 1) {
        pdf.rect(left, 9, 1.5, 16, 'F');
        pdf.setFont('helvetica', 'bold');
        footerText(supplier.name, 19, 14, width - 5);
        pdf.setFont('helvetica', 'normal'); pdf.text(title, 19, 23);
      }
      pdf.roundedRect(left, 273, width, 19, 2, 2);
      pdf.setFontSize(7);
      footerText([taxId, doc.unitName, supplier.contact].filter(Boolean).join('\n'), 19, 279, 155);
      pdf.text(pagination, 191, 287, { align: 'right' });
    } else {
      if (p > 1) {
        pdf.setFont('helvetica', 'bold'); footerText(supplier.name, right, 12, width, 'right');
        pdf.setFont('helvetica', 'normal'); pdf.text(title, right, 22, { align: 'right' });
      }
      pdf.line(left, 273, right, 273);
      pdf.setFontSize(7); pdf.text(pagination, left, 280);
      footerText([taxId, doc.unitName, supplier.contact].filter(Boolean).join('\n'), right, 280, width - 20, 'right');
    }
  }
  return pdf;
}
