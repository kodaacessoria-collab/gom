import type jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import referenceUrl from '../assets/caninde-logo.png';
import { BASIC_BASKET_COMPOSITION } from './basicBasket';

const navy: [number, number, number] = [19, 55, 71];
const quantity = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const date = (value?: string) => value ? value.split('-').reverse().join('/') : '____/____/________';
let referenceData: string | undefined;

export async function addCanindeHeader(doc: jsPDF, options: { title: string; subtitle?: string; footer?: string }) {
  if (!referenceData) {
    const response = await fetch(referenceUrl);
    if (!response.ok) throw new Error('Não foi possível carregar o timbre Canindé.');
    const blob = await response.blob();
    referenceData = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  const width = doc.internal.pageSize.getWidth();
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, width, 34, 'F');
  doc.addImage(referenceData, 'PNG', 12, 5, 66, 19);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...navy);
  const titleLines = doc.splitTextToSize(options.title, width - 96);
  doc.text(titleLines, width - 13, 10, { align: 'right' });
  doc.setDrawColor(236, 124, 38);
  doc.setLineWidth(0.6);
  doc.line(13, 26, width - 13, 26);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  if (options.subtitle) doc.text(options.subtitle, 14, 30, { maxWidth: width - 28 });
  if (options.footer) doc.text(options.footer, 14, 34, { maxWidth: width - 28 });
  doc.setTextColor(31, 41, 55);
}

export interface BasketInvoice {
  number: string;
  series: string;
  issuedAt: string;
  collaborationTerm: string;
}

export const emptyBasketInvoice: BasketInvoice = { number: '', series: '', issuedAt: '', collaborationTerm: '' };

export async function addCanindeDelivery(doc: jsPDF, data: {
  location: string; address: string; competence: string; control: string;
  deliveryDate: string; receiverCnpj?: string; notes?: string;
  invoice?: BasketInvoice;
  items: { product: string; unit: string; quantity: number; notes?: string }[];
}) {
  await addCanindeHeader(doc, { title: 'ROMANEIO DE ENTREGA' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(...navy);
  const locationLines = doc.splitTextToSize(data.location, 180) as string[];
  const locationExtra = (locationLines.length - 1) * 7;
  doc.text(locationLines, 14, 36);
  doc.setFontSize(9);
  doc.text(`COMPETÊNCIA: ${data.competence || '-'}`, 14, 45 + locationExtra);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const addressLines = doc.splitTextToSize(data.address || 'Endereço: não cadastrado', 180) as string[];
  doc.text(addressLines, 14, 51 + locationExtra);
  const offset = locationExtra + (addressLines.length - 1) * 4;
  doc.setFillColor(243, 244, 247);
  doc.roundedRect(14, 61 + offset, 182, 25, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.text(`NF-e: ${data.invoice?.number || '________'} | Série: ${data.invoice?.series || '____'} | Emissão: ${date(data.invoice?.issuedAt)}`, 17, 67 + offset);
  doc.text(`CNPJ RECEBEDOR - IGEVE: ${data.receiverCnpj || '________________________'}`, 17, 74 + offset);
  doc.text(`TERMO DE COLABORAÇÃO: ${data.invoice?.collaborationTerm || '________________________'}`, 17, 81 + offset);
  const baskets = data.items.reduce((sum, item) => sum + item.quantity, 0);
  const labels = ['DATA DA ENTREGA', 'HORÁRIO', 'CESTAS NA NF', 'CESTAS NO ROMANEIO'];
  const values = [date(data.deliveryDate), '____:____', '________', quantity(baskets)];
  labels.forEach((label, index) => {
    const x = 14 + index * 46;
    doc.setFillColor(241, 245, 247);
    doc.roundedRect(x, 90 + offset, 44, 16, 1.5, 1.5, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(label, x + 3, 95 + offset);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(values[index], x + 3, 102 + offset);
  });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('COMPOSIÇÃO DA CESTA E QUANTITATIVO RECEBIDO', 14, 114 + offset);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Quantidade do romaneio: ${quantity(baskets)} cesta(s) | Controle: ${data.control}`, 14, 120 + offset);
  autoTable(doc, {
    startY: 124 + offset,
    head: [['ITEM', 'PRODUTO / APRESENTAÇÃO', 'POR CESTA', 'TOTAL RECEBIDO']],
    body: BASIC_BASKET_COMPOSITION.map(([product, count], index) => [
      index + 1, product, `${count} ${index === 0 ? 'kg' : 'un.'}`,
      `${quantity(count * baskets)} ${index === 0 ? 'kg' : 'un.'}`,
    ]),
    theme: 'striped',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.1, textColor: navy },
    headStyles: { fillColor: navy, textColor: [255, 255, 255], fontSize: 7, minCellHeight: 8 },
    alternateRowStyles: { fillColor: [241, 245, 247] },
    columnStyles: { 0: { cellWidth: 12, halign: 'center' }, 2: { cellWidth: 30, halign: 'center' }, 3: { cellWidth: 38, halign: 'center' } },
    margin: { left: 14, right: 14 },
  });
  let y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  const notes = [data.notes, ...data.items.map(item => item.notes)].filter(Boolean).join(' | ');
  if (notes) {
    autoTable(doc, { startY: y, body: [[`Observações: ${notes}`]], styles: { font: 'helvetica', fontSize: 8, fillColor: [243, 244, 247] }, margin: { left: 14, right: 14 } });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }
  if (y + 56 > 283) { doc.addPage(); await addCanindeHeader(doc, { title: 'CONFIRMAÇÃO DE RECEBIMENTO', subtitle: data.location }); y = 44; }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...navy);
  doc.text('RECEBEDOR INSTITUCIONAL', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.text('Instituto de Gestão, Educação e Valorização do Ensino - IGEVE', 14, y + 6);
  doc.text('Representante (nome/função): __________________________________________________', 14, y + 16);
  doc.text('Documento: __________________________________________________________________', 14, y + 24);
  doc.setDrawColor(150, 150, 150);
  doc.line(50, y + 40, 160, y + 40);
  doc.setFont('helvetica', 'bold');
  doc.text('Assinatura do representante do IGEVE', 105, y + 45, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.text('Data da assinatura: ____/____/________', 14, y + 53);
}
