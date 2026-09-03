import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Building2,
  Calendar,
  Download,
  Edit3,
  FileSpreadsheet,
  FileText,
  FolderCheck,
  FolderPlus,
  History,
  Layers,
  MapPin,
  PackagePlus,
  Plus,
  Search,
  Save,
  ShoppingCart,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { supabase } from '../lib/supabase';
import type { Deposit, Product } from '../types';
import { addCompanyLetterhead, addPdfHeader } from '../lib/pdfBranding';
import type { PdfLogoVariant } from '../lib/pdfBranding';
import { createOperationPdfWriter, getAllOperationPdfFolders, pickOperationPdfFolder, supportsOperationPdfFolders } from '../lib/operationPdfFolders';
import type { OperationPdfFolder } from '../lib/operationPdfFolders';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();

type SourceType = 'Manual' | 'Excel' | 'PDF';
type DeliveryCategory = 'Hortifrutigranjeiro' | 'Estocáveis' | 'Dietas e Fórmulas' | 'Proteínas' | 'Limpeza';
type OperationsModule = 'operations' | 'locations' | 'order-entry' | 'orders' | 'history' | 'orders-summary-report' | 'deliveries-summary-report' | 'period-report' | 'romaneio-products-report' | 'purchase-period-report' | 'products-by-date-report';

interface OperationContract {
  id: string;
  name: string;
  city: string;
  uf: string;
  bidNumber?: string;
  supplyAuthorization?: string;
  logoVariant?: PdfLogoVariant;
  createdAt: string;
}

interface Sector {
  id: string;
  operationId: string;
  name: string;
}

interface DeliveryItem {
  product: string;
  unit: string;
  quantity: number;
  notes?: string;
}

interface DeliveryPoint {
  id: string;
  operationId: string;
  sectorId: string;
  code: string;
  name: string;
  address: string;
  neighborhood: string;
}

interface OrderDelivery {
  id: string;
  deliveryPointId: string;
  items: DeliveryItem[];
}

interface OperationOrder {
  id: string;
  operationId: string;
  category: DeliveryCategory;
  sourceFileName: string;
  sourceType: SourceType;
  deliveryDate: string;
  consumptionPeriod: string;
  generalNotes?: string;
  importedAt: string;
  deliveries: OrderDelivery[];
}

interface PurchaseNeed {
  product: string;
  unit: string;
  demand: number;
  stock: number;
  missing: number;
  status: 'SEM CADASTRO' | 'ESTOQUE INSUFICIENTE';
}

interface OperationForm {
  name: string;
  city: string;
  uf: string;
  bidNumber: string;
  supplyAuthorization: string;
  logoVariant: PdfLogoVariant;
}

const OPERATIONS_KEY = 'gom_delivery_operations';
const SECTORS_KEY = 'gom_delivery_sectors';
const DELIVERY_POINTS_KEY = 'gom_delivery_points';
const ORDERS_KEY = 'gom_delivery_operation_orders';
const PRODUCT_PRICES_KEY = 'gom_delivery_product_prices';
const ACTIVE_OPERATION_KEY = 'gom_active_delivery_operation';
type SharedStateKey = typeof OPERATIONS_KEY | typeof SECTORS_KEY | typeof DELIVERY_POINTS_KEY | typeof ORDERS_KEY | typeof PRODUCT_PRICES_KEY;
interface ProductPrice {
  costPrice: number;
  salePrice: number;
}
type ProductPrices = Record<string, ProductPrice>;
let sharedStateWriteQueue: Promise<void> = Promise.resolve();

const saveSharedState = (key: SharedStateKey, value: unknown) => {
  const write = sharedStateWriteQueue
    .catch(() => undefined)
    .then(async () => {
      const { error } = await supabase.from('app_shared_state').upsert({
        key,
        value,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
      if (error) throw error;
    });
  sharedStateWriteQueue = write;
  return write;
};
const REPORT_FONT = 'courier';
const REPORT_FONT_SIZE = 11;
const DELIVERY_CATEGORIES: DeliveryCategory[] = ['Hortifrutigranjeiro', 'Estocáveis', 'Dietas e Fórmulas', 'Proteínas', 'Limpeza'];
const DEFAULT_LOGO_VARIANT: PdfLogoVariant = 'gom';
const LOGO_OPTIONS: { value: PdfLogoVariant; label: string }[] = [
  { value: 'gom', label: 'Logo LM' },
  { value: 'igeve', label: 'IGEVÊ' },
];

const defaultOperations: OperationContract[] = [
  { id: 'boituva', name: 'Operação Boituva', city: 'Boituva', uf: 'SP', createdAt: '2026-08-05' },
  { id: 'maceio', name: 'Operação Maceió', city: 'Maceió', uf: 'AL', createdAt: '2026-08-05' },
];

const defaultSectors: Sector[] = [
  { id: 'boituva_setor_01', operationId: 'boituva', name: 'Setor 01' },
  { id: 'maceio_setor_01', operationId: 'maceio', name: 'Setor 01' },
];

const todayIso = () => new Date().toISOString().split('T')[0];
const makeId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const emptyOperationForm = (): OperationForm => ({
  name: '',
  city: '',
  uf: '',
  bidNumber: '',
  supplyAuthorization: '',
  logoVariant: DEFAULT_LOGO_VARIANT,
});

const readStorage = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    localStorage.removeItem(key);
    return fallback;
  }
};

const saveStorage = <T,>(key: string, value: T) => localStorage.setItem(key, JSON.stringify(value));

const normalizeText = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const displayText = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalizeKey = (value: unknown) => normalizeText(value).toUpperCase();
const normalizeDeliveryLabel = (value: unknown) =>
  normalizeKey(value)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const toNumber = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? '').replace(/\./g, '').replace(',', '.').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatDate = (value: string) => value ? value.split('-').reverse().join('/') : '-';
