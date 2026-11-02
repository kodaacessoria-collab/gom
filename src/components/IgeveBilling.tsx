import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, FileText, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { getOrderControlNumber } from '../lib/orderControlNumber';
import { addPdfHeader } from '../lib/pdfBranding';
import { BILLING_PREFIX, SOURCE_KEYS, sortBillingRows, createDeliveryBillingInvoice, locationBillingInvoices, locationTotals, companyTotals, billingDateInRange, invoiceTotal, isIgeveOperation, lineTotal, validateInvoice } from '../lib/igeveBilling';
import type { BillingInvoice, BillingOperation, BillingOrder, BillingPoint, SavedInvoice, BillingSort } from '../lib/igeveBilling';
import type { Company } from '../types';
import './IgeveBilling.css';

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const dateLabel = (value: string) => value.split('-').reverse().join('/');
const newItem = () => ({ id: crypto.randomUUID(), product: '', unit: 'UN', quantity: 1, price: 0 });
interface SharedRow { key: string; value: unknown; updated_at: string }
async function loadInvoices() {
  const rows: SharedRow[] = [];
  for (let first = 0; ; first += 500) {
    const { data, error } = await supabase.from('app_shared_state').select('key,value,updated_at')
      .like('key', `${BILLING_PREFIX.replace(/_/g, '\\_')}%`).order('key').range(first, first + 499);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 500) return rows;
  }
}

