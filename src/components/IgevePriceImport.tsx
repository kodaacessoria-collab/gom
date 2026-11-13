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
  items: { id: string; product: string; unit: string; price: number; category?: string }[];
  warnings: string[];
}
export default function IgevePriceImport({ operations, categories, catalog, busy, onApply, onSaveExcel }: Props) {
  const [operationId, setOperation] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [doc, setDoc] = useState<PriceImportPreview | null>(null);
  const [loading, setLoading] = useState<ImportFormat | null>(null);
  const [message, setMessage] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const destination = {
    operation: operations.find(op => op.id === operationId)?.name || '',
    categories: selectedCategories.filter(category => categories.includes(category)),
  };
  const hasDestination = !!destination.operation && destination.categories.length > 0;
  const targets = catalog.filter(row => row.operationId === operationId && destination.categories.includes(row.category));
  const targetsByKey = new Map(targets.map(row => [row.key, row]));
  const targetsByCategory = new Map(destination.categories.map(category => [
    category, targets.filter(row => row.category === category),
  ]));
  const targetKeys = new Map(doc ? doc.items.map(item => {
    if (mapping[item.id]) return [item.id, mapping[item.id]];
    const itemCategories = item.category ? [item.category] : destination.categories;
    const matches = itemCategories.map(category => billingOperationPriceKey(operationId, category, item.product, item.unit))
      .filter(key => targetsByKey.has(key));
    if (matches.length === 1) return [item.id, matches[0]];
    if (matches.length > 1) return [item.id, ''];
    if (doc.format === 'excel') return [item.id, 'skip'];
    return [item.id, itemCategories.length === 1 ? `new:${itemCategories[0]}` : ''];
  }) : []);
  const needsDestination = [...targetKeys.values()].includes('');
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
      if (!doc || !hasDestination || needsDestination || !confirmed) throw new Error('Escolha os destinos e confirme a conferência.');
      const entries = doc.items.filter(item => targetKeys.get(item.id) !== 'skip').map(item => {
        const key = targetKeys.get(item.id);
        const target = key ? targetsByKey.get(key) : undefined;
        const category = target?.category || (key?.startsWith('new:') ? key.slice(4) : '');
        if (!destination.categories.includes(category)) throw new Error(`Escolha o destino de ${item.product}.`);
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
  const unmatched = doc?.format === 'excel' ? doc.items.filter(item => !mapping[item.id] && targetKeys.get(item.id) === 'skip').length : 0;
  return <section className="card igeve-panel igeve-filter-panel">
    <h3>Importar preços de venda</h3>
    <p>Selecione a operação e uma ou mais categorias. Para Excel, use as colunas Produto, Unidade e Preço unitário (R$). A coluna Categoria é opcional e ajuda quando um produto aparece em mais de uma categoria.</p>
    <fieldset disabled={busy || loading !== null} className="igeve-document-fieldset">
      <div className="igeve-filters"><label>Operação da tabela de destino<select className="input-field" value={operationId} onChange={e => { setOperation(e.target.value); resetDestination(); }}><option value="">Selecione a operação</option>{operations.map(op => <option key={op.id} value={op.id}>{op.name}</option>)}</select></label>
        <div className="igeve-category-filter">
          <span id="igeve-price-destination-label">Categoria da tabela de destino</span>
          <details onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
          }} onKeyDown={event => {
            if (event.key === 'Escape') {
              event.currentTarget.open = false;
              event.currentTarget.querySelector('summary')?.focus();
            }
          }}>
            <summary className="input-field" aria-labelledby="igeve-price-destination-label igeve-price-destination-selection">
              <span id="igeve-price-destination-selection">{destination.categories.join(', ') || 'Selecione as categorias'}</span>
            </summary>
            <div className="igeve-category-options" role="group" aria-labelledby="igeve-price-destination-label">
              {categories.map(category => <label key={category}>
                <input type="checkbox" checked={selectedCategories.includes(category)} onChange={event => {
                  const checked = event.target.checked;
                  setSelectedCategories(current => checked ? [...current, category].sort() : current.filter(value => value !== category));
                  resetDestination();
                }} />{category}
              </label>)}
            </div>
          </details>
        </div>
      </div>
      <div className="igeve-actions">
        <label className="button button-outline">Selecionar Excel<input className="igeve-file-input" aria-label="Excel para preços de venda" type="file" accept=".xlsx,.xls" disabled={!hasDestination} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void read(file, 'excel'); }} /></label>
        <button type="button" className="button button-outline" disabled={!hasDestination} onClick={() => downloadIgevePriceWorkbook(targets, destination)}>Baixar modelo Excel</button>
        <label className="button button-outline">Selecionar NF-e em PDF<input className="igeve-file-input" aria-label="PDF para preços de venda" type="file" accept="application/pdf,.pdf" disabled={!hasDestination} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void read(file, 'pdf'); }} /></label>
      </div>
      {doc && <><p><strong>{destination.operation} / {destination.categories.join(', ')}</strong><br />{doc.source.filename}{doc.format === 'pdf' && ` | NF-e ${doc.source.invoice || 'não identificada'}`}</p>
        {doc.warnings.length > 0 && <details><summary>{doc.warnings.length} aviso(s) da importação</summary><ul>{doc.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
        {unmatched > 0 && <p>{unmatched} produto(s) sem correspondência. Selecione um produto da tabela ou escolha cadastrá-lo para incluí-lo na importação.</p>}
        {needsDestination && <p>Escolha um destino ou ignore cada item sem uma categoria definida.</p>}
        <div className="table-container"><table><thead><tr><th>Produto do arquivo</th><th>Unidade</th><th>Produto na tabela</th><th>Preço de venda (R$)</th></tr></thead><tbody>
          {doc.items.map(item => {
            const itemCategories = item.category ? [item.category] : destination.categories;
            return <tr key={item.id}>
              <td>{billingProductName(item.product)}{item.category && <><br /><small>{item.category}</small></>}</td>
              <td>{item.unit}</td>
              <td><select aria-label={`Destino ${item.product}`} className="input-field" value={targetKeys.get(item.id)} onChange={e => { setMapping(current => ({ ...current, [item.id]: e.target.value })); setConfirmed(false); }}>
                <option value="" disabled>Selecione o destino</option>
                <option value="skip">Ignorar item</option>
                {itemCategories.map(category => <option key={category} value={`new:${category}`}>Cadastrar em {category}</option>)}
                {itemCategories.map(category => <optgroup key={category} label={category}>
                  {targetsByCategory.get(category)?.map(row => <option key={row.key} value={row.key}>{row.product} / {row.unit}{row.salePrice === null ? '' : ` - atual R$ ${row.salePrice.toFixed(2)}`}</option>)}
                </optgroup>)}
              </select></td>
              <td><input className="input-field" aria-label={`Preço importado ${item.product}`} type="number" min="0" step="0.01" value={values[item.id] ?? ''} onChange={e => { setValues(current => ({ ...current, [item.id]: e.target.value })); setConfirmed(false); }} /></td>
            </tr>;
          })}
        </tbody></table></div>
        <label className="igeve-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Conferi {doc.format === 'pdf' ? 'o PDF' : 'a planilha'}, a tabela de destino, as unidades e os preços. Os preços selecionados substituem os valores anteriores ao salvar.</label>
        <div className="igeve-actions"><button type="button" className="button" disabled={!confirmed || !hasDestination || needsDestination || !doc.items.length} onClick={apply}>{doc.format === 'excel' ? 'Salvar preços importados' : 'Aplicar à tabela para revisão'}</button><button type="button" className="button button-outline" onClick={() => setDoc(null)}>Cancelar importação</button></div>
      </>}
    </fieldset>
    {loading && <p role="status">{loading === 'pdf' ? 'Lendo o PDF...' : 'Lendo a planilha...'}</p>}{message && <p role="status">{message}</p>}
  </section>;
}
