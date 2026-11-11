import { useState } from 'react';
import type { BillingInvoice, BillingOperation, BillingOrder, BillingPoint, BillingPriceEntry, SavedInvoice } from '../lib/igeveBilling';
import { billingPricesFromEntries, invoiceTotal, lineTotal, normalizeBillingText } from '../lib/igeveBilling';
import { complementSuggestion, createRubricInvoice, reductionSuggestion, RUBRIC_BILLING_CATEGORIES, rubricBalance, rubricCategoryTotals, rubricDiscountNote, rubricProposal, rubricKey, rubricMonthInvoices, rubricOperationKind, rubricScopeInvoices, shiftRubricMonth } from '../lib/igeveRubrics';
import type { MonthlyRubric, SavedRubric } from '../lib/igeveRubrics';
import { readRubricWorkbook } from '../lib/igeveRubricWorkbook';
import type { RubricWorkbookRow } from '../lib/igeveRubricWorkbook';

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
interface Props {
  operations: BillingOperation[]; points: BillingPoint[]; orders: BillingOrder[]; invoices: SavedInvoice[];
  applyFreight: (invoice: BillingInvoice) => BillingInvoice;
  catalog: BillingPriceEntry[]; rubrics: SavedRubric[]; busy: boolean;
  onSave: (rubric: MonthlyRubric, version: string | null) => Promise<boolean>;
  onOpen: (invoice: BillingInvoice, version: string | null) => void;
}
export default function IgeveRubrics({ operations, points, orders, invoices, catalog, rubrics, busy, onSave, onOpen, applyFreight }: Props) {
  const [operationId, setOperationId] = useState('');
  const [pointId, setPointId] = useState('');
  const [complementPoint, setComplementPoint] = useState('');
  const [month, setMonth] = useState(() => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date()).slice(0, 7));
  const [edits, setEdits] = useState<Record<string, MonthlyRubric>>({});
  const [message, setMessage] = useState('');
  const [workbookRows, setWorkbookRows] = useState<RubricWorkbookRow[]>([]);
  const [workbookSelection, setWorkbookSelection] = useState<Record<string, string>>({});
  const operation = operations.find(row => row.id === operationId);
  const byLocal = operation && rubricOperationKind(operation) === 'local';
  const key = rubricKey(operationId, byLocal ? pointId : '', month);
  const stored = rubrics.find(row => row.rubric.key === key);
  const rubric = edits[key] || stored?.rubric || { key, operationId, pointId: byLocal ? pointId : '', month, amount: 0, previousAdjustment: 0, adjustmentNotes: '' };
  const dirty = !!edits[key];
  const valid = !!operation && !!month && (!byLocal || !!pointId);
  const monthInvoices = month ? rubricMonthInvoices(orders, operations, points, billingPricesFromEntries(catalog), invoices.map(row => row.invoice), month).map(applyFreight) : [];
  const scoped = valid ? rubricScopeInvoices(monthInvoices, rubric, orders, points) : [];
  const balance = rubricBalance(rubric, scoped);
  const proposal = rubricProposal(rubric);
  const savedIds = new Set(invoices.map(({ invoice }) => invoice.id));
  const billed = rubricCategoryTotals(scoped.filter(invoice => savedIds.has(invoice.id)));
  const point = points.find(row => row.id === pointId);
  const exactMatches = workbookRows.filter(row => normalizeBillingText(row.school) === normalizeBillingText(point?.name || ''));
  const workbookSchool = workbookSelection[key] ?? (exactMatches.length === 1 ? exactMatches[0].school : '');
  const workbookRow = workbookRows.find(row => row.school === workbookSchool);
  const crossMonth = scoped.some(invoice => invoice.location && (invoice.location.start.slice(0, 7) !== month || invoice.location.end.slice(0, 7) !== month));
  const missingPrices = scoped.flatMap(invoice => invoice.items.filter(item => !catalog.some(entry => entry.operationId === invoice.operationId && entry.category === (item.category || invoice.category) && entry.product === item.product && entry.unit === item.unit && entry.salePrice !== null) && item.price === 0));
  const suggestions = !rubric.proportional && balance.remaining > 0 ? complementSuggestion(catalog, rubric, balance.remaining) : [];
  const suggestedValue = suggestions.reduce((sum, item) => sum + lineTotal(item), 0);
  const previousMonth = month ? shiftRubricMonth(month, -1) : '';
  const carry = invoices.filter(({ invoice }) => invoice.operationId === operationId && invoice.rubric?.month === previousMonth && invoice.rubric.kind === 'reduction' && invoice.rubric.deferred?.length && (!byLocal || rubricScopeInvoices([invoice], rubric, orders, points).length));
  const edit = (patch: Partial<MonthlyRubric>) => setEdits(current => ({ ...current, [key]: { ...rubric, ...patch } }));
  async function loadWorkbook(file: File) {
    setWorkbookRows([]);
    setWorkbookSelection({});
    try {
      const rows = readRubricWorkbook(await file.arrayBuffer());
      setWorkbookRows(rows);
      setMessage(`${rows.length} escola(s) na planilha. Confira o mês e vincule a linha ao local selecionado antes de salvar.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível ler a planilha.');
    }
  }
  const canSuggest = valid && !!stored && !dirty && !busy && !crossMonth && !missingPrices.length;
  const openSupplement = () => {
    if (!operation) return;
    const point = points.find(row => row.id === (byLocal ? pointId : complementPoint) && row.operationId === operationId);
    if (!point) return setMessage('Selecione o local de entrega do complemento.');
    const invoice = createRubricInvoice(rubric, operation, point, suggestions, 'complement');
    const existing = invoices.find(row => row.invoice.id === invoice.id);
    if (existing) return setMessage('Este mês já possui complemento de rubrica. Edite o registro abaixo para ajustar os itens, sem duplicar o complemento.');
    onOpen(invoice, null);
  };
  return <div className="card igeve-panel igeve-rubrics">
    <h2>Rubricas mensais por operação</h2>
    <p>Boituva e Guaianases: uma rubrica para toda a operação. Maceió: uma rubrica individual por local. O cálculo considera o mês completo de entrega, todas as categorias e os complementos, sem duplicar consolidados.</p>
    <div className="igeve-filters">
      <label>Operação da rubrica<select className="input-field" value={operationId} onChange={event => { setOperationId(event.target.value); setPointId(''); setComplementPoint(''); setMessage(''); }}><option value="">Selecione a operação</option>{operations.filter(row => rubricOperationKind(row)).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label>Mês de referência<input type="month" required className="input-field" value={month} onChange={event => { setMonth(event.target.value); setMessage(''); }} /></label>
      {byLocal && <label>Local da rubrica<select className="input-field" value={pointId} onChange={event => { setPointId(event.target.value); setMessage(''); }}><option value="">Selecione o local</option>{points.filter(row => row.operationId === operationId).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
    </div>
    {valid && <>
      <form onSubmit={event => { event.preventDefault(); void (async () => { if (await onSave(rubric, stored?.version || null)) { setEdits(current => { const next = { ...current }; delete next[key]; return next; }); setMessage('Rubrica salva.'); } })(); }}>
        <div className="igeve-filters">
          <label>Rubrica do mês (R$)<input className="input-field" type="number" min="0.01" step="0.01" required value={rubric.amount || ''} onChange={event => edit({ amount: Number(event.target.value) })} /></label>
          <label>Ajuste do faturamento anterior (R$)<input className="input-field" type="number" step="0.01" required value={rubric.previousAdjustment} onChange={event => edit({ previousAdjustment: Number(event.target.value) })} /><small>Positivo consome a rubrica; negativo libera saldo. O ajuste é financeiro e não cria entrega.</small></label>
          <label>Referência / motivo do ajuste<input className="input-field" required={rubric.previousAdjustment !== 0} value={rubric.adjustmentNotes} onChange={event => edit({ adjustmentNotes: event.target.value })} /></label>
        </div>
        {byLocal && <div className="igeve-filters">
          <label>Planilha de rubricas (.xlsx)<input className="input-field" type="file" accept=".xlsx" disabled={busy} onChange={event => {
            const file = event.target.files?.[0];
            if (file) void loadWorkbook(file);
            event.target.value = '';
          }} /></label>
          {!!workbookRows.length && <label>Escola na planilha<select className="input-field" value={workbookSchool} onChange={event => setWorkbookSelection(current => ({ ...current, [key]: event.target.value }))}>
            <option value="">Selecione a escola</option>
            {workbookRows.map(row => <option key={row.school}>{row.school}</option>)}
          </select></label>}
          {workbookRow && <div className="igeve-actions"><button type="button" className="button button-outline" disabled={busy} onClick={() => {
            edit({ amount: workbookRow.amount, proportional: workbookRow.proportional });
            setMessage(`Valores de ${workbookRow.school} carregados para ${point?.name}, mês ${month}. Revise e salve a rubrica.`);
          }}>Carregar valores da escola</button></div>}
        </div>}
        <label><input type="checkbox" checked={!!rubric.proportional} onChange={event => edit({
          proportional: event.target.checked ? { proteinsBilled: 0, bases: { 'Hortifrúti': 0, 'Estocáveis': 0, 'Dietas e Fórmulas': 0 } } : undefined,
        })} /> Ratear a rubrica pelas bases mensais</label>
        {rubric.proportional && <div className="igeve-filters">
          <label>Proteínas já faturadas (R$)<input className="input-field" type="number" min="0" step="0.01" required value={rubric.proportional.proteinsBilled} onChange={event => edit({
            proportional: { ...rubric.proportional!, proteinsBilled: Number(event.target.value) },
          })} /></label>
          {RUBRIC_BILLING_CATEGORIES.map(category => <label key={category}>Base mensal de {category} (R$)<input className="input-field" type="number" min="0" step="0.01" required value={rubric.proportional!.bases[category]} onChange={event => edit({
            proportional: { ...rubric.proportional!, bases: { ...rubric.proportional!.bases, [category]: Number(event.target.value) } },
          })} /></label>)}
        </div>}
        <div className="igeve-actions"><button className="button" disabled={busy || (!!stored && !dirty) || (!!rubric.proportional && !proposal)}>Salvar rubrica mensal</button>{dirty && <button type="button" className="button button-outline" disabled={busy} onClick={() => setEdits(current => { const next = { ...current }; delete next[key]; return next; })}>Descartar alterações</button>}</div>
      </form>
      {rubric.proportional && !proposal && <p role="alert">A referência precisa cobrir as Proteínas já faturadas e o ajuste anterior. Se houver saldo a ratear, informe uma base mensal positiva.</p>}
      {proposal && <div className="table-container"><table>
        <thead><tr><th>Categoria</th><th>Base mensal</th><th>Meta do mês</th><th>Faturado bruto</th><th>Excedente bruto</th></tr></thead>
        <tbody>
          <tr><td>Proteínas</td><td>—</td><td>{money(rubric.proportional!.proteinsBilled)}</td><td>{money(rubric.proportional!.proteinsBilled)}</td><td>—</td></tr>
          {RUBRIC_BILLING_CATEGORIES.map(category => <tr key={category}>
            <td>{category}</td><td>{money(rubric.proportional!.bases[category])}</td><td>{money(proposal[category])}</td>
            <td>{money(billed[category] / 100)}</td><td>{money(Math.max(0, billed[category] - Math.round(proposal[category] * 100)) / 100)}</td>
          </tr>)}
        </tbody>
        <tfoot><tr><th colSpan={2}>Total proposto com ajuste anterior</th><td>{money(rubric.amount)}</td><td colSpan={2} /></tr></tfoot>
      </table></div>}
      <div className="igeve-rubric-summary"><div>Rubrica<strong>{money(rubric.amount)}</strong></div><div>{rubric.proportional ? 'Total previsto com proteínas' : 'Soma dos romaneios'}<strong>{money(balance.total)}</strong></div><div>Com ajuste anterior<strong>{money(balance.used)}</strong></div><div>{balance.remaining < 0 ? 'Ultrapassou' : 'Saldo disponível'}<strong>{money(Math.abs(balance.remaining))}</strong></div></div>
      {!rubric.proportional && <p role="status" className={`igeve-rubric-status ${balance.status}`}>{!stored ? 'Cadastre a rubrica para habilitar as sugestões.' : dirty ? 'Salve as alterações para atualizar as sugestões.' : balance.status === 'exceeded' ? 'A rubrica foi ultrapassada. Revise as reduções sugeridas abaixo.' : balance.status === 'matched' ? 'Faturamento dentro do valor exato da rubrica.' : balance.status === 'near' ? 'Atenção: 90% ou mais da rubrica já foi consumida.' : 'Há saldo disponível para complementar o faturamento.'}</p>}
      {crossMonth && <p role="alert">Há faturamento consolidado abrangendo mais de um mês. Separe esse faturamento por mês antes de ajustar a rubrica. O total exibido inclui o valor integral desse consolidado.</p>}
      {!!missingPrices.length && <p role="alert">{missingPrices.length} item(ns) sem preço definido. Preencha a tabela de preços ou os faturamentos para concluir o cálculo e gerar sugestões.</p>}
      {!rubric.proportional && balance.remaining < 0 && <><h3>Reduções sugeridas</h3><p>Abra um romaneio para revisar a redução. Ao salvar, as quantidades retiradas ficam registradas para o mês seguinte. Unidades inteiras podem deixar saldo residual.</p><div className="igeve-actions">{scoped.filter(invoice => invoiceTotal(invoice) > 0).map(invoice => <button key={invoice.id} className="button button-outline" disabled={!canSuggest || (!!invoice.rubric && invoice.rubric.kind !== 'reduction')} onClick={() => { const suggestion = reductionSuggestion(invoice, -balance.remaining, rubric); onOpen(suggestion, invoices.find(row => row.invoice.id === invoice.id)?.version || null); }}>Revisar redução: {invoice.control} · {invoice.destination} · até {money(Math.min(invoiceTotal(invoice), -balance.remaining))}</button>)}</div></>}
      {!rubric.proportional && balance.remaining > 0 && <><h3>Complemento distribuído por categoria</h3><p>Distribuição entre Hortifrúti, Proteínas, Dietas e Fórmulas e Estocáveis com produtos e preços cadastrados. Categorias sem produtos com preço precisam ser cadastradas. A precisão das quantidades pode deixar saldo residual.</p>
        <div className="table-container"><table><thead><tr><th>Categoria</th><th>Produto</th><th>Quantidade</th><th>Unidade</th><th>Preço</th><th>Total</th></tr></thead><tbody>{suggestions.map(item => <tr key={item.id}><td>{item.category}</td><td>{item.product}</td><td>{item.quantity}</td><td>{item.unit}</td><td>{money(item.price)}</td><td>{money(lineTotal(item))}</td></tr>)}{!suggestions.length && <tr><td colSpan={6}>Nenhuma combinação disponível para o saldo e os preços cadastrados.</td></tr>}</tbody></table></div>
        <p>Complemento sugerido: <strong>{money(suggestedValue)}</strong> · Saldo após a sugestão: {money(balance.remaining - suggestedValue)}</p>
        {!byLocal && <label>Local de entrega do complemento<select className="input-field" value={complementPoint} onChange={event => setComplementPoint(event.target.value)}><option value="">Selecione o local</option>{points.filter(row => row.operationId === operationId).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
        <button className="button" disabled={!canSuggest || !suggestions.length} onClick={openSupplement}>Gerar romaneio complementar para revisão</button>
      </>}
      <h3>Itens reservados do mês anterior</h3>
      {!carry.length && <p>Nenhum item retirado do faturamento de {previousMonth} para este local/operação.</p>}
      {carry.map(({ invoice }) => { const carryInvoice = operation ? createRubricInvoice(rubric, operation, points.find(row => row.id === (byLocal ? pointId : invoice.deliveryPointId)), invoice.rubric!.deferred!, 'carry', invoice.id) : null; const existing = invoices.find(row => row.invoice.id === carryInvoice?.id); return <div key={invoice.id}><p>{invoice.control} · {invoice.destination}: {invoice.rubric!.deferred!.map(item => `${item.product}: ${item.quantity} ${item.unit}`).join('; ')} · {money(invoice.rubric!.deferred!.reduce((sum, item) => sum + lineTotal(item), 0))}</p><button className="button button-outline" disabled={!canSuggest || !carryInvoice} onClick={() => { if (carryInvoice) onOpen(existing?.invoice || { ...carryInvoice, destination: invoice.destination, company: invoice.company, cnpj: invoice.cnpj }, existing?.version || null); }}>{existing ? 'Editar aproveitamento salvo' : 'Preparar aproveitamento neste mês'}</button></div>; })}
      <h3>Romaneios que compõem a rubrica</h3><div className="table-container"><table><thead><tr><th>Controle / local</th><th>Categorias</th><th>Situação</th><th>Total</th><th>Ação</th></tr></thead><tbody>{scoped.map(invoice => { const existing = invoices.find(row => row.invoice.id === invoice.id); return <tr key={invoice.id}><td>{invoice.control}<br />{invoice.destination}</td><td>{invoice.category}</td><td>{existing ? 'Salvo' : 'Estimativa a preparar'}{invoice.rubricDiscount && <><br /><small>{rubricDiscountNote(invoice.rubricDiscount)}</small></>}</td><td>{money(invoiceTotal(invoice))}</td><td><button className="button button-outline" disabled={busy} onClick={() => onOpen(invoice, existing?.version || null)}>{existing ? 'Editar' : 'Preparar faturamento'}</button></td></tr>; })}{!scoped.length && <tr><td colSpan={5}>Nenhum romaneio para este mês e escopo.</td></tr>}</tbody></table></div>
    </>}
    {message && <p role="status">{message}</p>}
  </div>;
}
