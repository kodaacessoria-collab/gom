import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, FileText, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { getOrderControlNumber } from '../lib/orderControlNumber';
import { addPdfHeader } from '../lib/pdfBranding';
import { digits, validCnpj } from '../lib/igeveDocuments';
import { billingProductsToAdd, addBillingTableProduct, billingInvoiceType, BILLING_PREFIX, BILLING_PRICE_PREFIX, billingPriceCatalog, billingPricesFromEntries, parseBillingPrice, SOURCE_KEYS, billingCategoryOptions, billingCategoryMatches, billingInvoiceCategoryMatches, sortBillingRows, createLocationBillingInvoice, refreshLocationBillingInvoices, locationInvoiceConflict, effectiveBillingInvoices, createDeliveryBillingInvoice, locationBillingInvoices, locationTotals, companyTotals, billingDateInRange, invoiceTotal, isIgeveOperation, billingCostLines, billingQuantityAdjustment, applyBillingQuantityAdjustment, billingAdjustmentLines, billingTablePrice, billingTablePriceMatch, applyBillingTablePrices, validateInvoice } from '../lib/igeveBilling';
import type { BillingInvoice, BillingOperation, BillingOrder, BillingPoint, SavedInvoice, BillingSort, SavedBillingPrice, BillingPriceEntry } from '../lib/igeveBilling';
import type { Company } from '../types';
import IgeveFreight from './IgeveFreight';
import { FREIGHT_PREFIX, billingFreightApplier, freightScopesOverlap } from '../lib/igeveFreight';
import type { BillingFreight, SavedFreight } from '../lib/igeveFreight';
import IgevePriceImport from './IgevePriceImport';
import IgevePriceTable from './IgevePriceTable';
import IgeveBillingProducts from './IgeveBillingProducts';
import IgeveRubrics from './IgeveRubrics';
import IgeveDocuments from './IgeveDocuments';
import { RUBRIC_PREFIX, withDeferredItems, rubricBalance, rubricCategory, rubricDiscountNote, rubricInvoiceDiscount, rubricMonthInvoices, rubricProposal, rubricScopeInvoices } from '../lib/igeveRubrics';
import type { MonthlyRubric, SavedRubric } from '../lib/igeveRubrics';
import { createOmBillingRomaneio, isOmLogBilling, romaneioFilename } from '../lib/igeveOmRomaneio';
import igeveLogoUrl from '../assets/igeve-logo.png';
import './IgeveBilling.css';

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const dateLabel = (value: string) => value.split('-').reverse().join('/');
const BILLING_COMPANY_PREFIX = 'gom_igeve_billing_company_';
const companyOption = (company: Company) => `${company.legal_name} — ${company.cnpj}`;
const newItem = () => ({ id: crypto.randomUUID(), product: '', unit: 'UN', quantity: 1, price: 0 });
interface SharedRow { key: string; value: unknown; updated_at: string }
async function loadInvoices(prefix = BILLING_PREFIX) {
  const rows: SharedRow[] = [];
  for (let first = 0; ; first += 500) {
    const { data, error } = await supabase.from('app_shared_state').select('key,value,updated_at')
      .like('key', `${prefix.replace(/_/g, '\\_')}%`).order('key').range(first, first + 499);
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
  const [documentsOpened, setDocumentsOpened] = useState(false);
  const [operations, setOperations] = useState<BillingOperation[]>([]);
  const [orders, setOrders] = useState<BillingOrder[]>([]);
  const [points, setPoints] = useState<BillingPoint[]>([]);
  const [savedPrices, setSavedPrices] = useState<SavedBillingPrice[]>([]);
  const [importedPrices, setImportedPrices] = useState<BillingPriceEntry[]>([]);
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const prices = useMemo(() => billingPricesFromEntries(savedPrices.map(row => row.entry), operations), [savedPrices, operations]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyNotice, setCompanyNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [rawSaved, setSaved] = useState<SavedInvoice[]>([]);
  const [freights, setFreights] = useState<SavedFreight[]>([]);
  const [rubrics, setRubrics] = useState<SavedRubric[]>([]);
  const [draft, setDraft] = useState<BillingInvoice | null>(null);
  const [quantityAdjustments, setQuantityAdjustments] = useState<Record<string, string>>({});
  const [adjustmentCategory, setAdjustmentCategory] = useState('');
  const [priceTableSelection, setPriceTableSelection] = useState('');
  const [version, setVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [operationId, setOperationId] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [locationFilter, setLocationFilter] = useState('');
  const [expandedLocation, setExpandedLocation] = useState('');
  const [sorts, setSorts] = useState<Record<string, BillingSort>>({});
  const sort = sorts[tab];
  const changeSort = (column: string) => setSorts(current => ({ ...current, [tab]: { column, direction: current[tab]?.column === column && current[tab].direction === 'asc' ? 'desc' : 'asc' } }));
  const header = (column: string, label: string) => <SortHeader key={column} column={column} label={label} sort={sort} onSort={changeSort} />;
  const [start, setStart] = useState(`${today().slice(0, 7)}-01`);
  const [end, setEnd] = useState(today());

  const freightSource = { orders, operations, points, prices, date: today(), invoices: draft ? [...rawSaved.filter(row => row.invoice.id !== draft.id).map(row => row.invoice), draft] : rawSaved.map(row => row.invoice) };
  const applyFreight = billingFreightApplier(freightSource, freights.map(row => row.freight));
  const refreshedSaved = useMemo(() => refreshLocationBillingInvoices(rawSaved, orders, prices), [rawSaved, orders, prices]);
  const saved = refreshedSaved.map(row => ({ ...row, invoice: applyFreight(row.invoice) }));
  async function saveFreight(freight: BillingFreight, previousVersion: string | null) {
    if (busy || !ready) return false;
    if (freights.some(row => freightScopesOverlap(row.freight, freight))) {
      setMessage('Já existe frete para parte destas categorias e datas. Reabra os filtros do rateio anterior e remova-o antes de salvar um conjunto sobreposto.'); return false;
    }
    setBusy(true); setMessage('');
    try {
      const row = { key: freight.key, value: freight, updated_at: new Date().toISOString() };
      const result = previousVersion
        ? await supabase.from('app_shared_state').update(row).eq('key', freight.key).eq('updated_at', previousVersion).select('updated_at').single()
        : await supabase.from('app_shared_state').insert(row).select('updated_at').single();
      if (result.error || !result.data) throw new Error('Não foi possível salvar o frete. Atualize os dados antes de tentar novamente.');
      setFreights(current => [...current.filter(item => item.freight.key !== freight.key), { freight, version: result.data.updated_at }]);
      setMessage(freight.amount ? 'Frete salvo e rateado entre todos os romaneios filtrados.' : 'Frete removido deste conjunto de romaneios.');
      return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha ao salvar frete.'); return false; }
    finally { setBusy(false); }
  }

  async function load() {
    setBusy(true); setMessage(''); setReady(false);
    try {
      const [source, invoices, companyResult, billingCompanies, priceRows, rubricRows, freightRows] = await Promise.all([
        supabase.from('app_shared_state').select('key,value').in('key', SOURCE_KEYS),
        loadInvoices(),
        supabase.from('companies').select('*').order('legal_name'),
        loadInvoices(BILLING_COMPANY_PREFIX).catch(() => null),
        loadInvoices(BILLING_PRICE_PREFIX),
        loadInvoices(RUBRIC_PREFIX),
        loadInvoices(FREIGHT_PREFIX),
      ]);
      if (source.error) throw source.error;
      const map = new Map((source.data || []).map(row => [row.key, row.value]));
      setOperations(((map.get(SOURCE_KEYS[0]) || []) as BillingOperation[]).filter(isIgeveOperation));
      setPoints(map.get(SOURCE_KEYS[1]) || []); setOrders(map.get(SOURCE_KEYS[2]) || []);
      setFreights(freightRows.map(row => ({ freight: row.value as BillingFreight, version: row.updated_at })));
      setRubrics(rubricRows.map(row => ({ rubric: row.value as MonthlyRubric, version: row.updated_at })));
      setSavedPrices(priceRows.map(row => ({ entry: row.value as BillingPriceEntry, version: row.updated_at })));
      setSaved(invoices.map(row => ({ invoice: row.value as BillingInvoice, version: row.updated_at })));
      const baseCompanies = (companyResult.data || []) as Company[];
      const baseCnpjs = new Set(baseCompanies.map(company => digits(company.cnpj)));
      const extraCompanies = (billingCompanies || []).map(row => row.value as Company)
        .filter(company => !baseCnpjs.has(digits(company.cnpj)));
      setCompanies([...baseCompanies, ...extraCompanies].sort((a, b) => a.legal_name.localeCompare(b.legal_name, 'pt-BR')));
      setReady(true);
      if (companyResult.error || billingCompanies === null) setMessage('Parte do cadastro de empresas está indisponível. Você pode informar a empresa manualmente.');
    } catch { setMessage('Não foi possível carregar o faturamento. Clique em Atualizar para tentar novamente.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  const validPeriod = !start || !end || start <= end;
  const filteredOrders = orders.filter(order => validPeriod && operations.some(op => op.id === order.operationId) && (!operationId || order.operationId === operationId) && billingCategoryMatches(order.category, categoryFilter) && billingDateInRange(order.deliveryDate, start, end));
  const unifiedBilling = categoryFilter.length > 1 || (!categoryFilter.length && new Set(filteredOrders.map(order => order.category)).size > 1);
  const filteredInvoices = effectiveBillingInvoices(saved.map(row => row.invoice)).filter(invoice => validPeriod && (!operationId || invoice.operationId === operationId) && (!companyFilter || invoice.company === companyFilter) && billingInvoiceCategoryMatches(invoice, categoryFilter) && billingDateInRange(invoice.date, start, end));
  const categories = billingCategoryOptions([
    ...orders.filter(order => operations.some(op => op.id === order.operationId)).map(order => order.category),
    ...saved.filter(row => !row.invoice.location).map(row => row.invoice.category),
    ...saved.flatMap(row => row.invoice.location?.categories || []),
    ...savedPrices.map(row => row.entry.category),
    ...categoryFilter,
  ]);
  const priceCatalog = billingPriceCatalog(orders, operations, saved.map(row => row.invoice), [...savedPrices.map(row => row.entry), ...importedPrices]);
  const visiblePrices = sortBillingRows(priceCatalog.filter(row => (!operationId || row.operationId === operationId) && billingCategoryMatches(row.category, categoryFilter)).map(row => ({ ...row, operation: operations.find(operation => operation.id === row.operationId)?.name || row.operationId })), sorts.prices, (row, column) => {
    switch (column) {
      case 'operation': return row.operation;
      case 'category': return row.category;
      case 'product': return row.product;
      case 'unit': return row.unit;
      case 'price': return row.salePrice ?? -1;
      case 'status': return row.salePrice === null ? 'Pendente' : 'Cadastrado';
      default: return '';
    }
  });
  function editPrice(key: string, value: string) {
    setPriceEdits(current => {
      const next = { ...current };
      const original = priceCatalog.find(row => row.key === key)?.salePrice;
      if (!importedPrices.some(row => row.key === key) && value === (original == null ? '' : String(original))) delete next[key];
      else next[key] = value;
      return next;
    });
  }
  async function savePrices(event: FormEvent) {
    event.preventDefault(); if (busy || !ready) return;
    const changes = Object.entries(priceEdits);
    if (!changes.length) return;
    let entries: BillingPriceEntry[];
    try {
      entries = changes.map(([key, value]) => {
        const item = priceCatalog.find(row => row.key === key);
        if (!item) throw new Error('Produto não encontrado. Atualize a tabela.');
        return { ...item, salePrice: parseBillingPrice(value), identityVersion: 1 as const };
      });
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Preço inválido.'); return; }
    await persistPrices(entries);
  }
  function stagePrices(entries: BillingPriceEntry[]) {
    const keys = new Set(entries.map(entry => entry.key));
    setImportedPrices(current => [...current.filter(row => !keys.has(row.key)), ...entries]);
    setPriceEdits(current => ({ ...current, ...Object.fromEntries(entries.map(entry => [entry.key, String(entry.salePrice)])) }));
    setOperationId(entries[0].operationId);
    setCategoryFilter([entries[0].category]);
  }
  async function persistPrices(entries: BillingPriceEntry[], batchSize = 1) {
    if (busy || !ready) return;
    setBusy(true); setMessage('Salvando preços na tabela...');
    let count = 0;
    const existing = new Map(savedPrices.map(row => [row.entry.key, row.version]));
    const recordSaved = (saved: SavedBillingPrice[]) => {
      const keys = new Set(saved.map(row => row.entry.key));
      setSavedPrices(current => [...current.filter(row => !keys.has(row.entry.key)), ...saved]);
      setPriceEdits(current => Object.fromEntries(Object.entries(current).filter(([key]) => !keys.has(key))));
      setImportedPrices(current => current.filter(item => !keys.has(item.key)));
      count += saved.length;
    };
    const toRow = (entry: BillingPriceEntry) => ({ key: entry.key, value: entry, updated_at: new Date().toISOString() });
    try {
      const newEntries = entries.filter(entry => !existing.has(entry.key));
      for (let index = 0; index < newEntries.length; index += batchSize) {
        const batch = newEntries.slice(index, index + batchSize);
        if (batch.length === 1) {
          const [entry] = batch;
          const { data, error } = await supabase.from('app_shared_state').insert(toRow(entry)).select('updated_at').single();
          if (error || !data) throw new Error(`Não foi possível salvar o preço de ${entry.product}. Atualize a tabela e tente novamente.`);
          recordSaved([{ entry, version: data.updated_at }]);
        } else {
          const { data, error } = await supabase.from('app_shared_state').insert(batch.map(toRow)).select('key,updated_at');
          const versions = new Map((data || []).map(row => [row.key, row.updated_at]));
          if (error || batch.some(entry => !versions.has(entry.key))) throw new Error('Não foi possível gravar os novos preços. Confira a conexão ou atualize a tabela se outro usuário alterou os preços.');
          recordSaved(batch.map(entry => ({ entry, version: versions.get(entry.key)! })));
        }
      }
      for (const entry of entries.filter(entry => existing.has(entry.key))) {
        const result = await supabase.from('app_shared_state').update(toRow(entry)).eq('key', entry.key).eq('updated_at', existing.get(entry.key)!).select('updated_at').single();
        if (result.error || !result.data) throw new Error(`Não foi possível atualizar o preço de ${entry.product}. Atualize a tabela e confira se o valor foi alterado por outro usuário.`);
        recordSaved([{ entry, version: result.data.updated_at }]);
      }
      setMessage(`${count} preço(s) salvo(s) com sucesso. Novos faturamentos usarão a tabela da operação e categoria.`);
    } catch (error) { setMessage(`${count ? `${count} preço(s) já salvo(s). ` : ''}${error instanceof Error ? error.message : 'Falha ao salvar preços. Tente novamente.'}`); }
    finally { setBusy(false); }
  }
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
      case 'type': return billingInvoiceType(invoice);
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
  const locationSource = locationBillingInvoices({ orders, operations, points, prices, invoices: saved.map(row => row.invoice), start, end, draftDate: today(), operationId, category: categoryFilter, company: '' }).map(applyFreight);
  const storedLocations = saved.filter(({ invoice }) => invoice.location && validPeriod &&
    (!operationId || invoice.operationId === operationId) &&
    (!start || !invoice.location.end || invoice.location.end >= start) &&
    (!end || !invoice.location.start || invoice.location.start <= end) &&
    billingInvoiceCategoryMatches(invoice, categoryFilter));
  const outstandingSources = effectiveBillingInvoices([...locationSource, ...storedLocations.map(row => row.invoice)])
    .filter(invoice => !invoice.location);
  const preparedLocations = [
    ...storedLocations.map(stored => {
      const invoice = stored.invoice;
      const context = invoice.location!;
      const group = locationTotals([invoice], orders, points)[0];
      const sources = new Set(context.sourceIds);
      const deliveries = new Set(context.deliveryKeys);
      const origins = locationSource.filter(source => sources.has(source.id) || (!source.parentId &&
        deliveries.has(JSON.stringify([source.sourceOrderId, source.sourceDeliveryId]))));
      return { ...group, key: context.groupKey || group.key, count: context.count, products: invoice.items.length, invoices: origins, invoice, stored };
    }),
    ...locationTotals(outstandingSources, orders, points).map(group => {
      const preview = createLocationBillingInvoice(group, orders, prices, start, end, categoryFilter, today());
      if (savedIds.has(preview.id)) {
        const firstSource = [...preview.location!.sourceIds].sort()[0];
        preview.id += `_adicional_${encodeURIComponent(firstSource)}`;
      }
      const invoice = applyFreight(preview);
      return { ...group, count: invoice.location?.count ?? group.count, total: invoiceTotal(invoice), products: invoice.items.length, invoice, stored: undefined };
    }),
  ];
  const locationGroups = [...new Map(preparedLocations.map(row => [row.key, row])).values()];
  const unifiedRows = sortBillingRows(preparedLocations, sorts.romaneios, (row, column) => {
    switch (column) {
      case 'operation': return [row.operation, row.destination];
      case 'control': return row.count;
      case 'date': return row.invoice.location?.start || '';
      case 'category': return row.invoice.category;
      case 'action': return row.stored ? 'Abrir faturamento unificado' : 'Preparar faturamento unificado';
      default: return '';
    }
  });
  const visibleLocations = sortBillingRows(preparedLocations.filter(row => !locationFilter || row.key === locationFilter), sorts.locations, (row, column) => {
    switch (column) {
      case 'operation': return row.operation;
      case 'destination': return row.destination;
      case 'count': return row.count;
      case 'complementCount': return row.complementCount;
      case 'base': return row.base;
      case 'complement': return row.complement;
      case 'total': return row.total;
      case 'products': return row.products;
      default: return '';
    }
  });
  const locationGrandTotal = Math.round(visibleLocations.reduce((sum, row) => sum + row.total, 0) * 100) / 100;
  const pendingLocationCount = visibleLocations.filter(row => !row.stored).length;
  const expandedGroup = visibleLocations.find(row => row.invoice.id === expandedLocation);
  const open = (invoice: BillingInvoice, savedVersion: string | null) => { setDraft(structuredClone(applyFreight(invoice))); setVersion(savedVersion); setQuantityAdjustments(Object.fromEntries(invoice.items.map(item => { const adjustment = billingQuantityAdjustment(item); return [item.id, adjustment ? String(adjustment) : '']; }))); setAdjustmentCategory(''); setPriceTableSelection(invoice.priceTableOperationId || invoice.operationId); setCompanyNotice(null); setMessage(''); };
  function importDelivery(order: BillingOrder, delivery: BillingOrder['deliveries'][number]) {
    const id = `${BILLING_PREFIX}${order.id}_${delivery.id}`;
    const existing = saved.find(row => row.invoice.id === id);
    if (existing) return open({ ...existing.invoice, deliveryDate: order.deliveryDate, deliveryPointId: existing.invoice.deliveryPointId || delivery.deliveryPointId }, existing.version);
    open(createDeliveryBillingInvoice(order, delivery, operations.find(op => op.id === order.operationId), points.find(point => point.id === delivery.deliveryPointId), prices, today()), null);
  }
  function complement(invoice: BillingInvoice) {
    open({ ...structuredClone(invoice), id: `${BILLING_PREFIX}${crypto.randomUUID()}`, parentId: invoice.id, date: today(), notes: '', freight: undefined, batchFreight: undefined, rubricDiscount: undefined, items: [newItem()] }, null);
  }
  async function saveRubric(rubric: MonthlyRubric, previousVersion: string | null): Promise<boolean> {
    if (busy || !ready) return false;
    if (!Number.isFinite(rubric.amount) || rubric.amount <= 0 || !Number.isFinite(rubric.previousAdjustment) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(rubric.month) || (rubric.previousAdjustment !== 0 && !rubric.adjustmentNotes.trim())) {
      setMessage('Informe a rubrica positiva, o mês e a referência do ajuste anterior.'); return false;
    }
    if (rubric.proportional && !rubricProposal(rubric)) {
      setMessage('Confira Proteínas já faturadas, o ajuste anterior e as bases mensais.'); return false;
    }
    setBusy(true); setMessage('');
    try {
      const row = { key: rubric.key, value: rubric, updated_at: new Date().toISOString() };
      const result = previousVersion
        ? await supabase.from('app_shared_state').update(row).eq('key', rubric.key).eq('updated_at', previousVersion).select('updated_at').single()
        : await supabase.from('app_shared_state').insert(row).select('updated_at').single();
      if (result.error || !result.data) throw new Error('Não foi possível salvar a rubrica. Ela pode ter sido alterada por outro usuário. Atualize antes de tentar novamente.');
      setRubrics(current => [...current.filter(item => item.rubric.key !== rubric.key), { rubric, version: result.data.updated_at }]);
      return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha ao salvar rubrica.'); return false; }
    finally { setBusy(false); }
  }
  const draftCosts = draft ? billingCostLines(applyFreight(draft)) : [];
  const adjustableDraft = !!draft && (!!draft.location || draft.rubric?.kind === 'reduction');
  const adjustmentError = (() => {
    if (!draft || !adjustableDraft) return '';
    try { draft.items.forEach(item => applyBillingQuantityAdjustment(item, quantityAdjustments[item.id] || '')); return ''; }
    catch (error) { return error instanceof Error ? error.message : 'Ajuste inválido.'; }
  })();
  function updateQuantityAdjustment(id: string, value: string) {
    setQuantityAdjustments(current => ({ ...current, [id]: value }));
    setDraft(current => {
      if (!current) return current;
      try { return { ...current, items: current.items.map(item => item.id === id ? applyBillingQuantityAdjustment(item, value) : item) }; }
      catch { return current; }
    });
  }
  const adjustmentCategories = [...new Set(draft?.items.map(item => item.category || draft.category) || [])].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const selectedAdjustmentCategory = adjustmentCategory || adjustmentCategories[0] || '';
  const draftMonth = draft?.rubric?.month || draft?.deliveryDate?.slice(0, 7) || draft?.location?.start.slice(0, 7);
  const draftRubric = rubrics.find(({ rubric }) => draft && (draft.rubric ? rubric.key === draft.rubric.key : rubric.operationId === draft.operationId && rubric.month === draftMonth && rubricScopeInvoices([draft], rubric, orders, points).length > 0))?.rubric;
  const draftMonthScope = draft && draftRubric ? rubricScopeInvoices(
    rubricMonthInvoices(orders, operations, points, prices, [...saved.filter(row => row.invoice.id !== draft.id).map(row => row.invoice), draft], draftRubric.month).map(applyFreight),
    draftRubric, orders, points,
  ) : [];
  const draftBalance = draftRubric ? rubricBalance(draftRubric, draftMonthScope) : null;
  const crossMonthLocation = draft?.location && (!draft.location.start || !draft.location.end || draft.location.start.slice(0, 7) !== draft.location.end.slice(0, 7));
  const draftRubricError = (() => {
    if (!draft) return '';
    if (crossMonthLocation && draft.location && rubrics.some(({ rubric }) => rubric.proportional &&
      (!draft.location!.start || rubric.month >= draft.location!.start.slice(0, 7)) &&
      (!draft.location!.end || rubric.month <= draft.location!.end.slice(0, 7)) &&
      rubricScopeInvoices([draft], rubric, orders, points).length)) {
      return 'Selecione um único mês de entrega para faturar com a rubrica proporcional.';
    }
    if (draftRubric?.proportional && draftMonthScope.some(invoice => invoice.id !== draft.id && invoice.location &&
      (invoice.location.start.slice(0, 7) !== draftRubric.month || invoice.location.end.slice(0, 7) !== draftRubric.month))) {
      return 'Há um faturamento salvo neste escopo que abrange mais de um mês. Separe-o por mês para calcular o excedente da categoria.';
    }
    if (draftRubric?.proportional && !version && draftCosts.some(row =>
      rubricCategory(row.item.category || draft.category) === 'Proteínas' && (row.item.billedQuantity ?? row.item.quantity) > 0)) {
      return 'Proteínas já constam como faturadas na rubrica. Selecione apenas as categorias a faturar ou zere a quantidade faturada de Proteínas.';
    }
    return '';
  })();
  const draftDiscount = draft && draftRubric?.proportional ? rubricInvoiceDiscount(
    draftRubric, applyFreight(draft), draftMonthScope.filter(invoice => invoice.id !== draft.id && savedIds.has(invoice.id)),
  ) : draft?.rubricDiscount;
  const pricedOperationIds = new Set(savedPrices.filter(({ entry }) => entry.salePrice !== null).map(({ entry }) => entry.operationId));
  const otherPriceTables = draft ? operations.filter(operation => operation.id !== draft.operationId &&
    (pricedOperationIds.has(operation.id) || operation.id === draft.priceTableOperationId))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) : [];
  const appliedPriceTable = draft?.priceTableOperationId
    ? otherPriceTables.find(operation => operation.id === draft.priceTableOperationId)?.name || 'Operação da tabela salva'
    : draft?.operation;
  const draftPriceLabels = draft?.items.map(item => {
    const match = billingTablePriceMatch(prices, draft, item);
    if (!match) return '';
    const source = match.operationId === (draft.priceTableOperationId || draft.operationId) ? '' :
      operations.find(operation => operation.id === match.operationId)?.name;
    return `Tabela: ${money(match.salePrice)}${source ? ` · ${source}` : ''}`;
  }) || [];
  const draftMissingPrices = draft?.items.filter((item, index) => item.price === 0 && !draftPriceLabels[index]) || [];
  function addDraftProduct(key: string, quantity: number) {
    if (!draft || busy) return false;
    try {
      const invoice = addBillingTableProduct(draft, savedPrices.map(row => row.entry), key, quantity, crypto.randomUUID());
      const item = invoice.items[invoice.items.length - 1];
      const tablePrice = billingTablePrice(prices, invoice, item);
      if (tablePrice !== undefined) item.price = tablePrice;
      setDraft(invoice);
      if (adjustableDraft) setQuantityAdjustments(current => ({ ...current, [item.id]: String(quantity) }));
      setMessage('Produto adicionado. Confira a quantidade e o preço antes de salvar o faturamento.');
      return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível adicionar o produto.'); return false; }
  }
  async function refreshDraftPrices() {
    if (!draft || busy || !priceTableSelection) return;
    if (Object.keys(priceEdits).length) {
      setMessage('Há alterações não salvas na Tabela de preços. Cancele este editor, salve os preços na tabela e reabra o faturamento para buscá-los.'); return;
    }
    setBusy(true); setMessage('');
    try {
      const rows = await loadInvoices(BILLING_PRICE_PREFIX);
      const entries = rows.map(row => ({ entry: row.value as BillingPriceEntry, version: row.updated_at }));
      const latestPrices = billingPricesFromEntries(entries.map(row => row.entry), operations);
      const result = applyBillingTablePrices(draft, latestPrices, priceTableSelection);
      setSavedPrices(entries);
      setDraft(current => current?.id === draft.id ? applyBillingTablePrices(current, latestPrices, priceTableSelection).invoice : current);
      const sourceName = operations.find(operation => operation.id === priceTableSelection)?.name || draft.operation;
      setMessage(result.updated
        ? `${result.updated} produto(s) atualizado(s) na busca por ${sourceName}. ${result.missing ? `${result.missing} sem correspondência mantiveram o preço atual.` : 'Revise os valores e salve o faturamento.'}`
        : 'Nenhum produto tem preço correspondente na tabela selecionada. Os valores atuais foram mantidos.');
    } catch { setMessage('Não foi possível buscar os preços. Os valores do faturamento foram mantidos. Tente novamente.'); }
    finally { setBusy(false); }
  }
  async function registerBillingCompany() {
    if (!draft || busy || !ready) return;
    const name = draft.company.trim();
    const cnpjInput = draft.cnpj.trim();
    if (!name || !/^[0-9./\s-]+$/.test(cnpjInput) || !validCnpj(cnpjInput)) {
      setCompanyNotice({ text: 'Informe a razão social e um CNPJ válido para cadastrar a empresa.', error: true });
      return;
    }

    const cnpjDigits = digits(cnpjInput);
    const existing = companies.find(company => digits(company.cnpj) === cnpjDigits);
    if (existing) {
      setDraft({ ...draft, company: existing.legal_name, cnpj: existing.cnpj });
      setCompanyNotice({ text: 'Este CNPJ já está cadastrado. A empresa existente foi selecionada.' });
      return;
    }

    const cnpj = cnpjDigits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    const key = `${BILLING_COMPANY_PREFIX}${cnpjDigits}`;
    const company: Company = { id: key, legal_name: name, trade_name: name, cnpj };
    setBusy(true);
    setCompanyNotice(null);
    try {
      const { error } = await supabase.from('app_shared_state').insert({ key, value: company });
      let selected = company;
      if (error?.code === '23505') {
        const { data, error: readError } = await supabase.from('app_shared_state').select('value').eq('key', key).single();
        if (readError || !data?.value) throw readError || error;
        selected = data.value as Company;
      } else if (error) {
        throw error;
      }
      setCompanies(current => [...current.filter(item => digits(item.cnpj) !== cnpjDigits), selected]
        .sort((a, b) => a.legal_name.localeCompare(b.legal_name, 'pt-BR')));
      setDraft(current => current?.id === draft.id ? { ...current, company: selected.legal_name, cnpj: selected.cnpj } : current);
      setCompanyNotice({ text: error
        ? 'Este CNPJ já está cadastrado. A empresa existente foi selecionada.'
        : 'Empresa cadastrada e selecionada para este faturamento.' });
    } catch {
      setCompanyNotice({ text: 'Não foi possível cadastrar a empresa. Confira a conexão e tente novamente.', error: true });
    } finally {
      setBusy(false);
    }
  }

  async function deleteInvoice(invoice: BillingInvoice, expectedVersion: string | null) {
    if (!ready || busy || !expectedVersion || !savedIds.has(invoice.id)) return;
    if (!window.confirm(`Excluir definitivamente o faturamento ${invoice.control} de ${invoice.company} (${invoice.destination})? Os romaneios da operação e o estoque serão preservados.`)) return;

    setBusy(true); setMessage('');
    try {
      const rows = await loadInvoices();
      const deliveryKey = JSON.stringify([invoice.sourceOrderId, invoice.sourceDeliveryId]);
      const dependent = rows.map(row => row.value as BillingInvoice).find(other => other.id !== invoice.id && (
        other.parentId === invoice.id || other.rubric?.sourceId === invoice.id ||
        other.location?.sourceIds?.includes(invoice.id) ||
        (!invoice.parentId && other.location?.deliveryKeys?.includes(deliveryKey))
      ));
      if (dependent) throw new Error(`Exclua primeiro o faturamento vinculado ${dependent.control} (${dependent.destination}).`);

      const { data, error } = await supabase.from('app_shared_state').delete()
        .eq('key', invoice.id).eq('updated_at', expectedVersion).select('key').maybeSingle();
      if (error) throw new Error('Não foi possível excluir o faturamento. Tente novamente.');
      if (!data) throw new Error('O faturamento já foi alterado ou excluído. Clique em Atualizar antes de tentar novamente.');
      setSaved(current => current.filter(row => row.invoice.id !== invoice.id));
      setDraft(null);
      setExpandedLocation(current => current === invoice.id ? '' : current);
      setMessage('Faturamento excluído com sucesso.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível excluir o faturamento. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault(); if (!draft || busy || !ready) return;
    if (adjustmentError || draftRubricError) return setMessage(adjustmentError || draftRubricError);
    if (draft.rubric?.kind === 'reduction' && saved.some(row => row.invoice.rubric?.kind === 'carry' && row.invoice.rubric.sourceId === draft.id)) return setMessage('Estes itens já foram aproveitados no mês seguinte. A redução original fica preservada; ajustes adicionais devem ser feitos no faturamento de aproveitamento.');
    const errorMessage = validateInvoice(applyFreight(draft)); if (errorMessage) return setMessage(errorMessage);
    if (locationInvoiceConflict(draft, saved.map(row => row.invoice))) return setMessage('Já existe faturamento por local incluindo um destes romaneios. Abra o registro salvo em Romaneios de faturamento para evitar cobrança duplicada.');
    setBusy(true); setMessage('');
    try {
      const invoice = withDeferredItems({ ...draft, company: draft.company.trim(), cnpj: draft.cnpj.trim() });
      invoice.rubricDiscount = draftDiscount;
      delete invoice.batchFreight;
      const row = { key: invoice.id, value: invoice, updated_at: new Date().toISOString() };
      const result = version
        ? await supabase.from('app_shared_state').update(row).eq('key', invoice.id).eq('updated_at', version).select('updated_at').single()
        : await supabase.from('app_shared_state').insert(row).select('updated_at').single();
      if (result.error || !result.data) throw new Error('Não foi possível salvar. Este romaneio pode ter sido alterado por outro usuário. Atualize os dados antes de tentar novamente.');
      setSaved(current => [...current.filter(item => item.invoice.id !== invoice.id), { invoice, version: result.data.updated_at }]);
      setDraft(null); setTab(invoice.rubric ? 'rubrics' : invoice.location ? 'locations' : 'saved'); setMessage('Faturamento salvo com sucesso.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha ao salvar. Tente novamente.'); }
    finally { setBusy(false); }
  }
  async function exportPdf(invoice?: BillingInvoice, adjustmentCategory?: string) {
    if (invoice && invoice.id === draft?.id) {
      if (adjustmentError || draftRubricError) { setMessage(adjustmentError || draftRubricError); return; }
      invoice = { ...invoice, rubricDiscount: draftDiscount };
    }
    invoice = invoice ? applyFreight(invoice) : undefined;
    try {
      if (invoice && adjustmentCategory) {
        const error = validateInvoice(invoice);
        if (error) { setMessage(error); return; }
        if (!billingAdjustmentLines(invoice, adjustmentCategory).length) { setMessage('Nenhum item ajustado nesta categoria. Informe um ajuste diferente de zero para gerar o romaneio.'); return; }
        if (isOmLogBilling(invoice)) {
          const response = await fetch(igeveLogoUrl);
          if (!response.ok) throw new Error('Logo indisponível.');
          const blob = await response.blob();
          const logo = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
          const sourceKeys = new Set(invoice.location?.deliveryKeys || []);
          const consumption = [...new Set(orders.filter(order => invoice!.location ? order.deliveries.some(delivery => sourceKeys.has(JSON.stringify([order.id, delivery.id]))) : order.id === invoice!.sourceOrderId).map(order => order.consumptionPeriod).filter(Boolean))].join(' / ');
          createOmBillingRomaneio({ ...invoice, notes: [invoice.notes, rubricDiscountNote(invoice.rubricDiscount, adjustmentCategory)].filter(Boolean).join(' | ') }, adjustmentCategory, { logo, point: points.find(point => point.id === invoice!.deliveryPointId), consumption }).save(romaneioFilename(invoice, adjustmentCategory));
          return;
        }
      }
      const doc = new jsPDF({ orientation: 'landscape' });
      await addPdfHeader(doc, { title: invoice ? adjustmentCategory ? 'Romaneio' : `Faturamento IGEVE - ${billingInvoiceType(invoice)}` : tab === 'locations' ? 'Faturamento IGEVE por operação/local' : 'Faturamento IGEVE por empresa', subtitle: invoice ? `${invoice.company} | CNPJ: ${invoice.cnpj || '-'} | ${dateLabel(invoice.date)}` : `Período de ${tab === 'locations' ? 'entrega' : 'faturamento'}: ${dateLabel(start) || 'início'} a ${dateLabel(end) || 'hoje'}`, footer: !invoice && tab === 'locations' && pendingLocationCount ? `${pendingLocationCount} local(is) a preparar: valores estimados; itens sem preço cadastrado valem zero.` : undefined });
      if (invoice) {
        doc.setFontSize(10);
        const info = `${invoice.operation} | ${invoice.destination} | Controle: ${invoice.control} | ${adjustmentCategory || invoice.category}`;
        const infoLines = doc.splitTextToSize(info, 275);
        doc.text(infoLines, 10, 42);
        const parent = saved.find(row => row.invoice.id === invoice.parentId)?.invoice;
        const costRows = adjustmentCategory ? billingAdjustmentLines(invoice, adjustmentCategory) : billingCostLines(invoice);
        const notes = [invoice.parentId ? `Complemento do controle ${parent?.control || invoice.control}` : '', invoice.notes, rubricDiscountNote(invoice.rubricDiscount, adjustmentCategory), adjustmentCategory ? `Frete rateado desta categoria: ${money(costRows.reduce((sum, row) => sum + row.freight, 0))}` : invoice.batchFreight ? `Frete rateado do conjunto de romaneios: ${money(billingCostLines(invoice).reduce((sum, row) => sum + row.freight, 0))}` : invoice.freight?.amount ? `Frete: ${money(invoice.freight.amount)} | Categoria: ${invoice.freight.category || 'Todas'} | Rateio pela quantidade faturada` : ''].filter(Boolean).join(' | ');
        autoTable(doc, { startY: 45 + infoLines.length * 5, styles: { fontSize: 8 }, head: [['Produto', 'Categoria', 'Unidade', 'Qtd. entregue', 'Ajuste (+/-)', 'Qtd. faturada', 'Preço unitário', 'Frete rateado', 'Custo unit. final', 'Total com frete']], body: costRows.map(({ item, freight, unitCost, total }) => [item.product, item.category || invoice.category, item.unit, item.quantity, billingQuantityAdjustment(item), item.billedQuantity ?? item.quantity, money(item.price), money(freight), unitCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 }), money(total)]), foot: [['TOTAL', '', '', '', '', '', '', money(costRows.reduce((sum, row) => sum + row.freight, 0)), '', money(costRows.reduce((sum, row) => sum + row.total, 0))]] });
        if (notes) { doc.addPage(); doc.text(doc.splitTextToSize(`Observações: ${notes}`, 275), 10, 20); }
      } else if (tab === 'locations') {
        autoTable(doc, { startY: 40, head: [['Operação', 'Local', 'Romaneios', 'Produtos', 'Situação', 'Total']], body: visibleLocations.map(row => [row.operation, row.destination, row.count, row.products, row.stored ? 'Salvo' : 'A preparar', money(row.total)]), foot: [['TOTAL', '', '', '', '', money(locationGrandTotal)]] });
        doc.addPage();
        autoTable(doc, { styles: { fontSize: 8 }, head: [['Operação / local', 'Produto', 'Categoria', 'Unidade', 'Qtd. entregue', 'Ajuste (+/-)', 'Qtd. faturada', 'Preço unitário', 'Frete rateado', 'Custo unit. final', 'Total com frete']], body: visibleLocations.flatMap(row => billingCostLines(row.invoice).map(({ item, freight, unitCost, total }) => [`${row.operation} / ${row.destination}`, item.product, item.category || row.invoice.category, item.unit, item.quantity, billingQuantityAdjustment(item), item.billedQuantity ?? item.quantity, money(item.price), money(freight), unitCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 }), money(total)])) });
      } else {
        autoTable(doc, { startY: 40, head: [['Empresa', 'CNPJ', 'Romaneios', 'Faturamento base', 'Complementos', 'Total']], body: totals.map(row => [row.company, row.cnpj, row.count, money(row.base), money(row.complement), money(row.base + row.complement)]), foot: [['TOTAL', '', visibleInvoices.length, '', '', money(visibleInvoices.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0))]] });
        doc.addPage();
        autoTable(doc, { head: [['Empresa', 'Operação / local', 'Controle', 'Tipo', 'Data faturamento', 'Total']], body: visibleInvoices.map(item => [item.company, `${item.operation} / ${item.destination}`, item.control, billingInvoiceType(item), dateLabel(item.date), money(invoiceTotal(item))]) });
      }
      doc.save(invoice && adjustmentCategory ? romaneioFilename(invoice, adjustmentCategory) : invoice ? `faturamento-${invoice.control}-${invoice.id.slice(-8)}.pdf` : tab === 'locations' ? 'faturamento-igeve-locais.pdf' : 'faturamento-igeve-empresas.pdf');
    } catch { setMessage('Não foi possível gerar o PDF. Tente novamente.'); }
  }
  function exportExcel() {
    const workbook = XLSX.utils.book_new();
    if (tab === 'locations') {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(visibleLocations.map(row => ({ Operacao: row.operation, Local: row.destination, Romaneios: row.count, Produtos: row.products, Situacao: row.stored ? 'Salvo' : 'A preparar', Total: row.total }))), 'Por operacao e local');
    } else XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(totals.map(row => ({ Empresa: row.company, CNPJ: row.cnpj, Romaneios: row.count, Base: row.base, Complementos: row.complement, Total: row.base + row.complement }))), 'Por empresa');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet((tab === 'locations' ? visibleLocations.map(row => row.invoice) : visibleInvoices).flatMap(invoice => billingCostLines(invoice).map(({ item, subtotal, freight, unitCost, total }) => ({ Empresa: invoice.company, CNPJ: invoice.cnpj, Operacao: invoice.operation, Local: invoice.destination, Controle: invoice.control, Tipo: billingInvoiceType(invoice), Vinculo: invoice.parentId || '', Data: tab === 'locations' && !savedIds.has(invoice.id) ? '' : invoice.date, ...(tab === 'locations' ? { EntregaDe: invoice.location?.start || invoice.deliveryDate || '', EntregaAte: invoice.location?.end || invoice.deliveryDate || '', Situacao: savedIds.has(invoice.id) ? 'Salvo' : 'A preparar' } : {}), Produto: item.product, Categoria: item.category || invoice.category, Unidade: item.unit, Quantidade: item.quantity, ...(invoice.location || invoice.rubric ? { AjusteFaturamento: billingQuantityAdjustment(item), QuantidadeFaturada: item.billedQuantity ?? item.quantity } : {}), Preco: item.price, Subtotal: subtotal, FreteRateado: freight, CustoUnitarioFinal: unitCost, Total: total })))), 'Detalhamento');
    const exportedInvoices = tab === 'locations' ? visibleLocations.map(row => row.invoice) : visibleInvoices;
    const discounts = exportedInvoices.flatMap(invoice => (invoice.rubricDiscount?.categories || []).map(row => ({
      Operação: invoice.operation, Local: invoice.destination, Controle: invoice.control, Mês: invoice.rubricDiscount!.month,
      Categoria: row.category, MetaMensal: row.target, BrutoDoRomaneio: row.gross, DescontoFinalAAplicar: row.excess,
    })));
    if (discounts.length) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(discounts), 'Descontos de rubrica');
    XLSX.writeFile(workbook, tab === 'locations' ? 'faturamento-igeve-locais.xlsx' : 'faturamento-igeve-empresas.xlsx');
  }
  return <section className="igeve-billing">
    <div className="igeve-heading"><div><h1>Faturamento IGEVE</h1><p>Romaneios e complementos com valores próprios para faturamento.</p></div><button className="button button-outline" disabled={busy || !!draft || !!Object.keys(priceEdits).length} onClick={() => void load()}><RefreshCw size={18} /> Atualizar</button></div>
    <nav className="igeve-actions" aria-label="Faturamento IGEVE">{[['documents', 'Orçamentos e entrega por NF-e'], ['rubrics', 'Rubricas por operação'], ['romaneios', 'Faturamento por romaneio'], ['saved', 'Romaneios de faturamento'], ['freight', 'Frete'], ['locations', 'Faturamento por operação/local'], ['report', 'Relatório por empresas'], ['prices', 'Tabela de preços']].map(([id, label]) => <button key={id} className={`button ${tab !== id ? 'button-outline' : ''}`} disabled={busy || !!draft} onClick={() => { if (id === 'documents') setDocumentsOpened(true); setTab(id); }}>{label}</button>)}</nav>
    {documentsOpened && <div hidden={tab !== 'documents'}><IgeveDocuments /></div>}
    {tab !== 'rubrics' && tab !== 'documents' && <div className="card igeve-panel igeve-filter-panel"><div className="igeve-filters">
      <label>Operação<select className="input-field" value={operationId} onChange={event => { setOperationId(event.target.value); setLocationFilter(''); }}><option value="">Todas as operações IGEVE</option>{operations.map(op => <option key={op.id} value={op.id}>{op.name}</option>)}</select></label>
      <div className="igeve-category-filter"><span id="igeve-category-label">Categoria</span><details onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}><summary className="input-field" aria-labelledby="igeve-category-label igeve-category-selection"><span id="igeve-category-selection">{categoryFilter.length ? categoryFilter.join(', ') : 'Todas as categorias'}</span></summary><div className="igeve-category-options" role="group" aria-label="Selecionar categorias">
        <label><input type="checkbox" checked={!categoryFilter.length} onChange={() => setCategoryFilter([])} />Todas as categorias</label>
        {categories.map(category => <label key={category}><input type="checkbox" checked={categoryFilter.includes(category)} onChange={event => setCategoryFilter(current => event.target.checked ? [...current, category].sort() : current.filter(value => value !== category))} />{category}</label>)}
      </div></details></div>
      {tab !== 'prices' && <label>{tab === 'romaneios' || tab === 'locations' || tab === 'freight' ? 'Entrega de' : 'Faturamento de'}<input className="input-field" type="date" value={start} onChange={event => setStart(event.target.value)} /></label>}
      {tab !== 'prices' && <label>Até<input className="input-field" type="date" value={end} onChange={event => setEnd(event.target.value)} /></label>}
      {tab !== 'romaneios' && tab !== 'locations' && tab !== 'prices' && tab !== 'freight' && <label>Empresa<select className="input-field" value={companyFilter} onChange={event => setCompanyFilter(event.target.value)}><option value="">Todas as empresas</option>{[...new Set(saved.map(row => row.invoice.company))].sort().map(name => <option key={name}>{name}</option>)}</select></label>}
      {tab === 'locations' && <label>Local<select className="input-field" value={locationFilter} onChange={event => setLocationFilter(event.target.value)}><option value="">Todos os locais</option>{locationFilter && !locationGroups.some(row => row.key === locationFilter) && <option value={locationFilter}>Local selecionado (sem faturamento nos filtros atuais)</option>}{locationGroups.map(row => <option key={row.key} value={row.key}>{row.operation} / {row.destination}</option>)}</select></label>}
    </div><small>Maceió, Guaianases, Boituva, Mongaguá e Rio de Janeiro. Alterações aqui são exclusivas do faturamento.</small></div>}
    {message && !draft && <div className="card igeve-panel" role="status">{message}</div>}
    {tab !== 'prices' && tab !== 'rubrics' && tab !== 'documents' && !validPeriod && <div role="alert">A data inicial deve ser anterior ou igual à data final.</div>}
    {busy && <p role="status">Processando...</p>}
    {ready && tab === 'rubrics' && <IgeveRubrics operations={operations} points={points} orders={orders} invoices={saved} catalog={priceCatalog} rubrics={rubrics} busy={busy} onSave={saveRubric} onOpen={open} applyFreight={applyFreight} />}
    {ready && tab === 'prices' && <IgevePriceImport operations={operations} categories={categories} catalog={priceCatalog} busy={busy} onApply={stagePrices} onSaveExcel={entries => { stagePrices(entries); void persistPrices(entries, 200); }} />}
    {ready && tab === 'prices' && <IgevePriceTable rows={visiblePrices} edits={priceEdits} busy={busy} onEdit={editPrice} onSave={event => void savePrices(event)} onCancel={() => { setPriceEdits({}); setImportedPrices([]); }} header={header} />}
    {ready && (tab === 'romaneios' || tab === 'freight') && <IgeveFreight source={freightSource} scope={{ operationId, categories: categoryFilter, start, end }} saved={freights} busy={busy} detailed={tab === 'freight'} onSave={saveFreight} />}
    {ready && tab === 'romaneios' && <div className="card igeve-panel"><h2>Romaneios disponíveis</h2>{unifiedBilling && <p>As categorias selecionadas serão faturadas juntas, em um único faturamento por local no período de entrega informado.</p>}<div className="table-container"><table><thead><tr>{header('operation', 'Operação / local')}{header('control', 'Controle')}{header('date', 'Entrega')}{header('category', 'Categoria')}{header('action', 'Ação')}</tr></thead><tbody>
      {unifiedBilling ? unifiedRows.map(row => <tr key={row.key}><td>{row.operation}<br />{row.destination}</td><td>{row.count} romaneio(s)</td><td>{dateLabel(start) || 'Início'} a {dateLabel(end) || 'Fim'}</td><td>{row.invoice.category}</td><td><button disabled={busy} className="button button-outline" onClick={() => open(row.invoice, row.stored?.version || null)}>{row.stored ? 'Abrir faturamento unificado' : 'Preparar faturamento unificado'}</button></td></tr>) : availableRows.map(({ order, delivery, operation, destination, action }) => <tr key={`${order.id}-${delivery.id}`}><td>{operation}<br />{destination}</td><td>{getOrderControlNumber(order.importedAt)}</td><td>{dateLabel(order.deliveryDate)}</td><td>{order.category}</td><td><button disabled={busy} className="button button-outline" onClick={() => importDelivery(order, delivery)}>{action}</button></td></tr>)}
      {!(unifiedBilling ? unifiedRows : availableRows).length && <tr><td colSpan={5}>Nenhum romaneio encontrado. Confira a categoria, o período e as operações cadastradas em Operações.</td></tr>}
    </tbody></table></div></div>}
    {ready && tab === 'saved' && <div className="card igeve-panel"><h2>Romaneios de faturamento</h2><div className="table-container"><table><thead><tr>{header('company', 'Empresa / operação')}{header('control', 'Controle / local')}{header('type', 'Tipo')}{header('date', 'Data')}{header('total', 'Total')}{header('actions', 'Ações')}</tr></thead><tbody>{visibleInvoices.map(invoice => <tr key={invoice.id}><td>{invoice.company}<br />{invoice.operation}</td><td>{invoice.control}<br />{invoice.destination}</td><td>{billingInvoiceType(invoice)}</td><td>{dateLabel(invoice.date)}</td><td>{money(invoiceTotal(invoice))}{invoice.rubricDiscount && <><br /><small>{rubricDiscountNote(invoice.rubricDiscount)}</small></>}</td><td><div className="igeve-actions"><button className="button button-outline" disabled={busy} onClick={() => open(invoice, saved.find(row => row.invoice.id === invoice.id)!.version)}>Editar</button>{!invoice.parentId && !invoice.location && !invoice.rubric && <button className="button button-outline" disabled={busy} onClick={() => complement(invoice)}><Plus size={16} /> Complemento</button>}<button className="button button-outline" onClick={() => void exportPdf(invoice)}><FileText size={16} /> PDF</button><button type="button" className="button button-outline" disabled={busy} onClick={() => void deleteInvoice(invoice, saved.find(row => row.invoice.id === invoice.id)!.version)}><Trash2 size={16} /> Excluir faturamento</button></div></td></tr>)}{!visibleInvoices.length && <tr><td colSpan={6}>Nenhum faturamento salvo neste período.</td></tr>}</tbody></table></div></div>}
    {ready && tab === 'locations' && <div className="card igeve-panel">
      <div className="igeve-heading"><div><h2>Faturamento por operação/local</h2><p>Abra o faturamento do local para conferir a soma entregue por produto, informar o ajuste faturamento e definir o preço unitário.</p></div><div className="igeve-actions"><button className="button button-outline" disabled={!visibleLocations.length} onClick={() => void exportPdf()}>Exportar PDF</button><button className="button button-outline" disabled={!visibleLocations.length} onClick={exportExcel}>Exportar Excel</button></div></div>
      {pendingLocationCount > 0 && <p role="status">{pendingLocationCount} local(is) a preparar. Os valores iniciais usam a quantidade entregue e os preços cadastrados; itens sem preço entram com valor zero.</p>}
      <div className="table-container"><table><thead><tr>{header('operation', 'Operação')}{header('destination', 'Local')}{header('count', 'Romaneios')}{header('products', 'Produtos')}{header('total', 'Total do faturamento')}<th scope="col">Faturamento</th><th scope="col">Detalhamento</th></tr></thead>
        <tbody>{visibleLocations.map(row => <tr key={row.invoice.id}>
          <td>{row.operation}</td><td>{row.destination}<br /><small>{row.invoice.category}</small></td><td>{row.count}</td><td>{row.products}</td><td>{money(row.total)}</td>
          <td><div className="igeve-actions"><button className="button button-outline" disabled={busy} onClick={() => open(row.invoice, row.stored?.version || null)}>{row.stored ? 'Editar faturamento' : 'Preparar faturamento'}</button>
            {row.stored && <button type="button" className="button button-outline" disabled={busy} onClick={() => void deleteInvoice(row.invoice, row.stored!.version)}><Trash2 size={16} /> Excluir faturamento</button>}</div></td>
          <td><button className="button button-outline" aria-expanded={expandedGroup?.invoice.id === row.invoice.id} aria-controls="igeve-location-details" onClick={() => setExpandedLocation(current => current === row.invoice.id ? '' : row.invoice.id)}>{expandedGroup?.invoice.id === row.invoice.id ? 'Ocultar romaneios' : 'Ver romaneios'}</button></td>
        </tr>)}{!visibleLocations.length && <tr><td colSpan={7}>Nenhum romaneio encontrado para o período de entrega e os filtros selecionados.</td></tr>}</tbody>
        <tfoot><tr><th colSpan={4}>Total geral</th><td><strong>{money(locationGrandTotal)}</strong></td><td colSpan={2} /></tr></tfoot>
      </table></div>
      {expandedGroup && <div id="igeve-location-details"><h3>{expandedGroup.operation} / {expandedGroup.destination}</h3><div className="table-container"><table><thead><tr><th>Controle</th><th>Empresa</th><th>Categoria</th><th>Tipo</th><th>Entrega</th><th>Situação</th><th>Total</th><th>Ação</th></tr></thead><tbody>{!expandedGroup.invoices.length && <tr><td colSpan={8}>Nenhum romaneio de origem nos filtros atuais.</td></tr>}{expandedGroup.invoices.map(invoice => <tr key={invoice.id}><td>{invoice.control}</td><td>{invoice.company || 'A definir'}</td><td>{invoice.category}</td><td>{billingInvoiceType(invoice)}</td><td>{dateLabel(invoice.deliveryDate || '')}</td><td>{savedIds.has(invoice.id) ? 'Salvo' : 'A preparar'}</td><td>{money(invoiceTotal(invoice))}</td><td><button className="button button-outline" disabled={busy} onClick={() => { if (expandedGroup.stored || unifiedBilling) return open(expandedGroup.invoice, expandedGroup.stored?.version || null); const existing = saved.find(row => row.invoice.id === invoice.id); open(existing ? { ...existing.invoice, deliveryDate: invoice.deliveryDate, deliveryPointId: invoice.deliveryPointId } : { ...invoice, date: today() }, existing?.version || null); }}>{expandedGroup.stored || unifiedBilling ? 'Abrir faturamento unificado do local' : savedIds.has(invoice.id) ? 'Abrir faturamento' : 'Preparar faturamento'}</button></td></tr>)}</tbody></table></div></div>}
    </div>}
    {ready && tab === 'report' && <div className="card igeve-panel"><div className="igeve-heading"><h2>Faturamento por empresas</h2><div className="igeve-actions"><button className="button button-outline" disabled={!totals.length} onClick={() => void exportPdf()}>Exportar PDF</button><button className="button button-outline" disabled={!totals.length} onClick={exportExcel}>Exportar Excel</button></div></div><div className="table-container"><table><thead><tr>{header('company', 'Empresa')}{header('cnpj', 'CNPJ')}{header('count', 'Romaneios')}{header('base', 'Base')}{header('complement', 'Complementos')}{header('total', 'Total')}</tr></thead><tbody>{totals.map(row => <tr key={row.cnpj || row.company}><td>{row.company}</td><td>{row.cnpj || '-'}</td><td>{row.count}</td><td>{money(row.base)}</td><td>{money(row.complement)}</td><td>{money(row.base + row.complement)}</td></tr>)}{!totals.length && <tr><td colSpan={6}>Nenhum faturamento encontrado para os filtros.</td></tr>}</tbody><tfoot><tr><th colSpan={5}>Total geral</th><th>{money(visibleInvoices.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0))}</th></tr></tfoot></table></div></div>}
    {draft && <div className="igeve-editor" role="dialog" aria-modal="true" aria-label="Editar faturamento"><form className="card igeve-panel" onSubmit={event => void save(event)}><h2>{draft.location ? 'Faturamento por local' : draft.rubric?.kind === 'carry' ? 'Aproveitamento de itens do mês anterior' : draft.rubric?.kind === 'complement' || draft.parentId ? 'Romaneio complementar' : 'Faturamento por romaneio'} — {draft.control}</h2><p>{draft.operation} · {draft.destination} · {draft.category}</p><div className="igeve-filters">
      <label>Empresa para faturamento<input required className="input-field" list="igeve-companies" disabled={busy} value={draft.company} onChange={event => {
        const name = event.target.value;
        const exactNames = companies.filter(item => item.legal_name === name);
        const company = companies.find(item => companyOption(item) === name) || (exactNames.length === 1 ? exactNames[0] : undefined);
        setDraft({ ...draft, company: company?.legal_name || name, cnpj: company?.cnpj || '' });
        setCompanyNotice(null);
      }} /><datalist id="igeve-companies">{companies.map(company => <option key={company.id} value={companyOption(company)} />)}</datalist></label>
      <label>CNPJ<input className="input-field" disabled={busy} value={draft.cnpj} onChange={event => {
        setDraft({ ...draft, cnpj: event.target.value });
        setCompanyNotice(null);
      }} /></label>
      <label>Data do faturamento<input required type="date" className="input-field" value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} /></label>
    </div>
    <div className="igeve-actions">
      <button type="button" className="button button-outline" disabled={busy} onClick={() => void registerBillingCompany()}><Plus size={16} /> Cadastrar empresa para faturamento</button>
      <small>Para cadastrar uma nova empresa, preencha a razão social e o CNPJ acima.</small>
    </div>
    {companyNotice && <p role={companyNotice.error ? 'alert' : 'status'}>{companyNotice.text}</p>}
    <p>O frete é informado em <strong>Frete</strong> ou <strong>Faturamento por romaneio</strong>, nos filtros de operação, categorias e período de entrega. O rateio considera a soma das quantidades de todos os romaneios filtrados e aparece no custo final abaixo.</p>
    <div className="igeve-filters">
      <label>Tabela de preços<select className="input-field" disabled={busy} value={priceTableSelection} onChange={event => setPriceTableSelection(event.target.value)}>
        <option value={draft.operationId}>{draft.operation} (operação do faturamento)</option>
        {otherPriceTables.map(operation => <option key={operation.id} value={operation.id}>{operation.name}</option>)}
        {draft.priceTableOperationId && !otherPriceTables.some(operation => operation.id === draft.priceTableOperationId) &&
          <option value={draft.priceTableOperationId}>Operação da tabela salva</option>}
      </select></label>
      <div className="igeve-actions"><button type="button" className="button button-outline" disabled={busy} onClick={() => void refreshDraftPrices()}><RefreshCw size={16} /> Buscar preços na tabela</button></div>
    </div>
    <small>Tabela em uso: {appliedPriceTable}. Guaianases e Boituva consultam a tabela uma da outra quando falta um preço. Itens sem correspondência mantêm o valor atual.</small>
    {draftMissingPrices.length > 0 && <div role="alert" className="igeve-price-warning">{draftMissingPrices.length} produto(s) sem preço na tabela em uso e com valor zero neste faturamento: {draftMissingPrices.map(item => item.product).join(', ')}. Cadastre e salve os preços na tabela, ou informe-os abaixo. O custo final desses itens contém somente o frete enquanto o preço estiver zerado.</div>}
    {draftRubricError && <p role="alert" className="igeve-price-warning">{draftRubricError}</p>}
    {draftDiscount && <p role="status" className="igeve-rubric-status exceeded">{rubricDiscountNote(draftDiscount)}</p>}
    {draftBalance && <p role="status" className={`igeve-rubric-status ${draftBalance.status}`}>Rubrica do mês: {money(draftRubric!.amount)} · Total previsto com este faturamento e ajuste anterior: {money(draftBalance.used)} · {draftBalance.remaining < 0 ? 'Ultrapassa em' : 'Saldo'}: {money(Math.abs(draftBalance.remaining))}. {draftBalance.remaining < 0 && 'Revise as quantidades antes de concluir.'}</p>}
    {draft.rubric?.kind === 'reduction' && <p>As quantidades retiradas em Ajuste faturamento serão guardadas para aproveitamento no mês seguinte. As entregas originais são preservadas.</p>}
    {draft.location && <p>Entregas de {dateLabel(draft.location.start) || 'início'} a {dateLabel(draft.location.end) || 'fim'} · {draft.location.count} romaneio(s). Informe somente a diferença em quantidade: -10 para retirar ou +10 para acrescentar. Vazio ou zero mantém a quantidade entregue. A quantidade faturada é a entregue mais o ajuste.</p>}
    {adjustableDraft && <div className="card igeve-panel">
      <h3>Romaneio</h3>
      <p>Gere o romaneio somente com os itens que receberam ajuste na categoria selecionada. O documento usa os valores atuais desta janela; salve o faturamento para registrar as alterações.</p>
      {isOmLogBilling(draft) && <p>Modelo OM Log: produtos, unidade, quantidade do ajuste e campos para recebimento.</p>}
      <div className="igeve-filters"><label>Categoria do romaneio<select className="input-field" value={selectedAdjustmentCategory} onChange={event => setAdjustmentCategory(event.target.value)}>{adjustmentCategories.map(category => <option key={category} value={category}>{category}</option>)}</select></label>
      <button type="button" className="button button-outline" disabled={busy || !selectedAdjustmentCategory} onClick={() => void exportPdf(draft, selectedAdjustmentCategory)}><FileText size={16} /> Gerar romaneio</button></div>
    </div>}
    {adjustableDraft && <p>Quantidade faturada = quantidade entregue + ajuste. Exemplo: 60 entregues com ajuste -10 = 50 faturados; com +10 = 70 faturados.</p>}
    {adjustmentError && <p role="alert">{adjustmentError}</p>}
    <IgeveBillingProducts key={draft.id} entries={billingProductsToAdd(draft, savedPrices.map(row => row.entry))} busy={busy} adjustable={adjustableDraft} onAdd={addDraftProduct} />
    <div className="table-container"><table><thead><tr><th>{draft.location ? 'Produto / categoria' : 'Produto'}</th><th>Unidade</th><th>{adjustableDraft ? 'Qtd. entregue' : 'Quantidade'}</th>{adjustableDraft && <th>Ajuste faturamento</th>}<th>Preço unitário (R$)</th><th>Frete rateado</th><th>Custo unitário final</th><th>Total com frete</th><th>Remover</th></tr></thead><tbody>{draft.items.map((item, index) => <tr key={item.id}>
      {(['product', 'unit', 'quantity', ...(adjustableDraft ? ['billedQuantity' as const] : []), 'price'] as const).map(field => <td key={field}><input aria-label={`${field === 'product' ? 'Produto' : field === 'unit' ? 'Unidade' : field === 'quantity' ? (draft.location ? 'Quantidade entregue' : 'Quantidade') : field === 'billedQuantity' ? 'Ajuste faturamento' : 'Preço'} ${index + 1}`} className="input-field" required={field !== 'billedQuantity'} readOnly={adjustableDraft && (field === 'product' || field === 'unit' || field === 'quantity')} type={field === 'quantity' || field === 'price' ? 'number' : 'text'} inputMode={field === 'billedQuantity' ? 'decimal' : undefined} placeholder={field === 'billedQuantity' ? '-10 ou +10' : undefined} min={field === 'quantity' && !adjustableDraft ? '0.001' : '0'} step={field === 'quantity' || field === 'billedQuantity' ? '0.001' : '0.01'} value={field === 'billedQuantity' ? quantityAdjustments[item.id] ?? '' : item[field]} onChange={event => { if (field === 'billedQuantity') { updateQuantityAdjustment(item.id, event.target.value); return; } setDraft({ ...draft, items: draft.items.map(row => {
        if (row.id !== item.id) return row;
        const updated = { ...row, [field]: field === 'quantity' || field === 'price' ? Number(event.target.value) : event.target.value };
        if (!draft.location && (field === 'product' || field === 'unit')) {
          const price = billingTablePrice(prices, draft, updated);
          if (price !== undefined) updated.price = price;
        }
        return updated;
      }) }); }} />{field === 'billedQuantity' && <small>Qtd. faturada: {(item.billedQuantity ?? item.quantity).toLocaleString('pt-BR', { maximumFractionDigits: 6 })}</small>}{field === 'price' && <small className={draftPriceLabels[index] ? '' : 'igeve-price-missing'}>{draftPriceLabels[index] || 'Sem preço cadastrado na tabela'}</small>}{field === 'product' && item.addedForBilling && <small>Adicionado ao faturamento</small>}{(draft.location || draft.rubric) && field === 'product' && (draft.rubric && !adjustableDraft ? <select aria-label={`Categoria ${index + 1}`} className="input-field" value={item.category || ''} onChange={event => setDraft({ ...draft, items: draft.items.map(row => row.id === item.id ? { ...row, category: event.target.value, price: billingTablePrice(prices, draft, { ...row, category: event.target.value }) ?? 0 } : row) })}>{categories.map(category => <option key={category}>{category}</option>)}</select> : <small>{item.category || draft.category}</small>)}</td>)}
      <td>{money(draftCosts[index].freight)}</td><td>{draftCosts[index].unitCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 6 })}</td><td>{money(draftCosts[index].total)}</td><td>{(!adjustableDraft || item.addedForBilling) && <button type="button" className="button button-outline" disabled={busy} aria-label={`Remover produto ${index + 1}`} onClick={() => setDraft({ ...draft, items: draft.items.filter(row => row.id !== item.id) })}><Trash2 size={16} /></button>}</td>
    </tr>)}</tbody></table></div>
      {!adjustableDraft && <button type="button" className="button button-outline" onClick={() => setDraft({ ...draft, items: [...draft.items, { ...newItem(), category: draft.rubric ? 'Estocáveis' : undefined }] })}><Plus size={16} /> Adicionar produto</button>}
      <label>Observações<textarea className="input-field" value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label><p>Produtos: {money(draftCosts.reduce((sum, row) => sum + row.subtotal, 0))} · Frete: {money(draftCosts.reduce((sum, row) => sum + row.freight, 0))}</p><strong>Total do faturamento com frete: {money(invoiceTotal(applyFreight(draft)))}</strong>
      <div className="igeve-actions"><button type="submit" className="button" disabled={busy || !!draftRubricError}><Save size={18} /> Salvar faturamento</button>{version && <button type="button" className="button button-outline" disabled={busy} onClick={() => void deleteInvoice(draft, version)}><Trash2 size={16} /> Excluir faturamento</button>}{draft.location && <button type="button" className="button button-outline" onClick={() => void exportPdf(draft)}>Exportar PDF</button>}<button type="button" className="button button-outline" disabled={busy} onClick={() => { setDraft(null); setMessage(''); }}>Cancelar</button></div>
      {message && <div role="alert">{message}</div>}
    </form></div>}
  </section>;
}
