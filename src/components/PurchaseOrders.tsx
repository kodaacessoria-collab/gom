import React, { useState, useEffect } from 'react';
import { ShoppingCart, CheckCircle, ListChecks, ArrowRight, FileText, History, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Product } from '../types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const PurchaseOrders: React.FC = () => {
  const [activeView, setActiveView] = useState<'create' | 'history'>('create');
  const [products, setProducts] = useState<Product[]>([]);
  const [slips, setSlips] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [selectedSlips, setSelectedSlips] = useState<string[]>([]);
  const [selectedDeposit, setSelectedDeposit] = useState<'Depósito-Grupo OM' | 'Depósito-RED'>('Depósito-Grupo OM');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setLoading(true);
    const { data: productsData } = await supabase.from('products').select('*');
    const { data: slipsData } = await supabase.from('slips').select('*, products(name, deposit)').order('date', { ascending: false });
    const { data: ordersData } = await supabase.from('purchase_orders').select('*').order('created_at', { ascending: false });
    
    if (productsData) setProducts(productsData);
    if (ordersData) setOrders(ordersData);
    
    // Filter: Only show 'SAIDA' slips that aren't already marked as [COMPRADO]
    if (slipsData) {
      const pendingSlips = slipsData.filter(s => 
        s.type === 'SAIDA' && 
        !s.destination.startsWith('[COMPRADO]')
      );
      setSlips(pendingSlips);
    }
    
    setLoading(false);
  };

  const filteredSlips = slips.filter(s => s.products?.deposit === selectedDeposit);

  const toggleSelectAll = () => {
    if (selectedSlips.length === filteredSlips.length) {
      setSelectedSlips([]);
    } else {
      setSelectedSlips(filteredSlips.map(s => s.id));
    }
  };

  const toggleSlip = (id: string) => {
    setSelectedSlips(prev => 
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const calculateDemand = () => {
    if (selectedSlips.length === 0) {
      setSuggestions([]);
      return;
    }

    // Helper to normalize product group key based on name and unit (ignoring brand)
    const getProductGroupKey = (p: Product) => {
      let name = p.name.toLowerCase().trim();
      
      // Remove brand from name if present to group different brands of same product
      if (p.brand) {
        const brandLower = p.brand.toLowerCase().trim();
        if (brandLower && brandLower !== 'null' && brandLower !== 'diversos' && brandLower !== 'variadas marcas') {
          const escapedBrand = brandLower.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const regex = new RegExp(`\\b${escapedBrand}\\b`, 'gi');
          name = name.replace(regex, '').replace(/\s+/g, ' ').trim();
        }
      }
      
      // Strip trailing or leading punctuation/hyphens/parentheses left after stripping brand
      name = name.replace(/[\s\-\/\(\)]+$/, '').replace(/^\s*[\s\-\/\(\)]+/, '').replace(/\s+/g, ' ').trim();

      // Normalize common weight and packaging units
      let unit = (p.unit || 'UN').toLowerCase().trim().replace(/\s+/g, '');
      if (unit === '1kilo' || unit === 'kilo' || unit === '1kg' || unit === 'kg') {
        unit = '1kg';
      } else if (unit === '5kg') {
        unit = '5kg';
      } else if (unit === '5l' || unit === '5lt' || unit === '5lts') {
        unit = '5l';
      } else if (unit === '1l' || unit === '1lt' || unit === '1lts') {
        unit = '1l';
      } else if (unit === '500g' || unit === '500gr') {
        unit = '500g';
      } else if (unit === '300g' || unit === '300gr') {
        unit = '300g';
      } else if (unit === '250g' || unit === '250gr') {
        unit = '250g';
      } else if (unit === '200g' || unit === '200gr') {
        unit = '200g';
      } else if (unit === '170g' || unit === '170gr') {
        unit = '170g';
      }

      return `${name} | ${unit}`;
    };

    // 1. Group all available products by normalized key and sum their stock
    const productGroups: Record<string, {
      representative: Product;
      totalStock: number;
      allProducts: Product[];
    }> = {};

    products.forEach(p => {
      const key = getProductGroupKey(p);
      if (!productGroups[key]) {
        productGroups[key] = {
          representative: p,
          totalStock: 0,
          allProducts: []
        };
      }
      productGroups[key].totalStock += Number(p.quantity || 0);
      productGroups[key].allProducts.push(p);
    });

    // 2. Sum the demand from selected slips grouped by product key
    const groupDemand: Record<string, number> = {};
    
    slips.filter(s => selectedSlips.includes(s.id)).forEach(s => {
      const product = products.find(p => p.id === s.product_id);
      if (product) {
        const key = getProductGroupKey(product);
        groupDemand[key] = (groupDemand[key] || 0) + Number(s.quantity);
      }
    });

    // 3. Generate suggestions based on grouped stock and demand
    const newSuggestions = Object.keys(groupDemand).map(key => {
      const group = productGroups[key];
      if (!group) return null;

      const totalStock = group.totalStock;
      const demandQty = groupDemand[key];
      const balance = totalStock - demandQty;

      // Only generate suggestion if balance is less than zero (estoque total - demanda total < 0)
      if (balance >= 0) return null;

      const suggestedQty = Math.abs(balance);

      // Return a suggestion matching the representative product structure
      return {
        ...group.representative,
        quantity: totalStock, // display the combined stock of all matching products/brands
        neededQty: demandQty, // total demand across matching products/brands
        balance: balance,
        suggestedQty: suggestedQty
      };
    }).filter((s): s is NonNullable<typeof s> => s !== null);

    setSuggestions(newSuggestions);
  };

  useEffect(() => {
    calculateDemand();
  }, [selectedSlips, products]);

  const createOrder = async () => {
    if (suggestions.length === 0) return;

    const order = {
      date: new Date().toISOString().split('T')[0],
      status: 'PENDENTE',
      items: suggestions.map(s => ({
        product_id: s.id,
        product_name: s.name,
        quantity: s.suggestedQty,
        unit: s.unit || 'UN'
      }))
    };

    const { error: orderError } = await supabase.from('purchase_orders').insert([order]);
    if (orderError) {
      alert(orderError.message);
      return;
    }

    // Mark selected slips as processed by updating their destination
    const updates = slips
      .filter(s => selectedSlips.includes(s.id))
      .map(s => ({
        ...s,
        destination: `[COMPRADO] ${s.destination}`
      }));

    for (const update of updates) {
      const { products: _, ...cleanUpdate } = update as any; // Remove the joined products data
      await supabase.from('slips').update(cleanUpdate).eq('id', update.id);
    }

    alert('Pedido de compra gerado com sucesso!');
    setSelectedSlips([]);
    setSuggestions([]);
    fetchInitialData();
    setActiveView('history');
  };

  const deleteOrder = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este pedido? Se ele estiver EFETIVADO, as entradas de estoque correspondentes também serão removidas.')) return;
    
    // Find the order to check its ID for slip cleanup
    const orderToDelete = orders.find(o => o.id === id);
    
    if (orderToDelete && orderToDelete.status === 'EFETIVADO') {
      const ref = orderToDelete.id.split('-')[0];
      await supabase.from('slips').delete().like('destination', `%Ref: ${ref}%`);
    }

    const { error } = await supabase.from('purchase_orders').delete().eq('id', id);
    if (error) alert(error.message);
    else fetchInitialData();
  };

  const confirmPurchase = async (order: any) => {
    if (!confirm('Deseja confirmar a compra destes itens? O estoque será atualizado automaticamente.')) return;
    
    // 1. Create ENTRADA slips for each item
    const slipsToCreate = order.items.map((item: any) => ({
      date: new Date().toISOString().split('T')[0],
      product_id: item.product_id,
      quantity: item.quantity,
      type: 'ENTRADA',
      category: 'ESTOCAVEIS', // Default category
      unit: item.unit || 'UN',
      destination: `Compra Efetivada (Ref: ${order.id.split('-')[0]})`
    }));

    const { error: slipError } = await supabase.from('slips').insert(slipsToCreate);
    if (slipError) {
      alert('Erro ao gerar entradas: ' + slipError.message);
      return;
    }

    // 2. Update order status
    const { error: orderError } = await supabase.from('purchase_orders').update({ status: 'EFETIVADO' }).eq('id', order.id);
    if (orderError) alert('Erro ao atualizar pedido: ' + orderError.message);
    else {
      alert('Compra efetivada e estoque atualizado!');
      fetchInitialData();
    }
  };

  const generatePDF = (order: any) => {
    const doc = new jsPDF();
    
    // Header
    doc.setFillColor(79, 70, 229);
    doc.rect(0, 0, 210, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.text('PEDIDO DE COMPRA - GOM', 20, 25);
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.text(`Data: ${order.date.split('-').reverse().join('/')} | ID: ${order.id.split('-')[0]}`, 20, 33);

    // Order Info
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    doc.text(`Status: ${order.status}`, 20, 50);
    
    // Items Table
    const tableData = order.items.map((item: any) => [
      item.product_name,
      item.quantity,
      item.unit || 'UN'
    ]);

    autoTable(doc, {
      startY: 60,
      head: [['Produto', 'Quantidade', 'Unidade']],
      body: tableData,
      headStyles: { fillColor: [79, 70, 229] },
      theme: 'grid'
    });

    doc.save(`pedido_compra_${order.date}.pdf`);
  };

  return (
    <div>
      <div className="view-header">
        <div className="view-title">
          <h1>Pedidos de Compra</h1>
          <p>Gestão de demandas e ordens de fornecimento.</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button 
            className={`button ${activeView === 'create' ? '' : 'button-outline'}`}
            onClick={() => setActiveView('create')}
          >
            <Plus size={18} style={{ marginRight: '0.5rem' }} />
            Gerar Novo
          </button>
          <button 
            className={`button ${activeView === 'history' ? '' : 'button-outline'}`}
            onClick={() => setActiveView('history')}
          >
            <History size={18} style={{ marginRight: '0.5rem' }} />
            Histórico ({orders.length})
          </button>
        </div>
      </div>

      {activeView === 'create' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
          {/* Selection Area */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ListChecks size={20} /> 1. Selecione os Romaneios
              </h3>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <select 
                  className="input-field" 
                  style={{ width: '180px', padding: '0.2rem 0.5rem', height: '32px', fontSize: '0.85rem' }}
                  value={selectedDeposit}
                  onChange={e => { setSelectedDeposit(e.target.value as any); setSelectedSlips([]); }}
                >
                  <option value="Depósito-Grupo OM">Depósito-Grupo OM</option>
                  <option value="Depósito-RED">Depósito-RED</option>
                </select>
                <span className="badge badge-blue">{selectedSlips.length} selecionados</span>
              </div>
            </div>
            
            <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
              <table className="data-table" style={{ fontSize: '0.9rem' }}>
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>
                      <input 
                        type="checkbox" 
                        checked={selectedSlips.length === filteredSlips.length && filteredSlips.length > 0} 
                        onChange={toggleSelectAll}
                        style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                        title="Selecionar Tudo"
                      />
                    </th>
                    <th>Data</th>
                    <th>Produto</th>
                    <th>QTD</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSlips.map((s) => (
                    <tr 
                      key={s.id} 
                      onClick={() => toggleSlip(s.id)}
                      style={{ cursor: 'pointer', background: selectedSlips.includes(s.id) ? 'rgba(79, 70, 229, 0.1)' : 'transparent' }}
                    >
                      <td>
                        <input 
                          type="checkbox" 
                          checked={selectedSlips.includes(s.id)} 
                          onChange={() => {}} 
                          style={{ width: '18px', height: '18px' }}
                        />
                      </td>
                      <td>{s.date.split('-').reverse().join('/')}</td>
                      <td style={{ fontWeight: 600 }}>{s.products?.name}</td>
                      <td style={{ fontWeight: 700 }}>{s.quantity}</td>
                    </tr>
                  ))}
                  {filteredSlips.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: '2rem' }}>Nenhum romaneio pendente neste depósito.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Results Area */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ShoppingCart size={20} /> 2. Sugestão de Compra
              </h3>
              <button 
                className="button" 
                onClick={createOrder} 
                disabled={suggestions.length === 0}
                style={{ opacity: suggestions.length === 0 ? 0.5 : 1 }}
              >
                Salvar Pedido
              </button>
            </div>

            {loading ? (
              <p>Analisando dados...</p>
            ) : selectedSlips.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                <ListChecks size={48} style={{ margin: '0 auto 1rem', display: 'block', opacity: 0.2 }} />
                <p>Selecione romaneios à esquerda para calcular a necessidade de compra.</p>
              </div>
            ) : suggestions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                <CheckCircle size={48} style={{ margin: '0 auto 1rem', display: 'block', color: 'var(--green)' }} />
                <p>Estoque suficiente! O saldo atual cobre todos os romaneios selecionados.</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Estoque Atual</th>
                      <th>Demanda (Romaneios)</th>
                      <th>Saldo Projetado</th>
                      <th>Falta (A Comprar)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suggestions.map((s) => (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 600 }}>{s.name}</td>
                        <td>{s.quantity}</td>
                        <td>{s.neededQty}</td>
                        <td style={{ color: '#f87171', fontWeight: 600 }}>{s.balance}</td>
                        <td style={{ fontWeight: 800, color: '#f87171' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <ArrowRight size={14} /> {s.suggestedQty}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: '1.5rem' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Status</th>
                <th>Itens</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{o.date.split('-').reverse().join('/')}</td>
                  <td>
                    <span className={`badge ${o.status === 'EFETIVADO' ? 'badge-green' : 'badge-yellow'}`}>
                      {o.status}
                    </span>
                  </td>
                  <td>{o.items.length} itens</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button 
                        className="button" 
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem', backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)' }}
                        onClick={() => generatePDF(o)}
                        title="Gerar PDF"
                      >
                        <FileText size={14} />
                      </button>
                      
                      {o.status === 'PENDENTE' && (
                        <button 
                          className="button" 
                          style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem', backgroundColor: '#10b981', border: 'none' }}
                          onClick={() => confirmPurchase(o)}
                          title="Efetivar Compra"
                        >
                          <CheckCircle size={14} /> Efetivar
                        </button>
                      )}

                      <button 
                        className="button" 
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem', backgroundColor: '#ef4444', border: 'none' }}
                        onClick={() => deleteOrder(o.id)}
                        title="Excluir Pedido"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: '2rem' }}>Nenhum pedido encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default PurchaseOrders;
