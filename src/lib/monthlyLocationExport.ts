import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type { MonthlyLocationGroup } from './monthlyLocationReport';

interface MonthlyExportScope {
  operation: string;
  monthLabel: string;
  category: string;
  groups: MonthlyLocationGroup[];
}

export function buildMonthlyLocationWorkbook(scope: MonthlyExportScope) {
  const rows = [
    ['RELATÓRIO MENSAL DE PRODUTOS POR LOCAL'],
    ['Operação', scope.operation], ['Mês completo', scope.monthLabel],
    ['Categoria', scope.category], ['Locais com entregas', scope.groups.length], [],
    ['Local', 'Endereço', 'Categoria', 'Produto', 'Unidade', 'Quantidade'],
    ...scope.groups.flatMap(group => group.rows.map(row => [group.name, group.address, row.category, row.product, row.unit, row.quantity])),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [32, 52, 24, 52, 12, 18].map(wch => ({ wch }));
  sheet['!autofilter'] = { ref: `A7:F${rows.length}` };
  for (let i = 7; i < rows.length; i++) sheet[`F${i + 1}`].z = '#,##0.###';
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Produtos por local');
  return workbook;
}

export async function buildMonthlyLocationPdf(
  scope: MonthlyExportScope,
  addHeader: (doc: jsPDF, group: MonthlyLocationGroup, continuation: boolean) => Promise<void>,
) {
  if (!scope.groups.length) throw new Error('Nenhuma entrega encontrada para os filtros selecionados.');
  const doc = new jsPDF();
  for (const [index, group] of scope.groups.entries()) {
    if (index) doc.addPage();
    const firstPage = doc.getNumberOfPages();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    const nameLines = doc.splitTextToSize(group.name, 182) as string[];
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const addressLines = group.address ? doc.splitTextToSize(group.address, 182) as string[] : [];
    const addressY = 39 + nameLines.length * 5;
    const summaryY = addressY + addressLines.length * 3.5 + 2;
    const tableY = summaryY + 5;
    autoTable(doc, {
      startY: tableY, margin: { top: tableY, bottom: 16, left: 14, right: 14 },
      head: [['Categoria', 'Produto', 'Unidade', 'Quantidade']],
      body: group.rows.map(row => [row.category, row.product, row.unit, row.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 })]),
      theme: 'striped',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.8, overflow: 'linebreak' },
      headStyles: { fillColor: [19, 55, 71], textColor: [255, 255, 255] },
      columnStyles: { 0: { cellWidth: 38 }, 2: { cellWidth: 20 }, 3: { cellWidth: 28, halign: 'right' } },
    });
    const lastPage = doc.getNumberOfPages();
    for (let page = firstPage; page <= lastPage; page++) {
      doc.setPage(page);
      await addHeader(doc, group, page > firstPage);
      doc.setTextColor(19, 55, 71);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(nameLines, 14, 39);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      if (addressLines.length) doc.text(addressLines, 14, addressY);
      doc.text(`${group.orderCount} pedido(s) | ${group.deliveryCount} entrega(s) | ${scope.monthLabel}`, 14, summaryY);
    }
    doc.setPage(lastPage);
  }
  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page++) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(`Página ${page} de ${totalPages}`, 196, 289, { align: 'right' });
  }
  return doc;
}
