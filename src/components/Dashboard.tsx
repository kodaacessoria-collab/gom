import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, FileText, Package, RefreshCw, WalletCards } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { AccountPayable, Product } from '../types';

interface DashboardOperation { id: string; name: string; city?: string; uf?: string; }
interface DashboardRomaneio {
  id: string;
  operationId: string;
  category: string;
  deliveryDate: string;
  importedAt: string;
  deliveries?: unknown[];
}

const OPERATIONS_KEY = 'gom_delivery_operations';
const ORDERS_KEY = 'gom_delivery_operation_orders';
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDate = (value?: string | null) => value
  ? /^\d{4}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')
  : '-';

const readLocalState = <T,>(key: string, fallback: T): T => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
};

const Dashboard: React.FC = () => {
  const [cleaningStock, setCleaningStock] = useState<Product[]>([]);
  const [accounts, setAccounts] = useState<AccountPayable[]>([]);
  const [operations, setOperations] = useState<DashboardOperation[]>([]);
  const [romaneios, setRomaneios] = useState<DashboardRomaneio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [productsResult, accountsResult, sharedStateResult] = await Promise.all([
      supabase.from('products').select('*').eq('category', 'LIMPEZA').order('name'),
      supabase.from('accounts_payable').select('*, companies(*)').eq('status', 'PENDENTE').order('due_date'),
      supabase.from('app_shared_state').select('key,value').in('key', [OPERATIONS_KEY, ORDERS_KEY]),
    ]);

    if (productsResult.data) setCleaningStock(productsResult.data as Product[]);
    if (accountsResult.data) setAccounts(accountsResult.data as AccountPayable[]);
    if (sharedStateResult.data) {
      const rows = new Map(sharedStateResult.data.map(row => [row.key, row.value]));
      setOperations((rows.get(OPERATIONS_KEY) as DashboardOperation[] | undefined) || readLocalState(OPERATIONS_KEY, []));
      setRomaneios((rows.get(ORDERS_KEY) as DashboardRomaneio[] | undefined) || readLocalState(ORDERS_KEY, []));
    } else {
      setOperations(readLocalState(OPERATIONS_KEY, []));
      setRomaneios(readLocalState(ORDERS_KEY, []));
    }
    if (productsResult.error || accountsResult.error || sharedStateResult.error) {
      setError('Alguns dados não puderam ser atualizados. Exibindo as informações disponíveis.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // Initial remote synchronization is intentionally performed on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchDashboard();
    const interval = window.setInterval(fetchDashboard, 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [fetchDashboard]);

  const accountsTotal = useMemo(() => accounts.reduce((sum, item) => sum + Number(item.amount), 0), [accounts]);
  const cleaningUnits = useMemo(() => cleaningStock.reduce((sum, item) => sum + Number(item.quantity), 0), [cleaningStock]);
  const latestByOperation = useMemo(() => operations.map(operation => ({
    operation,
    items: romaneios
      .filter(item => item.operationId === operation.id)
      .sort((a, b) => (b.deliveryDate || '').localeCompare(a.deliveryDate || '') || (b.importedAt || '').localeCompare(a.importedAt || ''))
      .slice(0, 3),
  })), [operations, romaneios]);

  return (
    <div className="dashboard-container">
      <div className="view-header">
        <div className="view-title"><h1>Painel de Controle</h1><p>Contas, estoque de limpeza e últimos romaneios das operações.</p></div>
        <button onClick={fetchDashboard} className="button-outline dashboard-refresh" disabled={loading}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} />{loading ? 'Atualizando...' : 'Atualizar'}</button>
      </div>

      {error && <div className="dashboard-warning"><AlertTriangle size={20} /><span>{error}</span></div>}

      <div className="dashboard-summary-grid">
        <div className="dashboard-summary-card"><WalletCards /><div><span>Contas a pagar</span><strong>{loading && !accounts.length ? '...' : currency.format(accountsTotal)}</strong><small>{accounts.length} conta(s) pendente(s)</small></div></div>
        <div className="dashboard-summary-card"><Package /><div><span>Estoque de limpeza</span><strong>{loading && !cleaningStock.length ? '...' : cleaningUnits.toLocaleString('pt-BR')}</strong><small>{cleaningStock.length} produto(s) cadastrado(s)</small></div></div>
        <div className="dashboard-summary-card"><FileText /><div><span>Romaneios das operações</span><strong>{loading && !romaneios.length ? '...' : romaneios.length}</strong><small>{operations.length} operação(ões)</small></div></div>
      </div>

      <section className="dashboard-section">
        <div className="dashboard-section-heading"><WalletCards size={21} /><div><h2>Contas a pagar</h2><p>Próximos vencimentos em aberto.</p></div></div>
        <div className="dashboard-table-wrap"><table className="data-table"><thead><tr><th>Vencimento</th><th>Empresa</th><th>Favorecido</th><th>Valor</th></tr></thead><tbody>{accounts.length === 0 ? <tr><td colSpan={4}>{loading ? 'Carregando...' : 'Nenhuma conta pendente.'}</td></tr> : accounts.slice(0, 5).map(account => <tr key={account.id}><td>{formatDate(account.due_date)}</td><td>{account.companies?.trade_name || account.companies?.legal_name || '-'}</td><td>{account.beneficiary}</td><td><strong>{currency.format(Number(account.amount))}</strong></td></tr>)}</tbody></table></div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-heading"><Package size={21} /><div><h2>Estoque de limpeza</h2><p>Saldo atual dos produtos da categoria Limpeza.</p></div></div>
        <div className="dashboard-stock-grid">{cleaningStock.length === 0 ? <p className="dashboard-empty">{loading ? 'Carregando...' : 'Nenhum produto de limpeza cadastrado.'}</p> : cleaningStock.map(product => <div className="dashboard-stock-item" key={product.id}><div><strong>{product.name}</strong><small>{product.deposit || 'Depósito não informado'}</small></div><span className={Number(product.quantity) <= Number(product.min_stock) ? 'low' : ''}>{Number(product.quantity).toLocaleString('pt-BR')} {product.unit}</span></div>)}</div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-heading"><FileText size={21} /><div><h2>Últimos romaneios por operação</h2><p>Os três romaneios mais recentes de cada operação.</p></div></div>
        <div className="dashboard-operations-grid">{latestByOperation.length === 0 ? <p className="dashboard-empty">{loading ? 'Carregando...' : 'Nenhuma operação cadastrada.'}</p> : latestByOperation.map(({ operation, items }) => <article className="dashboard-operation-card" key={operation.id}><header><h3>{operation.name}</h3><small>{[operation.city, operation.uf].filter(Boolean).join(' / ')}</small></header>{items.length === 0 ? <p className="dashboard-empty">Nenhum romaneio nesta operação.</p> : <ol>{items.map(item => <li key={item.id}><CalendarDays size={17} /><div><strong>{item.category}</strong><small>{formatDate(item.deliveryDate)} · {item.deliveries?.length || 0} ponto(s) de entrega</small></div></li>)}</ol>}</article>)}</div>
      </section>
    </div>
  );
};

export default Dashboard;
