import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Save } from 'lucide-react';
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

export default function IgevePriceTable({ rows, edits, busy, onEdit, onSave, onCancel, header }: Props) {
  const [search, setSearch] = useState('');
  const [onlyPending, setOnlyPending] = useState(false);
  const visible = rows.filter(row => normalizeBillingText(row.product).includes(normalizeBillingText(search)) && (!onlyPending || row.salePrice === null));
  const changed = Object.keys(edits).length;
  return <form className="card igeve-panel igeve-price-table" onSubmit={onSave}>
    <div className="igeve-heading"><div><h2>Tabela de preços por operação</h2><p>Produtos dos romaneios cadastrados automaticamente por operação e categoria, de todo o histórico. Preencha os preços e salve para usar nos novos faturamentos.</p></div>
      <div className="igeve-actions"><button type="submit" className="button" disabled={busy || !changed}><Save size={18} /> Salvar preços{changed ? ` (${changed})` : ''}</button><button type="button" className="button button-outline" disabled={busy || !changed} onClick={onCancel}>Cancelar alterações</button></div>
    </div>
    <div className="igeve-filters"><label>Buscar produto<input type="search" className="input-field" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nome do produto" /></label><label>Situação<select className="input-field" value={onlyPending ? 'pending' : 'all'} onChange={event => setOnlyPending(event.target.value === 'pending')}><option value="all">Todos os produtos</option><option value="pending">Sem preço cadastrado</option></select></label></div>
    <p>{visible.length} produto(s) listado(s). Preço em branco significa pendente; zero é um preço cadastrado. Alterações não salvas permanecem disponíveis ao trocar de aba.</p>
    <div className="table-container"><table><thead><tr>{header('operation', 'Operação')}{header('category', 'Categoria')}{header('product', 'Produto')}{header('unit', 'Unidade')}{header('price', 'Preço unitário (R$)')}{header('status', 'Situação')}</tr></thead><tbody>
      {visible.map(row => <tr key={row.key}><td>{row.operation}</td><td>{row.category}</td><td>{row.product}</td><td>{row.unit}</td><td><input aria-label={`Preço ${row.operation} / ${row.category} / ${row.product} / ${row.unit}`} className="input-field igeve-price-input" type="number" min="0" step="0.01" placeholder="A preencher" value={edits[row.key] ?? (row.salePrice === null ? '' : String(row.salePrice))} disabled={busy} onChange={event => onEdit(row.key, event.target.value)} /></td><td>{Object.hasOwn(edits, row.key) ? 'Alteração não salva' : row.salePrice === null ? 'Pendente' : 'Cadastrado'}</td></tr>)}
      {!visible.length && <tr><td colSpan={6}>Nenhum produto encontrado. Confira os filtros ou cadastre romaneios para a operação.</td></tr>}
    </tbody></table></div>
  </form>;
}
