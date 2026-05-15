import React, { useEffect, useState } from 'react';
import { Package, FileText, ShoppingCart } from 'lucide-react';
import { supabase } from '../lib/supabase';

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState({
    totalProducts: 0,
    totalSlips: 0,
    activeOrders: 0,
  });

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const { data: products } = await supabase.from('products').select('*');
      const { data: slips } = await supabase.from('slips').select('*');
      const { data: orders } = await supabase.from('purchase_orders').select('*').eq('status', 'PENDENTE');

      setStats({
        totalProducts: products?.length || 0,
        totalSlips: slips?.length || 0,
        activeOrders: orders?.length || 0,
      });
    } catch (err) {
      console.error('Erro ao buscar estatísticas:', err);
    }
  };

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
      </div>

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
                <h2 style={{ fontSize: '2rem', marginTop: '0.5rem', marginBottom: 0, fontWeight: 800 }}>{card.value}</h2>
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

// Adicionando ícone que faltou no import
import { BarChart3 } from 'lucide-react';

export default Dashboard;
