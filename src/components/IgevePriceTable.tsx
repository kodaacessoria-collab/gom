import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { FileDown, Save } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { normalizeBillingText } from '../lib/igeveBilling';
import type { BillingPriceEntry } from '../lib/igeveBilling';

interface Props {
  rows: (BillingPriceEntry & { operation: string })[];
  edits: Record<string, string>;
  busy: boolean;
  onEdit: (key: string, value: string) => void;
  onSave: (event: FormEvent) => void;
  onCancel: () => void;
  header: (column: string, label: string) => ReactNode;
}

const priceStatuses = {
  all: { label: 'Todos os produtos', file: 'lista-de-precos' },
  priced: { label: 'Com preço cadastrado', file: 'produtos-com-preco' },
  pending: { label: 'Sem preço cadastrado', file: 'produtos-sem-preco' },
};
type PriceStatus = keyof typeof priceStatuses;
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function downloadPriceList(rows: Props['rows'], status: PriceStatus, hasEdits: boolean) {
  const pdf = new jsPDF({ orientation: 'landscape', format: 'a4' });
  const title = 'Faturamento IGEVE | Lista de preços';
  pdf.setProperties({ title });
  autoTable(pdf, {
    margin: { top: hasEdits ? 35 : 29, right: 14, bottom: 16, left: 14 },
    head: [['Operação', 'Categoria', 'Produto', 'Unidade', 'Preço unitário', 'Situação']],
    body: rows.map(row => [
      row.operation, row.category, row.product, row.unit,
      row.salePrice === null ? '' : currency.format(row.salePrice),
      row.salePrice === null ? 'Pendente' : 'Cadastrado',
    ]),
    styles: { fontSize: 9, overflow: 'linebreak' },
    headStyles: { fillColor: [30, 41, 59] },
    columnStyles: { 4: { halign: 'right' } },
    rowPageBreak: 'avoid',
    willDrawPage: () => {
      pdf.setTextColor(30, 41, 59);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(16);
      pdf.text(title, 14, 15);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.text(`${priceStatuses[status].label} | ${rows.length} produto(s)`, 14, 22);
      if (hasEdits) pdf.text('Há alterações não salvas na tabela. Confira os preços antes de usar este relatório.', 14, 28);
    },
  });
  const totalPages = pdf.getNumberOfPages();
  for (let page = 1; page <= totalPages; page++) {
    pdf.setPage(page);
    pdf.setFontSize(8);
    pdf.setTextColor(71, 85, 105);
    pdf.text(`Página ${page} de ${totalPages}`, 283, 202, { align: 'right' });
  }
  pdf.save(`igeve-${priceStatuses[status].file}.pdf`);
}

export default function IgevePriceTable({ rows, edits, busy, onEdit, onSave, onCancel, header }: Props) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PriceStatus>('all');
  const searchTerm = normalizeBillingText(search);
  const visible = rows.filter(row => normalizeBillingText(row.product).includes(searchTerm)
    && (status === 'all' || (row.salePrice === null ? status === 'pending' : status === 'priced')));
  const changed = Object.keys(edits).length;
  return <form className="card igeve-panel igeve-price-table" onSubmit={onSave}>
    <div className="igeve-heading"><div><h2>Tabela de preços por operação</h2><p>Produtos dos romaneios cadastrados automaticamente por operação e categoria, de todo o histórico. Preencha os preços e salve para usar nos novos faturamentos.</p></div>
      <div className="igeve-actions">
        <button type="button" className="button button-outline" disabled={busy || !visible.length} onClick={() => downloadPriceList(visible, status, visible.some(row => Object.hasOwn(edits, row.key)))}><FileDown size={18} /> Baixar PDF</button>
        <button type="submit" className="button" disabled={busy || !changed}><Save size={18} /> Salvar preços{changed ? ` (${changed})` : ''}</button>
        <button type="button" className="button button-outline" disabled={busy || !changed} onClick={onCancel}>Cancelar alterações</button>
      </div>
    </div>
    <div className="igeve-filters">
      <label>Buscar produto<input type="search" className="input-field" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nome do produto" /></label>
      <label>Situação<select className="input-field" value={status} onChange={event => setStatus(event.target.value as PriceStatus)}>
        {Object.entries(priceStatuses).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
      </select></label>
    </div>
    <p>{visible.length} produto(s) listado(s). Preço em branco significa pendente; zero é um preço cadastrado. Alterações não salvas permanecem disponíveis ao trocar de aba.</p>
    <div className="table-container"><table><thead><tr>{header('operation', 'Operação')}{header('category', 'Categoria')}{header('product', 'Produto')}{header('unit', 'Unidade')}{header('price', 'Preço unitário (R$)')}{header('status', 'Situação')}<th>Origem do preço</th></tr></thead><tbody>
      {visible.map(row => <tr key={row.key}><td>{row.operation}</td><td>{row.category}</td><td>{row.product}</td><td>{row.unit}</td><td><input aria-label={`Preço ${row.operation} / ${row.category} / ${row.product} / ${row.unit}`} className="input-field igeve-price-input" type="number" min="0" step="0.01" placeholder="A preencher" value={edits[row.key] ?? (row.salePrice === null ? '' : String(row.salePrice))} disabled={busy} onChange={event => onEdit(row.key, event.target.value)} /></td><td>{Object.hasOwn(edits, row.key) ? 'Alteração não salva' : row.salePrice === null ? 'Pendente' : 'Cadastrado'}</td><td>{row.source?.format === 'excel' ? `Excel | ${row.source.filename}` : row.source ? `${row.source.filename} | NF-e ${row.source.invoice || 'não identificada'}` : 'Manual'}</td></tr>)}
      {!visible.length && <tr><td colSpan={7}>Nenhum produto encontrado. Confira os filtros ou cadastre romaneios para a operação.</td></tr>}
    </tbody></table></div>
  </form>;
}