function SortHeader({ label, column, sort, onSort }: { label: string; column: string; sort?: BillingSort; onSort: (column: string) => void }) {
  const active = sort?.column === column;
  const Icon = active ? (sort.direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return <th scope="col" aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" className="igeve-sort" onClick={() => onSort(column)} aria-label={`${label}: classificar em ordem ${active && sort.direction === 'asc' ? 'decrescente' : 'crescente'}`}>
    {label}<Icon size={14} aria-hidden="true" />
  </button></th>;
}

export default function IgeveBilling() {
  const [tab, setTab] = useState('romaneios');
  const [operations, setOperations] = useState<BillingOperation[]>([]);
  const [orders, setOrders] = useState<BillingOrder[]>([]);
  const [points, setPoints] = useState<BillingPoint[]>([]);
  const [prices, setPrices] = useState<Record<string, { salePrice: number }>>({});
  const [companies, setCompanies] = useState<Company[]>([]);
  const [saved, setSaved] = useState<SavedInvoice[]>([]);
  const [draft, setDraft] = useState<BillingInvoice | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [operationId, setOperationId] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [expandedLocation, setExpandedLocation] = useState('');
  const [sorts, setSorts] = useState<Record<string, BillingSort>>({});
  const sort = sorts[tab];
  const changeSort = (column: string) => setSorts(current => ({ ...current, [tab]: { column, direction: current[tab]?.column === column && current[tab].direction === 'asc' ? 'desc' : 'asc' } }));
  const header = (column: string, label: string) => <SortHeader key={column} column={column} label={label} sort={sort} onSort={changeSort} />;
  const [start, setStart] = useState(`${today().slice(0, 7)}-01`);
  const [end, setEnd] = useState(today());

  async function load() {
    setBusy(true); setMessage(''); setReady(false);
    try {
      const [source, invoices, companyResult] = await Promise.all([
        supabase.from('app_shared_state').select('key,value').in('key', SOURCE_KEYS),
        loadInvoices(),
        supabase.from('companies').select('*').order('legal_name'),
      ]);
      if (source.error) throw source.error;
      const map = new Map((source.data || []).map(row => [row.key, row.value]));
      setOperations(((map.get(SOURCE_KEYS[0]) || []) as BillingOperation[]).filter(isIgeveOperation));
      setPoints(map.get(SOURCE_KEYS[1]) || []); setOrders(map.get(SOURCE_KEYS[2]) || []); setPrices(map.get(SOURCE_KEYS[3]) || {});
      setSaved(invoices.map(row => ({ invoice: row.value as BillingInvoice, version: row.updated_at })));
      setCompanies(companyResult.data || []); setReady(true);
      if (companyResult.error) setMessage('Cadastro de empresas indisponível. Você pode informar a empresa manualmente.');
    } catch { setMessage('Não foi possível carregar o faturamento. Clique em Atualizar para tentar novamente.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  const validPeriod = !start || !end || start <= end;
  const filteredOrders = orders.filter(order => validPeriod && operations.some(op => op.id === order.operationId) && (!operationId || order.operationId === operationId) && (!categoryFilter || order.category === categoryFilter) && billingDateInRange(order.deliveryDate, start, end));
  const filteredInvoices = saved.map(row => row.invoice).filter(invoice => validPeriod && (!operationId || invoice.operationId === operationId) && (!companyFilter || invoice.company === companyFilter) && (!categoryFilter || invoice.category === categoryFilter) && billingDateInRange(invoice.date, start, end));
  const categories = [...new Set([
    ...orders.filter(order => operations.some(op => op.id === order.operationId)).map(order => order.category),
    ...saved.map(row => row.invoice.category),
  ])].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const availableRows = sortBillingRows(filteredOrders.flatMap(order => order.deliveries.map(delivery => ({
    order, delivery,
    operation: operations.find(op => op.id === order.operationId)?.name || '',
    destination: points.find(point => point.id === delivery.deliveryPointId)?.name || delivery.deliveryPointId,
    action: saved.some(row => row.invoice.id === `${BILLING_PREFIX}${order.id}_${delivery.id}`) ? 'Abrir faturamento' : 'Preparar faturamento',
  }))), sorts.romaneios, (row, column) => {
    switch (column) {
      case 'operation': return [row.operation, row.destination];
      case 'control': return getOrderControlNumber(row.order.importedAt);
      case 'date': return row.order.deliveryDate;
      case 'category': return row.order.category;
      case 'action': return row.action;
      default: return '';
    }
  });
  const visibleInvoices = sortBillingRows(filteredInvoices, sorts.saved, (invoice, column) => {
    switch (column) {
      case 'company': return [invoice.company, invoice.operation];
      case 'control': return [invoice.control, invoice.destination];
      case 'type': return invoice.parentId ? 'Complemento' : 'Romaneio';
      case 'date': return invoice.date;
      case 'total': return invoiceTotal(invoice);
      case 'actions': return invoice.parentId ? 'Editar PDF' : 'Editar Complemento PDF';
      default: return '';
    }
  });
  const totals = sortBillingRows(companyTotals(visibleInvoices), sorts.report, (row, column) => {
    switch (column) {
      case 'company': return row.company;
      case 'cnpj': return row.cnpj;
      case 'count': return row.count;
      case 'base': return row.base;
      case 'complement': return row.complement;
      case 'total': return row.base + row.complement;
      default: return '';
    }
  });
  const savedIds = new Set(saved.map(row => row.invoice.id));
  const locationSource = locationBillingInvoices({ orders, operations, points, prices, invoices: saved.map(row => row.invoice), start, end, draftDate: today(), operationId, category: categoryFilter, company: companyFilter });
  const locationGroups = locationTotals(locationSource, orders, points);
  const visibleLocations = sortBillingRows(locationGroups.filter(row => !locationFilter || row.key === locationFilter), sorts.locations, (row, column) => {
    switch (column) {
      case 'operation': return row.operation;
      case 'destination': return row.destination;
      case 'count': return row.count;
      case 'complementCount': return row.complementCount;
      case 'base': return row.base;
      case 'complement': return row.complement;
      case 'total': return row.total;
      default: return '';
    }
  });
  const locationGrandTotal = Math.round(visibleLocations.reduce((sum, row) => sum + row.total, 0) * 100) / 100;
  const locationInvoices = visibleLocations.flatMap(row => row.invoices);
  const pendingLocationCount = locationInvoices.filter(invoice => !savedIds.has(invoice.id)).length;
  const expandedGroup = visibleLocations.find(row => row.key === expandedLocation);
  const open = (invoice: BillingInvoice, savedVersion: string | null) => { setDraft(structuredClone(invoice)); setVersion(savedVersion); setMessage(''); };
  function importDelivery(order: BillingOrder, delivery: BillingOrder['deliveries'][number]) {
    const id = `${BILLING_PREFIX}${order.id}_${delivery.id}`;
    const existing = saved.find(row => row.invoice.id === id);
    if (existing) return open({ ...existing.invoice, deliveryDate: order.deliveryDate, deliveryPointId: existing.invoice.deliveryPointId || delivery.deliveryPointId }, existing.version);
    open(createDeliveryBillingInvoice(order, delivery, operations.find(op => op.id === order.operationId), points.find(point => point.id === delivery.deliveryPointId), prices, today()), null);
  }
  function complement(invoice: BillingInvoice) {
    open({ ...structuredClone(invoice), id: `${BILLING_PREFIX}${crypto.randomUUID()}`, parentId: invoice.id, date: today(), notes: '', items: [newItem()] }, null);
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!draft || busy || !ready) return;
    const errorMessage = validateInvoice(draft); if (errorMessage) return setMessage(errorMessage);
    setBusy(true); setMessage('');
    try {
      const invoice = { ...draft, company: draft.company.trim(), cnpj: draft.cnpj.trim() };
      const row = { key: invoice.id, value: invoice, updated_at: new Date().toISOString() };
      const result = version
        ? await supabase.from('app_shared_state').update(row).eq('key', invoice.id).eq('updated_at', version).select('updated_at').single()
        : await supabase.from('app_shared_state').insert(row).select('updated_at').single();
      if (result.error || !result.data) throw new Error('Não foi possível salvar. Este romaneio pode ter sido alterado por outro usuário. Atualize os dados antes de tentar novamente.');
      setSaved(current => [...current.filter(item => item.invoice.id !== invoice.id), { invoice, version: result.data.updated_at }]);
      setDraft(null); setTab('saved'); setMessage('Romaneio de faturamento salvo com sucesso.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha ao salvar. Tente novamente.'); }
    finally { setBusy(false); }
  }
  async function exportPdf(invoice?: BillingInvoice) {
    try {
      const doc = new jsPDF({ orientation: 'landscape' });
      await addPdfHeader(doc, { title: invoice ? `Faturamento IGEVE - ${invoice.parentId ? 'Complemento' : 'Romaneio'}` : tab === 'locations' ? 'Faturamento IGEVE por operação/local' : 'Faturamento IGEVE por empresa', subtitle: invoice ? `${invoice.company} | CNPJ: ${invoice.cnpj || '-'} | ${dateLabel(invoice.date)}` : `Período de ${tab === 'locations' ? 'entrega' : 'faturamento'}: ${dateLabel(start) || 'início'} a ${dateLabel(end) || 'hoje'}`, footer: !invoice && tab === 'locations' && pendingLocationCount ? `${pendingLocationCount} romaneio(s) a preparar: valores estimados; itens sem preço cadastrado valem zero.` : undefined });
      if (invoice) {
        doc.setFontSize(10);
        const info = `${invoice.operation} | ${invoice.destination} | Controle: ${invoice.control} | ${invoice.category}`;
        const infoLines = doc.splitTextToSize(info, 275);
        doc.text(infoLines, 10, 42);
        const parent = saved.find(row => row.invoice.id === invoice.parentId)?.invoice;
        const notes = [invoice.parentId ? `Complemento do controle ${parent?.control || invoice.control}` : '', invoice.notes].filter(Boolean).join(' | ');
        autoTable(doc, { startY: 45 + infoLines.length * 5, head: [['Produto', 'Unidade', 'Quantidade', 'Preço unitário', 'Total']], body: invoice.items.map(item => [item.product, item.unit, item.quantity, money(item.price), money(lineTotal(item))]), foot: [['TOTAL', '', '', '', money(invoiceTotal(invoice))]] });
        if (notes) { doc.addPage(); doc.text(doc.splitTextToSize(`Observações: ${notes}`, 275), 10, 20); }
      } else if (tab === 'locations') {
        autoTable(doc, { startY: 40, head: [['Operação', 'Local', 'Romaneios', 'Qtd. complementos', 'Faturamento base', 'Complementos', 'Total']], body: visibleLocations.map(row => [row.operation, row.destination, row.count, row.complementCount, money(row.base), money(row.complement), money(row.total)]), foot: [['TOTAL', '', visibleLocations.reduce((sum, row) => sum + row.count, 0), visibleLocations.reduce((sum, row) => sum + row.complementCount, 0), '', '', money(locationGrandTotal)]] });
        doc.addPage();
        autoTable(doc, { head: [['Operação / local', 'Empresa', 'Controle', 'Categoria', 'Tipo', 'Entrega', 'Situação', 'Total']], body: locationInvoices.map(item => [`${item.operation} / ${item.destination}`, item.company, item.control, item.category, item.parentId ? 'Complemento' : 'Romaneio', dateLabel(item.deliveryDate || ''), savedIds.has(item.id) ? 'Salvo' : 'A preparar', money(invoiceTotal(item))]) });
      } else {
        autoTable(doc, { startY: 40, head: [['Empresa', 'CNPJ', 'Romaneios', 'Faturamento base', 'Complementos', 'Total']], body: totals.map(row => [row.company, row.cnpj, row.count, money(row.base), money(row.complement), money(row.base + row.complement)]), foot: [['TOTAL', '', visibleInvoices.length, '', '', money(visibleInvoices.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0))]] });
        doc.addPage();
        autoTable(doc, { head: [['Empresa', 'Operação / local', 'Controle', 'Tipo', 'Data faturamento', 'Total']], body: visibleInvoices.map(item => [item.company, `${item.operation} / ${item.destination}`, item.control, item.parentId ? 'Complemento' : 'Romaneio', dateLabel(item.date), money(invoiceTotal(item))]) });
      }
      doc.save(invoice ? `faturamento-${invoice.control}-${invoice.id.slice(-8)}.pdf` : tab === 'locations' ? 'faturamento-igeve-locais.pdf' : 'faturamento-igeve-empresas.pdf');
    } catch { setMessage('Não foi possível gerar o PDF. Tente novamente.'); }
  }
  function exportExcel() {
    const workbook = XLSX.utils.book_new();
    if (tab === 'locations') {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(visibleLocations.map(row => ({ Operacao: row.operation, Local: row.destination, Romaneios: row.count, QuantidadeComplementos: row.complementCount, Base: row.base, Complementos: row.complement, Total: row.total }))), 'Por operacao e local');
    } else XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(totals.map(row => ({ Empresa: row.company, CNPJ: row.cnpj, Romaneios: row.count, Base: row.base, Complementos: row.complement, Total: row.base + row.complement }))), 'Por empresa');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet((tab === 'locations' ? locationInvoices : visibleInvoices).flatMap(invoice => invoice.items.map(item => ({ Empresa: invoice.company, CNPJ: invoice.cnpj, Operacao: invoice.operation, Local: invoice.destination, Controle: invoice.control, Tipo: invoice.parentId ? 'Complemento' : 'Romaneio', Vinculo: invoice.parentId || '', Data: tab === 'locations' && !savedIds.has(invoice.id) ? '' : invoice.date, ...(tab === 'locations' ? { Entrega: invoice.deliveryDate || '', Situacao: savedIds.has(invoice.id) ? 'Salvo' : 'A preparar' } : {}), Produto: item.product, Unidade: item.unit, Quantidade: item.quantity, Preco: item.price, Total: lineTotal(item) })))), 'Detalhamento');
    XLSX.writeFile(workbook, tab === 'locations' ? 'faturamento-igeve-locais.xlsx' : 'faturamento-igeve-empresas.xlsx');
  }
  return <section className="igeve-billing">
    <div className="igeve-heading"><div><h1>Faturamento IGEVE</h1><p>Romaneios e complementos com valores próprios para faturamento.</p></div><button className="button button-outline" disabled={busy || !!draft} onClick={() => void load()}><RefreshCw size={18} /> Atualizar</button></div>
    <nav className="igeve-actions" aria-label="Faturamento IGEVE">{[['romaneios', 'Faturamento por romaneio'], ['saved', 'Romaneios de faturamento'], ['locations', 'Faturamento por operação/local'], ['report', 'Relatório por empresas']].map(([id, label]) => <button key={id} className={`button ${tab !== id ? 'button-outline' : ''}`} onClick={() => setTab(id)}>{label}</button>)}</nav>
    <div className="card igeve-panel"><div className="igeve-filters">
      <label>Operação<select className="input-field" value={operationId} onChange={event => { setOperationId(event.target.value); setLocationFilter(''); }}><option value="">Todas as operações IGEVE</option>{operations.map(op => <option key={op.id} value={op.id}>{op.name}</option>)}</select></label>
      <label>Categoria<select className="input-field" value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="">Todas as categorias</option>{categories.map(category => <option key={category} value={category}>{category}</option>)}</select></label>
      <label>{tab === 'romaneios' || tab === 'locations' ? 'Entrega de' : 'Faturamento de'}<input className="input-field" type="date" value={start} onChange={event => setStart(event.target.value)} /></label>
      <label>Até<input className="input-field" type="date" value={end} onChange={event => setEnd(event.target.value)} /></label>
      {tab !== 'romaneios' && <label>Empresa<select className="input-field" value={companyFilter} onChange={event => setCompanyFilter(event.target.value)}><option value="">Todas as empresas</option>{[...new Set(saved.map(row => row.invoice.company))].sort().map(name => <option key={name}>{name}</option>)}</select></label>}
      {tab === 'locations' && <label>Local<select className="input-field" value={locationFilter} onChange={event => setLocationFilter(event.target.value)}><option value="">Todos os locais</option>{locationFilter && !locationGroups.some(row => row.key === locationFilter) && <option value={locationFilter}>Local selecionado (sem faturamento nos filtros atuais)</option>}{locationGroups.map(row => <option key={row.key} value={row.key}>{row.operation} / {row.destination}</option>)}</select></label>}
    </div><small>Maceió, Guaianases, Boituva, Mongaguá e Rio de Janeiro. Alterações aqui são exclusivas do faturamento.</small></div>
    {message && <div className="card igeve-panel" role="status">{message}</div>}
    {!validPeriod && <div role="alert">A data inicial deve ser anterior ou igual à data final.</div>}
    {busy && <p role="status">Processando...</p>}
    {ready && tab === 'romaneios' && <div className="card igeve-panel"><h2>Romaneios disponíveis</h2><div className="table-container"><table><thead><tr>{header('operation', 'Operação / local')}{header('control', 'Controle')}{header('date', 'Entrega')}{header('category', 'Categoria')}{header('action', 'Ação')}</tr></thead><tbody>
      {availableRows.map(({ order, delivery, operation, destination, action }) => <tr key={`${order.id}-${delivery.id}`}><td>{operation}<br />{destination}</td><td>{getOrderControlNumber(order.importedAt)}</td><td>{dateLabel(order.deliveryDate)}</td><td>{order.category}</td><td><button disabled={busy} className="button button-outline" onClick={() => importDelivery(order, delivery)}>{action}</button></td></tr>)}
      {!availableRows.length && <tr><td colSpan={5}>Nenhum romaneio encontrado. Confira a categoria, o período e as operações cadastradas em Operações.</td></tr>}
    </tbody></table></div></div>}
    {ready && tab === 'saved' && <div className="card igeve-panel"><h2>Romaneios de faturamento</h2><div className="table-container"><table><thead><tr>{header('company', 'Empresa / operação')}{header('control', 'Controle / local')}{header('type', 'Tipo')}{header('date', 'Data')}{header('total', 'Total')}{header('actions', 'Ações')}</tr></thead><tbody>{visibleInvoices.map(invoice => <tr key={invoice.id}><td>{invoice.company}<br />{invoice.operation}</td><td>{invoice.control}<br />{invoice.destination}</td><td>{invoice.parentId ? 'Complemento' : 'Romaneio'}</td><td>{dateLabel(invoice.date)}</td><td>{money(invoiceTotal(invoice))}</td><td><div className="igeve-actions"><button className="button button-outline" disabled={busy} onClick={() => open(invoice, saved.find(row => row.invoice.id === invoice.id)!.version)}>Editar</button>{!invoice.parentId && <button className="button button-outline" disabled={busy} onClick={() => complement(invoice)}><Plus size={16} /> Complemento</button>}<button className="button button-outline" onClick={() => void exportPdf(invoice)}><FileText size={16} /> PDF</button></div></td></tr>)}{!visibleInvoices.length && <tr><td colSpan={6}>Nenhum faturamento salvo neste período.</td></tr>}</tbody></table></div></div>}
    {ready && tab === 'locations' && <div className="card igeve-panel">
      <div className="igeve-heading"><div><h2>Faturamento por operação/local</h2><p>Soma dos romaneios de cada local pela data de entrega. Valores salvos são preservados; romaneios a preparar usam os preços de venda cadastrados.</p></div><div className="igeve-actions"><button className="button button-outline" disabled={!visibleLocations.length} onClick={() => void exportPdf()}>Exportar PDF</button><button className="button button-outline" disabled={!visibleLocations.length} onClick={exportExcel}>Exportar Excel</button></div></div>
      {pendingLocationCount > 0 && <p role="status">{pendingLocationCount} romaneio(s) a preparar, com valores estimados pelos preços de venda atuais. Confira os preços ao preparar o faturamento. Itens sem preço cadastrado entram com valor zero.</p>}
      <div className="table-container"><table><thead><tr>{header('operation', 'Operação')}{header('destination', 'Local')}{header('count', 'Romaneios')}{header('complementCount', 'Qtd. complementos')}{header('base', 'Faturamento base')}{header('complement', 'Complementos')}{header('total', 'Total')}<th scope="col">Detalhamento</th></tr></thead>
        <tbody>{visibleLocations.map(row => <tr key={row.key}><td>{row.operation}</td><td>{row.destination}</td><td>{row.count}</td><td>{row.complementCount}</td><td>{money(row.base)}</td><td>{money(row.complement)}</td><td>{money(row.total)}</td><td><button className="button button-outline" aria-expanded={expandedGroup?.key === row.key} aria-controls="igeve-location-details" onClick={() => setExpandedLocation(current => current === row.key ? '' : row.key)}>{expandedGroup?.key === row.key ? 'Ocultar romaneios' : 'Ver romaneios'}</button></td></tr>)}{!visibleLocations.length && <tr><td colSpan={8}>Nenhum romaneio encontrado para o período de entrega e os filtros selecionados.</td></tr>}</tbody>
        <tfoot><tr><th colSpan={6}>Total geral</th><td><strong>{money(locationGrandTotal)}</strong></td><td /></tr></tfoot>
      </table></div>
      {expandedGroup && <div id="igeve-location-details"><h3>{expandedGroup.operation} / {expandedGroup.destination}</h3><div className="table-container"><table><thead><tr><th>Controle</th><th>Empresa</th><th>Categoria</th><th>Tipo</th><th>Entrega</th><th>Situação</th><th>Total</th><th>Ação</th></tr></thead><tbody>{expandedGroup.invoices.map(invoice => <tr key={invoice.id}><td>{invoice.control}</td><td>{invoice.company || 'A definir'}</td><td>{invoice.category}</td><td>{invoice.parentId ? 'Complemento' : 'Romaneio'}</td><td>{dateLabel(invoice.deliveryDate || '')}</td><td>{savedIds.has(invoice.id) ? 'Salvo' : 'A preparar'}</td><td>{money(invoiceTotal(invoice))}</td><td><button className="button button-outline" disabled={busy} onClick={() => { const existing = saved.find(row => row.invoice.id === invoice.id); open(existing ? { ...existing.invoice, deliveryDate: invoice.deliveryDate, deliveryPointId: invoice.deliveryPointId } : { ...invoice, date: today() }, existing?.version || null); }}>{savedIds.has(invoice.id) ? 'Abrir faturamento' : 'Preparar faturamento'}</button></td></tr>)}</tbody></table></div></div>}
    </div>}
    {ready && tab === 'report' && <div className="card igeve-panel"><div className="igeve-heading"><h2>Faturamento por empresas</h2><div className="igeve-actions"><button className="button button-outline" disabled={!totals.length} onClick={() => void exportPdf()}>Exportar PDF</button><button className="button button-outline" disabled={!totals.length} onClick={exportExcel}>Exportar Excel</button></div></div><div className="table-container"><table><thead><tr>{header('company', 'Empresa')}{header('cnpj', 'CNPJ')}{header('count', 'Romaneios')}{header('base', 'Base')}{header('complement', 'Complementos')}{header('total', 'Total')}</tr></thead><tbody>{totals.map(row => <tr key={row.cnpj || row.company}><td>{row.company}</td><td>{row.cnpj || '-'}</td><td>{row.count}</td><td>{money(row.base)}</td><td>{money(row.complement)}</td><td>{money(row.base + row.complement)}</td></tr>)}{!totals.length && <tr><td colSpan={6}>Nenhum faturamento encontrado para os filtros.</td></tr>}</tbody><tfoot><tr><th colSpan={5}>Total geral</th><th>{money(visibleInvoices.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0))}</th></tr></tfoot></table></div></div>}
    {draft && <div className="igeve-editor" role="dialog" aria-modal="true" aria-label="Editar faturamento"><form className="card igeve-panel" onSubmit={event => void save(event)}><h2>{draft.parentId ? 'Romaneio de complemento' : 'Faturamento por romaneio'} — {draft.control}</h2><p>{draft.operation} · {draft.destination} · {draft.category}</p><div className="igeve-filters">
      <label>Empresa para faturamento<input required className="input-field" list="igeve-companies" value={draft.company} onChange={event => { const company = companies.find(item => item.legal_name === event.target.value); setDraft({ ...draft, company: event.target.value, cnpj: company?.cnpj || '' }); }} /><datalist id="igeve-companies">{companies.map(company => <option key={company.id} value={company.legal_name}>{company.trade_name}</option>)}</datalist></label>
      <label>CNPJ<input className="input-field" value={draft.cnpj} onChange={event => setDraft({ ...draft, cnpj: event.target.value })} /></label>
      <label>Data do faturamento<input required type="date" className="input-field" value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} /></label>
    </div><div className="table-container"><table><thead><tr><th>Produto</th><th>Unidade</th><th>Quantidade</th><th>Preço unitário (R$)</th><th>Total</th><th>Remover</th></tr></thead><tbody>{draft.items.map((item, index) => <tr key={item.id}>{(['product', 'unit', 'quantity', 'price'] as const).map(field => <td key={field}><input aria-label={`${field === 'product' ? 'Produto' : field === 'unit' ? 'Unidade' : field === 'quantity' ? 'Quantidade' : 'Preço'} ${index + 1}`} className="input-field" required type={field === 'quantity' || field === 'price' ? 'number' : 'text'} min={field === 'quantity' ? '0.001' : '0'} step={field === 'quantity' ? '0.001' : '0.01'} value={item[field]} onChange={event => setDraft({ ...draft, items: draft.items.map(row => row.id === item.id ? { ...row, [field]: field === 'quantity' || field === 'price' ? Number(event.target.value) : event.target.value } : row) })} /></td>)}<td>{money(lineTotal(item))}</td><td><button type="button" className="button button-outline" aria-label={`Remover produto ${index + 1}`} onClick={() => setDraft({ ...draft, items: draft.items.filter(row => row.id !== item.id) })}><Trash2 size={16} /></button></td></tr>)}</tbody></table></div>
      <button type="button" className="button button-outline" onClick={() => setDraft({ ...draft, items: [...draft.items, newItem()] })}><Plus size={16} /> Adicionar produto</button>
      <label>Observações<textarea className="input-field" value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label><strong>Total: {money(invoiceTotal(draft))}</strong>
      <div className="igeve-actions"><button type="submit" className="button" disabled={busy}><Save size={18} /> Salvar faturamento</button><button type="button" className="button button-outline" disabled={busy} onClick={() => { setDraft(null); setMessage(''); }}>Cancelar</button></div>
      {message && <div role="alert">{message}</div>}
    </form></div>}
  </section>;
}
