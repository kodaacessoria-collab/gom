import React, { useEffect, useState, useCallback } from 'react';
import { Package, FileText, ShoppingCart, BarChart3, RefreshCw, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState({
    totalProducts: 0,
    totalSlips: 0,
    activeOrders: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Usando Promise.all para buscar tudo em paralelo e ser mais rápido
      const [productsRes, slipsRes, ordersRes] = await Promise.all([
        supabase.from('products').select('*', { count: 'exact', head: true }),
        supabase.from('slips').select('*', { count: 'exact', head: true }),
        supabase.from('purchase_orders').select('*', { count: 'exact', head: true }).eq('status', 'PENDENTE')
      ]);

      if (productsRes.error) throw productsRes.error;
      if (slipsRes.error) throw slipsRes.error;
      if (ordersRes.error) throw ordersRes.error;

      setStats({
        totalProducts: productsRes.count || 0,
        totalSlips: slipsRes.count || 0,
        activeOrders: ordersRes.count || 0,
      });
      
      console.log('Estatísticas atualizadas:', {
        p: productsRes.count,
        s: slipsRes.count,
        o: ordersRes.count
      });
    } catch (err: any) {
      console.error('Erro detalhado ao buscar estatísticas:', err);
      setError(err.message || 'Erro ao carregar dados do banco de dados');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    
    // Configurar um intervalo para atualizar a cada 5 minutos
    const interval = setInterval(fetchStats, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const cards = [
    { title: 'Total de Itens', value: stats.totalProducts, icon: Package, color: 'blue' },
    { title: 'Romaneios (Total)', value: stats.totalSlips, icon: FileText, color: 'green' },
    { title: 'Pedidos Pendentes', value: stats.activeOrders, icon: ShoppingCart, color: 'yellow' },
  ];

  return (
    <div className="dashboard-container">
      <div className="view-header">
        <div className="view-title">
          <h1>Painel de Controle</h1>
          <p>Visão geral do sistema de estoque GOM.</p>
        </div>
        <button 
          onClick={fetchStats} 
          className="button-outline" 
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: 'auto', padding: '0.5rem 1rem' }}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>

      {error && (
        <div style={{ 
          backgroundColor: 'rgba(239, 68, 68, 0.1)', 
          border: '1px solid #ef4444', 
          color: '#f87171', 
          padding: '1rem', 
          borderRadius: '0.5rem', 
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <AlertTriangle size={20} />
          <span>{error}. Verifique sua conexão ou credenciais.</span>
        </div>
      )}

      <div className="stats-grid" style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', 
        gap: '1.5rem', 
        marginBottom: '2.5rem' 
      }}>
        {cards.map((card) => (
          <div key={card.title} className="card" style={{ padding: '1.5rem', marginBottom: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-muted)' }}>{card.title}</p>
                <h2 style={{ fontSize: '2rem', marginTop: '0.5rem', marginBottom: 0, fontWeight: 800 }}>
                  {loading && stats.totalProducts === 0 ? '...' : card.value}
                </h2>
              </div>
              <div style={{ 
                padding: '0.75rem', 
                borderRadius: '1rem', 
                backgroundColor: `rgba(var(--${card.color}-rgb, 99, 102, 241), 0.1)`,
                color: `var(--${card.color}, #6366f1)`,
                boxShadow: `0 0 20px rgba(var(--${card.color}-rgb, 99, 102, 241), 0.1)`
              }}>
                <card.icon size={24} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1.5rem' }}>
        <div className="card" style={{ padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '0.5rem', fontSize: '1.25rem' }}>Movimentação Recente</h3>
          <p style={{ fontSize: '0.875rem', marginBottom: '1.5rem' }}>Últimas entradas e saídas de estoque.</p>
          <div style={{ 
            height: '240px', 
            display: 'flex', 
            flexDirection: 'column',
            alignItems: 'center', 
            justifyContent: 'center', 
            opacity: 0.6,
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            borderRadius: '0.75rem',
            border: '1px dashed var(--border)'
          }}>
            <BarChart3 size={48} style={{ marginBottom: '1rem', opacity: 0.5 }} />
            <p style={{ margin: 0 }}>Gráfico em desenvolvimento...</p>
          </div>
        </div>
        
        <div className="card" style={{ padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '0.5rem', fontSize: '1.25rem' }}>Alertas de Validade</h3>
          <p style={{ fontSize: '0.875rem', marginBottom: '1.5rem' }}>Produtos próximos ao vencimento.</p>
          <div style={{ 
            height: '240px', 
            display: 'flex', 
            flexDirection: 'column',
            alignItems: 'center', 
            justifyContent: 'center', 
            opacity: 0.6,
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            borderRadius: '0.75rem',
            border: '1px dashed var(--border)'
          }}>
            <Package size={48} style={{ marginBottom: '1rem', opacity: 0.5 }} />
            <p style={{ margin: 0 }}>Nenhum alerta crítico hoje.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
