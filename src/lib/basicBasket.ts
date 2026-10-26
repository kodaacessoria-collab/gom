import type jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export const BASIC_BASKET_CATEGORY = 'CESTA BASICA';
export const BASIC_BASKET_COMPOSITION = [
  ['ARROZ PARBOLIZADO 1', 3],
  ['ACUCAR TIPO 1', 2],
  ['FEIJAO CARIOQUINA', 2],
  ['FARINHA DE MANDIOCA', 2],
  ['OLEO LIZA 900ML', 2],
  ['FLOCAO CORINGA 500G', 3],
  ['SARDINHA DE TOMATE TIPO 01', 2],
  ['MACARRAO ESPAGUETE', 3],
  ['SAL', 1],
  ['FARINHA DE TRIGO', 1],
  ['BISCOITO RECHEADO 90G', 2],
  ['MILHO E ERVILHA', 2],
  ['EXTRATO DE TOMATE', 1],
  ['LEITE SOL 200G', 1],
  ['FIAMBRE 320G', 1],
  ['EMBALAGEM', 1],
] as const;

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();

export const isMaceioBasicBasket = (
  operation: { id: string; city: string; name: string } | undefined,
  order: { category: string },
) => Boolean(operation && normalize(order.category) === BASIC_BASKET_CATEGORY && (
  normalize(operation.id) === 'MACEIO' || normalize(operation.city) === 'MACEIO' ||
  normalize(operation.name) === 'OPERACAO MACEIO'
));

export const addBasicBasketComposition = (doc: jsPDF, startY: number) => {
  if (startY + 115 > doc.internal.pageSize.getHeight() - 14) {
    doc.addPage();
    startY = 20;
  }
  doc.setFont('courier', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text('CESTA BASICA - MACEIO - COMPOSICAO DE CADA CESTA', 14, startY);
  autoTable(doc, {
    startY: startY + 4,
    head: [['Descrição do produto', 'Un.', 'Qtde. por cesta']],
    body: BASIC_BASKET_COMPOSITION.map(([product, quantity]) => [product, 'UN', quantity.toFixed(2).replace('.', ',')]),
    theme: 'striped',
    styles: { font: 'courier', fontSize: 9, cellPadding: 1.2 },
    headStyles: { fillColor: [31, 58, 79], fontStyle: 'bold' },
    columnStyles: { 1: { cellWidth: 18 }, 2: { cellWidth: 38, halign: 'right' } },
    margin: { left: 14, right: 14 },
  });
  return (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
};
