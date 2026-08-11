import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Calendar,
  Download,
  Edit3,
  FileText,
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
import { addPdfHeader } from '../lib/pdfBranding';
import type { PdfLogoVariant } from '../lib/pdfBranding';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();

type SourceType = 'Manual' | 'Excel' | 'PDF';
type DeliveryCategory = 'Hortifrutigranjeiro' | 'Estocáveis' | 'Dietas e Fórmulas' | 'Proteínas' | 'Limpeza';

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
const REPORT_FONT = 'courier';
const REPORT_FONT_SIZE = 8;
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
const formatQuantity = (value: number) => Number.isInteger(value) ? String(value) : value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

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
  rows.findIndex(row => row.some(cell => normalizeKey(cell) === 'PRODUTO') && row.some(cell => ['QTD', 'QUANTIDADE'].includes(normalizeKey(cell))));

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
  });
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
  const [products, setProducts] = useState<Product[]>([]);
  const [activeOperationId, setActiveOperationId] = useState(() => operations[0]?.id || 'boituva');
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
    deliveryPointId: '',
    product: '',
    unit: 'UN',
    quantity: 0,
    notes: '',
  });
  const [draftDeliveries, setDraftDeliveries] = useState<OrderDelivery[]>([]);
  const [editingDraftItem, setEditingDraftItem] = useState<{ deliveryPointId: string; itemIndex: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [creatingPurchase, setCreatingPurchase] = useState(false);

  const activeOperation = operations.find(operation => operation.id === activeOperationId) || operations[0];
  const operationSectors = sectors.filter(sector => sector.operationId === activeOperation?.id);
  const operationPoints = deliveryPoints.filter(point => point.operationId === activeOperation?.id);
  const operationOrders = useMemo(
    () => orders.filter(order => order.operationId === activeOperation?.id).sort((a, b) => b.importedAt.localeCompare(a.importedAt)),
    [orders, activeOperation?.id]
  );

  useEffect(() => {
    fetchProducts();
  }, []);

  useEffect(() => {
    if (!newPoint.sectorId && operationSectors[0]) setNewPoint(prev => ({ ...prev, sectorId: operationSectors[0].id }));
    if (!orderForm.deliveryPointId && operationPoints[0]) setOrderForm(prev => ({ ...prev, deliveryPointId: operationPoints[0].id }));
  }, [activeOperationId, operationSectors, operationPoints, newPoint.sectorId, orderForm.deliveryPointId]);

  const fetchProducts = async () => {
    const { data } = await supabase.from('products').select('*').order('name');
    if (data) setProducts(data);
  };

  const persistOperations = (next: OperationContract[]) => {
    setOperations(next);
    saveStorage(OPERATIONS_KEY, next);
  };

  const persistSectors = (next: Sector[]) => {
    setSectors(next);
    saveStorage(SECTORS_KEY, next);
  };

  const persistDeliveryPoints = (next: DeliveryPoint[]) => {
    setDeliveryPoints(next);
    saveStorage(DELIVERY_POINTS_KEY, next);
  };

  const persistOrders = (next: OperationOrder[]) => {
    setOrders(next);
    saveStorage(ORDERS_KEY, next);
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
    setEditingOrderId(order.id);
    setEditingDraftItem(null);
    setOrderForm(prev => ({
      ...prev,
      category: order.category,
      deliveryDate: order.deliveryDate,
      consumptionPeriod: order.consumptionPeriod || '',
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
    requestAnimationFrame(() => document.getElementById('operation-order-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const deleteOrder = (orderId: string) => {
    if (!confirm('Deseja excluir este pedido da operação?')) return;
    persistOrders(orders.filter(order => order.id !== orderId));
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
      importedAt: new Date().toISOString(),
      deliveries: normalizeOrderDeliveries(draftDeliveries),
    };
    persistOrders([order, ...orders]);
    setEditingDraftItem(null);
    setDraftDeliveries([]);
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
    }));
  };

  const parseUnitSheet = (sheetName: string, rows: unknown[][]): OrderDelivery | null => {
    const headerRow = findHeaderRow(rows);
    if (headerRow < 0) return null;
    const headers = rows[headerRow].map(normalizeKey);
    const productIndex = headers.findIndex(header => header === 'PRODUTO');
    const unitIndex = headers.findIndex(header => ['UND', 'UNIDADE', 'EMBALAGEM'].includes(header));
    const quantityIndex = headers.findIndex(header => ['QTD', 'QUANTIDADE'].includes(header));
    const notesIndex = headers.findIndex(header => header === 'OBS' || header === 'OBS.');
    if (productIndex < 0 || quantityIndex < 0) return null;

    const items = rows.slice(headerRow + 1).map(row => ({
      product: displayText(row[productIndex]),
      unit: displayText(unitIndex >= 0 ? row[unitIndex] : 'UN') || 'UN',
      quantity: toNumber(row[quantityIndex]),
      notes: displayText(notesIndex >= 0 ? row[notesIndex] : ''),
    })).filter(item => item.product && item.quantity > 0);

    if (items.length === 0) return null;
    const sheetKey = normalizeKey(sheetName);
    const matchedPoint = findDeliveryPointByLabel(sheetName) || operationPoints.find(point => sheetKey.includes(normalizeKey(point.code)));
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

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !activeOperation) return;
    setImporting(true);
    try {
      const extension = file.name.split('.').pop()?.toLowerCase();
      const order = extension === 'pdf' ? await parsePdfOrder(file) : await parseExcelOrder(file);
      persistOrders([order, ...orders]);
      alert(`Pedido importado com ${order.deliveries.length} local(is) de entrega.`);
    } catch (err: any) {
      alert(err.message || 'Não foi possível importar o pedido.');
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
      .sort((a, b) => a.name.localeCompare(b.name));

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
    const sector = sectorById(point?.sectorId);
    const items = aggregateDeliveryItems(delivery.items);
    const doc = new jsPDF();
    doc.setFont(REPORT_FONT, 'normal');
    doc.setFontSize(REPORT_FONT_SIZE);
    await addHeader(doc, reportOperation, order, `${sector?.name || 'Sem setor'} | ${point?.name || 'Local de entrega'}`);
    doc.text(`Local: ${point?.name || '-'} | Codigo: ${point?.code || '-'}`, 14, 39);
    doc.text(`Endereco: ${point?.address || '-'} | Bairro: ${point?.neighborhood || '-'}`, 14, 45);

    autoTable(doc, {
      startY: 52,
      head: [['Produto', 'UND', 'QTD', 'OBS.']],
      body: items.map(item => [item.product, item.unit, formatQuantity(item.quantity), item.notes || '']),
      styles: { font: REPORT_FONT, fontSize: REPORT_FONT_SIZE, cellPadding: 1.4 },
      headStyles: { font: REPORT_FONT, fontSize: REPORT_FONT_SIZE, fontStyle: 'bold', fillColor: [5, 150, 105] },
      theme: 'grid',
    });
    addReceiptFields(doc, (doc as any).lastAutoTable?.finalY || 60);
    doc.save(getRomaneioFileName(reportOperation, order, point?.name || 'entrega'));
  };

  const generateAllDeliveriesPdf = async (order: OperationOrder) => {
    const reportOperation = operationByOrder(order);
    if (!reportOperation || order.deliveries.length === 0) return;
    const doc = new jsPDF();
    doc.setFont(REPORT_FONT, 'normal');
    doc.setFontSize(REPORT_FONT_SIZE);

    for (const [index, delivery] of order.deliveries.entries()) {
      if (index > 0) doc.addPage();
      const point = pointById(delivery.deliveryPointId);
      const sector = sectorById(point?.sectorId);
      const items = aggregateDeliveryItems(delivery.items);

      doc.setFont(REPORT_FONT, 'normal');
      doc.setFontSize(REPORT_FONT_SIZE);
      await addHeader(doc, reportOperation, order, `${sector?.name || 'Sem setor'} | ${point?.name || 'Local de entrega'}`);
      doc.text(`Local: ${point?.name || '-'} | Codigo: ${point?.code || '-'}`, 14, 39);
      doc.text(`Endereco: ${point?.address || '-'} | Bairro: ${point?.neighborhood || '-'}`, 14, 45);

      autoTable(doc, {
        startY: 52,
        head: [['Produto', 'UND', 'QTD', 'OBS.']],
        body: items.map(item => [item.product, item.unit, formatQuantity(item.quantity), item.notes || '']),
        styles: { font: REPORT_FONT, fontSize: REPORT_FONT_SIZE, cellPadding: 1.4 },
        headStyles: { font: REPORT_FONT, fontSize: REPORT_FONT_SIZE, fontStyle: 'bold', fillColor: [5, 150, 105] },
        theme: 'grid',
      } as any);
      addReceiptFields(doc, (doc as any).lastAutoTable?.finalY || 60);
    }

    for (const sector of getOrderSectors(order)) {
      const scopedDeliveries = order.deliveries.filter(delivery => pointById(delivery.deliveryPointId)?.sectorId === sector.id);
      const summary = buildSummary(scopedDeliveries);

      doc.addPage();
      await addHeader(doc, reportOperation, order, `SOMA DO SETOR - ${sector.name}`);
      autoTable(doc, {
        startY: 39,
        head: [['Produto', 'UND', sector.name]],
        body: [
          ...summary.map(item => [item.product, item.unit, formatQuantity(item.quantity)]),
          ['TOTAL GERAL', '', formatQuantity(summary.reduce((sum, item) => sum + item.quantity, 0))],
        ],
        styles: { font: REPORT_FONT, fontSize: REPORT_FONT_SIZE, cellPadding: 1.4 },
        headStyles: { font: REPORT_FONT, fontSize: REPORT_FONT_SIZE, fontStyle: 'bold', fillColor: [79, 70, 229] },
        theme: 'grid',
      });
    }

    doc.addPage();
    await addHeader(doc, reportOperation, order, 'TOTAL GERAL POR SETOR');
    const sectorSummary = getSectorSummaryTable(order);
    autoTable(doc, {
      startY: 39,
      head: sectorSummary.head,
      body: sectorSummary.body,
      styles: { font: REPORT_FONT, fontSize: sectorSummary.sectorColumns.length > 3 ? 7 : REPORT_FONT_SIZE, cellPadding: 1.2 },
      headStyles: { font: REPORT_FONT, fontSize: REPORT_FONT_SIZE, fontStyle: 'bold', fillColor: [79, 70, 229] },
      theme: 'grid',
    });

    doc.save(getRomaneioFileName(reportOperation, order));
  };

  const generateSummaryPdf = async (order: OperationOrder, sectorId?: string) => {
    const reportOperation = operationByOrder(order);
    if (!reportOperation) return;
    const scopedDeliveries = sectorId
      ? order.deliveries.filter(delivery => pointById(delivery.deliveryPointId)?.sectorId === sectorId)
      : order.deliveries;
    const summary = buildSummary(scopedDeliveries);
    const sector = sectorById(sectorId);
    const doc = new jsPDF();
    doc.setFont(REPORT_FONT, 'normal');
    doc.setFontSize(REPORT_FONT_SIZE);
    await addHeader(doc, reportOperation, order, sector ? `Soma das unidades - ${sector.name}` : 'Soma de todos os setores');
    const sectorSummary = sector ? null : getSectorSummaryTable(order);
    autoTable(doc, {
      startY: 39,
      head: sectorSummary?.head || [['Produto', 'UND', 'Total']],
      body: sectorSummary?.body || summary.map(item => [item.product, item.unit, formatQuantity(item.quantity)]),
      styles: { font: REPORT_FONT, fontSize: sectorSummary && sectorSummary.sectorColumns.length > 3 ? 7 : REPORT_FONT_SIZE, cellPadding: 1.4 },
      headStyles: { font: REPORT_FONT, fontSize: REPORT_FONT_SIZE, fontStyle: 'bold', fillColor: [79, 70, 229] },
      theme: 'grid',
    });
    doc.save(getRomaneioFileName(reportOperation, order, sector ? `SOMA ${sector.name}` : 'TOTAL SETORES'));
  };

  const generateStockAnalysisPdf = async (order: OperationOrder) => {
    const reportOperation = operationByOrder(order);
    if (!reportOperation) return;
    const needs = getPurchaseNeeds(order);
    const stock = getStockMap();
    const doc = new jsPDF();
    doc.setFont(REPORT_FONT, 'normal');
    doc.setFontSize(REPORT_FONT_SIZE);
    await addHeader(doc, reportOperation, order, 'Analise de estoque para compra');
    autoTable(doc, {
      startY: 39,
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
    doc.save(getRomaneioFileName(reportOperation, order, 'ANALISE ESTOQUE COMPRA'));
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

  return (
    <div>
      <div className="view-header" style={{ flexWrap: 'wrap', gap: '1rem' }}>
        <div className="view-title">
          <h1>Operações e Entregas</h1>
          <p>Cadastre operações, setores, locais de entrega, pedidos dos clientes, romaneios e compras necessárias.</p>
        </div>
        <label className="button" style={{ width: 'auto', cursor: activeOperation ? 'pointer' : 'not-allowed', opacity: importing ? 0.6 : 1 }}>
          <Upload size={18} style={{ marginRight: '0.5rem' }} />
          {importing ? 'Importando...' : 'Importar Pedido'}
          <input type="file" hidden accept=".xlsx,.xls,.pdf" disabled={importing || !activeOperation} onChange={handleImport} />
        </label>
      </div>

      <div className="operations-layout">
        <div className="card" style={{ maxWidth: 'none', padding: '1.25rem' }}>
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
              </div>
            ))}
          </div>

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

          <div className="card" style={{ maxWidth: 'none', padding: '1.5rem' }}>
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

          <div id="operation-order-form" className="card" style={{ maxWidth: 'none', padding: '1.5rem' }}>
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
                <button className="button button-outline" type="button" onClick={cancelOrderEdit} style={{ width: 'auto' }}>
                  <X size={16} style={{ marginRight: '0.5rem' }} /> Cancelar edição
                </button>
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

          <div className="card" style={{ maxWidth: 'none', padding: '1.5rem' }}>
            <div className="view-header" style={{ marginBottom: '1rem', gap: '1rem' }}>
              <div>
                <h2>Pedidos da operação</h2>
                <p style={{ textAlign: 'left', marginBottom: 0 }}>Gere romaneios por local, PDF único com total da entrega, somas por setor, soma geral e análise de compra.</p>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Entrega</th>
                    <th>Categoria</th>
                    <th>Origem</th>
                    <th>Locais</th>
                    <th>Itens</th>
                    <th>Comprar</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {operationOrders.map(order => {
                    const needs = getPurchaseNeeds(order);
                    return (
                      <tr key={order.id}>
                        <td>{formatDate(order.deliveryDate)}</td>
                        <td><span className="badge badge-blue">{order.category}</span></td>
                        <td>{order.sourceType}</td>
                        <td>{order.deliveries.length}</td>
                        <td>{buildSummary(order.deliveries).length}</td>
                        <td><span className={`badge ${needs.length ? 'badge-red' : 'badge-green'}`}>{needs.length ? `${needs.length} faltante(s)` : 'OK'}</span></td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <button className={`button ${editingOrderId === order.id ? '' : 'button-outline'}`} type="button" style={{ width: '42px', height: '36px', padding: 0 }} title="Editar pedido de entrega" onClick={() => startEditOrder(order)}>
                              <Edit3 size={16} />
                            </button>
                            <button className="button button-outline" style={{ width: '42px', height: '36px', padding: 0 }} title="PDF único: romaneios + total da entrega" onClick={() => generateAllDeliveriesPdf(order)}>
                              <FileText size={16} />
                            </button>
                            {order.deliveries.map(delivery => (
                              <button key={delivery.id} className="button button-outline" style={{ width: '42px', height: '36px', padding: 0 }} title={`PDF ${pointById(delivery.deliveryPointId)?.name || 'Entrega'}`} onClick={() => generateDeliveryPdf(order, delivery)}>
                                <FileText size={16} />
                              </button>
                            ))}
                            {operationSectors.map(sector => (
                              <button key={sector.id} className="button button-outline" style={{ width: '42px', height: '36px', padding: 0 }} title={`Soma ${sector.name}`} onClick={() => generateSummaryPdf(order, sector.id)}>
                                <Layers size={16} />
                              </button>
                            ))}
                            <button className="button button-outline" style={{ width: '42px', height: '36px', padding: 0 }} title="Soma de todos os setores" onClick={() => generateSummaryPdf(order)}>
                              <Download size={16} />
                            </button>
                            <button className="button button-outline" style={{ width: '42px', height: '36px', padding: 0 }} title="Análise de estoque para compra" onClick={() => generateStockAnalysisPdf(order)}>
                              <Search size={16} />
                            </button>
                            <button className="button button-outline" disabled={creatingPurchase} style={{ width: '42px', height: '36px', padding: 0 }} title="Gerar pedido de compra" onClick={() => createPurchaseOrderFromOperation(order)}>
                              <ShoppingCart size={16} />
                            </button>
                            <button className="button" style={{ width: '42px', height: '36px', padding: 0, backgroundColor: '#ef4444' }} title="Excluir pedido" onClick={() => deleteOrder(order.id)}>
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {operationOrders.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem' }}>Nenhum pedido lançado nesta operação.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ maxWidth: 'none', padding: '1.5rem' }}>
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
                        <button className="button button-outline" style={{ width: '42px', height: '36px', padding: 0 }} title="Gerar romaneio desta entrega" onClick={() => generateDeliveryPdf(entry.order, entry.delivery)}>
                          <FileText size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {deliveryHistory.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>Nenhuma entrega no histórico.</td></tr>}
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
