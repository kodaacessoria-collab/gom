import { useState } from 'react';
import type { BillingInvoice } from '../lib/igeveBilling';
import { applyIgeveWorkbookPrices, readIgevePriceWorkbook } from '../lib/igevePriceWorkbook';

interface Props {
  invoice: BillingInvoice;
  busy: boolean;
  onApply: (invoice: BillingInvoice) => void;
}

export default function IgeveDraftPriceWorkbook({ invoice, busy, onApply }: Props) {
  const categories = [...new Set(invoice.items.map(item => item.category || invoice.category))].filter(Boolean);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [preview, setPreview] = useState<(ReturnType<typeof readIgevePriceWorkbook> & { filename: string; category: string }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState('');
  const category = categories.includes(selectedCategory) ? selectedCategory : categories[0] || '';
  let result: ReturnType<typeof applyIgeveWorkbookPrices> | undefined;
  let matchError = '';
  if (preview?.category === category) {
    try { result = applyIgeveWorkbookPrices(invoice, category, preview.items); }
    catch (failure) { matchError = (failure as Error).message; }
  }
  async function read(file: File) {
    setPreview(null); setApplied(''); setError(''); setLoading(true);
    try {
      const content = readIgevePriceWorkbook(await file.arrayBuffer(), { operation: invoice.operation, category });
      setPreview({ ...content, filename: file.name, category });
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível ler a planilha.'); }
    finally { setLoading(false); }
  }
  return <details>
    <summary>Importar preços do Excel neste faturamento</summary>
    <p>Use uma planilha com Produto, Unidade e Preço unitário (R$). Os valores serão aplicados aos produtos correspondentes deste faturamento.</p>
    {categories.length > 1 && <label>Categoria da planilha<select className="input-field" value={category} disabled={busy || loading} onChange={event => {
      setSelectedCategory(event.target.value); setPreview(null); setError(''); setApplied('');
    }}>{categories.map(value => <option key={value}>{value}</option>)}</select></label>}
    <label>Planilha de preços do faturamento<input className="input-field" type="file" accept=".xlsx,.xls" disabled={busy || loading || !category} onChange={event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) void read(file);
    }} /></label>
    {loading && <p role="status">Lendo a planilha...</p>}
    {(error || matchError) && <p role="alert">{error || matchError}</p>}
    {preview && result && <div>
      <p>{preview.filename} · {category} · {result.updated} produto(s) correspondente(s), {result.missing} sem preço na planilha, {result.ignored} linha(s) fora deste faturamento.</p>
      {preview.warnings.length > 0 && <details><summary>{preview.warnings.length} aviso(s) da planilha</summary><ul>{preview.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
      <button type="button" className="button" disabled={busy || !result.updated} onClick={() => {
        if (!result) return;
        onApply(result.invoice);
        setApplied(`${result.updated} preço(s) aplicado(s). Confira o total e clique em Salvar faturamento.`);
        setPreview(null);
      }}>Aplicar preços ao faturamento</button>
    </div>}
    {applied && <p role="status">{applied}</p>}
  </details>;
}
