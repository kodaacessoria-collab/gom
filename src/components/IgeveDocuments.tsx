import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { DEFAULT_DOCUMENT_SUPPLIERS, DEFAULT_IGEVE_UNITS, DOCUMENT_PREFIX, SUPPLIER_PREFIX, UNIT_PREFIX, createAutomaticQuotation, quotationPrices, decimal2, digits, documentToday, documentTotal, emptyNfeDocument, round2, unitsForCnpj, validCnpj, validateNfeDocument } from '../lib/igeveDocuments';
import type { DocumentLayout, DocumentSupplier, IgeveUnit, NfeDocument, NfeItem, Quotation } from '../lib/igeveDocuments';
import { importNfePdf } from '../lib/nfePdfImport';
import './IgeveDocuments.css';

interface Stored<T> { value: T; version: string }
interface DocumentRecord { document: NfeDocument; savedAt: string; generatedAt?: string; generatedKind?: 'quote' | 'delivery'; generatedDocument?: NfeDocument; suppliers?: DocumentSupplier[] }
async function readRows<T>(prefix: string): Promise<Stored<T>[]> {
  const rows: Stored<T>[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.from('app_shared_state').select('value,updated_at').like('key', `${prefix.replace(/_/g, '\\_')}%`).order('key').range(offset, offset + 99);
    if (error) throw new Error('Não foi possível carregar os documentos. Tente Atualizar documentos.');
    rows.push(...(data || []).map(row => ({ value: row.value as T, version: row.updated_at })));
    if (!data || data.length < 100) return rows;
  }
}
async function writeRow(key: string, value: unknown, version?: string) {
  const row = { key, value, updated_at: new Date().toISOString() };
  const signal = AbortSignal.timeout(15000);
  const result = version
    ? await supabase.from('app_shared_state').update(row).eq('key', key).eq('updated_at', version).select('updated_at').abortSignal(signal).single()
    : await supabase.from('app_shared_state').insert(row).select('updated_at').abortSignal(signal).single();
  if (result.error || !result.data) throw new Error('Não foi possível salvar. Pode haver uma edição de outro usuário. Preserve suas alterações e atualize os documentos antes de tentar novamente.');
  return result.data.updated_at as string;
}
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function imageData(file: File) {
  if (file.size > 512 * 1024 || !['image/png', 'image/jpeg'].includes(file.type)) throw new Error('Use um logotipo PNG ou JPG de até 512 KB.');
  return await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Não foi possível ler o logotipo.')); reader.readAsDataURL(file); });
}
const blankSupplier = (): DocumentSupplier => ({ id: crypto.randomUUID(), name: '', cnpj: '', address: '', contact: '', layout: 'generic', color: '#203b50', payment: 'PIX / à vista', validity: 90, footer: '' });
const newItem = (): NfeItem => ({ id: crypto.randomUUID(), code: '', product: '', unit: 'UN', quantity: 1, price: 0, brand: '', notes: '' });
const layoutNames: Record<DocumentLayout, string> = { caninde: 'Canindé - dados em quadro / cestas', nobre: 'Nobre - destaque em laranja / marcas', om: 'OM Logística - cabeçalho central', lm: 'LM - tabela comercial', red: 'RED - proposta comercial', delicias: 'Delícias - entrega simplificada', generic: 'Padrão personalizado' };

function DecimalInput({ value, onChange, label, min = 0 }: { value: number | null; onChange: (value: number | null) => void; label: string; min?: number }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const display = value == null || !Number.isFinite(value) ? '' : round2(value) === value ? value.toFixed(2) : String(value);
  return <input aria-label={label} className="input-field" type="number" inputMode="decimal" step="0.01" min={min} value={editing ? text : display}
    onFocus={() => { setText(display); setEditing(true); }}
    onChange={event => { setText(event.target.value); onChange(event.target.value === '' ? null : Number(event.target.value)); }} onBlur={() => setEditing(false)} />;
}

