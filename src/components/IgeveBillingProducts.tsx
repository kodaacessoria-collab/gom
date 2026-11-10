import { useState } from 'react';
import { Plus } from 'lucide-react';
import { normalizeBillingText } from '../lib/igeveBilling';
import type { BillingPriceEntry } from '../lib/igeveBilling';

interface Props {
  entries: BillingPriceEntry[];
  busy: boolean;
  adjustable: boolean;
  onAdd: (key: string, quantity: number) => boolean;
}

export default function IgeveBillingProducts({ entries, busy, adjustable, onAdd }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const [quantity, setQuantity] = useState('1');
  const visible = entries.filter(entry => normalizeBillingText(`${entry.product} ${entry.category} ${entry.unit}`).includes(normalizeBillingText(search)));
  const entry = visible.find(entry => entry.key === selected);
  return <div className="igeve-add-products">
    <button type="button" className="button button-outline" disabled={busy} aria-expanded={expanded} aria-controls="igeve-add-product-fields" onClick={() => setExpanded(!expanded)}><Plus size={16} /> Adicionar produtos da tabela</button>
    {expanded && <div id="igeve-add-product-fields">
      <p>Busque na tabela salva da operação e das categorias deste faturamento. Produtos já incluídos não aparecem na seleção.</p>
      {adjustable && <p>O produto será incluído com quantidade entregue zero. A quantidade informada entra como acréscimo no faturamento e no romaneio de ajustes.</p>}
      <div className="igeve-filters">
        <label>Buscar produto na tabela<input type="search" className="input-field" value={search} onChange={event => { setSearch(event.target.value); setSelected(''); }} placeholder="Produto, categoria ou unidade" /></label>
        <label>Produto da tabela<select aria-label="Produto da tabela" className="input-field" value={entry?.key || ''} onChange={event => setSelected(event.target.value)} disabled={busy}>
          <option value="">Selecione um produto</option>
          {visible.map(row => <option key={row.key} value={row.key}>{row.product} · {row.category} · {row.unit} · {row.salePrice === null ? 'Sem preço cadastrado' : row.salePrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</option>)}
        </select></label>
        <label>Quantidade a adicionar<input type="number" className="input-field" min="0.001" step="0.001" value={quantity} onChange={event => setQuantity(event.target.value)} disabled={busy} /></label>
      </div>
      {!visible.length && <p role="status">Nenhum produto disponível. Confira a busca ou cadastre e salve os produtos na Tabela de preços.</p>}
      {entry?.salePrice === null && <p role="status">Este produto está sem preço cadastrado. Informe o preço na linha após adicioná-lo.</p>}
      <button type="button" className="button" disabled={busy || !entry || !quantity} onClick={() => {
        if (entry && onAdd(entry.key, Number(quantity))) { setSelected(''); setQuantity('1'); }
      }}><Plus size={16} /> Incluir produto selecionado</button>
    </div>}
  </div>;
}
