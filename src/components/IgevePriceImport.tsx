import { useState } from 'react';
import { importNfePdf } from '../lib/nfePdfImport';
import { billingOperationPriceKey, normalizeBillingText, parseBillingPrice } from '../lib/igeveBilling';
import type { BillingOperation, BillingPriceEntry } from '../lib/igeveBilling';
import type { NfeDocument } from '../lib/igeveDocuments';

interface Props {
  operations: BillingOperation[]; categories: string[]; catalog: BillingPriceEntry[]; busy: boolean;
  onApply: (entries: BillingPriceEntry[]) => void;
}
export default function IgevePriceImport({ operations, categories, catalog, busy, onApply }: Props) {
  const [operationId, setOperation] = useState('');
  const [category, setCategory] = useState('');
  const [doc, setDoc] = useState<NfeDocument | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const targets = catalog.filter(row => row.operationId === operationId && row.category === category);
  const targetKey = (id: string) => mapping[id] ?? (() => {
    const item = doc!.items.find(item => item.id === id)!;
    return targets.find(row => normalizeBillingText(row.product) === normalizeBillingText(item.product) && normalizeBillingText(row.unit) === normalizeBillingText(item.unit))?.key || 'new';
  })();
  async function read(file: File) {
    setLoading(true); setMessage(''); setDoc(null); setConfirmed(false); setMapping({});
    try {
      const result = await importNfePdf(file); setDoc(result.document); setWarnings(result.warnings);
      setValues(Object.fromEntries(result.document.items.map(item => [item.id, String(item.price)])));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível importar o PDF.'); }
    finally { setLoading(false); }
  }
  function apply() {
    try {
      if (!doc || !operations.some(op => op.id === operationId) || !categories.includes(category) || !confirmed) throw new Error('Escolha a tabela e confirme a conferência.');
      const entries = doc.items.filter(item => targetKey(item.id) !== 'skip').map(item => {
        const target = targets.find(row => row.key === targetKey(item.id));
        const price = parseBillingPrice(values[item.id] ?? '');
        if (price === null) throw new Error(`Informe o preço de ${item.product}.`);
        return { key: billingOperationPriceKey(operationId, category, target?.product || item.product, target?.unit || item.unit), operationId, category, product: target?.product || item.product, unit: target?.unit || item.unit, salePrice: price,
          source: { filename: doc.sourceName, hash: doc.sourceHash, invoice: doc.number, importedAt: doc.importedAt } };
      });
      if (!entries.length) throw new Error('Selecione ao menos um produto.');
      if (new Set(entries.map(entry => entry.key)).size !== entries.length) throw new Error('Há itens destinados ao mesmo produto. Ignore a repetição ou escolha produtos diferentes.');
      onApply(entries); setDoc(null); setConfirmed(false); setMessage(`${entries.length} preço(s) preparado(s). Clique em Salvar preços para concluir.`);
    } catch (error) { setMessage((error as Error).message); }
  }
  return <section className="card igeve-panel">
    <h3>Importar preços de venda por NF-e em PDF</h3>
    <p>Informe a tabela de destino (operação e categoria). Os valores unitários da nota serão usados como preços de venda; confira as unidades e associe os produtos antes de salvar.</p>
    <fieldset disabled={busy || loading} className="igeve-document-fieldset">
      <div className="igeve-filters"><label>Operação da tabela de destino<select className="input-field" value={operationId} onChange={e => { setOperation(e.target.value); setMapping({}); setConfirmed(false); }}><option value="">Selecione a operação</option>{operations.map(op => <option key={op.id} value={op.id}>{op.name}</option>)}</select></label>
      <label>Categoria da tabela de destino<select className="input-field" value={category} onChange={e => { setCategory(e.target.value); setMapping({}); setConfirmed(false); }}><option value="">Selecione a categoria</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label></div>
      <label className="button button-outline">Selecionar NF-e em PDF<input className="igeve-file-input" aria-label="PDF para preços de venda" type="file" accept="application/pdf,.pdf" disabled={!operationId || !category} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void read(file); }} /></label>
      {doc && <><p><strong>Tabela: {operations.find(op => op.id === operationId)?.name} / {category}</strong><br />Arquivo: {doc.sourceName} | NF-e: {doc.number || 'não identificada'}</p>
        {warnings.map(warning => <p key={warning} role="note">{warning}</p>)}
        <div className="table-container"><table><thead><tr><th>Produto da nota</th><th>Unidade</th><th>Produto na tabela</th><th>Preço de venda (R$)</th></tr></thead><tbody>{doc.items.map(item => <tr key={item.id}><td>{item.product}</td><td>{item.unit}</td><td><select aria-label={`Destino ${item.product}`} className="input-field" value={targetKey(item.id)} onChange={e => { setMapping(current => ({ ...current, [item.id]: e.target.value })); setConfirmed(false); }}><option value="new">Cadastrar como novo produto</option><option value="skip">Ignorar item</option>{targets.map(row => <option key={row.key} value={row.key}>{row.product} / {row.unit}{row.salePrice === null ? '' : ` - atual R$ ${row.salePrice.toFixed(2)}`}</option>)}</select></td><td><input className="input-field" aria-label={`Preço importado ${item.product}`} type="number" min="0" step="0.01" value={values[item.id] ?? ''} onChange={e => { setValues(current => ({ ...current, [item.id]: e.target.value })); setConfirmed(false); }} /></td></tr>)}</tbody></table></div>
        <label className="igeve-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Conferi o PDF, a tabela de destino, as unidades e os preços. Produtos existentes terão seu preço substituído ao salvar.</label>
        <div className="igeve-actions"><button type="button" className="button" disabled={!confirmed || !operationId || !category || !doc.items.length} onClick={apply}>Aplicar à tabela para revisão</button><button type="button" className="button button-outline" onClick={() => setDoc(null)}>Cancelar importação</button></div>
      </>}
    </fieldset>
    {loading && <p role="status">Lendo o PDF...</p>}{message && <p role="status">{message}</p>}
  </section>;
}