export default function IgeveDocuments() {
  const [suppliers, setSuppliers] = useState<DocumentSupplier[]>(DEFAULT_DOCUMENT_SUPPLIERS);
  const [units, setUnits] = useState<IgeveUnit[]>(DEFAULT_IGEVE_UNITS);
  const [supplierRows, setSupplierRows] = useState<Stored<DocumentSupplier>[]>([]);
  const [unitRows, setUnitRows] = useState<Stored<IgeveUnit>[]>([]);
  const [records, setRecords] = useState<Stored<DocumentRecord>[]>([]);
  const [draft, setDraft] = useState<NfeDocument>(emptyNfeDocument);
  const [version, setVersion] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [messageIsError, setMessageIsError] = useState(false);
  const messageRef = useRef<HTMLDivElement>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [supplierEditor, setSupplierEditor] = useState<DocumentSupplier | null>(null);
  const [unitEditor, setUnitEditor] = useState<IgeveUnit | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const [source, setSource] = useState<File | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [mode, setMode] = useState<'editor' | 'suppliers' | 'units' | 'history'>('editor');
  const matches = unitsForCnpj(draft.recipientCnpj, units);
  const currentUnit = units.find(u => u.id === draft.unitId);
  const selectedSnapshot = records.find(r => r.value.document.id === draft.id)?.value;
  const change = (patch: Partial<NfeDocument>) => { setDraft(d => ({ ...d, ...patch, confirmed: patch.confirmed ?? false })); setDirty(true); };
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setMessage(''); setMessageIsError(false);
    try { await action(); } catch (error) { setMessageIsError(true); setMessage(error instanceof Error ? error.message : 'Não foi possível concluir a ação.'); }
    finally { setBusy(false); }
  };
  async function load() {
    setReady(false);
    const [s, u, d] = await Promise.all([readRows<DocumentSupplier>(SUPPLIER_PREFIX), readRows<IgeveUnit>(UNIT_PREFIX), readRows<DocumentRecord>(DOCUMENT_PREFIX)]);
    setSupplierRows(s); setUnitRows(u); setRecords(d);
    setSuppliers([...DEFAULT_DOCUMENT_SUPPLIERS.filter(v => !s.some(r => r.value.id === v.id)), ...s.map(r => r.value)]);
    setUnits([...DEFAULT_IGEVE_UNITS.filter(v => !u.some(r => r.value.id === v.id)), ...u.map(r => r.value)]);
    setReady(true);
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run(load);
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || supplierEditor || unitEditor) event.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, supplierEditor, unitEditor]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => {
    if (message && messageIsError) {
      messageRef.current?.focus({ preventScroll: true });
      messageRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [message, messageIsError]);
  const discard = () => !dirty || window.confirm('Há alterações não salvas. Deseja descartá-las?');
  function applyCnpj(cnpj: string, doc = draft): NfeDocument {
    const found = unitsForCnpj(cnpj, units);
    return { ...doc, recipientCnpj: cnpj, unitId: found.length === 1 ? found[0].id : '', unitName: found.length === 1 ? found[0].name : '', address: (digits(cnpj) === digits(doc.recipientCnpj) ? doc.address : '') || (found.length === 1 ? found[0].address : ''), confirmed: false };
  }
  async function importPdf(file: File) {
    if (!discard()) return;
    const result = await importNfePdf(file);
    const existing = records.find(r => r.value.document.sourceHash === result.document.sourceHash);
    if (existing && !window.confirm('Esta NF-e já foi importada. Deseja reler o PDF para corrigir a importação? Os dados e itens serão extraídos novamente e os orçamentos selecionados serão removidos. A substituição no histórico só ocorrerá ao salvar.')) return;
    const supplier = suppliers.find(s => digits(s.cnpj) === digits(result.document.issuerCnpj));
    setDraft({ ...applyCnpj(result.document.recipientCnpj, result.document), id: existing?.value.document.id || result.document.id, deliverySupplierId: supplier?.id || '' });
    setVersion(existing?.version); setSource(file); setWarnings(result.warnings); setDirty(true); setMode('editor');
    setMessage('PDF importado. Confira todos os campos e os itens com o original.');
  }
  async function save(kind?: 'quote' | 'delivery', selectedIds?: string[], generatedDocument = draft) {
    if (!ready) throw new Error('Aguarde o carregamento ou atualize os documentos.');
    if (!currentUnit || digits(currentUnit.cnpj) !== digits(draft.recipientCnpj)) throw new Error('A unidade selecionada deve corresponder ao CNPJ do destinatário.');
    const error = validateNfeDocument(kind ? generatedDocument : draft, suppliers, kind);
    if (error) throw new Error(error);
    const value: DocumentRecord = {
      ...records.find(r => r.value.document.id === draft.id)?.value,
      document: structuredClone(draft), savedAt: new Date().toISOString(),
      ...(kind ? { generatedAt: new Date().toISOString(), generatedKind: kind, generatedDocument: structuredClone(generatedDocument), suppliers: suppliers.filter(s => selectedIds?.includes(s.id)).map(s => ({ ...s, referencePdf: undefined })) } : {}),
    };
    const nextVersion = await writeRow(draft.id, value, version);
    setVersion(nextVersion); setRecords(rows => [{ value, version: nextVersion }, ...rows.filter(r => r.value.document.id !== draft.id)]); setDirty(false);
    return value;
  }
  async function generate(kind: 'quote' | 'delivery', only?: string, previewOnly = false) {
    const outputDoc = only && kind === 'quote' ? { ...draft, quotations: draft.quotations.filter(q => q.supplierId === only) } : draft;
    const error = validateNfeDocument(outputDoc, suppliers, kind); if (error) throw new Error(error);
    if (!currentUnit || digits(currentUnit.cnpj) !== digits(outputDoc.recipientCnpj)) throw new Error('A unidade selecionada deve corresponder ao CNPJ do destinatário.');
    const { createIgeveDocumentPdf } = await import('../lib/igeveDocumentPdf');
    const selected = kind === 'delivery' ? [suppliers.find(s => s.id === draft.deliverySupplierId)!] : suppliers.filter(s => draft.quotations.some(q => q.supplierId === s.id) && (!only || s.id === only));
    const outputs = selected.map(s => createIgeveDocumentPdf(outputDoc, s, kind, outputDoc.quotations.find(q => q.supplierId === s.id)));
    if (previewOnly) { setPreview({ url: outputs[0].pdf.output('bloburl').toString(), name: outputs[0].filename }); return; }
    // Generate locally first. A failure to archive must not prevent the download.
    let blob: Blob;
    let filename: string;
    if (outputs.length === 1) { blob = outputs[0].pdf.output('blob'); filename = outputs[0].filename; }
    else {
      const { zipSync } = await import('fflate');
      const files: Record<string, Uint8Array> = {};
      for (const [index, out] of outputs.entries()) {
        const name = Object.hasOwn(files, out.filename) ? out.filename.replace(/\.pdf$/, `_${index + 1}.pdf`) : out.filename;
        files[name] = new Uint8Array(out.pdf.output('arraybuffer'));
      }
      blob = new Blob([Uint8Array.from(zipSync(files))], { type: 'application/zip' });
      filename = `ORCAMENTOS_${draft.unitName.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`;
    }
    downloadBlob(blob, filename);
    setMessage('Download gerado. Salvando dados no histórico...');
    let archiveError = '';
    try { await save(kind, selected.map(s => s.id), outputDoc); }
    catch (error) { archiveError = error instanceof Error ? error.message : 'Não foi possível salvar no histórico.'; }
    if (archiveError) {
      setMessageIsError(true);
      setMessage(`Download gerado, mas os dados não foram salvos no histórico. ${archiveError} Guarde o arquivo e tente Salvar dados da NF-e novamente.`);
      return;
    }
    setMessage(kind === 'quote' ? 'Orçamento(s) gerado(s) e dados salvos.' : 'Romaneio gerado e dados salvos.');
  }
  async function downloadPrevious(record: DocumentRecord) {
    if (!record.generatedDocument || !record.generatedKind || !record.suppliers?.length) throw new Error('Não há geração arquivada neste registro.');
    const { createIgeveDocumentPdf } = await import('../lib/igeveDocumentPdf');
    const doc = record.generatedDocument;
    const outputs = record.suppliers.map(s => createIgeveDocumentPdf(doc, s, record.generatedKind!, doc.quotations.find(q => q.supplierId === s.id)));
    if (outputs.length === 1) outputs[0].pdf.save(outputs[0].filename);
    else {
      const { zipSync } = await import('fflate');
      const files = Object.fromEntries(outputs.map((out, index) => [out.filename.replace(/\.pdf$/, `_${index + 1}.pdf`), new Uint8Array(out.pdf.output('arraybuffer'))]));
      const reference = record.generatedKind === 'quote' ? doc.unitName : doc.number;
      downloadBlob(new Blob([Uint8Array.from(zipSync(files))], { type: 'application/zip' }), `DOCUMENTOS_${reference.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`);
    }
    setMessage('Última geração recuperada com os dados e modelos arquivados na ocasião.');
  }
  function selectQuote(supplierId: string, checked: boolean) {
    if (!checked) {
      change({ quotations: draft.quotations.filter(q => q.supplierId !== supplierId) });
      return;
    }
    if (draft.quotations.some(q => q.supplierId === supplierId)) return;
    if (draft.quotations.length >= 3) { setMessage('Selecione até três empresas: o fornecedor da nota e até dois parceiros.'); return; }
    const supplier = suppliers.find(s => s.id === supplierId)!;
    let quote: Quotation;
    try { quote = createAutomaticQuotation(draft, supplier, suppliers); }
    catch (error) { setMessage((error as Error).message); return; }
    change({ quotations: [...draft.quotations, quote] });
  }
  function updateQuote(id: string, patch: Partial<Quotation>) { change({ quotations: draft.quotations.map(q => q.supplierId === id ? { ...q, ...patch } : q) }); }
  function changeQuoteMarkup(id: string, markupPercent: number) {
    if (markupPercent !== 8.75 && markupPercent !== 12.35) return;
    change({ quotations: draft.quotations.map(q => {
      const supplier = suppliers.find(s => s.id === q.supplierId);
      const isIssuer = digits(draft.issuerCnpj).length === 14 && digits(supplier?.cnpj || '') === digits(draft.issuerCnpj);
      if (isIssuer || (q.supplierId !== id && q.markupPercent !== markupPercent)) return q;
      const nextMarkup = q.supplierId === id ? markupPercent : markupPercent === 8.75 ? 12.35 : 8.75;
      const automaticReference = `Orçamento calculado: NF-e ${draft.number} + ${decimal2(q.markupPercent ?? 0)}%`;
      return { ...q, markupPercent: nextMarkup, automaticPrices: true, prices: quotationPrices(draft.items, nextMarkup),
        reference: q.reference === automaticReference ? `Orçamento calculado: NF-e ${draft.number} + ${decimal2(nextMarkup)}%` : q.reference };
    }) });
  }
  function replaceItems(items: NfeItem[]) {
    change({ items, quotations: draft.quotations.map(q => q.markupPercent == null || q.automaticPrices === false ? q : { ...q, prices: quotationPrices(items, q.markupPercent) }) });
  }
  function editItem(id: string, patch: Partial<NfeItem>) { replaceItems(draft.items.map(i => i.id === id ? { ...i, ...patch } : i)); }
  function openRecord(row: Stored<DocumentRecord>) {
    if (!discard()) return;
    setDraft(structuredClone(row.value.document)); setVersion(row.version); setDirty(false); setSource(null); setWarnings([]); setMode('editor');
  }
  async function saveSupplier(event: FormEvent) {
    event.preventDefault(); if (!supplierEditor) return;
    await run(async () => {
      if (!supplierEditor.name.trim() || !validCnpj(supplierEditor.cnpj)) throw new Error('Informe o nome e um CNPJ válido do fornecedor.');
      if (suppliers.some(s => s.id !== supplierEditor.id && digits(s.cnpj) === digits(supplierEditor.cnpj))) throw new Error('Este CNPJ já está cadastrado. Edite a empresa existente.');
      if (!Number.isInteger(supplierEditor.validity) || supplierEditor.validity < 1 || supplierEditor.validity > 3650) throw new Error('Informe uma validade entre 1 e 3650 dias.');
      const version = await writeRow(`${SUPPLIER_PREFIX}${supplierEditor.id}`, supplierEditor, supplierRows.find(r => r.value.id === supplierEditor.id)?.version);
      setSupplierRows(rows => [...rows.filter(r => r.value.id !== supplierEditor.id), { value: supplierEditor, version }]);
      setSuppliers(rows => [...rows.filter(r => r.id !== supplierEditor.id), supplierEditor]); setSupplierEditor(null); setMessage('Empresa e modelo salvos.');
    });
  }
  async function saveUnit(event: FormEvent) {
    event.preventDefault(); if (!unitEditor) return;
    await run(async () => {
      if (!unitEditor.name.trim() || !validCnpj(unitEditor.cnpj)) throw new Error('Informe a unidade e um CNPJ válido.');
      const version = await writeRow(`${UNIT_PREFIX}${unitEditor.id}`, unitEditor, unitRows.find(r => r.value.id === unitEditor.id)?.version);
      setUnitRows(rows => [...rows.filter(r => r.value.id !== unitEditor.id), { value: unitEditor, version }]);
      setUnits(rows => [...rows.filter(r => r.id !== unitEditor.id), unitEditor]); setUnitEditor(null); setMessage('Unidade salva.');
    });
  }
  const supplierField = (key: 'name' | 'cnpj' | 'address' | 'contact' | 'payment' | 'footer', label: string) => <label>{label}<input className="input-field" value={supplierEditor![key]} onChange={e => setSupplierEditor(s => s && ({ ...s, [key]: e.target.value }))} /></label>;
  return <div className="igeve-documents">
    <div className="card igeve-panel"><div className="igeve-heading"><div><h2>Orçamentos e entrega por NF-e</h2><p>Importe a nota, confira os produtos e prepare os documentos de cada fornecedor.</p></div><button className="button button-outline" disabled={busy || dirty || !!supplierEditor || !!unitEditor} onClick={() => void run(load)}>Atualizar documentos</button></div>
      <div className="igeve-actions">{[['editor', 'Preparar documentos'], ['suppliers', 'Empresas e modelos'], ['units', 'Unidades IGEVE'], ['history', 'Histórico']].map(([key, label]) => <button key={key} className={`button ${mode === key ? '' : 'button-outline'}`} disabled={busy} onClick={() => setMode(key as typeof mode)}>{label}</button>)}</div>
    </div>
    {message && <div ref={messageRef} tabIndex={-1} role={messageIsError ? 'alert' : 'status'} className={`card igeve-panel${messageIsError ? ' igeve-document-notice' : ''}`}>{message}</div>}
    {busy && <p role="status">Processando documentos...</p>}
    {!ready && !busy && <p>Atualize os documentos para carregar os cadastros.</p>}
    <fieldset disabled={busy || !ready} className="igeve-document-fieldset">
    {mode === 'editor' && <>
      <div className="card igeve-panel"><div className="igeve-heading"><h3>1. Nota fiscal de origem</h3><span>{dirty ? 'Alterações não salvas' : version ? 'Dados salvos' : 'Novo documento'}</span></div>
        <div className="igeve-actions"><label className="button button-outline">Importar NF-e em PDF<input aria-label="Importar NF-e em PDF" className="igeve-file-input" type="file" accept="application/pdf,.pdf" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void run(() => importPdf(file)); }} /></label>
          <button className="button button-outline" onClick={() => { if (discard()) { setDraft(emptyNfeDocument()); setVersion(undefined); setSource(null); setWarnings([]); setDirty(false); } }}>Novo / preenchimento manual</button>
          {source && <button className="button button-outline" onClick={() => setPreview({ url: URL.createObjectURL(source), name: source.name })}>Conferir PDF original</button>}
        </div>
        <p><small>PDF com texto: extração automática quando as colunas são reconhecidas. PDF digitalizado: preenchimento manual. O arquivo original permanece intacto.</small></p>
        {draft.sourceName && <p>Origem: {draft.sourceName} <small>• importada em {new Date(draft.importedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</small></p>}
        {warnings.length > 0 && <ul className="igeve-document-notice">{warnings.map(w => <li key={w}>{w}</li>)}</ul>}
        <div className="igeve-filters">
          <label>Número da NF-e<input className="input-field" value={draft.number} onChange={e => change({ number: e.target.value })} /></label>
          <label>Data de emissão da NF-e<input className="input-field" type="date" value={draft.issuedAt} onChange={e => change({ issuedAt: e.target.value })} /></label>
          <label>Emitente da NF-e<input className="input-field" value={draft.issuer} onChange={e => change({ issuer: e.target.value })} /></label>
          <label>CNPJ do emitente<input className="input-field" value={draft.issuerCnpj} onChange={e => change({ issuerCnpj: e.target.value })} /></label>
        </div>
      </div>
      <div className="card igeve-panel"><h3>2. Destinatário e unidade de atendimento</h3><div className="igeve-filters">
        <label>Cliente<input className="input-field" value={draft.recipient} onChange={e => change({ recipient: e.target.value })} /></label>
        <label>CNPJ do destinatário<input className="input-field" value={draft.recipientCnpj} onChange={e => { setDraft(applyCnpj(e.target.value)); setDirty(true); }} /></label>
        <label>Unidade / escola<select className="input-field" value={draft.unitId} onChange={e => { const unit = matches.find(u => u.id === e.target.value); change({ unitId: unit?.id || '', unitName: unit?.name || '', address: unit?.address || draft.address }); }}><option value="">Selecione a unidade</option>{matches.map(u => <option key={u.id} value={u.id}>{u.name} - {u.city}</option>)}</select></label>
      </div>
        {matches.length > 1 && <p className="igeve-document-notice">Há mais de uma unidade para este CNPJ. Selecione a escola de atendimento.</p>}
        {digits(draft.recipientCnpj).length === 14 && !matches.length && <p className="igeve-document-notice">CNPJ sem unidade cadastrada. Inclua a unidade em Unidades IGEVE.</p>}
        <label>Endereço de entrega<input className="input-field" value={draft.address} onChange={e => change({ address: e.target.value })} /></label>
      </div>
      <div className="card igeve-panel"><h3>3. Produtos da nota</h3><div className="table-container"><table><thead><tr><th>Código</th><th>Produto</th><th>Un.</th><th>Quantidade</th><th>Preço NF-e (R$)</th><th>Marca</th><th>Observação entrega</th><th>Ação</th></tr></thead><tbody>
        {draft.items.map((item, index) => <tr key={item.id}>
          {(['code', 'product', 'unit', 'quantity', 'price', 'brand', 'notes'] as const).map(field => <td key={field}>{field === 'quantity' || field === 'price'
            ? <DecimalInput label={`${field === 'quantity' ? 'Quantidade' : 'Preço da NF-e'} item ${index + 1}`} value={item[field]} min={field === 'quantity' ? .01 : 0} onChange={value => editItem(item.id, { [field]: value ?? NaN })} />
            : <input className="input-field" aria-label={`${field} item ${index + 1}`} value={item[field]} onChange={e => editItem(item.id, { [field]: e.target.value })} />}{field === 'price' && <small>Total: {decimal2(item.quantity * item.price)}</small>}</td>)}
          <td><button className="button button-outline" aria-label={`Remover item ${index + 1}`} onClick={() => change({ items: draft.items.filter(i => i.id !== item.id), quotations: draft.quotations.map(q => ({ ...q, prices: Object.fromEntries(Object.entries(q.prices).filter(([id]) => id !== item.id)) })) })}>Remover</button></td>
        </tr>)}
        {!draft.items.length && <tr><td colSpan={8}>Importe a NF-e ou adicione os produtos manualmente.</td></tr>}
      </tbody></table></div><div className="igeve-heading"><button className="button button-outline" onClick={() => replaceItems([...draft.items, newItem()])}>Adicionar produto</button><strong>Total dos produtos da NF-e: R$ {decimal2(documentTotal(draft.items))}</strong></div>
        <div className="igeve-filters"><label>Quantidade de cestas (opcional)<DecimalInput label="Quantidade de cestas (opcional)" value={draft.baskets} onChange={value => change({ baskets: value ?? 0 })} /></label><label>Referência de consumo<input className="input-field" value={draft.consumption} placeholder="Ex.: NOVEMBRO/2026" onChange={e => change({ consumption: e.target.value })} /></label></div>
        <label>Observações gerais<textarea className="input-field" rows={3} value={draft.notes} onChange={e => change({ notes: e.target.value })} /></label>
      </div>

      <div className="card igeve-panel"><h3>4. Orçamentos de fornecedores</h3><p>Selecione o emitente e até dois parceiros. Escolha o acréscimo de cada parceiro: 8,75% ou 12,35% sobre o valor unitário de cada item da NF-e. Com dois parceiros, os percentuais ficam diferentes; ao trocar um, o outro é ajustado automaticamente. Alterar o acréscimo recalcula os preços do parceiro.</p>
        <div className="igeve-document-suppliers">{suppliers.map(s => <label className="igeve-check" key={s.id}><input type="checkbox" checked={draft.quotations.some(q => q.supplierId === s.id)} onChange={e => selectQuote(s.id, e.target.checked)} />{s.name}{digits(s.cnpj) === digits(draft.issuerCnpj) && digits(s.cnpj).length === 14 ? ' (emitente da NF-e)' : ''}</label>)}</div>
        {draft.quotations.map(q => { const s = suppliers.find(s => s.id === q.supplierId); return <div className="igeve-document-quote" key={q.supplierId}><h4>{s?.name || 'Fornecedor indisponível'}{q.markupPercent != null ? q.markupPercent === 0 ? ' — Valores da NF-e' : ` — Parceiro ${q.markupPercent === 8.75 ? '01' : '02'} (+${decimal2(q.markupPercent)}%)` : ''}</h4><div className="igeve-filters"><label>Data efetiva da cotação<input className="input-field" type="date" max={documentToday()} value={q.date} onChange={e => updateQuote(q.supplierId, { date: e.target.value })} /></label><label>Referência da cotação recebida<input className="input-field" placeholder="Ex.: proposta nº 123 / e-mail de 06/11/2026" value={q.reference} onChange={e => updateQuote(q.supplierId, { reference: e.target.value })} /></label></div>
          {!(digits(draft.issuerCnpj).length === 14 && digits(s?.cnpj || '') === digits(draft.issuerCnpj)) && <label>Acréscimo do parceiro<select className="input-field" aria-label={`Acréscimo ${s?.name}`} value={q.markupPercent ?? ''} onChange={e => changeQuoteMarkup(q.supplierId, Number(e.target.value))}><option value="" disabled>Selecione o acréscimo</option><option value="8.75">8,75%</option><option value="12.35">12,35%</option></select></label>}
          <div className="table-container"><table><thead><tr><th>Produto</th><th>Quantidade</th><th>Preço cotado (R$)</th><th>Total (R$)</th></tr></thead><tbody>{draft.items.map(i => <tr key={i.id}><td>{i.product}</td><td>{decimal2(i.quantity)} {i.unit}</td><td><DecimalInput label={`Preço ${s?.name} ${i.product}`} value={q.prices[i.id] ?? null} onChange={value => updateQuote(q.supplierId, { automaticPrices: false, prices: { ...q.prices, [i.id]: value } })} /></td><td>{q.prices[i.id] == null ? 'Pendente' : decimal2(i.quantity * q.prices[i.id]!)}</td></tr>)}</tbody></table></div>
          {q.automaticPrices === false && <p>Preços editados manualmente.</p>}
          {q.markupPercent != null && <button className="button button-outline" onClick={() => updateQuote(q.supplierId, { automaticPrices: true, prices: quotationPrices(draft.items, q.markupPercent!) })}>Recalcular valores automaticamente</button>}
          <strong>Total: R$ {decimal2(documentTotal(draft.items, q.prices))}</strong>
          <label className="igeve-check"><input type="checkbox" aria-label={`Conferência do orçamento ${s?.name}`} checked={draft.confirmed} onChange={e => change({ confirmed: e.target.checked })} />Conferi a NF-e, a unidade, os produtos e os valores para gerar o orçamento.</label>
          <div className="igeve-actions"><button className="button button-outline" onClick={() => void run(() => generate('quote', q.supplierId, true))}>Visualizar orçamento</button><button className="button" onClick={() => void run(() => generate('quote', q.supplierId))}>Baixar orçamento PDF</button></div>
        </div>; })}
        <button className="button" disabled={!draft.quotations.length} onClick={() => void run(() => generate('quote'))}>Gerar orçamentos selecionados{draft.quotations.length > 1 ? ' (ZIP com PDFs)' : ' (PDF)'}</button>
      </div>
      <div className="card igeve-panel"><h3>5. Romaneio de entrega</h3><div className="igeve-filters"><label>Empresa responsável<select className="input-field" value={draft.deliverySupplierId} onChange={e => change({ deliverySupplierId: e.target.value })}><option value="">Selecione a empresa</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Data de entrega<input className="input-field" type="date" value={draft.deliveryDate} onChange={e => change({ deliveryDate: e.target.value })} /></label></div><div className="igeve-actions"><button className="button button-outline" onClick={() => void run(() => generate('delivery', undefined, true))}>Visualizar romaneio</button><button className="button" onClick={() => void run(() => generate('delivery'))}>Gerar romaneio PDF</button></div><p><small>O romaneio inclui campos para recebimento e assinatura, sem preços dos produtos.</small></p></div>
      <div className="card igeve-panel"><h3>6. Conferência e gravação</h3><label className="igeve-check"><input type="checkbox" checked={draft.confirmed} onChange={e => change({ confirmed: e.target.checked })} />Conferi a NF-e, o CNPJ, a unidade, os itens e os valores informados.</label><button className="button" onClick={() => void run(async () => { await save(); setMessage('Dados da NF-e salvos.'); })}>Salvar dados da NF-e</button></div>
      {selectedSnapshot?.generatedAt && <p><small>Última geração salva: {new Date(selectedSnapshot.generatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</small></p>}
    </>}
    {mode === 'suppliers' && <div className="card igeve-panel"><div className="igeve-heading"><h3>Empresas e modelos</h3><button className="button" onClick={() => setSupplierEditor(blankSupplier())}>Nova empresa / modelo</button></div><p>Os estilos seguem as referências fornecidas. Personalize os dados, a cor, o logotipo e as condições comerciais. Cada documento tem campo para sua própria assinatura.</p>
      <div className="table-container"><table><thead><tr><th>Empresa</th><th>CNPJ</th><th>Modelo</th><th>Ação</th></tr></thead><tbody>{suppliers.map(s => <tr key={s.id}><td>{s.name}</td><td>{s.cnpj || 'A preencher'}</td><td>{layoutNames[s.layout]}</td><td><button className="button button-outline" onClick={() => setSupplierEditor({ ...s })}>Editar empresa e modelo</button></td></tr>)}</tbody></table></div>
      {supplierEditor && <form onSubmit={e => void saveSupplier(e)} className="igeve-document-config"><h4>Cadastro de empresa e modelo</h4><div className="igeve-filters">{supplierField('name', 'Razão social / nome')}{supplierField('cnpj', 'CNPJ')}{supplierField('address', 'Endereço')}{supplierField('contact', 'Contato')}
        <label>Estilo do modelo<select className="input-field" value={supplierEditor.layout} onChange={e => setSupplierEditor({ ...supplierEditor, layout: e.target.value as DocumentLayout })}>{Object.entries(layoutNames).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Cor do modelo<input type="color" className="input-field" value={supplierEditor.color} onChange={e => setSupplierEditor({ ...supplierEditor, color: e.target.value })} /></label>{supplierField('payment', 'Condições de pagamento')}<label>Validade (dias)<input className="input-field" type="number" min="1" max="3650" step="1" value={supplierEditor.validity} onChange={e => setSupplierEditor({ ...supplierEditor, validity: Number(e.target.value) })} /></label>{supplierField('footer', 'Observações do modelo')}
        <label>Logotipo próprio (PNG / JPG, até 512 KB)<input className="input-field" type="file" accept="image/png,image/jpeg" onChange={e => { const f = e.target.files?.[0]; if (f) void run(async () => { const logo = await imageData(f); setSupplierEditor(s => s && ({ ...s, logo })); }); }} /></label>
      </div>
        {supplierEditor.logo && <div className="igeve-actions"><img className="igeve-document-logo" src={supplierEditor.logo} alt="Logotipo do modelo" /><button type="button" className="button button-outline" onClick={() => setSupplierEditor({ ...supplierEditor, logo: undefined })}>Remover logotipo</button></div>}
        <label>PDF de referência (opcional, até 2 MB)<input className="input-field" type="file" accept="application/pdf,.pdf" onChange={e => { const f = e.target.files?.[0]; if (f) void run(async () => { if (f.size > 2 * 1024 * 1024 || !f.name.toLowerCase().endsWith('.pdf')) throw new Error('Use um PDF de até 2 MB.'); const reader = new FileReader(); const data = await new Promise<string>((resolve, reject) => { reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(f); }); setSupplierEditor(s => s && ({ ...s, referencePdf: data, referenceName: f.name })); }); }} /></label>
        {supplierEditor.referencePdf && <div className="igeve-actions"><button type="button" className="button button-outline" onClick={() => { const bytes = Uint8Array.from(atob(supplierEditor.referencePdf!.split(',')[1]), c => c.charCodeAt(0)); setPreview({ url: URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), name: supplierEditor.referenceName || 'Referência' }); }}>Ver referência original</button><button type="button" className="button button-outline" onClick={() => setSupplierEditor({ ...supplierEditor, referencePdf: undefined, referenceName: undefined })}>Remover referência</button></div>}
        <small>O PDF de referência é guardado intacto para consulta. O novo documento usa o estilo e os campos configurados acima.</small>
        <div className="igeve-actions"><button className="button" type="submit">Salvar empresa e modelo</button><button className="button button-outline" type="button" onClick={() => setSupplierEditor(null)}>Cancelar</button></div>
      </form>}
    </div>}
    {mode === 'units' && <div className="card igeve-panel"><div className="igeve-heading"><h3>Unidades IGEVE</h3><button className="button" onClick={() => setUnitEditor({ id: crypto.randomUUID(), name: '', cnpj: '', city: '', address: '' })}>Nova unidade</button></div><p>Cadastro inicial baseado na relação de outubro/2026. CNPJs compartilhados exigem seleção da unidade.</p><div className="table-container"><table><thead><tr><th>Unidade</th><th>CNPJ</th><th>Município / UF</th><th>Ação</th></tr></thead><tbody>{units.map(u => <tr key={u.id}><td>{u.name}</td><td>{u.cnpj}</td><td>{u.city}</td><td><button className="button button-outline" onClick={() => setUnitEditor({ ...u })}>Editar</button></td></tr>)}</tbody></table></div>
      {unitEditor && <form className="igeve-document-config" onSubmit={e => void saveUnit(e)}><div className="igeve-filters">{([['name', 'Unidade / escola'], ['cnpj', 'CNPJ'], ['city', 'Município / UF'], ['address', 'Endereço de entrega']] as const).map(([key, label]) => <label key={key}>{label}<input className="input-field" value={unitEditor[key]} onChange={e => setUnitEditor({ ...unitEditor, [key]: e.target.value })} /></label>)}</div><div className="igeve-actions"><button type="submit" className="button">Salvar unidade</button><button type="button" className="button button-outline" onClick={() => setUnitEditor(null)}>Cancelar</button></div></form>}
    </div>}
    {mode === 'history' && <div className="card igeve-panel"><h3>Histórico de notas e documentos</h3><label>Buscar nota, unidade ou fornecedor<input className="input-field" type="search" value={historySearch} onChange={e => setHistorySearch(e.target.value)} /></label><div className="table-container"><table><thead><tr><th>NF-e</th><th>Unidade</th><th>Fornecedor</th><th>Salvo em</th><th>Ação</th></tr></thead><tbody>{records.filter(r => `${r.value.document.number} ${r.value.document.unitName} ${r.value.document.issuer}`.toLocaleLowerCase('pt-BR').includes(historySearch.toLocaleLowerCase('pt-BR'))).sort((a, b) => b.value.savedAt.localeCompare(a.value.savedAt)).map(row => <tr key={row.value.document.id}><td>{row.value.document.number}</td><td>{row.value.document.unitName}</td><td>{row.value.document.issuer}</td><td>{new Date(row.value.savedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</td><td><button className="button button-outline" onClick={() => openRecord(row)}>Abrir</button>{row.value.generatedDocument && <button className="button button-outline" onClick={() => void run(() => downloadPrevious(row.value))}>Baixar última geração</button>}</td></tr>)}{!records.length && <tr><td colSpan={5}>Nenhuma NF-e salva.</td></tr>}</tbody></table></div><small>São salvos os dados conferidos e a identificação do arquivo. Guarde a NF-e original; ela não é arquivada neste histórico.</small></div>}
    </fieldset>
    {preview && <div className="igeve-document-preview" role="dialog" aria-modal="true" aria-label={preview.name}><div><div className="igeve-heading"><strong>{preview.name}</strong><div className="igeve-actions"><a href={preview.url} download={preview.name} className="button">Baixar PDF</a><button className="button button-outline" onClick={() => setPreview(null)} autoFocus>Fechar</button></div></div><iframe title={preview.name} src={preview.url} /></div></div>}
  </div>;
}