const formatDateTime = (value: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return `${date.toLocaleDateString('pt-BR')} às ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};
const formatQuantity = (value: number) => Number.isInteger(value) ? String(value) : value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const formatCurrency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const stockKey = (product: string, unit: string) => `${normalizeKey(product)}|${normalizeKey(unit || 'UN')}`;

const ignoredDeliveryHeaders = new Set([
  'TOTAL',
  'COLUNAS1',
  'COLUNAS2',
  'COLUNAS3',
  'VERDURAS',
  'LEGUMES',
  'HORTIFRUTI',
  'HORTIFRUTIGRANJEIRO',
  ...DELIVERY_CATEGORIES.map(normalizeKey),
]);

const categoryToInventoryCategory = (category: DeliveryCategory) => {
  if (category === 'Limpeza') return 'LIMPEZA';
  if (category === 'Dietas e Fórmulas') return 'DIETA';
  return 'Estocáveis';
};

const findHeaderRow = (rows: unknown[][]) =>
  rows.findIndex(row => row.some(cell => normalizeKey(cell) === 'PRODUTO') && row.some(cell => ['QTD', 'QTDE', 'QUANTIDADE'].includes(normalizeKey(cell))));

const extractDeliveryLabelFromRows = (rows: unknown[][]) => {
  for (const row of rows.slice(0, 15)) {
    const labelIndex = row.findIndex(cell => ['NOME DA ESCOLA', 'LOCAL DE ENTREGA', 'UNIDADE ESCOLAR'].includes(normalizeKey(cell)));
    if (labelIndex < 0) continue;
    const label = row.slice(labelIndex + 1).map(displayText).find(Boolean);
    if (label) return label;
  }
  return '';
};

const extractDateFromRows = (rows: unknown[][]) => {
  for (const row of rows.slice(0, 12)) {
    const labelIndex = row.findIndex(cell => normalizeKey(cell).includes('DATA'));
    if (labelIndex >= 0) {
      const rawDate = row.slice(labelIndex + 1).find(cell => String(cell ?? '').trim());
      if (rawDate instanceof Date) return rawDate.toISOString().split('T')[0];
      if (typeof rawDate === 'number') return new Date((rawDate - 25569) * 86400 * 1000).toISOString().split('T')[0];
      const textDate = String(rawDate ?? '').trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(textDate)) return textDate.slice(0, 10);
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(textDate)) {
        const [day, month, year] = textDate.split('/');
        return `${year}-${month}-${day}`;
      }
    }
  }
  return todayIso();
};

const buildSummary = (deliveries: OrderDelivery[]) => {
  const summary = new Map<string, DeliveryItem>();
  deliveries.forEach(delivery => {
    aggregateDeliveryItems(delivery.items).forEach(item => {
      const key = stockKey(item.product, item.unit);
      const current = summary.get(key);
      if (current) current.quantity += item.quantity;
      else summary.set(key, { ...item });
    });
  });
  return Array.from(summary.values()).sort((a, b) => a.product.localeCompare(b.product));
};

const aggregateDeliveryItems = (items: DeliveryItem[]) => {
  const grouped = new Map<string, DeliveryItem>();
  items.filter(item => item.product && item.quantity > 0).forEach(item => {
    const key = `${stockKey(item.product, item.unit)}|${normalizeKey(item.notes || '')}`;
    const current = grouped.get(key);
    if (current) current.quantity += Number(item.quantity || 0);
    else grouped.set(key, { ...item, quantity: Number(item.quantity || 0) });
  });
  return Array.from(grouped.values()).sort((a, b) => a.product.localeCompare(b.product));
};

const normalizeOrderDeliveries = (deliveries: OrderDelivery[]) => {
  const grouped = new Map<string, OrderDelivery>();
  deliveries.forEach(delivery => {
    if (!delivery.deliveryPointId) return;
    const current = grouped.get(delivery.deliveryPointId);
    if (current) {
      current.items.push(...delivery.items);
    } else {
      grouped.set(delivery.deliveryPointId, {
        ...delivery,
        items: [...delivery.items],
      });
    }
  });

  return Array.from(grouped.values())
    .map(delivery => ({ ...delivery, items: aggregateDeliveryItems(delivery.items) }))
    .filter(delivery => delivery.items.length > 0);
};

const getOperationTitle = (operation: OperationContract) =>
  `${operation.name} (${operation.city}${operation.uf ? `/${operation.uf}` : ''})`;

const getPdfHeader = (operation: OperationContract, order: OperationOrder) =>
  `ROMANEIO - ${order.category.toUpperCase()} - ${getOperationTitle(operation).toUpperCase()} - ${formatDate(order.deliveryDate)}`;

const addHeader = async (doc: jsPDF, operation: OperationContract, order: OperationOrder, subtitle?: string) => {
  const details = [
    operation.bidNumber ? `Ata: ${operation.bidNumber}` : '',
    operation.supplyAuthorization ? `Autorizacao: ${operation.supplyAuthorization}` : '',
    order.consumptionPeriod ? `Consumo: ${order.consumptionPeriod}` : '',
  ].filter(Boolean).join(' | ');
  await addPdfHeader(doc, {
    title: getPdfHeader(operation, order),
    subtitle: details || 'Documentacao de entrega',
    footer: subtitle,
    logoVariant: operation.logoVariant || DEFAULT_LOGO_VARIANT,
    titleFontSize: 14,
  });
};

const addDeliveryAddress = (doc: jsPDF, point?: DeliveryPoint, startY = 46) => {
  const address = `Endereco: ${point?.address || '-'} | Bairro: ${point?.neighborhood || '-'}`;
  const addressLines = (doc.splitTextToSize(address, 182) as string[]).slice(0, 2);
  doc.setFont(REPORT_FONT, 'normal');
  doc.setFontSize(11);
  doc.text(addressLines, 14, startY);
  return startY + (addressLines.length * 5) + 4;
};

const addOrderGeneralNotes = (doc: jsPDF, order: OperationOrder, startY = 39) => {
  const notes = displayText(order.generalNotes);
  if (!notes) return startY;

  const lines = doc.splitTextToSize(`Observacao geral: ${notes}`, 182);
  doc.setFont(REPORT_FONT, 'normal');
  doc.setFontSize(REPORT_FONT_SIZE);
  doc.text(lines, 14, startY);
  return startY + (lines.length * 4) + 6;
};

const toColumnLetters = (index: number) => {
  let value = index + 1;
  let letters = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
};

const addReceiptFields = (doc: jsPDF, startY: number) => {
  const y = Math.min(startY + 12, 260);
  doc.setFont(REPORT_FONT, 'normal');
  doc.text('Data de recebimento: ____/____/________', 14, y);
  doc.text('Nome de quem recebeu: _______________________________________________', 14, y + 8);
  doc.text('RG: __________________________   Assinatura: ________________________', 14, y + 16);
};

const sanitizeFileName = (value: string) =>
  value
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getRomaneioFileName = (operation: OperationContract, order: OperationOrder, suffix?: string) => {
  const base = `ROMANEIO - ${order.category}_${operation.name} - ${formatDate(order.deliveryDate)}`;
  return `${sanitizeFileName([base, suffix].filter(Boolean).join(' - '))}.pdf`;
};

const Operations: React.FC = () => {
  const [operations, setOperations] = useState<OperationContract[]>(() => readStorage(OPERATIONS_KEY, defaultOperations));
  const [sectors, setSectors] = useState<Sector[]>(() => readStorage(SECTORS_KEY, defaultSectors));
  const [deliveryPoints, setDeliveryPoints] = useState<DeliveryPoint[]>(() => readStorage(DELIVERY_POINTS_KEY, []));
  const [orders, setOrders] = useState<OperationOrder[]>(() => readStorage(ORDERS_KEY, []));
  const [productPrices, setProductPrices] = useState<ProductPrices>(() => readStorage(PRODUCT_PRICES_KEY, {}));
  const [products, setProducts] = useState<Product[]>([]);
  const [activeOperationId, setActiveOperationId] = useState(() => readStorage(ACTIVE_OPERATION_KEY, operations[0]?.id || 'boituva'));
  const [newOperation, setNewOperation] = useState<OperationForm>(() => emptyOperationForm());
  const [editingOperationId, setEditingOperationId] = useState<string | null>(null);
  const [operationEditForm, setOperationEditForm] = useState<OperationForm>(() => emptyOperationForm());
  const [newSector, setNewSector] = useState('Setor 01');
  const [editingSectorId, setEditingSectorId] = useState<string | null>(null);
  const [sectorEditName, setSectorEditName] = useState('');
  const [newPoint, setNewPoint] = useState({ sectorId: '', code: '', name: '', address: '', neighborhood: '' });
  const [editingPointId, setEditingPointId] = useState<string | null>(null);
  const [pointEditForm, setPointEditForm] = useState({ sectorId: '', code: '', name: '', address: '', neighborhood: '' });
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [orderForm, setOrderForm] = useState({
    category: 'Estocáveis' as DeliveryCategory,
    deliveryDate: todayIso(),
    consumptionPeriod: '',
    generalNotes: '',
    deliveryPointId: '',
    product: '',
    unit: 'UN',
    quantity: 0,
    notes: '',
  });
  const [draftDeliveries, setDraftDeliveries] = useState<OrderDelivery[]>([]);
  const [editingDraftItem, setEditingDraftItem] = useState<{ deliveryPointId: string; itemIndex: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [selectedImportFile, setSelectedImportFile] = useState<File | null>(null);
  const [importInputKey, setImportInputKey] = useState(0);
  const [importFeedback, setImportFeedback] = useState<{ type: 'progress' | 'success' | 'error'; message: string } | null>(null);
  const [creatingPurchase, setCreatingPurchase] = useState(false);
  const [activeModule, setActiveModule] = useState<OperationsModule | null>(null);
  const [deliverySortDirection, setDeliverySortDirection] = useState<'asc' | 'desc'>('desc');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [ordersCategoryFilter, setOrdersCategoryFilter] = useState<'Todas' | DeliveryCategory>('Todas');
  const [reportCategory, setReportCategory] = useState<'Todas' | DeliveryCategory>('Todas');
  const [purchaseOperationIds, setPurchaseOperationIds] = useState<string[]>([]);
  const [summaryOperationIds, setSummaryOperationIds] = useState<string[]>([]);
  const [reportStartDate, setReportStartDate] = useState(() => `${todayIso().slice(0, 8)}01`);
  const [reportEndDate, setReportEndDate] = useState(todayIso);
  const [reportProduct, setReportProduct] = useState('Todos');
  const [reportDeliveryPointId, setReportDeliveryPointId] = useState('Todos');
  const [sharedStateReady, setSharedStateReady] = useState(false);
  const [sharedStateError, setSharedStateError] = useState('');
  const [pdfFolders, setPdfFolders] = useState<Record<string, OperationPdfFolder>>({});

  const activeOperation = operations.find(operation => operation.id === activeOperationId) || operations[0];
  const operationSectors = sectors.filter(sector => sector.operationId === activeOperation?.id);
  const operationPoints = deliveryPoints.filter(point => point.operationId === activeOperation?.id);
  const operationOrders = useMemo(
    () => orders.filter(order => order.operationId === activeOperation?.id).sort((a, b) => b.importedAt.localeCompare(a.importedAt)),
    [orders, activeOperation?.id]
  );
  const sortedOperationOrders = useMemo(
    () => [...operationOrders].sort((a, b) => {
      const dateComparison = a.deliveryDate.localeCompare(b.deliveryDate);
      if (dateComparison !== 0) return deliverySortDirection === 'asc' ? dateComparison : -dateComparison;
      return b.importedAt.localeCompare(a.importedAt);
    }),
    [operationOrders, deliverySortDirection]
  );
  const visibleOperationOrders = useMemo(
    () => sortedOperationOrders.filter(order => ordersCategoryFilter === 'Todas' || order.category === ordersCategoryFilter),
    [sortedOperationOrders, ordersCategoryFilter]
  );

  useEffect(() => {
    fetchProducts();
    void loadSharedState();
    void getAllOperationPdfFolders()
      .then(folders => setPdfFolders(Object.fromEntries(folders.map(folder => [folder.operationId, folder]))))
      .catch(error => console.warn('Não foi possível carregar as pastas de PDF:', error));
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel('app-shared-state')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_shared_state' }, payload => {
        const row = payload.new as { key?: SharedStateKey; value?: unknown };
        if (!row?.key || row.value === undefined) return;
        saveStorage(row.key, row.value);
        if (row.key === OPERATIONS_KEY) setOperations(row.value as OperationContract[]);
        if (row.key === SECTORS_KEY) setSectors(row.value as Sector[]);
        if (row.key === DELIVERY_POINTS_KEY) setDeliveryPoints(row.value as DeliveryPoint[]);
        if (row.key === ORDERS_KEY) setOrders(row.value as OperationOrder[]);
        if (row.key === PRODUCT_PRICES_KEY) setProductPrices(row.value as ProductPrices);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (!newPoint.sectorId && operationSectors[0]) setNewPoint(prev => ({ ...prev, sectorId: operationSectors[0].id }));
    if (!orderForm.deliveryPointId && operationPoints[0]) setOrderForm(prev => ({ ...prev, deliveryPointId: operationPoints[0].id }));
  }, [activeOperationId, operationSectors, operationPoints, newPoint.sectorId, orderForm.deliveryPointId]);

  async function fetchProducts() {
    const { data } = await supabase.from('products').select('*').order('name');
    if (data) setProducts(data);
  }

  async function loadSharedState() {
    const keys: SharedStateKey[] = [OPERATIONS_KEY, SECTORS_KEY, DELIVERY_POINTS_KEY, ORDERS_KEY, PRODUCT_PRICES_KEY];
    const { data, error } = await supabase.from('app_shared_state').select('key,value').in('key', keys);
    if (error) {
      console.error('Falha ao carregar dados compartilhados:', error);
      setSharedStateError('Sem conexão com os dados compartilhados. Exibindo o cache deste navegador.');
      setSharedStateReady(true);
      return;
    }

    const rows = new Map((data || []).map(row => [row.key as SharedStateKey, row.value]));
    const nextOperations = (rows.get(OPERATIONS_KEY) as OperationContract[] | undefined) || operations;
    const nextSectors = (rows.get(SECTORS_KEY) as Sector[] | undefined) || sectors;
    const nextPoints = (rows.get(DELIVERY_POINTS_KEY) as DeliveryPoint[] | undefined) || deliveryPoints;
    const nextOrders = (rows.get(ORDERS_KEY) as OperationOrder[] | undefined) || orders;
    const nextProductPrices = (rows.get(PRODUCT_PRICES_KEY) as ProductPrices | undefined) || productPrices;

    setOperations(nextOperations);
    setSectors(nextSectors);
    setDeliveryPoints(nextPoints);
    setOrders(nextOrders);
    setProductPrices(nextProductPrices);
    saveStorage(OPERATIONS_KEY, nextOperations);
    saveStorage(SECTORS_KEY, nextSectors);
    saveStorage(DELIVERY_POINTS_KEY, nextPoints);
    saveStorage(ORDERS_KEY, nextOrders);
    saveStorage(PRODUCT_PRICES_KEY, nextProductPrices);
    setActiveOperationId(current => nextOperations.some(operation => operation.id === current) ? current : (nextOperations[0]?.id || ''));
    setSharedStateReady(true);
  }

  const reportSharedStateError = (error: unknown) => {
    console.error('Falha ao salvar dados compartilhados:', error);
    setSharedStateError('Não foi possível sincronizar a última alteração. Verifique a conexão antes de continuar.');
  };

  const configurePdfFolder = async (operation: OperationContract) => {
    try {
      const folder = await pickOperationPdfFolder(operation.id);
      setPdfFolders(current => ({ ...current, [operation.id]: folder }));
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return;
      if ((error as Error)?.message === 'UNSUPPORTED') {
        alert('Este navegador não permite escolher uma pasta padrão. Os PDFs continuarão sendo baixados normalmente. Use Chrome ou Edge atualizado para ativar a função.');
        return;
      }
      console.error('Falha ao configurar pasta de PDFs:', error);
      alert('Não foi possível configurar a pasta de PDFs desta operação.');
    }
  };

  const preparePdfWriter = async (operation: OperationContract, fileName: string) => {
    const folder = pdfFolders[operation.id];
    if (!folder) return null;
    try {
      return await createOperationPdfWriter(folder, fileName);
    } catch (error) {
      console.warn('Não foi possível abrir o PDF na pasta padrão:', error);
      alert(`A pasta “${folder.name}” não está disponível. O PDF será baixado normalmente. Clique novamente no botão de pasta da operação para selecioná-la.`);
      return null;
    }
  };

  const savePdf = async (doc: jsPDF, fileName: string, writer: FileSystemWritableFileStream | null) => {
    if (!writer) return doc.save(fileName);
    try {
      await writer.write(doc.output('blob'));
      await writer.close();
    } catch (error) {
      console.warn('Não foi possível gravar o PDF na pasta padrão:', error);
      alert('Não foi possível concluir a gravação na pasta escolhida. O PDF será baixado normalmente.');
      doc.save(fileName);
    }
  };

  const persistOperations = (next: OperationContract[]) => {
    setOperations(next);
    saveStorage(OPERATIONS_KEY, next);
    void saveSharedState(OPERATIONS_KEY, next).catch(reportSharedStateError);
  };

  const persistSectors = (next: Sector[]) => {
    setSectors(next);
    saveStorage(SECTORS_KEY, next);
    void saveSharedState(SECTORS_KEY, next).catch(reportSharedStateError);
  };

  const persistDeliveryPoints = (next: DeliveryPoint[]) => {
    setDeliveryPoints(next);
    saveStorage(DELIVERY_POINTS_KEY, next);
    void saveSharedState(DELIVERY_POINTS_KEY, next).catch(reportSharedStateError);
  };

  const persistOrders = (next: OperationOrder[]) => {
    setOrders(next);
    saveStorage(ORDERS_KEY, next);
    void saveSharedState(ORDERS_KEY, next).catch(reportSharedStateError);
  };

  const persistProductPrice = (key: string, field: keyof ProductPrice, value: string) => {
    const parsedValue = Number(value);
    const nextValue = Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 0;
    const next = {
      ...productPrices,
      [key]: {
        costPrice: productPrices[key]?.costPrice || 0,
        salePrice: productPrices[key]?.salePrice || 0,
        [field]: nextValue,
      },
    };
    setProductPrices(next);
    saveStorage(PRODUCT_PRICES_KEY, next);
    void saveSharedState(PRODUCT_PRICES_KEY, next).catch(reportSharedStateError);
  };

  const addOperation = (event: React.FormEvent) => {
    event.preventDefault();
    const city = displayText(newOperation.city);
    const name = displayText(newOperation.name) || `Operação ${city}`;
    if (!city && !name) return;

    const operation: OperationContract = {
      id: makeId('operation'),
      name,
      city: city || name,
      uf: displayText(newOperation.uf).toUpperCase(),
      bidNumber: displayText(newOperation.bidNumber),
      supplyAuthorization: displayText(newOperation.supplyAuthorization),
      logoVariant: newOperation.logoVariant,
      createdAt: todayIso(),
    };
    const sector: Sector = { id: makeId('sector'), operationId: operation.id, name: 'Setor 01' };

    persistOperations([...operations, operation]);
    persistSectors([...sectors, sector]);
    setActiveOperationId(operation.id);
    setNewOperation(emptyOperationForm());
  };

  const startEditOperation = (operation: OperationContract) => {
    setEditingOperationId(operation.id);
    setOperationEditForm({
      name: operation.name,
      city: operation.city,
      uf: operation.uf,
      bidNumber: operation.bidNumber || '',
      supplyAuthorization: operation.supplyAuthorization || '',
      logoVariant: operation.logoVariant || DEFAULT_LOGO_VARIANT,
    });
  };

  const saveOperationEdit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingOperationId) return;
    const name = displayText(operationEditForm.name);
    const city = displayText(operationEditForm.city);
    if (!name || !city) return;
    persistOperations(operations.map(operation => operation.id === editingOperationId ? {
      ...operation,
      name,
      city,
      uf: displayText(operationEditForm.uf).toUpperCase(),
      bidNumber: displayText(operationEditForm.bidNumber),
      supplyAuthorization: displayText(operationEditForm.supplyAuthorization),
      logoVariant: operationEditForm.logoVariant,
    } : operation));
    setEditingOperationId(null);
  };

  const deleteOperation = (operation: OperationContract) => {
    const relatedSectors = sectors.filter(sector => sector.operationId === operation.id);
    const relatedPoints = deliveryPoints.filter(point => point.operationId === operation.id);
    const relatedOrders = orders.filter(order => order.operationId === operation.id);
    const confirmed = window.confirm(
      `Excluir a operação "${operation.name}"?\n\n` +
      `Também serão excluídos ${relatedSectors.length} setor(es), ${relatedPoints.length} local(is) de entrega e ${relatedOrders.length} pedido(s).\n\n` +
      'Esta ação não pode ser desfeita.'
    );
    if (!confirmed) return;

    const remainingOperations = operations.filter(item => item.id !== operation.id);
    persistOperations(remainingOperations);
    persistSectors(sectors.filter(sector => sector.operationId !== operation.id));
    persistDeliveryPoints(deliveryPoints.filter(point => point.operationId !== operation.id));
    persistOrders(orders.filter(order => order.operationId !== operation.id));

    if (activeOperationId === operation.id) {
      setActiveOperationId(remainingOperations[0]?.id || '');
    }
    if (editingOperationId === operation.id) {
      setEditingOperationId(null);
      setOperationEditForm(emptyOperationForm());
    }
    setEditingSectorId(null);
    setEditingPointId(null);
    setEditingOrderId(null);
    setDraftDeliveries([]);
  };

  const addSector = (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeOperation || !displayText(newSector)) return;
    const sector = { id: makeId('sector'), operationId: activeOperation.id, name: displayText(newSector) };
    persistSectors([...sectors, sector]);
    setNewSector(`Setor ${String(operationSectors.length + 2).padStart(2, '0')}`);
  };

  const startEditSector = (sector: Sector) => {
    setEditingSectorId(sector.id);
    setSectorEditName(sector.name);
  };

  const saveSectorEdit = () => {
    if (!editingSectorId || !displayText(sectorEditName)) return;
    persistSectors(sectors.map(sector => sector.id === editingSectorId ? { ...sector, name: displayText(sectorEditName) } : sector));
    setEditingSectorId(null);
    setSectorEditName('');
  };

  const addDeliveryPoint = (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeOperation || !displayText(newPoint.name) || !newPoint.sectorId) return;
    const point: DeliveryPoint = {
      id: makeId('point'),
      operationId: activeOperation.id,
      sectorId: newPoint.sectorId,
      code: displayText(newPoint.code) || displayText(newPoint.name),
      name: displayText(newPoint.name),
      address: displayText(newPoint.address),
      neighborhood: displayText(newPoint.neighborhood),
    };
    persistDeliveryPoints([...deliveryPoints, point]);
    setNewPoint({ ...newPoint, code: '', name: '', address: '', neighborhood: '' });
    if (!orderForm.deliveryPointId) setOrderForm({ ...orderForm, deliveryPointId: point.id });
  };

  const startEditPoint = (point: DeliveryPoint) => {
    setEditingPointId(point.id);
    setPointEditForm({
      sectorId: point.sectorId,
      code: point.code,
      name: point.name,
      address: point.address,
      neighborhood: point.neighborhood,
    });
  };

  const savePointEdit = () => {
    if (!editingPointId || !displayText(pointEditForm.name) || !pointEditForm.sectorId) return;
    persistDeliveryPoints(deliveryPoints.map(point => point.id === editingPointId ? {
      ...point,
      sectorId: pointEditForm.sectorId,
      code: displayText(pointEditForm.code) || displayText(pointEditForm.name),
      name: displayText(pointEditForm.name),
      address: displayText(pointEditForm.address),
      neighborhood: displayText(pointEditForm.neighborhood),
    } : point));
    setEditingPointId(null);
  };

  const startEditOrder = (order: OperationOrder) => {
    setActiveModule('order-entry');
    setEditingOrderId(order.id);
    setEditingDraftItem(null);
    setOrderForm(prev => ({
      ...prev,
      category: order.category,
      deliveryDate: order.deliveryDate,
      consumptionPeriod: order.consumptionPeriod || '',
      generalNotes: order.generalNotes || '',
      deliveryPointId: order.deliveries[0]?.deliveryPointId || operationPoints[0]?.id || '',
      product: '',
      unit: 'UN',
      quantity: 0,
      notes: '',
    }));
    setDraftDeliveries(order.deliveries.map(delivery => ({
      ...delivery,
      items: delivery.items.map(item => ({ ...item })),
    })));
  };

  const deleteOrder = (orderId: string) => {
    if (!confirm('Deseja excluir este pedido da operação?')) return;
    persistOrders(orders.filter(order => order.id !== orderId));
  };

  const deleteDelivery = (orderId: string, deliveryId: string) => {
    const order = orders.find(item => item.id === orderId);
    const delivery = order?.deliveries.find(item => item.id === deliveryId);
    if (!order || !delivery) return;

    const deliveryName = pointById(delivery.deliveryPointId)?.name || 'Local não cadastrado';
    const isLastDelivery = order.deliveries.length === 1;
    const confirmed = window.confirm(
      isLastDelivery
        ? `Excluir o romaneio de "${deliveryName}"?\n\nEste é o último romaneio do pedido; o pedido também será excluído.`
        : `Excluir somente o romaneio de "${deliveryName}"?\n\nOs demais romaneios deste pedido serão preservados.`
    );
    if (!confirmed) return;

    if (isLastDelivery) {
      persistOrders(orders.filter(item => item.id !== orderId));
      return;
    }

    persistOrders(orders.map(item => item.id === orderId
      ? { ...item, deliveries: item.deliveries.filter(candidate => candidate.id !== deliveryId) }
      : item));
  };

  const addDraftItem = (event: React.FormEvent) => {
    event.preventDefault();
    if (!orderForm.deliveryPointId || !displayText(orderForm.product) || orderForm.quantity <= 0) return;
    const item: DeliveryItem = {
      product: displayText(orderForm.product),
      unit: displayText(orderForm.unit) || 'UN',
      quantity: Number(orderForm.quantity),
      notes: displayText(orderForm.notes),
    };
    if (editingDraftItem) {
      setDraftDeliveries(prev => {
        const next = prev
          .map(delivery => delivery.deliveryPointId === editingDraftItem.deliveryPointId
            ? { ...delivery, items: delivery.items.filter((_, index) => index !== editingDraftItem.itemIndex) }
            : delivery)
          .filter(delivery => delivery.items.length > 0);
        const current = next.find(delivery => delivery.deliveryPointId === orderForm.deliveryPointId);
        if (current) {
          return next.map(delivery => delivery.deliveryPointId === orderForm.deliveryPointId ? { ...delivery, items: [...delivery.items, item] } : delivery);
        }
        return [...next, { id: makeId('draft_delivery'), deliveryPointId: orderForm.deliveryPointId, items: [item] }];
      });
      setEditingDraftItem(null);
      setOrderForm(prev => ({ ...prev, product: '', quantity: 0, notes: '' }));
      return;
    }
    setDraftDeliveries(prev => {
      const current = prev.find(delivery => delivery.deliveryPointId === orderForm.deliveryPointId);
      if (current) {
        return prev.map(delivery => delivery.deliveryPointId === orderForm.deliveryPointId ? { ...delivery, items: [...delivery.items, item] } : delivery);
      }
      return [...prev, { id: makeId('draft_delivery'), deliveryPointId: orderForm.deliveryPointId, items: [item] }];
    });
    setOrderForm(prev => ({ ...prev, product: '', quantity: 0, notes: '' }));
  };

  const startEditDraftItem = (deliveryPointId: string, itemIndex: number) => {
    const item = draftDeliveries.find(delivery => delivery.deliveryPointId === deliveryPointId)?.items[itemIndex];
    if (!item) return;
    setEditingDraftItem({ deliveryPointId, itemIndex });
    setOrderForm(prev => ({
      ...prev,
      deliveryPointId,
      product: item.product,
      unit: item.unit || 'UN',
      quantity: item.quantity,
      notes: item.notes || '',
    }));
  };

  const cancelDraftItemEdit = () => {
    setEditingDraftItem(null);
    setOrderForm(prev => ({ ...prev, product: '', quantity: 0, notes: '' }));
  };

  const removeDraftItem = (deliveryPointId: string, itemIndex: number) => {
    setDraftDeliveries(prev => prev
      .map(delivery => delivery.deliveryPointId === deliveryPointId ? { ...delivery, items: delivery.items.filter((_, index) => index !== itemIndex) } : delivery)
      .filter(delivery => delivery.items.length > 0));
    if (editingDraftItem?.deliveryPointId === deliveryPointId && editingDraftItem.itemIndex === itemIndex) {
      cancelDraftItemEdit();
    }
  };

  const saveManualOrder = () => {
    if (!activeOperation || draftDeliveries.length === 0) return;
    if (editingOrderId) {
      persistOrders(orders.map(order => order.id === editingOrderId ? {
        ...order,
        category: orderForm.category,
        deliveryDate: orderForm.deliveryDate,
        consumptionPeriod: displayText(orderForm.consumptionPeriod),
        generalNotes: displayText(orderForm.generalNotes),
        deliveries: normalizeOrderDeliveries(draftDeliveries),
      } : order));
      setEditingOrderId(null);
      setEditingDraftItem(null);
      setDraftDeliveries([]);
      setOrderForm(prev => ({ ...prev, product: '', quantity: 0, notes: '' }));
      alert('Pedido de entrega atualizado.');
      return;
    }

    const order: OperationOrder = {
      id: makeId('order'),
      operationId: activeOperation.id,
      category: orderForm.category,
      sourceFileName: 'Lançamento manual',
      sourceType: 'Manual',
      deliveryDate: orderForm.deliveryDate,
      consumptionPeriod: displayText(orderForm.consumptionPeriod),
      generalNotes: displayText(orderForm.generalNotes),
      importedAt: new Date().toISOString(),
      deliveries: normalizeOrderDeliveries(draftDeliveries),
    };
    persistOrders([order, ...orders]);
    setEditingDraftItem(null);
    setDraftDeliveries([]);
    setOrderForm(prev => ({ ...prev, product: '', quantity: 0, notes: '', generalNotes: '' }));
    alert('Pedido do cliente lançado na operação.');
  };

  const cancelOrderEdit = () => {
    setEditingOrderId(null);
    setEditingDraftItem(null);
    setDraftDeliveries([]);
    setOrderForm(prev => ({
      ...prev,
      deliveryPointId: operationPoints[0]?.id || '',
      product: '',
      unit: 'UN',
      quantity: 0,
      notes: '',
      generalNotes: '',
    }));
  };

  const parseUnitSheet = (sheetName: string, rows: unknown[][]): OrderDelivery | null => {
    const headerRow = findHeaderRow(rows);
    if (headerRow < 0) return null;
    const headers = rows[headerRow].map(normalizeKey);
    const productIndex = headers.findIndex(header => header === 'PRODUTO');
    const unitIndex = headers.findIndex(header => ['UND', 'UNIDADE', 'EMBALAGEM'].includes(header));
    const quantityIndex = headers.findIndex(header => ['QTD', 'QTDE', 'QUANTIDADE'].includes(header));
    const notesIndex = headers.findIndex(header => header === 'OBS' || header === 'OBS.');
    if (productIndex < 0 || quantityIndex < 0) return null;

    const items = rows.slice(headerRow + 1).map(row => ({
      product: displayText(row[productIndex]),
      unit: displayText(unitIndex >= 0 ? row[unitIndex] : 'UN') || 'UN',
      quantity: toNumber(row[quantityIndex]),
      notes: displayText(notesIndex >= 0 ? row[notesIndex] : ''),
    })).filter(item => item.product && item.quantity > 0);

    if (items.length === 0) return null;
    const deliveryLabel = extractDeliveryLabelFromRows(rows);
    const sheetKey = normalizeKey(sheetName);
    const matchedPoint = (deliveryLabel ? findDeliveryPointByLabel(deliveryLabel) : undefined) ||
      findDeliveryPointByLabel(sheetName) ||
      operationPoints.find(point => sheetKey.includes(normalizeKey(point.code)));
    if (!matchedPoint && (operationPoints.length !== 1 || ignoredDeliveryHeaders.has(sheetKey))) return null;
    return { id: makeId('delivery'), deliveryPointId: matchedPoint?.id || operationPoints[0].id, items: aggregateDeliveryItems(items) };
  };

  const parseMatrixSheet = (rows: unknown[][]): OrderDelivery[] => {
    const headerRow = rows.findIndex(row =>
      row.some(cell => normalizeKey(cell) === 'PRODUTO') &&
      row.some(cell => ['EMBALAGEM', 'UND', 'UNIDADE'].includes(normalizeKey(cell)))
    );
    if (headerRow < 0) return [];
    const headers = rows[headerRow];
    const normalizedHeaders = headers.map(normalizeKey);
    const productIndex = normalizedHeaders.findIndex(header => header === 'PRODUTO');
    const unitIndex = normalizedHeaders.findIndex(header => ['EMBALAGEM', 'UND', 'UNIDADE'].includes(header));
    if (productIndex < 0 || unitIndex < 0) return [];
    return headers.map((header, index) => ({ header: displayText(header), index }))
      .filter(col => {
        if (col.index === productIndex || col.index === unitIndex || !col.header) return false;
        if (findDeliveryPointByLabel(col.header)) return true;
        return !ignoredDeliveryHeaders.has(normalizeKey(col.header));
      })
      .map(col => {
        const matchedPoint = findDeliveryPointByLabel(col.header);
        if (!matchedPoint) return null;
        const items = rows.slice(headerRow + 1).map(row => ({
          product: displayText(row[productIndex]),
          unit: displayText(row[unitIndex]) || 'UN',
          quantity: toNumber(row[col.index]),
        })).filter(item => item.product && item.quantity > 0);
        return items.length > 0 ? { id: makeId('delivery'), deliveryPointId: matchedPoint.id, items: aggregateDeliveryItems(items) } : null;
      })
      .filter((delivery): delivery is OrderDelivery => Boolean(delivery));
  };

  const parseExcelOrder = async (file: File): Promise<OperationOrder> => {
    if (!activeOperation || operationPoints.length === 0) throw new Error('Cadastre ao menos um local de entrega antes de importar.');
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
    let deliveryDate = orderForm.deliveryDate || todayIso();
    const deliveries: OrderDelivery[] = [];

    workbook.SheetNames.forEach(sheetName => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' }) as unknown[][];
      if (!rows.length) return;
      deliveryDate = extractDateFromRows(rows) || deliveryDate;
      const parsedUnit = parseUnitSheet(sheetName, rows);
      if (parsedUnit) deliveries.push(parsedUnit);
      if (!parsedUnit) deliveries.push(...parseMatrixSheet(rows));
    });

    const normalizedDeliveries = normalizeOrderDeliveries(deliveries);
    if (normalizedDeliveries.length === 0) {
      throw new Error('Não encontrei locais de entrega compatíveis com os locais cadastrados. Confira se as abas/colunas do Excel usam o mesmo nome ou código dos locais.');
    }
    return {
      id: makeId('order'),
      operationId: activeOperation.id,
      category: orderForm.category,
      sourceFileName: file.name,
      sourceType: 'Excel',
      deliveryDate,
      consumptionPeriod: displayText(orderForm.consumptionPeriod),
      importedAt: new Date().toISOString(),
      deliveries: normalizedDeliveries,
    };
  };

  const extractPdfText = async (file: File) => {
    const data = await file.arrayBuffer();
    const pdf = await getDocument({ data }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item: any) => item.str || '').join(' '));
    }
    return pages.join('\n');
  };

  const parsePdfOrder = async (file: File): Promise<OperationOrder> => {
    if (!activeOperation || operationPoints.length === 0) throw new Error('Cadastre ao menos um local de entrega antes de importar.');
    const text = await extractPdfText(file);
    const items = text
      .split(/\n|(?= [A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9\s()./%-]{6,}\s+(UND|UN|KG|PCT|CX|LT|L)\s+\d+)/g)
      .map(line => line.trim())
      .map(line => {
        const match = line.match(/^(.+?)\s+(UND|UN|KG|PCT|CX|LT|L)\s+([\d.,]+)(?:\s|$)/i);
        return match ? { product: displayText(match[1]), unit: displayText(match[2]).toUpperCase(), quantity: toNumber(match[3]) } : null;
      })
      .filter((item): item is DeliveryItem => Boolean(item?.product && item.quantity > 0));
    if (items.length === 0) throw new Error('Não consegui extrair itens do PDF. Para PDF digitalizado, importe o Excel correspondente.');
    return {
      id: makeId('order'),
      operationId: activeOperation.id,
      category: orderForm.category,
      sourceFileName: file.name,
      sourceType: 'PDF',
      deliveryDate: orderForm.deliveryDate || todayIso(),
      consumptionPeriod: displayText(orderForm.consumptionPeriod),
      importedAt: new Date().toISOString(),
      deliveries: [{ id: makeId('delivery'), deliveryPointId: operationPoints[0].id, items: aggregateDeliveryItems(items) }],
    };
  };

  const handleImportFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] || null;
    setSelectedImportFile(file);
    setImportFeedback(file ? { type: 'progress', message: `${file.name} selecionado. Clique em “Importar pedido” para continuar.` } : null);
  };

  const handleActiveOperationChange = (operationId: string) => {
    setActiveOperationId(operationId);
    saveStorage(ACTIVE_OPERATION_KEY, operationId);
    setSelectedImportFile(null);
    setImportInputKey(current => current + 1);
    setImportFeedback(null);
  };

  const handleImport = async () => {
    const file = selectedImportFile;
    if (!file || !activeOperation) return;
    setImporting(true);
    setImportFeedback({ type: 'progress', message: `Lendo ${file.name}...` });
    try {
      const extension = file.name.split('.').pop()?.toLowerCase();
      if (!extension || !['xlsx', 'xls', 'pdf'].includes(extension)) {
        throw new Error('Formato não suportado. Selecione um arquivo Excel (.xlsx ou .xls) ou PDF.');
      }
      const order = extension === 'pdf' ? await parsePdfOrder(file) : await parseExcelOrder(file);
      const nextOrders = [order, ...orders];
      setImportFeedback({ type: 'progress', message: `Salvando ${order.deliveries.length} local(is) de entrega...` });
      await saveSharedState(ORDERS_KEY, nextOrders);
      setOrders(nextOrders);
      saveStorage(ORDERS_KEY, nextOrders);
      setActiveModule('orders');
      setSelectedImportFile(null);
      setImportInputKey(current => current + 1);
      setImportFeedback({ type: 'success', message: `Pedido importado: ${order.deliveries.length} local(is) de entrega e ${buildSummary(order.deliveries).length} produto(s).` });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Não foi possível importar o pedido.';
      console.error('Falha ao importar pedido:', error);
      setImportFeedback({ type: 'error', message });
    } finally {
      setImporting(false);
    }
  };

  const pointById = (id: string) => deliveryPoints.find(point => point.id === id);
  const sectorById = (id?: string) => sectors.find(sector => sector.id === id);
  const operationByOrder = (order: OperationOrder) =>
    operations.find(operation => operation.id === order.operationId) || activeOperation;

  const getSectorSummaryTable = (order: OperationOrder) => {
    const usedSectorIds = new Set<string>();
    order.deliveries.forEach(delivery => {
      const point = pointById(delivery.deliveryPointId);
      usedSectorIds.add(point?.sectorId || 'sem_setor');
    });

    const sectorColumns = Array.from(usedSectorIds)
      .map(sectorId => {
        const sector = sectorById(sectorId);
        return {
          id: sectorId,
          name: sectorId === 'sem_setor' ? 'Sem setor' : sector?.name || 'Setor sem cadastro',
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    const totals = new Map<string, { product: string; unit: string; sectors: Record<string, number>; total: number }>();
    order.deliveries.forEach(delivery => {
      const point = pointById(delivery.deliveryPointId);
      const sectorId = point?.sectorId || 'sem_setor';
      aggregateDeliveryItems(delivery.items).forEach(item => {
        const key = stockKey(item.product, item.unit);
        const current = totals.get(key) || { product: item.product, unit: item.unit, sectors: {}, total: 0 };
        current.sectors[sectorId] = (current.sectors[sectorId] || 0) + item.quantity;
        current.total += item.quantity;
        totals.set(key, current);
      });
    });

    const rows = Array.from(totals.values()).sort((a, b) => a.product.localeCompare(b.product));
    const sectorTotals = sectorColumns.reduce<Record<string, number>>((acc, sector) => {
      acc[sector.id] = rows.reduce((sum, row) => sum + (row.sectors[sector.id] || 0), 0);
      return acc;
    }, {});

    const body = rows.map(row => [
      row.product,
      row.unit,
      ...sectorColumns.map(sector => row.sectors[sector.id] ? formatQuantity(row.sectors[sector.id]) : '-'),
      formatQuantity(row.total),
    ]);

    if (rows.length > 0) {
      body.push([
        'TOTAL GERAL',
        '',
        ...sectorColumns.map(sector => formatQuantity(sectorTotals[sector.id] || 0)),
        formatQuantity(rows.reduce((sum, row) => sum + row.total, 0)),
      ]);
    }

    return {
      head: [['Produto', 'UND', ...sectorColumns.map(sector => sector.name), 'Total']],
      body,
      sectorColumns,
    };
  };

  const getDeliveryPointSummaryTable = (deliveries: OrderDelivery[], usePointCodes = false) => {
    const pointColumns = deliveries
      .map(delivery => {
        const point = pointById(delivery.deliveryPointId);
        const sector = sectorById(point?.sectorId);
        return {
          id: delivery.deliveryPointId,
          name: point?.name || point?.code || 'Local sem cadastro',
          code: point?.code || '',
          sectorNumber: sector?.name.match(/\d+/)?.[0]?.replace(/^0+/, '') || '',
        };
      })
      .sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name, undefined, { numeric: true, sensitivity: 'base' }))
      .map((point, index) => {
        return {
          ...point,
          displayCode: `${point.sectorNumber || ''}${toColumnLetters(index)}`,
        };
      });

    const totals = new Map<string, { product: string; unit: string; points: Record<string, number>; total: number }>();
    deliveries.forEach(delivery => {
      aggregateDeliveryItems(delivery.items).forEach(item => {
        const key = stockKey(item.product, item.unit);
        const current = totals.get(key) || { product: item.product, unit: item.unit, points: {}, total: 0 };
        current.points[delivery.deliveryPointId] = (current.points[delivery.deliveryPointId] || 0) + item.quantity;
        current.total += item.quantity;
        totals.set(key, current);
      });
    });

    const rows = Array.from(totals.values()).sort((a, b) => a.product.localeCompare(b.product));
    const pointTotals = pointColumns.reduce<Record<string, number>>((acc, point) => {
      acc[point.id] = rows.reduce((sum, row) => sum + (row.points[point.id] || 0), 0);
      return acc;
    }, {});

    const body = rows.map(row => [
      row.product,
      row.unit,
      ...pointColumns.map(point => row.points[point.id] ? formatQuantity(row.points[point.id]) : '-'),
      formatQuantity(row.total),
    ]);

    if (rows.length > 0) {
      body.push([
        'TOTAL GERAL',
        '',
        ...pointColumns.map(point => formatQuantity(pointTotals[point.id] || 0)),
        formatQuantity(rows.reduce((sum, row) => sum + row.total, 0)),
      ]);
    }

    return {
      head: usePointCodes
        ? [
          ['Produto', 'UND', ...pointColumns.map(point => point.name), 'Total'],
          ['', '', ...pointColumns.map(point => point.displayCode), ''],
        ]
        : [['Produto', 'UND', ...pointColumns.map(point => point.name), 'Total']],
      body,
      pointColumns,
    };
  };

  const getOrderSectors = (order: OperationOrder) => {
    const usedSectorIds = new Set<string>(
      order.deliveries
        .map(delivery => pointById(delivery.deliveryPointId)?.sectorId || 'sem_setor')
    );

    return Array.from(usedSectorIds)
      .map(sectorId => {
        const sector = sectorById(sectorId);
        return {
          id: sectorId,
          operationId: order.operationId,
          name: sectorId === 'sem_setor' ? 'Sem setor' : sector?.name || 'Setor sem cadastro',
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  const getDeliveryPointSummaryPdfOptions = (summary: ReturnType<typeof getDeliveryPointSummaryTable>) => {
    const totalColumnIndex = summary.head[0].length - 1;
    const pointColumnIndexes = summary.pointColumns.map((_, index) => index + 2);
    const pointColumnWidth = 81.5 / Math.max(summary.pointColumns.length, 1);
    const schoolHeaderFillColor: [number, number, number] = [219, 234, 254];
    const schoolHeaderFontSize = 9;
    const schoolHeaderHeight = 36;
    const schoolHeaderTextHeight = schoolHeaderHeight - 4;
    const columnStyles = pointColumnIndexes.reduce<Record<number, any>>((acc, columnIndex) => {
      acc[columnIndex] = { cellWidth: pointColumnWidth, halign: 'center', overflow: 'linebreak' };
      return acc;
    }, {
      0: { cellWidth: 58, overflow: 'linebreak' },
      1: { cellWidth: 24, overflow: 'linebreak' },
      [totalColumnIndex]: { cellWidth: 18, halign: 'center' },
    });

    return {
      columnStyles,
      styles: { font: REPORT_FONT, fontSize: 6.8, cellPadding: 1, overflow: 'linebreak', minCellHeight: 6 },
      headStyles: {
        font: REPORT_FONT,
        fontSize: 6.2,
        fontStyle: 'bold',
        fillColor: schoolHeaderFillColor,
        textColor: [0, 0, 0],
        valign: 'middle',
        halign: 'center',
      },
      bodyStyles: { valign: 'middle' },
      didParseCell: (data: any) => {
        const columnIndex = data.column.index;
        const isPointColumn = columnIndex >= 2 && columnIndex < totalColumnIndex;
        if (isPointColumn || columnIndex === totalColumnIndex) {
          data.cell.styles.halign = 'center';
        }
        if (data.section === 'head' && data.row.index === 0 && isPointColumn) {
          data.cell.styles.minCellHeight = schoolHeaderHeight;
          data.cell.styles.cellPadding = 0.8;
          data.cell.styles.overflow = 'hidden';
          data.cell.text = [];
        }
        if (data.section === 'head' && data.row.index === 1) {
          data.cell.styles.halign = columnIndex >= 2 ? 'center' : 'left';
          data.cell.styles.fontSize = 7.5;
        }
      },
      didDrawCell: (data: any) => {
        const columnIndex = data.column.index;
        const isSchoolNameCell = data.section === 'head' && data.row.index === 0 &&
          columnIndex >= 2 && columnIndex < totalColumnIndex;
        if (!isSchoolNameCell) return;

        const schoolName = String(summary.head[0][columnIndex] || '');
        data.doc.setFont(REPORT_FONT, 'bold');
        data.doc.setFontSize(schoolHeaderFontSize);
        data.doc.setTextColor(0, 0, 0);
        const schoolNameLines = data.doc.splitTextToSize(schoolName, schoolHeaderTextHeight) as string[];
        const lineSpacing = 2.8;
        schoolNameLines.forEach((line, lineIndex) => {
          const lineWidth = data.doc.getTextWidth(line);
          const centeredLineOffset = (lineIndex - ((schoolNameLines.length - 1) / 2)) * lineSpacing;
          data.doc.text(
            line,
            data.cell.x + (data.cell.width / 2) + centeredLineOffset,
            data.cell.y + (data.cell.height / 2) + (lineWidth / 2),
            { baseline: 'middle', angle: 90 },
          );
        });
      },
    } as any;
  };

  const findDeliveryPointByLabel = (label: string) => {
    const labelKey = normalizeKey(label);
    const simpleLabel = normalizeDeliveryLabel(label);
    const exactMatch = operationPoints.find(point =>
      normalizeKey(point.code) === labelKey ||
      normalizeKey(point.name) === labelKey ||
      normalizeDeliveryLabel(point.code) === simpleLabel ||
      normalizeDeliveryLabel(point.name) === simpleLabel
    );
    if (exactMatch) return exactMatch;

    return [...operationPoints]
      .sort((a, b) => Math.max(normalizeDeliveryLabel(b.code).length, normalizeDeliveryLabel(b.name).length) - Math.max(normalizeDeliveryLabel(a.code).length, normalizeDeliveryLabel(a.name).length))
      .find(point => {
        const aliases = [normalizeDeliveryLabel(point.code), normalizeDeliveryLabel(point.name)].filter(alias => alias.length >= 5);
        return aliases.some(alias => simpleLabel.includes(alias) || alias.includes(simpleLabel));
      });
  };

  const getStockMap = () => {
    const map = new Map<string, number>();
    products.forEach(product => {
      const key = stockKey(product.name, product.unit || 'UN');
      map.set(key, (map.get(key) || 0) + Number(product.quantity || 0));
    });
    return map;
  };

  const getPurchaseNeeds = (order: OperationOrder): PurchaseNeed[] => {
    const stock = getStockMap();
    return buildSummary(order.deliveries).map(item => {
      const available = stock.get(stockKey(item.product, item.unit)) || 0;
      if (available >= item.quantity) return null;
      return {
        product: item.product,
        unit: item.unit,
        demand: item.quantity,
        stock: available,
        missing: item.quantity - available,
        status: available === 0 ? 'SEM CADASTRO' : 'ESTOQUE INSUFICIENTE',
      };
    }).filter((need): need is PurchaseNeed => Boolean(need));
  };

  const ensureMissingProducts = async (order: OperationOrder, needs: PurchaseNeed[]) => {
    const existingKeys = new Set(products.map(product => stockKey(product.name, product.unit || 'UN')));
    const missingProducts = needs.filter(need => !existingKeys.has(stockKey(need.product, need.unit)));
    if (missingProducts.length === 0) return;
    const payload = missingProducts.map(need => ({
      name: need.product,
      category: categoryToInventoryCategory(order.category),
      unit: need.unit || 'UN',
      quantity: 0,
      min_stock: 0,
      deposit: 'Depósito-Grupo OM' as Deposit,
    }));
    const { error } = await supabase.from('products').insert(payload);
    if (error) throw error;
    await fetchProducts();
  };

  const createPurchaseOrderFromOperation = async (order: OperationOrder) => {
    const needs = getPurchaseNeeds(order);
    if (needs.length === 0) {
      alert('O estoque atual atende todos os itens deste pedido.');
      return;
    }
    setCreatingPurchase(true);
    try {
      await ensureMissingProducts(order, needs);
      const purchaseOrder = {
        date: todayIso(),
        status: 'PENDENTE',
        items: needs.map(need => ({
          product_id: '',
          product_name: need.product,
          quantity: need.missing,
          unit: need.unit || 'UN',
        })),
      };
      const { error } = await supabase.from('purchase_orders').insert([purchaseOrder]);
      if (error) throw error;
      alert(`Pedido de compra gerado com ${needs.length} item(ns) faltante(s). Produtos sem cadastro foram criados com saldo zero.`);
    } catch (err: any) {
      alert(`Erro ao gerar pedido de compra: ${err.message}`);
    } finally {
      setCreatingPurchase(false);
    }
  };

  const generateDeliveryPdf = async (order: OperationOrder, delivery: OrderDelivery) => {
    const reportOperation = operationByOrder(order);
    if (!reportOperation) return;
    const point = pointById(delivery.deliveryPointId);
    const fileName = getRomaneioFileName(reportOperation, order, point?.name || 'entrega');
    const writer = await preparePdfWriter(reportOperation, fileName);
    const sector = sectorById(point?.sectorId);
    const items = aggregateDeliveryItems(delivery.items);
    const doc = new jsPDF();
    doc.setFont(REPORT_FONT, 'normal');
    doc.setFontSize(REPORT_FONT_SIZE);
    await addHeader(doc, reportOperation, order, `${sector?.name || 'Sem setor'} | ${point?.name || 'Local de entrega'}`);
    doc.text(`Local: ${point?.name || '-'} | Codigo: ${point?.code || '-'}`, 14, 39);
    const addressEndY = addDeliveryAddress(doc, point);
    const tableStartY = addOrderGeneralNotes(doc, order, addressEndY);

    autoTable(doc, {
      startY: tableStartY,
      head: [['Produto', 'UND', 'QTD', 'OBS.']],
      body: items.map(item => [item.product, item.unit, formatQuantity(item.quantity), item.notes || '']),
      styles: { font: REPORT_FONT, fontSize: REPORT_FONT_SIZE, cellPadding: 1.4 },
      headStyles: { font: REPORT_FONT, fontSize: REPORT_FONT_SIZE, fontStyle: 'bold', fillColor: [5, 150, 105] },
      theme: 'grid',
    });
    addReceiptFields(doc, (doc as any).lastAutoTable?.finalY || 60);
    await savePdf(doc, fileName, writer);
  };

  const generateAllDeliveriesPdf = async (order: OperationOrder) => {
    const reportOperation = operationByOrder(order);
    if (!reportOperation || order.deliveries.length === 0) return;
    const fileName = getRomaneioFileName(reportOperation, order);
    const writer = await preparePdfWriter(reportOperation, fileName);
    const doc = new jsPDF();
    doc.setFont(REPORT_FONT, 'normal');
    doc.setFontSize(REPORT_FONT_SIZE);

    const orderedSectors = getOrderSectors(order);
    const sectorSummary = getSectorSummaryTable(order);

    await addHeader(doc, reportOperation, order, 'TOTAL GERAL');
    let tableStartY = addOrderGeneralNotes(doc, order, 39);
    autoTable(doc, {
      startY: tableStartY,
      head: sectorSummary.head,
      body: sectorSummary.body,
      styles: { font: REPORT_FONT, fontSize: sectorSummary.sectorColumns.length > 3 ? 7 : REPORT_FONT_SIZE, cellPadding: 1.2 },
      headStyles: { font: REPORT_FONT, fontSize: REPORT_FONT_SIZE, fontStyle: 'bold', fillColor: [79, 70, 229] },
      theme: 'grid',
    });

    for (const sector of orderedSectors) {
      const scopedDeliveries = order.deliveries.filter(delivery => (pointById(delivery.deliveryPointId)?.sectorId || 'sem_setor') === sector.id);
      const summary = getDeliveryPointSummaryTable(scopedDeliveries, true);

      doc.addPage('a4', 'portrait');
      await addHeader(doc, reportOperation, order, `TOTAL - ${sector.name}`);
      tableStartY = addOrderGeneralNotes(doc, order, 39);
      const tableOptions = getDeliveryPointSummaryPdfOptions(summary);
      autoTable(doc, {
        startY: tableStartY,
        head: summary.head,
        body: summary.body,
        theme: 'grid',
        ...tableOptions,
      });
    }

    const orderedDeliveries = orderedSectors.flatMap((sector, sectorIndex) =>
      order.deliveries
        .filter(delivery => (pointById(delivery.deliveryPointId)?.sectorId || 'sem_setor') === sector.id)
        .sort((a, b) => {
          const pointA = pointById(a.deliveryPointId);
          const pointB = pointById(b.deliveryPointId);
          return (pointA?.code || pointA?.name || '').localeCompare(pointB?.code || pointB?.name || '', undefined, { numeric: true, sensitivity: 'base' });
        })
        .map((delivery, schoolIndex) => ({
          delivery,
          sector,
          displayCode: `${sector.name.match(/\d+/)?.[0]?.replace(/^0+/, '') || sectorIndex + 1}${toColumnLetters(schoolIndex)}`,
        }))
    );

    for (const { delivery, sector, displayCode } of orderedDeliveries) {
      doc.addPage();
      const point = pointById(delivery.deliveryPointId);
      const items = aggregateDeliveryItems(delivery.items);

      doc.setFont(REPORT_FONT, 'normal');
      doc.setFontSize(REPORT_FONT_SIZE);
      await addHeader(doc, reportOperation, order, `${sector.name} | ${displayCode} - ${point?.name || 'Local de entrega'}`);
      doc.text(`Local: ${point?.name || '-'} | Codigo: ${displayCode}`, 14, 39);
      const addressEndY = addDeliveryAddress(doc, point);
      tableStartY = addOrderGeneralNotes(doc, order, addressEndY);

      autoTable(doc, {
        startY: tableStartY,
        head: [['Produto', 'UND', 'QTD', 'OBS.']],
        body: items.map(item => [item.product, item.unit, formatQuantity(item.quantity), item.notes || '']),
        styles: { font: REPORT_FONT, fontSize: REPORT_FONT_SIZE, cellPadding: 1.4 },
        headStyles: { font: REPORT_FONT, fontSize: REPORT_FONT_SIZE, fontStyle: 'bold', fillColor: [5, 150, 105] },
        theme: 'grid',
      } as any);
      addReceiptFields(doc, (doc as any).lastAutoTable?.finalY || 60);
    }

    await savePdf(doc, fileName, writer);
  };

  const generateSummaryPdf = async (order: OperationOrder, sectorId?: string) => {
    const reportOperation = operationByOrder(order);
    if (!reportOperation) return;
    const scopedDeliveries = sectorId
      ? order.deliveries.filter(delivery => pointById(delivery.deliveryPointId)?.sectorId === sectorId)
      : order.deliveries;
    const sector = sectorById(sectorId);
    const fileName = getRomaneioFileName(reportOperation, order, sector ? `SOMA ${sector.name}` : 'TOTAL SETORES');
    const writer = await preparePdfWriter(reportOperation, fileName);
    const doc = new jsPDF();
    doc.setFont(REPORT_FONT, 'normal');
    doc.setFontSize(REPORT_FONT_SIZE);
    await addHeader(doc, reportOperation, order, sector ? `Soma das unidades - ${sector.name}` : 'Soma de todos os setores');
    const summaryTable = sector ? getDeliveryPointSummaryTable(scopedDeliveries, true) : getSectorSummaryTable(order);
    const tableStartY = addOrderGeneralNotes(doc, order, 39);
    autoTable(doc, {
      startY: tableStartY,
      head: summaryTable.head,
      body: summaryTable.body,
      theme: 'grid',
      ...(sector ? getDeliveryPointSummaryPdfOptions(summaryTable as ReturnType<typeof getDeliveryPointSummaryTable>) : {
        styles: { font: REPORT_FONT, fontSize: summaryTable.head[0].length > 6 ? 7 : REPORT_FONT_SIZE, cellPadding: 1.2 },
        headStyles: { font: REPORT_FONT, fontSize: REPORT_FONT_SIZE, fontStyle: 'bold', fillColor: [79, 70, 229] },
      }),
    });
    await savePdf(doc, fileName, writer);
  };

  const generateStockAnalysisPdf = async (order: OperationOrder) => {
    const reportOperation = operationByOrder(order);
    if (!reportOperation) return;
    const fileName = getRomaneioFileName(reportOperation, order, 'ANALISE ESTOQUE COMPRA');
    const writer = await preparePdfWriter(reportOperation, fileName);
    const needs = getPurchaseNeeds(order);
    const stock = getStockMap();
    const doc = new jsPDF();
    doc.setFont(REPORT_FONT, 'normal');
    doc.setFontSize(REPORT_FONT_SIZE);
    await addHeader(doc, reportOperation, order, 'Analise de estoque para compra');
    const tableStartY = addOrderGeneralNotes(doc, order, 39);
    autoTable(doc, {
      startY: tableStartY,
      head: [['Produto', 'UND', 'Demanda', 'Estoque', 'Comprar', 'Status']],
      body: buildSummary(order.deliveries).map(item => {
        const available = stock.get(stockKey(item.product, item.unit)) || 0;
        const missing = Math.max(0, item.quantity - available);
        return [item.product, item.unit, formatQuantity(item.quantity), formatQuantity(available), formatQuantity(missing), missing > 0 ? 'COMPRAR' : 'OK'];
      }),
      styles: { font: REPORT_FONT, fontSize: REPORT_FONT_SIZE, cellPadding: 1.4 },
      headStyles: { font: REPORT_FONT, fontSize: REPORT_FONT_SIZE, fontStyle: 'bold', fillColor: [220, 38, 38] },
      theme: 'grid',
    });
    doc.text(`Itens faltantes: ${needs.length}`, 14, ((doc as any).lastAutoTable?.finalY || 60) + 8);
    await savePdf(doc, fileName, writer);
  };

  const getExcelFileName = (operation: OperationContract, order: OperationOrder, suffix?: string) =>
    getRomaneioFileName(operation, order, suffix).replace(/\.pdf$/i, '.xlsx');

  const addExcelSheet = (
    workbook: XLSX.WorkBook,
    sheetName: string,
    operation: OperationContract,
    order: OperationOrder,
    title: string,
    rows: (string | number)[][],
    columnWidths: number[],
  ) => {
    const data: (string | number)[][] = [
      [operation.name, `${operation.city}/${operation.uf || '--'}`],
      [title],
      ['Entrega', formatDate(order.deliveryDate), 'Categoria', order.category],
      ['Período', order.consumptionPeriod || '-', 'Origem', order.sourceType],
      ...(order.generalNotes ? [['Observação', order.generalNotes]] : []),
      [],
      ...rows,
    ];
    const sheet = XLSX.utils.aoa_to_sheet(data);
    sheet['!cols'] = columnWidths.map(width => ({ wch: width }));
    sheet['!autofilter'] = rows.length > 1 ? { ref: XLSX.utils.encode_range({ s: { r: data.length - rows.length, c: 0 }, e: { r: data.length - 1, c: Math.max(0, rows[0].length - 1) } }) } : undefined;
    const baseSheetName = sanitizeFileName(sheetName).slice(0, 31) || 'Relatorio';
    let uniqueSheetName = baseSheetName;
    let copyNumber = 2;
    while (workbook.SheetNames.includes(uniqueSheetName)) {
      const suffix = ` ${copyNumber}`;
      uniqueSheetName = `${baseSheetName.slice(0, 31 - suffix.length)}${suffix}`;
      copyNumber += 1;
    }
    XLSX.utils.book_append_sheet(workbook, sheet, uniqueSheetName);
  };

  const generateDeliveryExcel = (order: OperationOrder, delivery: OrderDelivery) => {
    const reportOperation = operationByOrder(order);
    if (!reportOperation) return;
    const point = pointById(delivery.deliveryPointId);
    const sector = sectorById(point?.sectorId);
    const workbook = XLSX.utils.book_new();
    const items = aggregateDeliveryItems(delivery.items);
    addExcelSheet(
      workbook,
      'Entrega',
      reportOperation,
      order,
      `${sector?.name || 'Sem setor'} | ${point?.name || 'Local de entrega'}`,
      [
        ['Produto', 'UND', 'QTD', 'OBS.'],
        ...items.map(item => [item.product, item.unit, item.quantity, item.notes || '']),
      ],
      [42, 12, 12, 36],
    );
    XLSX.writeFile(workbook, getExcelFileName(reportOperation, order, point?.name || 'entrega'));
  };

  const addDeliverySummaryExcelSheet = (
    workbook: XLSX.WorkBook,
    order: OperationOrder,
    reportOperation: OperationContract,
    sheetName: string,
    title: string,
    summary: ReturnType<typeof getDeliveryPointSummaryTable> | ReturnType<typeof getSectorSummaryTable>,
  ) => {
    const widthCount = summary.head[0].length;
    addExcelSheet(
      workbook,
      sheetName,
      reportOperation,
      order,
      title,
      [...summary.head, ...summary.body] as (string | number)[][],
      Array.from({ length: widthCount }, (_, index) => index === 0 ? 38 : index === 1 ? 12 : 16),
    );
  };

  const generateAllDeliveriesExcel = (order: OperationOrder) => {
    const reportOperation = operationByOrder(order);
    if (!reportOperation) return;
    const workbook = XLSX.utils.book_new();
    addDeliverySummaryExcelSheet(workbook, order, reportOperation, 'Total geral', 'Total geral', getSectorSummaryTable(order));
    const orderedSectors = getOrderSectors(order);
    orderedSectors.forEach((sector, sectorIndex) => {
      const scoped = order.deliveries
        .filter(delivery => (pointById(delivery.deliveryPointId)?.sectorId || 'sem_setor') === sector.id)
        .sort((a, b) => {
          const pointA = pointById(a.deliveryPointId);
          const pointB = pointById(b.deliveryPointId);
          return (pointA?.code || pointA?.name || '').localeCompare(pointB?.code || pointB?.name || '', undefined, { numeric: true, sensitivity: 'base' });
        });
      addDeliverySummaryExcelSheet(workbook, order, reportOperation, `Total ${sector.name}`, `Total - ${sector.name}`, getDeliveryPointSummaryTable(scoped, true));
      scoped.forEach((delivery, schoolIndex) => {
        const point = pointById(delivery.deliveryPointId);
        const displayCode = `${sector.name.match(/\d+/)?.[0]?.replace(/^0+/, '') || sectorIndex + 1}${toColumnLetters(schoolIndex)}`;
        const items = aggregateDeliveryItems(delivery.items);
        addExcelSheet(
          workbook,
          `${displayCode} ${point?.name || 'Entrega'}`,
          reportOperation,
          order,
          `${sector.name} | ${displayCode} - ${point?.name || 'Local de entrega'}`,
          [['Produto', 'UND', 'QTD', 'OBS.'], ...items.map(item => [item.product, item.unit, item.quantity, item.notes || ''])],
          [42, 12, 12, 36],
        );
      });
    });
    XLSX.writeFile(workbook, getExcelFileName(reportOperation, order));
  };

  const generateSummaryExcel = (order: OperationOrder, sectorId?: string) => {
    const reportOperation = operationByOrder(order);
    if (!reportOperation) return;
    const sector = sectorById(sectorId);
    const scopedDeliveries = sectorId
      ? order.deliveries.filter(delivery => pointById(delivery.deliveryPointId)?.sectorId === sectorId)
      : order.deliveries;
    const summary = sector ? getDeliveryPointSummaryTable(scopedDeliveries, true) : getSectorSummaryTable(order);
    const workbook = XLSX.utils.book_new();
    addDeliverySummaryExcelSheet(workbook, order, reportOperation, 'Resumo', sector ? `Soma das unidades - ${sector.name}` : 'Soma de todos os setores', summary);
    XLSX.writeFile(workbook, getExcelFileName(reportOperation, order, sector ? `SOMA ${sector.name}` : 'TOTAL SETORES'));
  };

  const generateStockAnalysisExcel = (order: OperationOrder) => {
    const reportOperation = operationByOrder(order);
    if (!reportOperation) return;
    const workbook = XLSX.utils.book_new();
    const needs = getPurchaseNeeds(order);
    const stock = getStockMap();
    const summary = buildSummary(order.deliveries);
    addExcelSheet(
      workbook,
      'Análise de estoque',
      reportOperation,
      order,
      'Análise de estoque para compra',
      [
        ['Produto', 'UND', 'Necessário', 'Estoque', 'Comprar', 'Status'],
        ...summary.map(item => {
          const available = stock.get(stockKey(item.product, item.unit)) || 0;
          const missing = Math.max(0, item.quantity - available);
          return [item.product, item.unit, item.quantity, available, missing, missing > 0 ? 'COMPRAR' : 'OK'];
        }),
        [],
        ['Itens faltantes', needs.length],
      ],
      [42, 12, 14, 14, 14, 24],
    );
    XLSX.writeFile(workbook, getExcelFileName(reportOperation, order, 'ANALISE ESTOQUE COMPRA'));
  };

  const reportProductOptions = useMemo(() => {
    const options = new Map<string, { key: string; product: string; unit: string }>();
    operationOrders.forEach(order => {
      order.deliveries.forEach(delivery => {
        delivery.items.forEach(item => {
          const key = stockKey(item.product, item.unit);
          if (!options.has(key)) options.set(key, { key, product: item.product, unit: item.unit });
        });
      });
    });
    return Array.from(options.values()).sort((a, b) =>
      a.product.localeCompare(b.product) || a.unit.localeCompare(b.unit)
    );
  }, [operationOrders]);

  const selectedReportPoint = reportDeliveryPointId === 'Todos' ? undefined : pointById(reportDeliveryPointId);
  const selectedReportProduct = reportProduct === 'Todos'
    ? undefined
    : reportProductOptions.find(option => option.key === reportProduct);

  const periodReport = useMemo(() => {
    const filteredOrders = operationOrders.filter(order =>
      (reportCategory === 'Todas' || order.category === reportCategory) &&
      (!reportStartDate || order.deliveryDate >= reportStartDate) &&
      (!reportEndDate || order.deliveryDate <= reportEndDate)
    );
    const productMap = new Map<string, { product: string; unit: string; quantities: Record<string, number>; total: number }>();
    const matchedOrderIds = new Set<string>();
    const reportColumns = new Map<string, { key: string; date: string; pointId: string; pointLabel: string }>();

    filteredOrders.forEach(order => {
      order.deliveries
        .filter(delivery => reportDeliveryPointId === 'Todos' || delivery.deliveryPointId === reportDeliveryPointId)
        .forEach(delivery => {
        const matchingItems = aggregateDeliveryItems(delivery.items)
          .filter(item => reportProduct === 'Todos' || stockKey(item.product, item.unit) === reportProduct);
        if (matchingItems.length > 0) matchedOrderIds.add(order.id);
        const point = operationPoints.find(candidate => candidate.id === delivery.deliveryPointId);
        const columnKey = `${order.deliveryDate}::${delivery.deliveryPointId}`;
        if (matchingItems.length > 0 && !reportColumns.has(columnKey)) {
          reportColumns.set(columnKey, {
            key: columnKey,
            date: order.deliveryDate,
            pointId: delivery.deliveryPointId,
            pointLabel: point ? `${point.code ? `${point.code} - ` : ''}${point.name}` : 'Local não identificado',
          });
        }
        matchingItems.forEach(item => {
          const key = stockKey(item.product, item.unit);
          const current = productMap.get(key) || { product: item.product, unit: item.unit, quantities: {}, total: 0 };
          current.quantities[columnKey] = (current.quantities[columnKey] || 0) + item.quantity;
          current.total += item.quantity;
          productMap.set(key, current);
        });
      });
    });

    const columns = Array.from(reportColumns.values()).sort((a, b) =>
      a.date.localeCompare(b.date) || a.pointLabel.localeCompare(b.pointLabel, undefined, { numeric: true, sensitivity: 'base' })
    );
    const dates = Array.from(new Set(columns.map(column => column.date)));
    const locations = Array.from(new Set(columns.map(column => column.pointId)));
    const rows = Array.from(productMap.values()).sort((a, b) => a.product.localeCompare(b.product));
    const columnTotals = columns.reduce<Record<string, number>>((acc, column) => {
      acc[column.key] = rows.reduce((sum, row) => sum + (row.quantities[column.key] || 0), 0);
      return acc;
    }, {});
    return {
      columns,
      dates,
      locations,
      rows,
      orderCount: matchedOrderIds.size,
      columnTotals,
      grandTotal: rows.reduce((sum, row) => sum + row.total, 0),
    };
  }, [operationOrders, operationPoints, reportCategory, reportStartDate, reportEndDate, reportProduct, reportDeliveryPointId]);

  const romaneioProductsReport = useMemo(() => {
    const reportOrders = operationOrders
      .filter(order =>
        (reportCategory === 'Todas' || order.category === reportCategory) &&
        (!reportStartDate || order.deliveryDate >= reportStartDate) &&
        (!reportEndDate || order.deliveryDate <= reportEndDate)
      )
      .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate) || a.importedAt.localeCompare(b.importedAt));
    const productMap = new Map<string, { product: string; unit: string; quantities: Record<string, number>; total: number }>();

    reportOrders.forEach(order => {
      order.deliveries.forEach(delivery => {
        aggregateDeliveryItems(delivery.items)
          .filter(item => reportProduct === 'Todos' || stockKey(item.product, item.unit) === reportProduct)
          .forEach(item => {
            const key = stockKey(item.product, item.unit);
            const current = productMap.get(key) || { product: item.product, unit: item.unit, quantities: {}, total: 0 };
            current.quantities[order.id] = (current.quantities[order.id] || 0) + item.quantity;
            current.total += item.quantity;
            productMap.set(key, current);
          });
      });
    });

    const rows = Array.from(productMap.values()).sort((a, b) =>
      a.product.localeCompare(b.product, 'pt-BR') || a.unit.localeCompare(b.unit, 'pt-BR')
    );
    const columns = reportOrders.filter(order => rows.some(row => (row.quantities[order.id] || 0) > 0));
    const columnTotals = columns.reduce<Record<string, number>>((totals, order) => {
      totals[order.id] = rows.reduce((sum, row) => sum + (row.quantities[order.id] || 0), 0);
      return totals;
    }, {});

    return {
      columns,
      rows,
      columnTotals,
      deliveryCount: columns.reduce((sum, order) => sum + order.deliveries.length, 0),
      grandTotal: rows.reduce((sum, row) => sum + row.total, 0),
    };
  }, [operationOrders, reportCategory, reportStartDate, reportEndDate, reportProduct]);

  const generateRomaneioProductsPdf = async () => {
    if (!activeOperation || romaneioProductsReport.rows.length === 0) {
      alert('Nenhum produto foi encontrado para os filtros selecionados.');
      return;
    }
    const categoryLabel = reportCategory === 'Todas' ? 'Todas as categorias' : reportCategory;
    const productLabel = selectedReportProduct ? `${selectedReportProduct.product} - ${selectedReportProduct.unit}` : 'Todos os produtos';
    const fileName = `${sanitizeFileName(`RELATORIO SINTETICO POR ROMANEIO - ${activeOperation.name} - ${categoryLabel} - ${formatDate(reportStartDate)} a ${formatDate(reportEndDate)}`)}.pdf`;
    const writer = await preparePdfWriter(activeOperation, fileName);
    const doc = new jsPDF({ orientation: 'landscape' });
    await addPdfHeader(doc, {
      title: `PRODUTOS ENTREGUES - SINTETICO POR ROMANEIO - ${getOperationTitle(activeOperation).toUpperCase()}`,
      subtitle: `Categoria: ${categoryLabel} | Produto: ${productLabel} | Periodo: ${formatDate(reportStartDate)} a ${formatDate(reportEndDate)}`,
      footer: `${romaneioProductsReport.columns.length} romaneio(s) | ${romaneioProductsReport.deliveryCount} entrega(s) somadas`,
      logoVariant: activeOperation.logoVariant || DEFAULT_LOGO_VARIANT,
    });
    autoTable(doc, {
      startY: 36,
      head: [[
        'Produto', 'UND',
        ...romaneioProductsReport.columns.map((order, index) =>
          `${formatDate(order.deliveryDate)}\nRomaneio ${index + 1}\n${order.category}\n${order.generalNotes?.trim() || 'Sem observação'}`
        ),
        'Total',
      ]],
      body: romaneioProductsReport.rows.map(row => [
        row.product, row.unit,
        ...romaneioProductsReport.columns.map(order => row.quantities[order.id] ? formatQuantity(row.quantities[order.id]) : '-'),
        formatQuantity(row.total),
      ]),
      foot: [[
        'TOTAL', '',
        ...romaneioProductsReport.columns.map(order => formatQuantity(romaneioProductsReport.columnTotals[order.id] || 0)),
        formatQuantity(romaneioProductsReport.grandTotal),
      ]],
      theme: 'grid',
      styles: { font: REPORT_FONT, fontSize: 8, cellPadding: 1.4, valign: 'middle', overflow: 'linebreak' },
      headStyles: { font: REPORT_FONT, fontStyle: 'bold', fillColor: [79, 70, 229], halign: 'center' },
      footStyles: { font: REPORT_FONT, fontStyle: 'bold', fillColor: [226, 232, 240], textColor: [0, 0, 0] },
      columnStyles: { 0: { cellWidth: 48 }, 1: { cellWidth: 18, halign: 'center' } },
      horizontalPageBreak: true,
      horizontalPageBreakRepeat: [0, 1],
    });
    await savePdf(doc, fileName, writer);
  };

  const purchasePeriodReport = useMemo(() => {
    const filteredOrders = orders.filter(order =>
      (purchaseOperationIds.length === 0 || purchaseOperationIds.includes(order.operationId)) &&
      (reportCategory === 'Todas' || order.category === reportCategory) &&
      (!reportStartDate || order.deliveryDate >= reportStartDate) &&
      (!reportEndDate || order.deliveryDate <= reportEndDate)
    );
    const productMap = new Map<string, { product: string; unit: string; quantity: number }>();
    filteredOrders.forEach(order => {
      buildSummary(order.deliveries).forEach(item => {
        const key = stockKey(item.product, item.unit);
        const current = productMap.get(key) || { product: item.product, unit: item.unit, quantity: 0 };
        current.quantity += Number(item.quantity || 0);
        productMap.set(key, current);
      });
    });
    const rows = Array.from(productMap.values()).sort((a, b) =>
      a.product.localeCompare(b.product, 'pt-BR') || a.unit.localeCompare(b.unit, 'pt-BR')
    );
    return {
      rows,
      orderCount: filteredOrders.length,
      operationCount: new Set(filteredOrders.map(order => order.operationId)).size,
      deliveryCount: filteredOrders.reduce((sum, order) => sum + order.deliveries.length, 0),
      totalQuantity: rows.reduce((sum, row) => sum + row.quantity, 0),
    };
  }, [orders, purchaseOperationIds, reportCategory, reportStartDate, reportEndDate]);

  const togglePurchaseOperation = (operationId: string) => {
    setPurchaseOperationIds(current => {
      if (current.length === 0) {
        return operations.map(operation => operation.id).filter(id => id !== operationId);
      }
      if (current.includes(operationId)) {
        return current.length === 1 ? current : current.filter(id => id !== operationId);
      }
      const next = [...current, operationId];
      return next.length === operations.length ? [] : next;
    });
  };

  const purchaseOperationLabel = purchaseOperationIds.length === 0
    ? 'Todas as operações'
    : purchaseOperationIds.length === 1
      ? operations.find(operation => operation.id === purchaseOperationIds[0])?.name || '1 operação selecionada'
      : `${purchaseOperationIds.length} operações selecionadas`;

  const generatePurchasePeriodPdf = async () => {
    if (purchasePeriodReport.rows.length === 0) {
      alert('Nenhum item foi encontrado para os filtros selecionados.');
      return;
    }
    const categoryLabel = reportCategory === 'Todas' ? 'Todas as categorias' : reportCategory;
    const selectedOperations = purchaseOperationIds.map(id => operations.find(operation => operation.id === id)).filter(Boolean) as OperationContract[];
    const operationLabel = purchaseOperationIds.length === 0
      ? 'Todas as operacoes'
      : selectedOperations.length === 1
        ? getOperationTitle(selectedOperations[0])
        : `${selectedOperations.length} operacoes selecionadas`;
    const fileName = `${sanitizeFileName(`RELATORIO DE COMPRA - ${operationLabel} - ${categoryLabel} - ${formatDate(reportStartDate)} a ${formatDate(reportEndDate)}`)}.pdf`;
    const doc = new jsPDF();
    await addPdfHeader(doc, {
      title: 'RELATORIO GERAL DE COMPRA POR PERIODO',
      subtitle: `Operacoes: ${operationLabel} | Categoria: ${categoryLabel} | Periodo: ${formatDate(reportStartDate)} a ${formatDate(reportEndDate)}`,
      footer: `${purchasePeriodReport.operationCount} operacao(oes) | ${purchasePeriodReport.orderCount} pedido(s) | Sem desconto de estoque`,
      logoVariant: DEFAULT_LOGO_VARIANT,
    });
    autoTable(doc, {
      startY: 36,
      head: [['Produto', 'UND', 'Quantidade a comprar']],
      body: purchasePeriodReport.rows.map(row => [row.product, row.unit, formatQuantity(row.quantity)]),
      foot: [['TOTAL GERAL', '', formatQuantity(purchasePeriodReport.totalQuantity)]],
      theme: 'grid',
      styles: { font: REPORT_FONT, fontSize: REPORT_FONT_SIZE, cellPadding: 1.8, valign: 'middle' },
      headStyles: { font: REPORT_FONT, fontStyle: 'bold', fillColor: [5, 150, 105] },
      footStyles: { font: REPORT_FONT, fontStyle: 'bold', fillColor: [226, 232, 240], textColor: [0, 0, 0] },
      columnStyles: { 0: { cellWidth: 120 }, 1: { cellWidth: 25, halign: 'center' }, 2: { cellWidth: 40, halign: 'right' } },
    });
    await savePdf(doc, fileName, null);
  };

  const getPeriodReportFileName = (extension: 'pdf' | 'xlsx') => {
    const operationName = activeOperation?.name || 'Operacao';
    const categoryName = reportCategory === 'Todas' ? 'Todas categorias' : reportCategory;
    const productName = selectedReportProduct ? `${selectedReportProduct.product} ${selectedReportProduct.unit}` : 'Todos produtos';
    const pointName = selectedReportPoint?.name || 'Todos locais';
    return `${sanitizeFileName(`RELATORIO PRODUTOS - ${operationName} - ${categoryName} - ${productName} - ${pointName} - ${formatDate(reportStartDate)} a ${formatDate(reportEndDate)}`)}.${extension}`;
  };

  const productsByDateReport = useMemo(() => {
    const filteredOrders = operationOrders.filter(order =>
      (reportCategory === 'Todas' || order.category === reportCategory) &&
      (!reportStartDate || order.deliveryDate >= reportStartDate) &&
      (!reportEndDate || order.deliveryDate <= reportEndDate)
    );
    const dates = Array.from(new Set(filteredOrders.map(order => order.deliveryDate))).sort();
    const productsByKey = new Map<string, { product: string; unit: string; quantities: Record<string, number>; total: number }>();

    filteredOrders.forEach(order => {
      order.deliveries.forEach(delivery => {
        aggregateDeliveryItems(delivery.items).forEach(item => {
          const key = stockKey(item.product, item.unit);
          const current = productsByKey.get(key) || { product: item.product, unit: item.unit, quantities: {}, total: 0 };
          current.quantities[order.deliveryDate] = (current.quantities[order.deliveryDate] || 0) + item.quantity;
          current.total += item.quantity;
          productsByKey.set(key, current);
        });
      });
    });

    const rows = Array.from(productsByKey.values()).sort((a, b) =>
      a.product.localeCompare(b.product) || a.unit.localeCompare(b.unit)
    );
    const dateTotals = dates.reduce<Record<string, number>>((acc, date) => {
      acc[date] = rows.reduce((sum, row) => sum + (row.quantities[date] || 0), 0);
      return acc;
    }, {});

    return {
      dates,
      rows,
      orderCount: filteredOrders.length,
      deliveryCount: filteredOrders.reduce((sum, order) => sum + order.deliveries.length, 0),
      dateTotals,
      grandTotal: rows.reduce((sum, row) => sum + row.total, 0),
    };
  }, [operationOrders, reportCategory, reportStartDate, reportEndDate]);

  const generateProductsByDateExcel = () => {
    if (!activeOperation || productsByDateReport.rows.length === 0) {
      alert('Nenhum produto foi encontrado para os filtros selecionados.');
      return;
    }
    const categoryLabel = reportCategory === 'Todas' ? 'Todas as categorias' : reportCategory;
    const data: (string | number)[][] = [
      [`Faturamento dos produtos entregues - ${activeOperation.name}`],
      ['Operação', activeOperation.name, 'Categoria', categoryLabel],
      ['Período', `${formatDate(reportStartDate)} a ${formatDate(reportEndDate)}`],
      ['Pedidos considerados', productsByDateReport.orderCount, 'Entregas somadas', productsByDateReport.deliveryCount],
      [],
      ['Produto entregue', 'UND', 'Quantidade', 'Preço de custo', 'Total do custo', 'Margem venda', 'Preço de venda', 'Total da venda'],
      ...productsByDateReport.rows.map(row => {
        const price = productPrices[stockKey(row.product, row.unit)] || { costPrice: 0, salePrice: 0 };
        const margin = price.salePrice > 0 ? ((price.salePrice - price.costPrice) / price.salePrice) * 100 : 0;
        return [row.product, row.unit, row.total, price.costPrice, row.total * price.costPrice, margin / 100, price.salePrice, row.total * price.salePrice];
      }),
      ['TOTAL GERAL', '', productsByDateReport.grandTotal, '',
        productsByDateReport.rows.reduce((sum, row) => sum + row.total * (productPrices[stockKey(row.product, row.unit)]?.costPrice || 0), 0),
        '', '',
        productsByDateReport.rows.reduce((sum, row) => sum + row.total * (productPrices[stockKey(row.product, row.unit)]?.salePrice || 0), 0)],
    ];
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(data);
    const headerRowIndex = 5;
    const firstDataRowIndex = headerRowIndex + 1;
    const totalRowIndex = data.length - 1;
    for (let row = firstDataRowIndex; row <= totalRowIndex; row += 1) {
      [3, 4, 6, 7].forEach(column => {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (cell) cell.z = 'R$ #,##0.00';
      });
      const marginCell = sheet[XLSX.utils.encode_cell({ r: row, c: 5 })];
      if (marginCell) marginCell.z = '0.00%';
    }
    sheet['!cols'] = [
      { wch: 42 },
      { wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 18 },
    ];
    sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: headerRowIndex, c: 0 }, e: { r: totalRowIndex - 1, c: 7 } }) };
    sheet['!pageSetup'] = { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 };
    sheet['!margins'] = { left: 0.15, right: 0.15, top: 0.25, bottom: 0.25, header: 0.1, footer: 0.1 };
    XLSX.utils.book_append_sheet(workbook, sheet, 'Faturamento');
    const categoryName = reportCategory === 'Todas' ? 'Todas categorias' : reportCategory;
    const fileName = sanitizeFileName(`FATURAMENTO DE ENTREGAS - ${activeOperation.name} - ${categoryName} - ${formatDate(reportStartDate)} a ${formatDate(reportEndDate)}`);
    XLSX.writeFile(workbook, `${fileName}.xlsx`);
  };

  const generateProductsByDatePdf = async () => {
    if (!activeOperation || productsByDateReport.rows.length === 0) {
      alert('Nenhum produto foi encontrado para os filtros selecionados.');
      return;
    }

    const categoryLabel = reportCategory === 'Todas' ? 'Todas as categorias' : reportCategory;
    const baseName = sanitizeFileName(`FATURAMENTO DE ENTREGAS - ${activeOperation.name} - ${categoryLabel} - ${formatDate(reportStartDate)} a ${formatDate(reportEndDate)}`);
    const fileName = `${baseName}.pdf`;
    const writer = await preparePdfWriter(activeOperation, fileName);
    const doc = new jsPDF({ orientation: 'landscape' });
    const letterheadTitle = `RELATORIO DOS PRODUTOS ENTREGUES - ${getOperationTitle(activeOperation).toUpperCase()}`;
    const letterheadSubtitle = `Categoria: ${categoryLabel} | Periodo: ${formatDate(reportStartDate)} a ${formatDate(reportEndDate)}`;
    const columnStyles: Record<number, any> = {
      0: { cellWidth: 70 }, 1: { cellWidth: 16, halign: 'center' }, 2: { cellWidth: 22, halign: 'right' },
      3: { cellWidth: 30, halign: 'right' }, 4: { cellWidth: 30, halign: 'right' }, 5: { cellWidth: 25, halign: 'right' },
      6: { cellWidth: 30, halign: 'right' }, 7: { cellWidth: 30, halign: 'right' },
    };
    const body: (string | number)[][] = productsByDateReport.rows.map(row => [
      row.product,
      row.unit,
      formatQuantity(row.total),
      formatCurrency(productPrices[stockKey(row.product, row.unit)]?.costPrice || 0),
      formatCurrency(row.total * (productPrices[stockKey(row.product, row.unit)]?.costPrice || 0)),
      `${((productPrices[stockKey(row.product, row.unit)]?.salePrice || 0) > 0 ? (((productPrices[stockKey(row.product, row.unit)]?.salePrice || 0) - (productPrices[stockKey(row.product, row.unit)]?.costPrice || 0)) / (productPrices[stockKey(row.product, row.unit)]?.salePrice || 1)) * 100 : 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`,
      formatCurrency(productPrices[stockKey(row.product, row.unit)]?.salePrice || 0),
      formatCurrency(row.total * (productPrices[stockKey(row.product, row.unit)]?.salePrice || 0)),
    ]);
    const totalCost = productsByDateReport.rows.reduce((sum, row) => sum + row.total * (productPrices[stockKey(row.product, row.unit)]?.costPrice || 0), 0);
    const totalSale = productsByDateReport.rows.reduce((sum, row) => sum + row.total * (productPrices[stockKey(row.product, row.unit)]?.salePrice || 0), 0);
    const grandTotalRow = body.length;
    body.push([
      'TOTAL GERAL',
      '',
      formatQuantity(productsByDateReport.grandTotal),
      '', formatCurrency(totalCost), totalSale > 0 ? `${(((totalSale - totalCost) / totalSale) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` : '0%', '', formatCurrency(totalSale),
    ]);

    autoTable(doc, {
      startY: 55,
      margin: { top: 48, right: 4, bottom: 10, left: 4 },
      head: [['Produto entregue', 'UND', 'Quantidade', 'Preço custo', 'Total custo', 'Margem venda', 'Preço venda', 'Total venda']],
      body,
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 7.7, cellPadding: 1.1, overflow: 'linebreak', valign: 'middle' },
      headStyles: { font: 'helvetica', fontStyle: 'bold', fillColor: [219, 234, 254], textColor: [15, 23, 42], halign: 'center' },
      columnStyles,
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === grandTotalRow) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [226, 232, 240];
        }
      },
    });

    const pageCount = doc.getNumberOfPages();
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      doc.setPage(pageNumber);
      await addCompanyLetterhead(doc, {
        title: letterheadTitle,
        subtitle: letterheadSubtitle,
        // O faturamento é um documento comercial da Oliveira Mendes e deve
        // usar sempre a identidade da empresa, não a do cliente/operação.
        logoVariant: 'gom',
      });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text(
        `${productsByDateReport.orderCount} pedido(s) | ${productsByDateReport.deliveryCount} entrega(s) somadas | Pagina ${pageNumber} de ${pageCount}`,
        doc.internal.pageSize.getWidth() / 2,
        doc.internal.pageSize.getHeight() - 5,
        { align: 'center' },
      );
    }

    await savePdf(doc, fileName, writer);
  };

  const generatePeriodReportPdf = async () => {
    if (!activeOperation || periodReport.rows.length === 0) {
      alert('Nenhum produto entregue foi encontrado para os filtros selecionados.');
      return;
    }
    const fileName = getPeriodReportFileName('pdf');
    const writer = await preparePdfWriter(activeOperation, fileName);
    const doc = new jsPDF({ orientation: 'landscape' });
    const categoryLabel = reportCategory === 'Todas' ? 'Todas as categorias' : reportCategory;
    const productLabel = selectedReportProduct ? `${selectedReportProduct.product} (${selectedReportProduct.unit})` : 'Todos os produtos';
    const pointLabel = selectedReportPoint?.name || 'Todos os locais';
    await addPdfHeader(doc, {
      title: `RELATORIO DE PRODUTOS ENTREGUES - ${getOperationTitle(activeOperation).toUpperCase()}`,
      subtitle: `Categoria: ${categoryLabel} | Produto: ${productLabel} | Local: ${pointLabel} | Periodo: ${formatDate(reportStartDate)} a ${formatDate(reportEndDate)}`,
      footer: `${periodReport.orderCount} pedido(s) | ${periodReport.dates.length} data(s) | ${periodReport.locations.length} local(is)`,
      logoVariant: activeOperation.logoVariant || DEFAULT_LOGO_VARIANT,
    });
    const deliveryColumnWidth = Math.min(28, 190 / Math.min(Math.max(periodReport.columns.length, 1), 10));
    const totalColumnIndex = periodReport.columns.length + 2;
    const columnStyles = periodReport.columns.reduce<Record<number, any>>((acc, _, index) => {
      acc[index + 2] = { cellWidth: deliveryColumnWidth, halign: 'center' };
      return acc;
    }, {
      0: { cellWidth: 55 },
      1: { cellWidth: 16, halign: 'center' },
      [totalColumnIndex]: { cellWidth: 18, halign: 'center' },
    });
    const body: (string | number)[][] = periodReport.rows.map(row => [
        row.product,
        row.unit,
        ...periodReport.columns.map(column => row.quantities[column.key] ? formatQuantity(row.quantities[column.key]) : '-'),
        formatQuantity(row.total),
      ]);
    const grandTotalRow = body.length;
    body.push([
      'TOTAL GERAL',
      '',
      ...periodReport.columns.map(column => formatQuantity(periodReport.columnTotals[column.key] || 0)),
      formatQuantity(periodReport.grandTotal),
    ]);
    autoTable(doc, {
      startY: 36,
      head: [['Produto', 'UND', ...periodReport.columns.map(column => `${formatDate(column.date)}\n${column.pointLabel}`), 'Total']],
      body,
      theme: 'grid',
      styles: { font: REPORT_FONT, fontSize: REPORT_FONT_SIZE, cellPadding: 1, overflow: 'linebreak', valign: 'middle' },
      headStyles: { font: REPORT_FONT, fontStyle: 'bold', fillColor: [219, 234, 254], textColor: [0, 0, 0], halign: 'center' },
      columnStyles,
      horizontalPageBreak: periodReport.columns.length > 10,
      horizontalPageBreakRepeat: [0, 1],
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.row.index === grandTotalRow) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [226, 232, 240];
        }
      },
    });
    await savePdf(doc, fileName, writer);
  };

  const generatePeriodReportExcel = () => {
    if (!activeOperation || periodReport.rows.length === 0) {
      alert('Nenhum produto entregue foi encontrado para os filtros selecionados.');
      return;
    }
    const categoryLabel = reportCategory === 'Todas' ? 'Todas as categorias' : reportCategory;
    const productLabel = selectedReportProduct ? `${selectedReportProduct.product} (${selectedReportProduct.unit})` : 'Todos os produtos';
    const pointLabel = selectedReportPoint?.name || 'Todos os locais';
    const data: (string | number)[][] = [
      [`Relatório de produtos entregues - ${activeOperation.name}`],
      ['Operação', activeOperation.name, 'Categoria', categoryLabel],
      ['Produto', productLabel, 'Local de entrega', pointLabel],
      ['Período', `${formatDate(reportStartDate)} a ${formatDate(reportEndDate)}`],
      ['Pedidos considerados', periodReport.orderCount, 'Datas de entrega', periodReport.dates.length, 'Locais', periodReport.locations.length],
      [],
      ['Produto', 'UND', ...periodReport.columns.map(column => `${formatDate(column.date)} - ${column.pointLabel}`), 'Qtd. total', 'Preço de custo', 'Custo total'],
      ...periodReport.rows.map(row => [row.product, row.unit, ...periodReport.columns.map(column => row.quantities[column.key] || 0), row.total, '', '']),
      ['TOTAL GERAL', '', ...periodReport.columns.map(column => periodReport.columnTotals[column.key] || 0), periodReport.grandTotal, '', ''],
    ];
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(data);
    const headerRowIndex = 6;
    const firstDataRowIndex = headerRowIndex + 1;
    const totalRowIndex = data.length - 1;
    const quantityTotalColumnIndex = periodReport.columns.length + 2;
    const costPriceColumnIndex = quantityTotalColumnIndex + 1;
    const totalCostColumnIndex = quantityTotalColumnIndex + 2;
    periodReport.rows.forEach((_, rowIndex) => {
      const dataRowIndex = firstDataRowIndex + rowIndex;
      const quantityCell = XLSX.utils.encode_cell({ r: dataRowIndex, c: quantityTotalColumnIndex });
      const costPriceCell = XLSX.utils.encode_cell({ r: dataRowIndex, c: costPriceColumnIndex });
      const totalCostCell = XLSX.utils.encode_cell({ r: dataRowIndex, c: totalCostColumnIndex });
      sheet[totalCostCell] = { t: 'n', f: `IF(${costPriceCell}="","",${quantityCell}*${costPriceCell})`, z: 'R$ #,##0.00' };
      sheet[costPriceCell] = { t: 'z', z: 'R$ #,##0.00' };
    });
    const totalCostCell = XLSX.utils.encode_cell({ r: totalRowIndex, c: totalCostColumnIndex });
    const firstTotalCostCell = XLSX.utils.encode_cell({ r: firstDataRowIndex, c: totalCostColumnIndex });
    const lastTotalCostCell = XLSX.utils.encode_cell({ r: totalRowIndex - 1, c: totalCostColumnIndex });
    sheet[totalCostCell] = { t: 'n', f: `SUM(${firstTotalCostCell}:${lastTotalCostCell})`, z: 'R$ #,##0.00' };
    sheet['!cols'] = [
      { wch: 42 },
      { wch: 12 },
      ...periodReport.columns.map(() => ({ wch: 28 })),
      { wch: 16 },
      { wch: 18 },
      { wch: 18 },
    ];
    sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: headerRowIndex, c: 0 }, e: { r: totalRowIndex - 1, c: data[headerRowIndex].length - 1 } }) };
    XLSX.utils.book_append_sheet(workbook, sheet, 'Produtos por data');
    XLSX.writeFile(workbook, getPeriodReportFileName('xlsx'));
  };

  const ordersSummaryReport = useMemo(() => {
    const rows = operationOrders
      .filter(order =>
        (reportCategory === 'Todas' || order.category === reportCategory) &&
        (!reportStartDate || order.deliveryDate >= reportStartDate) &&
        (!reportEndDate || order.deliveryDate <= reportEndDate)
      )
      .map(order => {
        const summary = buildSummary(order.deliveries);
        return {
          order,
          locationCount: order.deliveries.length,
          itemCount: summary.length,
          totalQuantity: summary.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        };
      })
      .sort((a, b) => b.order.deliveryDate.localeCompare(a.order.deliveryDate) || b.order.importedAt.localeCompare(a.order.importedAt));

    return {
      rows,
      locationCount: rows.reduce((sum, row) => sum + row.locationCount, 0),
      itemCount: rows.reduce((sum, row) => sum + row.itemCount, 0),
      totalQuantity: rows.reduce((sum, row) => sum + row.totalQuantity, 0),
    };
  }, [operationOrders, reportCategory, reportStartDate, reportEndDate]);

  const getOrdersSummaryFileName = (extension: 'pdf' | 'xlsx') => {
    const operationName = activeOperation?.name || 'Operacao';
    const categoryName = reportCategory === 'Todas' ? 'Todas categorias' : reportCategory;
    return `${sanitizeFileName(`RELATORIO SINTETICO PEDIDOS - ${operationName} - ${categoryName} - ${formatDate(reportStartDate)} a ${formatDate(reportEndDate)}`)}.${extension}`;
  };

  const generateOrdersSummaryPdf = async () => {
    if (!activeOperation || ordersSummaryReport.rows.length === 0) {
      alert('Nenhum pedido foi encontrado para os filtros selecionados.');
      return;
    }
    const fileName = getOrdersSummaryFileName('pdf');
    const writer = await preparePdfWriter(activeOperation, fileName);
    const categoryLabel = reportCategory === 'Todas' ? 'Todas as categorias' : reportCategory;
    const doc = new jsPDF({ orientation: 'landscape' });
    await addPdfHeader(doc, {
      title: `RELATORIO SINTETICO DE PEDIDOS - ${getOperationTitle(activeOperation).toUpperCase()}`,
      subtitle: `Categoria: ${categoryLabel} | Periodo de entrega: ${formatDate(reportStartDate)} a ${formatDate(reportEndDate)}`,
      footer: `${ordersSummaryReport.rows.length} pedido(s) | ${ordersSummaryReport.locationCount} local(is)`,
      logoVariant: activeOperation.logoVariant || DEFAULT_LOGO_VARIANT,
    });
    autoTable(doc, {
      startY: 36,
      head: [['Entrega', 'Inserido em', 'Categoria', 'Origem', 'Locais', 'Itens', 'Qtd. total']],
      body: ordersSummaryReport.rows.map(({ order, locationCount, itemCount, totalQuantity }) => [
        formatDate(order.deliveryDate),
        formatDateTime(order.importedAt),
        order.category,
        order.sourceType,
        locationCount,
        itemCount,
        formatQuantity(totalQuantity),
      ]),
      foot: [['TOTAL', '', '', '', ordersSummaryReport.locationCount, ordersSummaryReport.itemCount, formatQuantity(ordersSummaryReport.totalQuantity)]],
      theme: 'grid',
      styles: { font: REPORT_FONT, fontSize: REPORT_FONT_SIZE, cellPadding: 1.7, valign: 'middle' },
      headStyles: { font: REPORT_FONT, fontStyle: 'bold', fillColor: [79, 70, 229] },
      footStyles: { font: REPORT_FONT, fontStyle: 'bold', fillColor: [226, 232, 240], textColor: [0, 0, 0] },
    });
    await savePdf(doc, fileName, writer);
  };

  const generateOrdersSummaryExcel = () => {
    if (!activeOperation || ordersSummaryReport.rows.length === 0) {
      alert('Nenhum pedido foi encontrado para os filtros selecionados.');
      return;
    }
    const categoryLabel = reportCategory === 'Todas' ? 'Todas as categorias' : reportCategory;
    const data: (string | number)[][] = [
      [`Relatório sintético de pedidos - ${activeOperation.name}`],
      ['Categoria', categoryLabel, 'Período de entrega', `${formatDate(reportStartDate)} a ${formatDate(reportEndDate)}`],
      [],
      ['Entrega', 'Inserido em', 'Categoria', 'Origem', 'Locais', 'Itens', 'Quantidade total'],
      ...ordersSummaryReport.rows.map(({ order, locationCount, itemCount, totalQuantity }) => [
        formatDate(order.deliveryDate), formatDateTime(order.importedAt), order.category, order.sourceType, locationCount, itemCount, totalQuantity,
      ]),
      ['TOTAL', '', '', '', ordersSummaryReport.locationCount, ordersSummaryReport.itemCount, ordersSummaryReport.totalQuantity],
    ];
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(data);
    sheet['!cols'] = [{ wch: 14 }, { wch: 22 }, { wch: 26 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 18 }];
    sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: data.length - 2, c: 6 } }) };
    XLSX.utils.book_append_sheet(workbook, sheet, 'Pedidos');
    XLSX.writeFile(workbook, getOrdersSummaryFileName('xlsx'));
  };

  const deliveriesSummaryReport = useMemo(() => {
    const groups = new Map<string, {
      operation: OperationContract;
      category: DeliveryCategory;
      deliveryDate: string;
      notes: Set<string>;
      orderIds: Set<string>;
      deliveryCount: number;
      pointIds: Set<string>;
      itemCount: number;
      totalQuantity: number;
    }>();

    orders
      .filter(order =>
        (summaryOperationIds.length === 0 || summaryOperationIds.includes(order.operationId)) &&
        (reportCategory === 'Todas' || order.category === reportCategory) &&
        (!reportStartDate || order.deliveryDate >= reportStartDate) &&
        (!reportEndDate || order.deliveryDate <= reportEndDate)
      )
      .forEach(order => {
        const operation = operations.find(item => item.id === order.operationId);
        if (!operation) return;
        const key = `${order.operationId}::${order.deliveryDate}::${order.category}`;
        const group = groups.get(key) || {
          operation,
          category: order.category,
          deliveryDate: order.deliveryDate,
          notes: new Set<string>(),
          orderIds: new Set<string>(),
          deliveryCount: 0,
          pointIds: new Set<string>(),
          itemCount: 0,
          totalQuantity: 0,
        };
        group.orderIds.add(order.id);
        if (order.generalNotes?.trim()) group.notes.add(order.generalNotes.trim());
        order.deliveries.forEach(delivery => {
          group.deliveryCount += 1;
          group.pointIds.add(delivery.deliveryPointId);
          group.itemCount += delivery.items.length;
          group.totalQuantity += delivery.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        });
        groups.set(key, group);
      });

    const rows = Array.from(groups.values()).sort((a, b) =>
      b.deliveryDate.localeCompare(a.deliveryDate) ||
      a.operation.name.localeCompare(b.operation.name, 'pt-BR') ||
      a.category.localeCompare(b.category, 'pt-BR')
    );
    return {
      rows,
      orderCount: rows.reduce((sum, row) => sum + row.orderIds.size, 0),
      deliveryCount: rows.reduce((sum, row) => sum + row.deliveryCount, 0),
      locationCount: rows.reduce((sum, row) => sum + row.pointIds.size, 0),
      itemCount: rows.reduce((sum, row) => sum + row.itemCount, 0),
      totalQuantity: rows.reduce((sum, row) => sum + row.totalQuantity, 0),
    };
  }, [orders, operations, summaryOperationIds, reportCategory, reportStartDate, reportEndDate]);

  const toggleSummaryOperation = (operationId: string) => {
    setSummaryOperationIds(current => {
      if (current.length === 0) {
        return operations.map(operation => operation.id).filter(id => id !== operationId);
      }
      if (current.includes(operationId)) {
        return current.length === 1 ? current : current.filter(id => id !== operationId);
      }
      const next = [...current, operationId];
      return next.length === operations.length ? [] : next;
    });
  };

  const summaryOperationLabel = summaryOperationIds.length === 0
    ? 'Todas as operações'
    : summaryOperationIds.length === 1
      ? operations.find(operation => operation.id === summaryOperationIds[0])?.name || '1 operação selecionada'
      : `${summaryOperationIds.length} operações selecionadas`;

  const getDeliveriesSummaryFileName = () => {
    const operationName = summaryOperationIds.length === 0
      ? 'Todas operacoes'
      : summaryOperationIds.length === 1
        ? operations.find(operation => operation.id === summaryOperationIds[0])?.name || 'Operacao'
        : 'Operacoes selecionadas';
    const categoryName = reportCategory === 'Todas' ? 'Todas categorias' : reportCategory;
    return `${sanitizeFileName(`RELATORIO SINTETICO DE ENTREGAS - ${operationName} - ${categoryName} - ${formatDate(reportStartDate)} a ${formatDate(reportEndDate)}`)}.pdf`;
  };

  const generateDeliveriesSummaryPdf = async () => {
    if (deliveriesSummaryReport.rows.length === 0) {
      alert('Nenhuma entrega foi encontrada para os filtros selecionados.');
      return;
    }
    const fileName = getDeliveriesSummaryFileName();
    const selectedOperation = summaryOperationIds.length === 1
      ? operations.find(operation => operation.id === summaryOperationIds[0])
      : undefined;
    const writer = selectedOperation ? await preparePdfWriter(selectedOperation, fileName) : null;
    const operationLabel = summaryOperationIds.length === 0
      ? 'Todas as operações'
      : summaryOperationIds.map(id => operations.find(operation => operation.id === id)?.name).filter(Boolean).join(', ');
    const categoryLabel = reportCategory === 'Todas' ? 'Todas as categorias' : reportCategory;
    const doc = new jsPDF({ orientation: 'landscape' });
    await addPdfHeader(doc, {
      title: 'RELATORIO SINTETICO DE ENTREGAS',
      subtitle: `Operacao: ${operationLabel} | Categoria: ${categoryLabel} | Periodo: ${formatDate(reportStartDate)} a ${formatDate(reportEndDate)}`,
      footer: `${deliveriesSummaryReport.deliveryCount} entrega(s) | ${deliveriesSummaryReport.orderCount} pedido(s)`,
      logoVariant: selectedOperation?.logoVariant || DEFAULT_LOGO_VARIANT,
    });
    autoTable(doc, {
      startY: 36,
      head: [['Operação', 'Data entrega', 'Categoria', 'Observação', 'Pedidos', 'Entregas', 'Locais', 'Itens', 'Qtd. total']],
      body: deliveriesSummaryReport.rows.map(row => [
        getOperationTitle(row.operation), formatDate(row.deliveryDate), row.category,
        Array.from(row.notes).join(' | ') || '-', row.orderIds.size, row.deliveryCount,
        row.pointIds.size, row.itemCount, formatQuantity(row.totalQuantity),
      ]),
      foot: [['TOTAL', '', '', '', deliveriesSummaryReport.orderCount, deliveriesSummaryReport.deliveryCount,
        deliveriesSummaryReport.locationCount, deliveriesSummaryReport.itemCount, formatQuantity(deliveriesSummaryReport.totalQuantity)]],
      theme: 'grid',
      styles: { font: REPORT_FONT, fontSize: 9, cellPadding: 1.5, valign: 'middle', overflow: 'linebreak' },
      headStyles: { font: REPORT_FONT, fontStyle: 'bold', fillColor: [79, 70, 229] },
      footStyles: { font: REPORT_FONT, fontStyle: 'bold', fillColor: [226, 232, 240], textColor: [0, 0, 0] },
      columnStyles: {
        0: { cellWidth: 40 },
        1: { cellWidth: 22 },
        2: { cellWidth: 32 },
        3: { cellWidth: 'auto' },
        4: { cellWidth: 15, halign: 'center' },
        5: { cellWidth: 17, halign: 'center' },
        6: { cellWidth: 14, halign: 'center' },
        7: { cellWidth: 13, halign: 'center' },
        8: { cellWidth: 22, halign: 'right' },
      },
    });
    await savePdf(doc, fileName, writer);
  };

  const totals = useMemo(() => {
    const deliveries = operationOrders.reduce((sum, order) => sum + order.deliveries.length, 0);
    const items = operationOrders.reduce((sum, order) => sum + buildSummary(order.deliveries).length, 0);
    return { deliveries, items };
  }, [operationOrders]);

  const deliveryHistory = useMemo(() => operationOrders.flatMap(order =>
    order.deliveries.map(delivery => {
      const point = pointById(delivery.deliveryPointId);
      const sector = sectorById(point?.sectorId);
      return {
        order,
        delivery,
        point,
        sector,
        totalItems: aggregateDeliveryItems(delivery.items).length,
        totalQuantity: aggregateDeliveryItems(delivery.items).reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      };
    })
  ), [operationOrders, deliveryPoints, sectors]);

  if (!sharedStateReady) {
    return <div className="card" style={{ padding: '1.5rem' }}>Carregando operações compartilhadas...</div>;
  }

  return (
    <div>
      {sharedStateError && (
        <div className="card" role="alert" style={{ marginBottom: '1rem', padding: '1rem', borderColor: '#f59e0b' }}>
          {sharedStateError}
        </div>
      )}
      <div className="view-header" style={{ flexWrap: 'wrap', gap: '1rem' }}>
        <div className="view-title">
          <h1>Operações e Entregas</h1>
          <p>Cadastre operações, setores, locais de entrega, pedidos dos clientes, romaneios e compras necessárias.</p>
        </div>
        <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <input
            key={importInputKey}
            type="file"
            aria-label="Selecionar arquivo do pedido"
            accept=".xlsx,.xls,.pdf"
            className="input-field"
            disabled={importing || !activeOperation}
            onChange={handleImportFileSelection}
            style={{ maxWidth: '330px', width: 'min(330px, 100%)' }}
          />
          <button
            type="button"
            className="button"
            disabled={importing || !activeOperation || !selectedImportFile}
            onClick={handleImport}
            style={{ opacity: importing || !activeOperation || !selectedImportFile ? 0.6 : 1, width: 'auto' }}
          >
            <Upload size={18} style={{ marginRight: '0.5rem' }} />
            {importing ? 'Importando...' : 'Importar Pedido'}
          </button>
        </div>
      </div>

      {importFeedback && (
        <div
          className="card"
          role={importFeedback.type === 'error' ? 'alert' : 'status'}
          style={{
            marginBottom: '1rem',
            padding: '0.85rem 1rem',
            borderColor: importFeedback.type === 'error' ? '#ef4444' : importFeedback.type === 'success' ? '#10b981' : '#6366f1',
            color: importFeedback.type === 'error' ? '#fca5a5' : importFeedback.type === 'success' ? '#6ee7b7' : 'var(--text-muted)',
          }}
        >
          {importFeedback.message}
        </div>
      )}

      <div className="operations-global-reports">
        <div>
          <strong>Relatórios gerais</strong>
          <small>Consultam todas as operações, independentemente da operação selecionada abaixo.</small>
        </div>
        <button type="button" className="operations-module-button" onClick={() => setActiveModule('purchase-period-report')}>
          <ShoppingCart size={22} /><span><strong>Compra por período</strong><small>Todas as operações, sem considerar estoque</small></span>
        </button>
      </div>

      <div className="operations-module-toolbar">
        <div className="operations-active-selector">
          <label htmlFor="active-operation">Operação selecionada</label>
          <select id="active-operation" className="input-field" value={activeOperationId} onChange={event => handleActiveOperationChange(event.target.value)}>
            {operations.map(operation => <option key={operation.id} value={operation.id}>{operation.name}</option>)}
          </select>
        </div>
        <div className="operations-module-grid">
          <button type="button" className="operations-module-button" onClick={() => setActiveModule('operations')}><Building2 size={22} /><span><strong>Operações</strong><small>Cadastrar e editar operações</small></span></button>
          <button type="button" className="operations-module-button" onClick={() => setActiveModule('locations')}><Layers size={22} /><span><strong>Setores e locais</strong><small>Organizar escolas e entregas</small></span></button>
          <button type="button" className="operations-module-button" onClick={() => setActiveModule('order-entry')}><PackagePlus size={22} /><span><strong>Entrada de pedidos</strong><small>Lançar itens por local</small></span></button>
          <button type="button" className="operations-module-button" onClick={() => setActiveModule('orders')}><FileText size={22} /><span><strong>Pedidos e arquivos</strong><small>Gerar PDF ou Excel</small></span></button>
          <button type="button" className="operations-module-button" onClick={() => setActiveModule('history')}><History size={22} /><span><strong>Histórico</strong><small>Consultar entregas anteriores</small></span></button>
          <button type="button" className="operations-module-button" onClick={() => setActiveModule('orders-summary-report')}><FileSpreadsheet size={22} /><span><strong>Relatório de pedidos</strong><small>Resumo sintético dos pedidos</small></span></button>
          <button type="button" className="operations-module-button" onClick={() => setActiveModule('deliveries-summary-report')}><FileText size={22} /><span><strong>Relatório de entregas</strong><small>Sintético por operação e categoria</small></span></button>
          <button type="button" className="operations-module-button" onClick={() => setActiveModule('period-report')}><Search size={22} /><span><strong>Produtos por categoria e período</strong><small>Filtrar categoria e datas</small></span></button>
          <button type="button" className="operations-module-button" onClick={() => setActiveModule('romaneio-products-report')}><FileText size={22} /><span><strong>Produtos por romaneio</strong><small>Sintético, sem misturar pedidos</small></span></button>
          <button type="button" className="operations-module-button" onClick={() => setActiveModule('products-by-date-report')}><FileSpreadsheet size={22} /><span><strong>Faturamento de entregas</strong><small>Custos, vendas e margem</small></span></button>
        </div>
      </div>

      {activeModule && (
        <>
          <button type="button" className="operations-modal-backdrop" aria-label="Fechar janela" onClick={() => setActiveModule(null)} />
          <button type="button" className="operations-modal-close" title="Fechar janela" onClick={() => setActiveModule(null)}><X size={20} /> Fechar</button>
        </>
      )}

      <div className="operations-layout operations-menu-layout" data-active-module={activeModule || undefined}>
        <div className="card operations-module-window module-operations" style={{ maxWidth: 'none', padding: '1.25rem' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <Building2 size={20} /> Operações
          </h3>
          <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '1.25rem' }}>
            {operations.map(operation => (
              <div key={operation.id} style={{ display: 'flex', gap: '0.4rem' }}>
                <button className={`nav-item ${activeOperationId === operation.id ? 'active' : ''}`} onClick={() => setActiveOperationId(operation.id)} style={{ width: '100%' }}>
                  <Building2 size={18} />
                  <span>{operation.name}</span>
                </button>
                <button className="button button-outline" type="button" title="Editar operação" onClick={() => startEditOperation(operation)} style={{ width: '40px', height: '42px', padding: 0 }}>
                  <Edit3 size={15} />
                </button>
                <button
                  className="button button-outline"
                  type="button"
                  title={pdfFolders[operation.id] ? `Pasta de PDFs: ${pdfFolders[operation.id].name}` : 'Definir pasta padrão para os PDFs'}
                  aria-label={pdfFolders[operation.id] ? `Alterar pasta de PDFs de ${operation.name}` : `Definir pasta de PDFs de ${operation.name}`}
                  onClick={() => void configurePdfFolder(operation)}
                  style={{ width: '40px', height: '42px', padding: 0, color: pdfFolders[operation.id] ? '#22c55e' : undefined }}
                >
                  {pdfFolders[operation.id] ? <FolderCheck size={16} /> : <FolderPlus size={16} />}
                </button>
                <button className="button button-outline" type="button" title="Excluir operação" aria-label={`Excluir ${operation.name}`} onClick={() => deleteOperation(operation)} style={{ width: '40px', height: '42px', padding: 0, color: '#ef4444' }}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <p style={{ margin: '-0.65rem 0 1.25rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {supportsOperationPdfFolders()
              ? 'Use o botão de pasta em cada operação para escolher onde os PDFs serão salvos neste dispositivo.'
              : 'A escolha de pasta requer Chrome ou Edge atualizado; neste navegador os PDFs usam o download padrão.'}
          </p>

          {editingOperationId && (
            <form onSubmit={saveOperationEdit} style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', display: 'grid', gap: '0.75rem', marginBottom: '1rem' }}>
              <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Edit3 size={18} /> Editar operação</h4>
              <input className="input-field" placeholder="Nome da operação" value={operationEditForm.name} onChange={event => setOperationEditForm({ ...operationEditForm, name: event.target.value })} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: '0.5rem' }}>
                <input className="input-field" placeholder="Município" value={operationEditForm.city} onChange={event => setOperationEditForm({ ...operationEditForm, city: event.target.value })} />
                <input className="input-field" placeholder="UF" maxLength={2} value={operationEditForm.uf} onChange={event => setOperationEditForm({ ...operationEditForm, uf: event.target.value })} />
              </div>
              <input className="input-field" placeholder="Número da ata de licitação" value={operationEditForm.bidNumber} onChange={event => setOperationEditForm({ ...operationEditForm, bidNumber: event.target.value })} />
              <input className="input-field" placeholder="Autorização de fornecimento" value={operationEditForm.supplyAuthorization} onChange={event => setOperationEditForm({ ...operationEditForm, supplyAuthorization: event.target.value })} />
              <div>
                <label>Logo dos relatórios</label>
                <select className="input-field" value={operationEditForm.logoVariant} onChange={event => setOperationEditForm({ ...operationEditForm, logoVariant: event.target.value as PdfLogoVariant })}>
                  {LOGO_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="button" type="submit"><Save size={16} style={{ marginRight: '0.5rem' }} /> Salvar</button>
                <button className="button button-outline" type="button" onClick={() => setEditingOperationId(null)}><X size={16} style={{ marginRight: '0.5rem' }} /> Cancelar</button>
              </div>
            </form>
          )}

          <form onSubmit={addOperation} style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', display: 'grid', gap: '0.75rem' }}>
            <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><FolderPlus size={18} /> Nova operação</h4>
            <input className="input-field" placeholder="Nome da operação" value={newOperation.name} onChange={event => setNewOperation({ ...newOperation, name: event.target.value })} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: '0.5rem' }}>
              <input className="input-field" placeholder="Município" value={newOperation.city} onChange={event => setNewOperation({ ...newOperation, city: event.target.value })} />
              <input className="input-field" placeholder="UF" maxLength={2} value={newOperation.uf} onChange={event => setNewOperation({ ...newOperation, uf: event.target.value })} />
            </div>
            <input className="input-field" placeholder="Número da ata de licitação" value={newOperation.bidNumber} onChange={event => setNewOperation({ ...newOperation, bidNumber: event.target.value })} />
            <input className="input-field" placeholder="Autorização de fornecimento" value={newOperation.supplyAuthorization} onChange={event => setNewOperation({ ...newOperation, supplyAuthorization: event.target.value })} />
            <div>
              <label>Logo dos relatórios</label>
              <select className="input-field" value={newOperation.logoVariant} onChange={event => setNewOperation({ ...newOperation, logoVariant: event.target.value as PdfLogoVariant })}>
                {LOGO_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <button className="button" type="submit"><Plus size={16} style={{ marginRight: '0.5rem' }} /> Criar</button>
          </form>
        </div>

        <div style={{ display: 'grid', gap: '1.5rem' }}>
          {activeOperation && (
            <div className="reports-grid">
              <div className="card report-card">
                <div className="report-icon bg-indigo"><Building2 size={24} /></div>
                <div className="report-info">
                  <h3>{activeOperation.name}</h3>
                  <p className="report-description">{activeOperation.city}/{activeOperation.uf || '--'} {activeOperation.bidNumber ? `| Ata ${activeOperation.bidNumber}` : ''}</p>
                  <span className="badge badge-blue">{operationSectors.length} setor(es)</span>
                </div>
              </div>
              <div className="card report-card">
                <div className="report-icon bg-green"><Calendar size={24} /></div>
                <div className="report-info">
                  <h3>{operationOrders.length} pedido(s)</h3>
                  <p className="report-description">{totals.deliveries} entrega(s) registradas e {totals.items} item(ns) consolidados.</p>
                  <span className="badge badge-green">{operationPoints.length} locais</span>
                </div>
              </div>
            </div>
          )}

          <div className="card operations-module-window module-locations" style={{ maxWidth: 'none', padding: '1.5rem' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}><Layers size={20} /> Setores e locais de entrega</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 0.7fr) 1fr', gap: '1rem' }}>
              <form onSubmit={addSector} style={{ display: 'grid', gap: '0.75rem', alignSelf: 'start' }}>
                <label>Cadastrar setor</label>
                <input className="input-field" placeholder="Setor 01" value={newSector} onChange={event => setNewSector(event.target.value)} />
                <button className="button" type="submit"><Plus size={16} style={{ marginRight: '0.5rem' }} /> Adicionar setor</button>
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {operationSectors.map(sector => (
                    <div key={sector.id} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      {editingSectorId === sector.id ? (
                        <>
                          <input className="input-field" style={{ marginTop: 0 }} value={sectorEditName} onChange={event => setSectorEditName(event.target.value)} />
                          <button className="button" type="button" title="Salvar setor" onClick={saveSectorEdit} style={{ width: '38px', height: '38px', padding: 0 }}><Save size={14} /></button>
                          <button className="button button-outline" type="button" title="Cancelar" onClick={() => setEditingSectorId(null)} style={{ width: '38px', height: '38px', padding: 0 }}><X size={14} /></button>
                        </>
                      ) : (
                        <>
                          <span className="badge badge-blue" style={{ flex: 1, borderRadius: '0.5rem', padding: '0.65rem' }}>{sector.name}</span>
                          <button className="button button-outline" type="button" title="Editar setor" onClick={() => startEditSector(sector)} style={{ width: '38px', height: '38px', padding: 0 }}><Edit3 size={14} /></button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </form>
              <form onSubmit={addDeliveryPoint} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label>Setor</label>
                  <select className="input-field" value={newPoint.sectorId} onChange={event => setNewPoint({ ...newPoint, sectorId: event.target.value })}>
                    {operationSectors.map(sector => <option key={sector.id} value={sector.id}>{sector.name}</option>)}
                  </select>
                </div>
                <div>
                  <label>Código</label>
                  <input className="input-field" placeholder="Código interno" value={newPoint.code} onChange={event => setNewPoint({ ...newPoint, code: event.target.value })} />
                </div>
                <div>
                  <label>Escola/local</label>
                  <input className="input-field" placeholder="Nome do local de entrega" value={newPoint.name} onChange={event => setNewPoint({ ...newPoint, name: event.target.value })} />
                </div>
                <div>
                  <label>Bairro</label>
                  <input className="input-field" placeholder="Bairro" value={newPoint.neighborhood} onChange={event => setNewPoint({ ...newPoint, neighborhood: event.target.value })} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label>Endereço</label>
                  <input className="input-field" placeholder="Endereço" value={newPoint.address} onChange={event => setNewPoint({ ...newPoint, address: event.target.value })} />
                </div>
                <button className="button" type="submit" style={{ gridColumn: '1 / -1' }}><MapPin size={16} style={{ marginRight: '0.5rem' }} /> Adicionar local</button>
              </form>
            </div>
            <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
              <table className="data-table">
                <thead><tr><th>Setor</th><th>Código</th><th>Local</th><th>Endereço</th><th>Ações</th></tr></thead>
                <tbody>
                  {operationPoints.map(point => (
                    <tr key={point.id}>
                      {editingPointId === point.id ? (
                        <>
                          <td>
                            <select className="input-field" value={pointEditForm.sectorId} onChange={event => setPointEditForm({ ...pointEditForm, sectorId: event.target.value })}>
                              {operationSectors.map(sector => <option key={sector.id} value={sector.id}>{sector.name}</option>)}
                            </select>
                          </td>
                          <td><input className="input-field" value={pointEditForm.code} onChange={event => setPointEditForm({ ...pointEditForm, code: event.target.value })} /></td>
                          <td><input className="input-field" value={pointEditForm.name} onChange={event => setPointEditForm({ ...pointEditForm, name: event.target.value })} /></td>
                          <td>
                            <input className="input-field" placeholder="Endereço" value={pointEditForm.address} onChange={event => setPointEditForm({ ...pointEditForm, address: event.target.value })} />
                            <input className="input-field" placeholder="Bairro" value={pointEditForm.neighborhood} onChange={event => setPointEditForm({ ...pointEditForm, neighborhood: event.target.value })} />
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                              <button className="button" type="button" title="Salvar local" onClick={savePointEdit} style={{ width: '38px', height: '34px', padding: 0 }}><Save size={14} /></button>
                              <button className="button button-outline" type="button" title="Cancelar" onClick={() => setEditingPointId(null)} style={{ width: '38px', height: '34px', padding: 0 }}><X size={14} /></button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td>{sectorById(point.sectorId)?.name}</td>
                          <td>{point.code}</td>
                          <td style={{ fontWeight: 600 }}>{point.name}</td>
                          <td>{point.address || '-'}</td>
                          <td><button className="button button-outline" type="button" title="Editar local" onClick={() => startEditPoint(point)} style={{ width: '38px', height: '34px', padding: 0 }}><Edit3 size={14} /></button></td>
                        </>
                      )}
                    </tr>
                  ))}
                  {operationPoints.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: '1.5rem' }}>Nenhum local cadastrado.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div id="operation-order-form" className="card operations-module-window module-order-entry" style={{ maxWidth: 'none', padding: '1.5rem' }}>
            <div className="view-header" style={{ marginBottom: '1rem', gap: '1rem' }}>
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {editingOrderId ? <Edit3 size={20} /> : <PackagePlus size={20} />}
                  {editingOrderId ? 'Editar pedido de entrega' : 'Entrada de pedidos do cliente'}
                </h2>
                <p style={{ textAlign: 'left', marginBottom: 0 }}>
                  {editingOrderId ? 'Altere os itens, quantidades e locais desta entrega e salve novamente.' : 'Lance os itens por local de entrega para gerar os romaneios.'}
                </p>
              </div>
              {editingOrderId && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '220px' }}>
                  <button className="button button-outline" type="button" onClick={cancelOrderEdit} style={{ width: '100%' }}>
                    <X size={16} style={{ marginRight: '0.5rem' }} /> Cancelar edição
                  </button>
                  <button className="button" type="button" disabled={draftDeliveries.length === 0} onClick={saveManualOrder} style={{ width: '100%', opacity: draftDeliveries.length === 0 ? 0.5 : 1 }}>
                    <Save size={16} style={{ marginRight: '0.5rem' }} /> Salvar edição
                  </button>
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
              <div>
                <label>Categoria</label>
                <select className="input-field" value={orderForm.category} onChange={event => setOrderForm({ ...orderForm, category: event.target.value as DeliveryCategory })}>
                  {DELIVERY_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
                </select>
              </div>
              <div>
                <label>Data para entrega</label>
                <input type="date" className="input-field" value={orderForm.deliveryDate} onChange={event => setOrderForm({ ...orderForm, deliveryDate: event.target.value })} />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label>Período de consumo</label>
                <input className="input-field" placeholder="Ex: 12/08 a 16/08" value={orderForm.consumptionPeriod} onChange={event => setOrderForm({ ...orderForm, consumptionPeriod: event.target.value })} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label>Observação geral do pedido</label>
                <input className="input-field" placeholder="Observação que será exibida em todos os PDFs deste pedido" value={orderForm.generalNotes} onChange={event => setOrderForm({ ...orderForm, generalNotes: event.target.value })} />
              </div>
            </div>
            <form onSubmit={addDraftItem} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.5fr 0.5fr 0.5fr 1fr auto', gap: '0.75rem', alignItems: 'end' }}>
              <div>
                <label>Local de entrega</label>
                <select className="input-field" value={orderForm.deliveryPointId} onChange={event => setOrderForm({ ...orderForm, deliveryPointId: event.target.value })}>
                  {operationPoints.map(point => <option key={point.id} value={point.id}>{point.name}</option>)}
                </select>
              </div>
              <div>
                <label>Produto</label>
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: '0.7rem', top: '1rem', color: 'var(--text-muted)' }} />
                  <input className="input-field" list="operation-products" placeholder="Buscar ou cadastrar novo" style={{ paddingLeft: '2rem' }} value={orderForm.product} onChange={event => setOrderForm({ ...orderForm, product: event.target.value })} />
                  <datalist id="operation-products">
                    {products.map(product => <option key={product.id} value={product.name}>{product.unit}</option>)}
                  </datalist>
                </div>
              </div>
              <div>
                <label>UND</label>
                <input className="input-field" value={orderForm.unit} onChange={event => setOrderForm({ ...orderForm, unit: event.target.value })} />
              </div>
              <div>
                <label>Qtd</label>
                <input type="number" min="0" step="0.001" className="input-field" value={orderForm.quantity || ''} onChange={event => setOrderForm({ ...orderForm, quantity: Number(event.target.value) })} />
              </div>
              <div>
                <label>Observação</label>
                <input className="input-field" value={orderForm.notes} onChange={event => setOrderForm({ ...orderForm, notes: event.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button className="button" type="submit" style={{ width: '44px', height: '42px', padding: 0 }} title={editingDraftItem ? 'Salvar item' : 'Adicionar item'}>
                  {editingDraftItem ? <Save size={18} /> : <Plus size={18} />}
                </button>
                {editingDraftItem && (
                  <button className="button button-outline" type="button" style={{ width: '44px', height: '42px', padding: 0 }} title="Cancelar edição do item" onClick={cancelDraftItemEdit}>
                    <X size={18} />
                  </button>
                )}
              </div>
            </form>
            <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
              <table className="data-table">
                <thead><tr><th>Local</th><th>Produto</th><th>UND</th><th>Qtd</th><th style={{ minWidth: '190px' }}>Ações</th></tr></thead>
                <tbody>
                  {draftDeliveries.flatMap(delivery => delivery.items.map((item, index) => (
                    <tr key={`${delivery.deliveryPointId}_${index}`} style={editingDraftItem?.deliveryPointId === delivery.deliveryPointId && editingDraftItem.itemIndex === index ? { outline: '1px solid var(--primary)', outlineOffset: '-1px' } : undefined}>
                      <td>{pointById(delivery.deliveryPointId)?.name}</td>
                      <td style={{ fontWeight: 600 }}>{item.product}</td>
                      <td>{item.unit}</td>
                      <td>{formatQuantity(item.quantity)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <button className="button button-outline" type="button" title="Editar item" style={{ width: 'auto', minWidth: '82px', height: '32px', padding: '0 0.75rem' }} onClick={() => startEditDraftItem(delivery.deliveryPointId, index)}>
                            <Edit3 size={14} style={{ marginRight: '0.35rem' }} /> Editar
                          </button>
                          <button className="button button-outline" type="button" title="Excluir item" style={{ width: 'auto', minWidth: '82px', height: '32px', padding: '0 0.75rem' }} onClick={() => removeDraftItem(delivery.deliveryPointId, index)}>
                            <Trash2 size={14} style={{ marginRight: '0.35rem' }} /> Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  )))}
                  {draftDeliveries.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: '1.5rem' }}>Nenhum item lançado.</td></tr>}
                </tbody>
              </table>
            </div>
            <button className="button" disabled={draftDeliveries.length === 0} onClick={saveManualOrder} style={{ marginTop: '1rem', opacity: draftDeliveries.length === 0 ? 0.5 : 1 }}>
              {editingOrderId ? 'Salvar alterações do pedido de entrega' : 'Salvar pedido do cliente'}
            </button>
          </div>

          <div className="card operations-module-window module-orders" style={{ maxWidth: 'none', padding: '1.5rem' }}>
            <div className="view-header" style={{ marginBottom: '1rem', gap: '1rem' }}>
              <div>
                <h2>Pedidos da operação</h2>
                <p style={{ textAlign: 'left', marginBottom: 0 }}>Gere romaneios por local, PDF único com total da entrega, somas por setor, soma geral e análise de compra.</p>
              </div>
              <div style={{ width: '260px', marginLeft: 'auto' }}>
                <label>Filtrar por categoria</label>
                <select className="input-field" value={ordersCategoryFilter} onChange={event => { setOrdersCategoryFilter(event.target.value as 'Todas' | DeliveryCategory); setExpandedOrderId(null); }}>
                  <option value="Todas">Todas as categorias</option>
                  {DELIVERY_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
                </select>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th aria-sort={deliverySortDirection === 'asc' ? 'ascending' : 'descending'}>
                      <button
                        type="button"
                        onClick={() => setDeliverySortDirection(current => current === 'asc' ? 'desc' : 'asc')}
                        title={`Ordenar entrega em ordem ${deliverySortDirection === 'asc' ? 'decrescente' : 'crescente'}`}
                        style={{
                          alignItems: 'center',
                          background: 'none',
                          border: 0,
                          color: 'inherit',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          font: 'inherit',
                          fontWeight: 'inherit',
                          gap: '0.35rem',
                          padding: 0,
                        }}
                      >
                        Entrega
                        {deliverySortDirection === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
                      </button>
                    </th>
                    <th>Inserido em</th>
                    <th>Categoria</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOperationOrders.map(order => {
                    const needs = getPurchaseNeeds(order);
                    const isExpanded = expandedOrderId === order.id;
                    return (
                      <React.Fragment key={order.id}>
                        <tr
                          className={`order-summary-row ${isExpanded ? 'is-expanded' : ''}`}
                          onClick={() => setExpandedOrderId(current => current === order.id ? null : order.id)}
                          aria-expanded={isExpanded}
                        >
                          <td>
                            <span className="order-delivery-date">
                              {formatDate(order.deliveryDate)}
                              {isExpanded ? <ArrowUp size={17} /> : <ArrowDown size={17} />}
                            </span>
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(order.importedAt)}</td>
                          <td><span className="badge badge-blue">{order.category}</span></td>
                        </tr>
                        {isExpanded && (
                          <tr className="order-details-row">
                            <td colSpan={3}>
                              <div className="order-expanded-content">
                                <div className="order-expanded-meta">
                                  <span><small>Origem</small><strong>{order.sourceType}</strong></span>
                                  <span><small>Locais</small><strong>{order.deliveries.length}</strong></span>
                                  <span><small>Itens</small><strong>{buildSummary(order.deliveries).length}</strong></span>
                                  <span><small>Comprar</small><strong><span className={`badge ${needs.length ? 'badge-red' : 'badge-green'}`}>{needs.length ? `${needs.length} faltante(s)` : 'OK'}</span></strong></span>
                                  {order.generalNotes?.trim() && <span className="order-expanded-note"><small>Observação</small><strong>{order.generalNotes}</strong></span>}
                                </div>
                                <div className="order-expanded-actions" onClick={event => event.stopPropagation()}>
                            <button className={`button ${editingOrderId === order.id ? '' : 'button-outline'}`} type="button" style={{ width: '42px', height: '36px', padding: 0 }} title="Editar pedido de entrega" onClick={() => startEditOrder(order)}>
                              <Edit3 size={16} />
                            </button>
                            <button className="button button-outline" style={{ width: '42px', height: '36px', padding: 0 }} title="PDF único: romaneios + total da entrega" onClick={() => generateAllDeliveriesPdf(order)}>
                              <FileText size={16} />
                            </button>
                            <button className="button button-outline excel-action" style={{ width: '42px', height: '36px', padding: 0 }} title="Excel único: romaneios + totais" onClick={() => generateAllDeliveriesExcel(order)}>
                              <FileSpreadsheet size={16} />
                            </button>
                            {order.deliveries.map(delivery => (
                              <React.Fragment key={delivery.id}>
                                <button className="button button-outline" style={{ width: '42px', height: '36px', padding: 0 }} title={`PDF ${pointById(delivery.deliveryPointId)?.name || 'Entrega'}`} onClick={() => generateDeliveryPdf(order, delivery)}>
                                  <FileText size={16} />
                                </button>
                                <button className="button button-outline excel-action" style={{ width: '42px', height: '36px', padding: 0 }} title={`Excel ${pointById(delivery.deliveryPointId)?.name || 'Entrega'}`} onClick={() => generateDeliveryExcel(order, delivery)}>
                                  <FileSpreadsheet size={16} />
                                </button>
                                <button className="button button-outline" style={{ width: '42px', height: '36px', padding: 0, color: '#ef4444' }} title={`Excluir romaneio ${pointById(delivery.deliveryPointId)?.name || 'Entrega'}`} onClick={() => deleteDelivery(order.id, delivery.id)}>
                                  <Trash2 size={16} />
                                </button>
                              </React.Fragment>
                            ))}
                            {operationSectors.map(sector => (
                              <React.Fragment key={sector.id}>
                                <button className="button button-outline" style={{ width: '42px', height: '36px', padding: 0 }} title={`PDF soma ${sector.name}`} onClick={() => generateSummaryPdf(order, sector.id)}>
                                  <Layers size={16} />
                                </button>
                                <button className="button button-outline excel-action" style={{ width: '42px', height: '36px', padding: 0 }} title={`Excel soma ${sector.name}`} onClick={() => generateSummaryExcel(order, sector.id)}>
                                  <FileSpreadsheet size={16} />
                                </button>
                              </React.Fragment>
                            ))}
                            <button className="button button-outline" style={{ width: '42px', height: '36px', padding: 0 }} title="Soma de todos os setores" onClick={() => generateSummaryPdf(order)}>
                              <Download size={16} />
                            </button>
                            <button className="button button-outline excel-action" style={{ width: '42px', height: '36px', padding: 0 }} title="Excel soma de todos os setores" onClick={() => generateSummaryExcel(order)}>
                              <FileSpreadsheet size={16} />
                            </button>
                            <button className="button button-outline" style={{ width: '42px', height: '36px', padding: 0 }} title="Análise de estoque para compra" onClick={() => generateStockAnalysisPdf(order)}>
                              <Search size={16} />
                            </button>
                            <button className="button button-outline excel-action" style={{ width: '42px', height: '36px', padding: 0 }} title="Excel da análise de estoque para compra" onClick={() => generateStockAnalysisExcel(order)}>
                              <FileSpreadsheet size={16} />
                            </button>
                            <button className="button button-outline" disabled={creatingPurchase} style={{ width: '42px', height: '36px', padding: 0 }} title="Gerar pedido de compra" onClick={() => createPurchaseOrderFromOperation(order)}>
                              <ShoppingCart size={16} />
                            </button>
                            <button className="button" style={{ width: '42px', height: '36px', padding: 0, backgroundColor: '#ef4444' }} title="Excluir pedido" onClick={() => deleteOrder(order.id)}>
                              <Trash2 size={16} />
                            </button>
                                </div>
                          </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {visibleOperationOrders.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', padding: '2rem' }}>Nenhum pedido encontrado para esta categoria.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card operations-module-window module-history" style={{ maxWidth: 'none', padding: '1.5rem' }}>
            <div className="view-header" style={{ marginBottom: '1rem', gap: '1rem' }}>
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><History size={20} /> Histórico das entregas</h2>
                <p style={{ textAlign: 'left', marginBottom: 0 }}>Cada linha representa uma unidade/local dentro dos pedidos da operação.</p>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Categoria</th>
                    <th>Setor</th>
                    <th>Local</th>
                    <th>Itens</th>
                    <th>Qtd total</th>
                    <th>Origem</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveryHistory.map(entry => (
                    <tr key={`${entry.order.id}_${entry.delivery.id}`}>
                      <td>{formatDate(entry.order.deliveryDate)}</td>
                      <td><span className="badge badge-blue">{entry.order.category}</span></td>
                      <td>{entry.sector?.name || '-'}</td>
                      <td style={{ fontWeight: 600 }}>{entry.point?.name || 'Local não cadastrado'}</td>
                      <td>{entry.totalItems}</td>
                      <td>{formatQuantity(entry.totalQuantity)}</td>
                      <td>{entry.order.sourceType}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button className="button button-outline" style={{ width: '42px', height: '36px', padding: 0 }} title="Gerar PDF desta entrega" onClick={() => generateDeliveryPdf(entry.order, entry.delivery)}>
                            <FileText size={16} />
                          </button>
                          <button className="button button-outline excel-action" style={{ width: '42px', height: '36px', padding: 0 }} title="Gerar Excel desta entrega" onClick={() => generateDeliveryExcel(entry.order, entry.delivery)}>
                            <FileSpreadsheet size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {deliveryHistory.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>Nenhuma entrega no histórico.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card operations-module-window module-orders-summary-report" style={{ maxWidth: 'none', padding: '1.5rem' }}>
            <div className="view-header" style={{ marginBottom: '1rem', gap: '1rem' }}>
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><FileSpreadsheet size={20} /> Relatório sintético de pedidos</h2>
                <p style={{ textAlign: 'left', marginBottom: 0 }}>Uma linha por pedido, com datas, origem, locais, itens e quantidade total.</p>
              </div>
            </div>
            <div className="period-report-filters">
              <div>
                <label>Categoria</label>
                <select className="input-field" value={reportCategory} onChange={event => setReportCategory(event.target.value as 'Todas' | DeliveryCategory)}>
                  <option value="Todas">Todas as categorias</option>
                  {DELIVERY_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
                </select>
              </div>
              <div>
                <label>Data inicial da entrega</label>
                <input type="date" className="input-field" max={reportEndDate || undefined} value={reportStartDate} onChange={event => setReportStartDate(event.target.value)} />
              </div>
              <div>
                <label>Data final da entrega</label>
                <input type="date" className="input-field" min={reportStartDate || undefined} value={reportEndDate} onChange={event => setReportEndDate(event.target.value)} />
              </div>
              <div className="period-report-actions">
                <button type="button" className="button button-outline" disabled={ordersSummaryReport.rows.length === 0} onClick={generateOrdersSummaryPdf}>
                  <FileText size={17} style={{ marginRight: '0.45rem' }} /> Gerar PDF
                </button>
                <button type="button" className="button button-outline excel-action" disabled={ordersSummaryReport.rows.length === 0} onClick={generateOrdersSummaryExcel}>
                  <FileSpreadsheet size={17} style={{ marginRight: '0.45rem' }} /> Gerar Excel
                </button>
              </div>
            </div>
            <div className="period-report-summary">
              <span className="badge badge-blue">{ordersSummaryReport.rows.length} pedido(s)</span>
              <span className="badge badge-green">{ordersSummaryReport.locationCount} local(is)</span>
              <span className="badge">{ordersSummaryReport.itemCount} item(ns)</span>
              <span className="badge">{formatQuantity(ordersSummaryReport.totalQuantity)} unidade(s)</span>
            </div>
            <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
              <table className="data-table">
                <thead><tr><th>Entrega</th><th>Inserido em</th><th>Categoria</th><th>Origem</th><th>Locais</th><th>Itens</th><th>Qtd. total</th></tr></thead>
                <tbody>
                  {ordersSummaryReport.rows.map(({ order, locationCount, itemCount, totalQuantity }) => (
                    <tr key={order.id}>
                      <td>{formatDate(order.deliveryDate)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(order.importedAt)}</td>
                      <td><span className="badge badge-blue">{order.category}</span></td>
                      <td>{order.sourceType}</td>
                      <td>{locationCount}</td>
                      <td>{itemCount}</td>
                      <td>{formatQuantity(totalQuantity)}</td>
                    </tr>
                  ))}
                  {ordersSummaryReport.rows.length > 0 && (
                    <tr style={{ fontWeight: 800, background: '#eff6ff' }}><td>Total</td><td></td><td></td><td></td><td>{ordersSummaryReport.locationCount}</td><td>{ordersSummaryReport.itemCount}</td><td>{formatQuantity(ordersSummaryReport.totalQuantity)}</td></tr>
                  )}
                  {ordersSummaryReport.rows.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem' }}>Nenhum pedido encontrado para os filtros selecionados.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card operations-module-window module-deliveries-summary-report" style={{ maxWidth: 'none', padding: '1.5rem' }}>
            <div className="view-header" style={{ marginBottom: '1rem', gap: '1rem' }}>
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><FileText size={20} /> Relatório sintético de entregas</h2>
                <p style={{ textAlign: 'left', marginBottom: 0 }}>Soma todas as entregas do mesmo romaneio, agrupando por data, operação e categoria.</p>
              </div>
            </div>
            <div className="period-report-filters">
              <div>
                <label>Operação</label>
                <details className="operation-multiselect">
                  <summary className="input-field">{summaryOperationLabel}</summary>
                  <div className="operation-multiselect-options">
                    <label className="operation-checkbox-option">
                      <input type="checkbox" checked={summaryOperationIds.length === 0} onChange={() => setSummaryOperationIds([])} />
                      <span>Todas as operações</span>
                    </label>
                    {operations.map(operation => (
                      <label className="operation-checkbox-option" key={operation.id}>
                        <input
                          type="checkbox"
                          checked={summaryOperationIds.length === 0 || summaryOperationIds.includes(operation.id)}
                          onChange={() => toggleSummaryOperation(operation.id)}
                        />
                        <span>{operation.name}</span>
                      </label>
                    ))}
                  </div>
                </details>
              </div>
              <div>
                <label>Categoria</label>
                <select className="input-field" value={reportCategory} onChange={event => setReportCategory(event.target.value as 'Todas' | DeliveryCategory)}>
                  <option value="Todas">Todas as categorias</option>
                  {DELIVERY_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
                </select>
              </div>
              <div>
                <label>Data inicial da entrega</label>
                <input type="date" className="input-field" max={reportEndDate || undefined} value={reportStartDate} onChange={event => setReportStartDate(event.target.value)} />
              </div>
              <div>
                <label>Data final da entrega</label>
                <input type="date" className="input-field" min={reportStartDate || undefined} value={reportEndDate} onChange={event => setReportEndDate(event.target.value)} />
              </div>
              <div className="period-report-actions">
                <button type="button" className="button button-outline" disabled={deliveriesSummaryReport.rows.length === 0} onClick={generateDeliveriesSummaryPdf}>
                  <FileText size={17} style={{ marginRight: '0.45rem' }} /> Gerar PDF
                </button>
              </div>
            </div>
            <div className="period-report-summary">
              <span className="badge badge-blue">{deliveriesSummaryReport.orderCount} pedido(s)</span>
              <span className="badge badge-green">{deliveriesSummaryReport.deliveryCount} entrega(s)</span>
              <span className="badge">{deliveriesSummaryReport.itemCount} item(ns)</span>
              <span className="badge">{formatQuantity(deliveriesSummaryReport.totalQuantity)} unidade(s)</span>
            </div>
            <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
              <table className="data-table">
                <thead><tr><th>Operação</th><th>Data da entrega</th><th>Categoria</th><th>Observação</th><th>Pedidos</th><th>Entregas</th><th>Locais</th><th>Itens</th><th>Qtd. total</th></tr></thead>
                <tbody>
                  {deliveriesSummaryReport.rows.map(row => (
                    <tr key={`${row.operation.id}_${row.deliveryDate}_${row.category}`}>
                      <td style={{ fontWeight: 600 }}>{getOperationTitle(row.operation)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDate(row.deliveryDate)}</td>
                      <td><span className="badge badge-blue">{row.category}</span></td>
                      <td>{Array.from(row.notes).join(' | ') || '-'}</td>
                      <td>{row.orderIds.size}</td><td>{row.deliveryCount}</td><td>{row.pointIds.size}</td><td>{row.itemCount}</td><td>{formatQuantity(row.totalQuantity)}</td>
                    </tr>
                  ))}
                  {deliveriesSummaryReport.rows.length > 0 && (
                    <tr style={{ fontWeight: 800, background: '#eff6ff' }}><td>Total</td><td></td><td></td><td></td><td>{deliveriesSummaryReport.orderCount}</td><td>{deliveriesSummaryReport.deliveryCount}</td><td>{deliveriesSummaryReport.locationCount}</td><td>{deliveriesSummaryReport.itemCount}</td><td>{formatQuantity(deliveriesSummaryReport.totalQuantity)}</td></tr>
                  )}
                  {deliveriesSummaryReport.rows.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: '2rem' }}>Nenhuma entrega encontrada para os filtros selecionados.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card operations-module-window module-romaneio-products-report" style={{ maxWidth: 'none', padding: '1.5rem' }}>
            <div className="view-header" style={{ marginBottom: '1rem', gap: '1rem' }}>
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><FileText size={20} /> Produtos entregues - sintético por romaneio</h2>
                <p style={{ textAlign: 'left', marginBottom: 0 }}>Soma todos os locais e entregas de cada romaneio, mantendo separados pedidos diferentes da mesma data.</p>
              </div>
            </div>
            <div className="period-report-filters">
              <div>
                <label>Categoria</label>
                <select className="input-field" value={reportCategory} onChange={event => setReportCategory(event.target.value as 'Todas' | DeliveryCategory)}>
                  <option value="Todas">Todas as categorias</option>
                  {DELIVERY_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
                </select>
              </div>
              <div>
                <label>Produto</label>
                <select className="input-field" value={reportProduct} onChange={event => setReportProduct(event.target.value)}>
                  <option value="Todos">Todos os produtos</option>
                  {reportProductOptions.map(option => <option key={option.key} value={option.key}>{option.product} — {option.unit}</option>)}
                </select>
              </div>
              <div>
                <label>Data inicial</label>
                <input type="date" className="input-field" max={reportEndDate || undefined} value={reportStartDate} onChange={event => setReportStartDate(event.target.value)} />
              </div>
              <div>
                <label>Data final</label>
                <input type="date" className="input-field" min={reportStartDate || undefined} value={reportEndDate} onChange={event => setReportEndDate(event.target.value)} />
              </div>
              <div className="period-report-actions">
                <button type="button" className="button button-outline" disabled={romaneioProductsReport.rows.length === 0} onClick={generateRomaneioProductsPdf}>
                  <FileText size={17} style={{ marginRight: '0.45rem' }} /> Gerar PDF sintético
                </button>
              </div>
            </div>
            <div className="period-report-summary">
              <span className="badge badge-blue">{romaneioProductsReport.columns.length} romaneio(s)</span>
              <span className="badge badge-green">{romaneioProductsReport.rows.length} produto(s)</span>
              <span className="badge">{romaneioProductsReport.deliveryCount} entrega(s) somadas</span>
              <span className="badge">{formatQuantity(romaneioProductsReport.grandTotal)} unidade(s)</span>
            </div>
            <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Produto</th><th>UND</th>
                    {romaneioProductsReport.columns.map((order, index) => (
                      <th key={order.id}>
                        <span style={{ whiteSpace: 'nowrap' }}>{formatDate(order.deliveryDate)} - Romaneio {index + 1}</span><br />
                        <small>{order.category}</small><br />
                        <small>{order.generalNotes?.trim() || 'Sem observação'}</small>
                      </th>
                    ))}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {romaneioProductsReport.rows.map(row => (
                    <tr key={stockKey(row.product, row.unit)}>
                      <td style={{ fontWeight: 600 }}>{row.product}</td><td>{row.unit}</td>
                      {romaneioProductsReport.columns.map(order => <td key={order.id}>{row.quantities[order.id] ? formatQuantity(row.quantities[order.id]) : '-'}</td>)}
                      <td style={{ fontWeight: 700 }}>{formatQuantity(row.total)}</td>
                    </tr>
                  ))}
                  {romaneioProductsReport.rows.length > 0 && (
                    <tr style={{ background: '#eff6ff', fontWeight: 800 }}>
                      <td>Total geral</td><td></td>
                      {romaneioProductsReport.columns.map(order => <td key={order.id}>{formatQuantity(romaneioProductsReport.columnTotals[order.id] || 0)}</td>)}
                      <td>{formatQuantity(romaneioProductsReport.grandTotal)}</td>
                    </tr>
                  )}
                  {romaneioProductsReport.rows.length === 0 && <tr><td colSpan={romaneioProductsReport.columns.length + 3} style={{ textAlign: 'center', padding: '2rem' }}>Nenhum produto encontrado para os filtros selecionados.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card operations-module-window module-period-report" style={{ maxWidth: 'none', padding: '1.5rem' }}>
            <div className="view-header" style={{ marginBottom: '1rem', gap: '1rem' }}>
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Search size={20} /> Relatório de produtos entregues</h2>
                <p style={{ textAlign: 'left', marginBottom: 0 }}>Filtre por categoria, produto, período e local, com uma coluna para cada combinação de data e local de entrega.</p>
              </div>
            </div>
            <div className="period-report-filters">
              <div>
                <label>Categoria</label>
                <select className="input-field" value={reportCategory} onChange={event => setReportCategory(event.target.value as 'Todas' | DeliveryCategory)}>
                  <option value="Todas">Todas as categorias</option>
                  {DELIVERY_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
                </select>
              </div>
              <div>
                <label>Produto</label>
                <select className="input-field" value={reportProduct} onChange={event => setReportProduct(event.target.value)}>
                  <option value="Todos">Todos os produtos</option>
                  {reportProductOptions.map(option => <option key={option.key} value={option.key}>{option.product} — {option.unit}</option>)}
                </select>
              </div>
              <div>
                <label>Local de entrega</label>
                <select className="input-field" value={reportDeliveryPointId} onChange={event => setReportDeliveryPointId(event.target.value)}>
                  <option value="Todos">Todos os locais</option>
                  {operationPoints.map(point => <option key={point.id} value={point.id}>{point.code ? `${point.code} - ` : ''}{point.name}</option>)}
                </select>
              </div>
              <div>
                <label>Data inicial</label>
                <input type="date" className="input-field" max={reportEndDate || undefined} value={reportStartDate} onChange={event => setReportStartDate(event.target.value)} />
              </div>
              <div>
                <label>Data final</label>
                <input type="date" className="input-field" min={reportStartDate || undefined} value={reportEndDate} onChange={event => setReportEndDate(event.target.value)} />
              </div>
              <div className="period-report-actions">
                <button type="button" className="button button-outline" disabled={periodReport.rows.length === 0} onClick={generatePeriodReportPdf}>
                  <FileText size={17} style={{ marginRight: '0.45rem' }} /> Gerar PDF
                </button>
                <button type="button" className="button button-outline excel-action" disabled={periodReport.rows.length === 0} onClick={generatePeriodReportExcel}>
                  <FileSpreadsheet size={17} style={{ marginRight: '0.45rem' }} /> Gerar Excel
                </button>
              </div>
            </div>
            <div className="period-report-summary">
              <span className="badge badge-blue">{periodReport.orderCount} pedido(s)</span>
              <span className="badge badge-green">{periodReport.rows.length} produto(s)</span>
              <span className="badge">{periodReport.dates.length} data(s)</span>
              <span className="badge">{periodReport.locations.length} local(is)</span>
            </div>
            <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
              <table className="data-table">
                <thead>
                  <tr><th>Produto</th><th>UND</th>{periodReport.columns.map(column => <th key={column.key}><span style={{ whiteSpace: 'nowrap' }}>{formatDate(column.date)}</span><br /><small>{column.pointLabel}</small></th>)}<th>Total</th></tr>
                </thead>
                <tbody>
                  {periodReport.rows.map(row => (
                    <tr key={stockKey(row.product, row.unit)}>
                      <td style={{ fontWeight: 600 }}>{row.product}</td><td>{row.unit}</td>
                      {periodReport.columns.map(column => <td key={column.key}>{row.quantities[column.key] ? formatQuantity(row.quantities[column.key]) : '-'}</td>)}
                      <td style={{ fontWeight: 700 }}>{formatQuantity(row.total)}</td>
                    </tr>
                  ))}
                  {periodReport.rows.length > 0 && (
                    <tr style={{ background: '#eff6ff', fontWeight: 800 }}>
                      <td>Total geral</td><td></td>
                      {periodReport.columns.map(column => <td key={column.key}>{formatQuantity(periodReport.columnTotals[column.key] || 0)}</td>)}
                      <td>{formatQuantity(periodReport.grandTotal)}</td>
                    </tr>
                  )}
                  {periodReport.rows.length === 0 && <tr><td colSpan={periodReport.columns.length + 3} style={{ textAlign: 'center', padding: '2rem' }}>Nenhuma entrega encontrada para os filtros selecionados.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card operations-module-window module-purchase-period-report" style={{ maxWidth: 'none', padding: '1.5rem' }}>
            <div className="view-header" style={{ marginBottom: '1rem', gap: '1rem' }}>
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><ShoppingCart size={20} /> Relatório de compra por período</h2>
                <p style={{ textAlign: 'left', marginBottom: 0 }}>Soma integralmente os itens dos pedidos. O estoque disponível não é consultado nem descontado.</p>
              </div>
            </div>
            <div className="period-report-filters">
              <div>
                <label>Operações</label>
                <details className="operation-multiselect">
                  <summary className="input-field">{purchaseOperationLabel}</summary>
                  <div className="operation-multiselect-options">
                    <label className="operation-checkbox-option">
                      <input type="checkbox" checked={purchaseOperationIds.length === 0} onChange={() => setPurchaseOperationIds([])} />
                      <span>Todas as operações</span>
                    </label>
                    {operations.map(operation => (
                      <label className="operation-checkbox-option" key={operation.id}>
                        <input
                          type="checkbox"
                          checked={purchaseOperationIds.length === 0 || purchaseOperationIds.includes(operation.id)}
                          onChange={() => togglePurchaseOperation(operation.id)}
                        />
                        <span>{getOperationTitle(operation)}</span>
                      </label>
                    ))}
                  </div>
                </details>
              </div>
              <div>
                <label>Categoria</label>
                <select className="input-field" value={reportCategory} onChange={event => setReportCategory(event.target.value as 'Todas' | DeliveryCategory)}>
                  <option value="Todas">Todas as categorias</option>
                  {DELIVERY_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
                </select>
              </div>
              <div>
                <label>Data inicial da entrega</label>
                <input type="date" className="input-field" max={reportEndDate || undefined} value={reportStartDate} onChange={event => setReportStartDate(event.target.value)} />
              </div>
              <div>
                <label>Data final da entrega</label>
                <input type="date" className="input-field" min={reportStartDate || undefined} value={reportEndDate} onChange={event => setReportEndDate(event.target.value)} />
              </div>
              <div className="period-report-actions">
                <button type="button" className="button button-outline" disabled={purchasePeriodReport.rows.length === 0} onClick={generatePurchasePeriodPdf}>
                  <FileText size={17} style={{ marginRight: '0.45rem' }} /> Gerar PDF de compra
                </button>
              </div>
            </div>
            <div className="period-report-summary">
              <span className="badge">{purchasePeriodReport.operationCount} operação(ões)</span>
              <span className="badge badge-blue">{purchasePeriodReport.orderCount} pedido(s)</span>
              <span className="badge badge-green">{purchasePeriodReport.rows.length} produto(s)</span>
              <span className="badge">{purchasePeriodReport.deliveryCount} entrega(s) somadas</span>
              <span className="badge">{formatQuantity(purchasePeriodReport.totalQuantity)} unidade(s)</span>
            </div>
            <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
              <table className="data-table">
                <thead><tr><th>Produto</th><th>UND</th><th>Quantidade a comprar</th></tr></thead>
                <tbody>
                  {purchasePeriodReport.rows.map(row => (
                    <tr key={stockKey(row.product, row.unit)}><td style={{ fontWeight: 600 }}>{row.product}</td><td>{row.unit}</td><td style={{ fontWeight: 700 }}>{formatQuantity(row.quantity)}</td></tr>
                  ))}
                  {purchasePeriodReport.rows.length > 0 && <tr style={{ background: '#eff6ff', fontWeight: 800 }}><td>Total geral</td><td></td><td>{formatQuantity(purchasePeriodReport.totalQuantity)}</td></tr>}
                  {purchasePeriodReport.rows.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', padding: '2rem' }}>Nenhum item encontrado para os filtros selecionados.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card operations-module-window module-products-by-date-report" style={{ maxWidth: 'none', padding: '1.5rem' }}>
            <div className="view-header" style={{ marginBottom: '1rem', gap: '1rem' }}>
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><FileSpreadsheet size={20} /> Faturamento dos produtos entregues</h2>
                <p style={{ textAlign: 'left', marginBottom: 0 }}>Soma as entregas do período, permite cadastrar custo e venda e calcula o faturamento e a margem.</p>
              </div>
            </div>
            <div className="period-report-filters">
              <div>
                <label>Categoria</label>
                <select className="input-field" value={reportCategory} onChange={event => setReportCategory(event.target.value as 'Todas' | DeliveryCategory)}>
                  <option value="Todas">Todas as categorias</option>
                  {DELIVERY_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
                </select>
              </div>
              <div>
                <label>Data inicial</label>
                <input type="date" className="input-field" max={reportEndDate || undefined} value={reportStartDate} onChange={event => setReportStartDate(event.target.value)} />
              </div>
              <div>
                <label>Data final</label>
                <input type="date" className="input-field" min={reportStartDate || undefined} value={reportEndDate} onChange={event => setReportEndDate(event.target.value)} />
              </div>
              <div className="period-report-actions">
                <button type="button" className="button button-outline" disabled={productsByDateReport.rows.length === 0} onClick={generateProductsByDatePdf}>
                  <FileText size={17} style={{ marginRight: '0.45rem' }} /> Gerar PDF
                </button>
                <button type="button" className="button button-outline excel-action" disabled={productsByDateReport.rows.length === 0} onClick={generateProductsByDateExcel}>
                  <FileSpreadsheet size={17} style={{ marginRight: '0.45rem' }} /> Gerar Excel
                </button>
              </div>
            </div>
            <div className="period-report-summary">
              <span className="badge badge-blue">{productsByDateReport.orderCount} pedido(s)</span>
              <span className="badge badge-green">{productsByDateReport.rows.length} produto(s)</span>
              <span className="badge">{productsByDateReport.dates.length} data(s)</span>
              <span className="badge">{productsByDateReport.deliveryCount} entrega(s) somadas</span>
              <span className="badge">Custo: {formatCurrency(productsByDateReport.rows.reduce((sum, row) => sum + row.total * (productPrices[stockKey(row.product, row.unit)]?.costPrice || 0), 0))}</span>
              <span className="badge badge-green">Venda: {formatCurrency(productsByDateReport.rows.reduce((sum, row) => sum + row.total * (productPrices[stockKey(row.product, row.unit)]?.salePrice || 0), 0))}</span>
            </div>
            <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
              <table className="data-table">
                <thead>
                  <tr><th>Produto entregue</th><th>UND</th><th>Quantidade</th><th>Preço de custo</th><th>Total do custo</th><th>Margem venda</th><th>Preço de venda</th><th>Total da venda</th></tr>
                </thead>
                <tbody>
                  {productsByDateReport.rows.map(row => (
                    <tr key={stockKey(row.product, row.unit)}>
                      <td style={{ fontWeight: 600 }}>{row.product}</td>
                      <td>{row.unit}</td>
                      <td style={{ fontWeight: 700 }}>{formatQuantity(row.total)}</td>
                      <td><input aria-label={`Preço de custo de ${row.product}`} className="input-field" type="number" min="0" step="0.01" style={{ minWidth: 120, margin: 0 }} value={productPrices[stockKey(row.product, row.unit)]?.costPrice || ''} onChange={event => persistProductPrice(stockKey(row.product, row.unit), 'costPrice', event.target.value)} placeholder="0,00" /></td>
                      <td>{formatCurrency(row.total * (productPrices[stockKey(row.product, row.unit)]?.costPrice || 0))}</td>
                      <td>{((productPrices[stockKey(row.product, row.unit)]?.salePrice || 0) > 0 ? (((productPrices[stockKey(row.product, row.unit)]?.salePrice || 0) - (productPrices[stockKey(row.product, row.unit)]?.costPrice || 0)) / (productPrices[stockKey(row.product, row.unit)]?.salePrice || 1)) * 100 : 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</td>
                      <td><input aria-label={`Preço de venda de ${row.product}`} className="input-field" type="number" min="0" step="0.01" style={{ minWidth: 120, margin: 0 }} value={productPrices[stockKey(row.product, row.unit)]?.salePrice || ''} onChange={event => persistProductPrice(stockKey(row.product, row.unit), 'salePrice', event.target.value)} placeholder="0,00" /></td>
                      <td style={{ fontWeight: 700 }}>{formatCurrency(row.total * (productPrices[stockKey(row.product, row.unit)]?.salePrice || 0))}</td>
                    </tr>
                  ))}
                  {productsByDateReport.rows.length > 0 && (
                    <tr style={{ background: '#eff6ff', fontWeight: 800 }}>
                      <td>Total geral</td><td></td><td>{formatQuantity(productsByDateReport.grandTotal)}</td><td></td>
                      <td>{formatCurrency(productsByDateReport.rows.reduce((sum, row) => sum + row.total * (productPrices[stockKey(row.product, row.unit)]?.costPrice || 0), 0))}</td>
                      <td>{(() => { const cost = productsByDateReport.rows.reduce((sum, row) => sum + row.total * (productPrices[stockKey(row.product, row.unit)]?.costPrice || 0), 0); const sale = productsByDateReport.rows.reduce((sum, row) => sum + row.total * (productPrices[stockKey(row.product, row.unit)]?.salePrice || 0), 0); return sale > 0 ? `${(((sale - cost) / sale) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` : '0%'; })()}</td><td></td>
                      <td>{formatCurrency(productsByDateReport.rows.reduce((sum, row) => sum + row.total * (productPrices[stockKey(row.product, row.unit)]?.salePrice || 0), 0))}</td>
                    </tr>
                  )}
                  {productsByDateReport.rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>Nenhuma entrega encontrada para os filtros selecionados.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Operations;
