import { useState } from 'react';
import { importNfePdf } from '../lib/nfePdfImport';
import { billingOperationPriceKey, billingProductName, parseBillingPrice } from '../lib/igeveBilling';
import type { BillingOperation, BillingPriceEntry } from '../lib/igeveBilling';
import { downloadIgevePriceWorkbook, readIgevePriceWorkbook } from '../lib/igevePriceWorkbook';

interface Props {
  operations: BillingOperation[]; categories: string[]; catalog: BillingPriceEntry[]; busy: boolean;
  onApply: (entries: BillingPriceEntry[]) => void;
  onSaveExcel: (entries: BillingPriceEntry[]) => void;
}
type ImportFormat = 'pdf' | 'excel';
interface PriceImportPreview {
  format: ImportFormat;
  source: NonNullable<BillingPriceEntry['source']>;
  items: { id: string; product: string; unit: string; price: number }[];
  warnings: string[];
}
export default function IgevePriceImport({ operations, categories, catalog, busy, onApply, onSaveExcel }: Props) {
  const [operationId, setOperation] = useState('');
  const [category, setCategory] = useState('');
  const [doc, setDoc] = useState<PriceImportPreview | null>(null);
  const [loading, setLoading] = useState<ImportFormat | null>(null);
  const [message, setMessage] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const destination = { operation: operations.find(op => op.id === operationId)?.name || '', category };
  const targets = catalog.filter(row => row.operationId === operationId && row.category === category);
  const targetsByKey = new Map(targets.map(row => [row.key, row]));
  const targetKey = (item: PriceImportPreview['items'][number]) => {
    if (mapping[item.id]) return mapping[item.id];
    const key = billingOperationPriceKey(operationId, category, item.product, item.unit);
    return targetsByKey.has(key) ? key : doc?.format === 'excel' ? 'skip' : 'new';
  };
  async function read(file: File, format: ImportFormat) {
    setLoading(format); setMessage(''); setDoc(null); setConfirmed(false); setMapping({});
    try {
      let preview: PriceImportPreview;
      if (format === 'excel') {
        const buffer = await file.arrayBuffer();
        const result = readIgevePriceWorkbook(buffer, destination);
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        preview = { format, ...result, source: { filename: file.name, hash, invoice: '', importedAt: new Date().toISOString(), format } };
      } else {
        const { document, warnings } = await importNfePdf(file);
        preview = { format, items: document.items, warnings, source: { filename: document.sourceName, hash: document.sourceHash, invoice: document.number, importedAt: document.importedAt } };
      }
      setDoc(preview);
      setValues(Object.fromEntries(preview.items.map(item => [item.id, String(item.price)])));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível ler o arquivo.'); }
    finally { setLoading(null); }
  }
  function resetDestination() {
    setMapping({}); setConfirmed(false);
    if (doc?.format === 'excel') {
      setDoc(null);
      setMessage('Selecione a planilha novamente para conferir a nova tabela de destino.');
    }
  }
  function apply() {
    try {
      if (!doc || !operations.some(op => op.id === operationId) || !categories.includes(category) || !confirmed) throw new Error('Escolha a tabela e confirme a conferência.');
      const entries = doc.items.filter(item => targetKey(item) !== 'skip').map(item => {
        const target = targetsByKey.get(targetKey(item));
        const price = parseBillingPrice(values[item.id] ?? '');
        if (price === null) throw new Error(`Informe o preço de ${item.product}.`);
        return { key: billingOperationPriceKey(operationId, category, target?.product || item.product, target?.unit || item.unit), operationId, category, product: billingProductName(target?.product || item.product), unit: target?.unit || item.unit, salePrice: price, identityVersion: 1 as const,
          source: doc.source };
      });
      if (!entries.length) throw new Error('Selecione ao menos um produto.');
      if (new Set(entries.map(entry => entry.key)).size !== entries.length) throw new Error('Há itens destinados ao mesmo produto. Ignore a repetição ou escolha produtos diferentes.');
      if (doc.format === 'excel') {
        onSaveExcel(entries);
        setMessage('');
      } else {
        onApply(entries);
        setMessage(`${entries.length} preço(s) preparado(s). Clique em Salvar preços para concluir.`);
      }
      setDoc(null); setConfirmed(false);
    } catch (error) { setMessage((error as Error).message); }
  }
  const unmatched = doc?.format === 'excel' ? doc.items.filter(item => !mapping[item.id] && targetKey(item) === 'skip').length : 0;
  return <section className="card igeve-panel">
    <h3>Importar preços de venda</h3>
    <p>Selecione a operação e a categoria. Para Excel, use as colunas Produto, Unidade e Preço unitário (R$). O modelo já traz os produtos da tabela selecionada.</p>
    <fieldset disabled={busy || loading !== null} className="igeve-document-fieldset">
      <div className="igeve-filters"><label>Operação da tabela de destino<select className="input-field" value={operationId} onChange={e => { setOperation(e.target.value); resetDestination(); }}><option value="">Selecione a operação</option>{operations.map(op => <option key={op.id} value={op.id}>{op.name}</option>)}</select></label>
      <label>Categoria da tabela de destino<select className="input-field" value={category} onChange={e => { setCategory(e.target.value); resetDestination(); }}><option value="">Selecione a categoria</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label></div>
      <div className="igeve-actions">
        <label className="button button-outline">Selecionar Excel<input className="igeve-file-input" aria-label="Excel para preços de venda" type="file" accept=".xlsx,.xls" disabled={!operationId || !category} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void read(file, 'excel'); }} /></label>
        <button type="button" className="button button-outline" disabled={!operationId || !category} onClick={() => downloadIgevePriceWorkbook(targets, destination)}>Baixar modelo Excel</button>
        <label className="button button-outline">Selecionar NF-e em PDF<input className="igeve-file-input" aria-label="PDF para preços de venda" type="file" accept="application/pdf,.pdf" disabled={!operationId || !category} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void read(file, 'pdf'); }} /></label>
      </div>
      {doc && <><p><strong>{destination.operation} / {category}</strong><br />{doc.source.filename}{doc.format === 'pdf' && ` | NF-e ${doc.source.invoice || 'não identificada'}`}</p>
        {doc.warnings.length > 0 && <details><summary>{doc.warnings.length} aviso(s) da importação</summary><ul>{doc.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
        {unmatched > 0 && <p>{unmatched} produto(s) sem correspondência. Selecione um produto da tabela ou escolha cadastrá-lo para incluí-lo na importação.</p>}
        <div className="table-container"><table><thead><tr><th>Produto do arquivo</th><th>Unidade</th><th>Produto na tabela</th><th>Preço de venda (R$)</th></tr></thead><tbody>{doc.items.map(item => <tr key={item.id}><td>{billingProductName(item.product)}</td><td>{item.unit}</td><td><select aria-label={`Destino ${item.product}`} className="input-field" value={targetKey(item)} onChange={e => { setMapping(current => ({ ...current, [item.id]: e.target.value })); setConfirmed(false); }}><option value="new">Cadastrar como novo produto</option><option value="skip">Ignorar item</option>{targets.map(row => <option key={row.key} value={row.key}>{row.product} / {row.unit}{row.salePrice === null ? '' : ` - atual R$ ${row.salePrice.toFixed(2)}`}</option>)}</select></td><td><input className="input-field" aria-label={`Preço importado ${item.product}`} type="number" min="0" step="0.01" value={values[item.id] ?? ''} onChange={e => { setValues(current => ({ ...current, [item.id]: e.target.value })); setConfirmed(false); }} /></td></tr>)}</tbody></table></div>
        <label className="igeve-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Conferi {doc.format === 'pdf' ? 'o PDF' : 'a planilha'}, a tabela de destino, as unidades e os preços. Os preços selecionados substituem os valores anteriores ao salvar.</label>
        <div className="igeve-actions"><button type="button" className="button" disabled={!confirmed || !operationId || !category || !doc.items.length} onClick={apply}>{doc.format === 'excel' ? 'Salvar preços importados' : 'Aplicar à tabela para revisão'}</button><button type="button" className="button button-outline" onClick={() => setDoc(null)}>Cancelar importação</button></div>
      </>}
    </fieldset>
    {loading && <p role="status">{loading === 'pdf' ? 'Lendo o PDF...' : 'Lendo a planilha...'}</p>}{message && <p role="status">{message}</p>}
  </section>;
}
