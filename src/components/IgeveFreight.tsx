import { useState } from 'react';
import { allocateFilteredFreight, freightKey, freightSourceInvoices } from '../lib/igeveFreight';
import type { BillingFreight, FreightSource, SavedFreight } from '../lib/igeveFreight';
import { lineTotal } from '../lib/igeveBilling';
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const quantityLabel = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
interface Props { source: FreightSource; scope: Omit<BillingFreight, 'key' | 'amount'>; saved: SavedFreight[]; busy: boolean; detailed: boolean; onSave: (freight: BillingFreight, version: string | null) => Promise<boolean> }
export default function IgeveFreight({ source, scope, saved, busy, detailed, onSave }: Props) {
  const key = freightKey(scope.operationId, scope.categories, scope.start, scope.end);
  const previous = saved.find(row => row.freight.key === key);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const value = edits[key] ?? (previous ? String(previous.freight.amount) : '');
  const invoices = freightSourceInvoices(source, scope);
  let error = '';
  let preview = allocateFilteredFreight(invoices, 0);
  try { preview = allocateFilteredFreight(invoices, Number(value)); } catch (reason) { error = reason instanceof Error ? reason.message : 'Frete inválido.'; }
  const validPeriod = !scope.start || !scope.end || scope.start <= scope.end;
  const canSave = !busy && !!scope.operationId && !!invoices.length && !!preview.quantity && validPeriod && value !== '' && !error;
  const save = async () => {
    if (!canSave) return;
    if (await onSave({ ...scope, key, amount: Number(value) }, previous?.version || null)) setEdits(current => { const next = { ...current }; delete next[key]; return next; });
  };
  return <div className="card igeve-panel igeve-freight-batch">
    <h2>Frete de todos os romaneios filtrados</h2>
    <p>O frete informado abaixo é único para todos os locais, categorias e romaneios encontrados pelos filtros de operação e período de entrega.</p>
    <div className="igeve-filters"><label>Valor total do frete (R$)<input className="input-field" type="number" min="0" step="0.01" value={value} placeholder="0,00" disabled={busy} onChange={event => setEdits(current => ({ ...current, [key]: event.target.value }))} /></label>
      <div><span>Romaneios filtrados</span><strong>{invoices.length}</strong></div><div><span>Quantidade total de itens</span><strong>{quantityLabel(preview.quantity)}</strong></div><div><span>Frete por unidade</span><strong>{preview.unitFreight.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 6 })}</strong></div></div>
    <p>Exemplo: R$ 200 de frete ÷ 1.000 itens em todos os romaneios = R$ 0,20 por unidade. A quantidade faturada de cada produto define sua parcela, com ajuste dos centavos para fechar o total.</p>
    {!scope.operationId && <p role="status">Selecione uma operação para salvar o frete.</p>}
    {!invoices.length && <p>Nenhum romaneio encontrado para os filtros de entrega.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="igeve-actions"><button type="button" className="button" disabled={!canSave} onClick={() => void save()}>{previous ? 'Atualizar rateio dos romaneios filtrados' : 'Salvar frete dos romaneios filtrados'}</button>{previous && <button type="button" className="button button-outline" disabled={busy} onClick={() => void onSave({ ...previous.freight, amount: 0 }, previous.version)}>Remover frete deste conjunto</button>}</div>
    {previous && <p role="status">Frete salvo para estes filtros: {money(previous.freight.amount)}. Alterar os filtros apenas muda a consulta. Para retirar um rateio salvo, use Remover frete deste conjunto.</p>}
    {detailed && <div className="table-container"><table><thead><tr><th>Controle / local</th><th>Categoria</th><th>Produto</th><th>Qtd. faturada</th><th>Frete rateado</th><th>Custo unitário final</th><th>Total com frete</th></tr></thead><tbody>{preview.rows.map(({ invoice, item, cents }, index) => <tr key={`${invoice.id}-${index}`}><td>{invoice.control}<br />{invoice.destination}</td><td>{item.category || invoice.category}</td><td>{item.product}</td><td>{quantityLabel(item.billedQuantity ?? item.quantity)}</td><td>{money(cents / 100)}</td><td>{((item.billedQuantity ?? item.quantity) > 0 ? item.price + cents / 100 / (item.billedQuantity ?? item.quantity) : item.price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 6 })}</td><td>{money(lineTotal(item) + cents / 100)}</td></tr>)}</tbody><tfoot><tr><th colSpan={3}>Total dos romaneios filtrados</th><th>{quantityLabel(preview.quantity)}</th><th>{money(preview.rows.reduce((sum, row) => sum + row.cents, 0) / 100)}</th><th /><th>{money(preview.rows.reduce((sum, row) => sum + Math.round(lineTotal(row.item) * 100) + row.cents, 0) / 100)}</th></tr></tfoot></table></div>}
  </div>;
}
