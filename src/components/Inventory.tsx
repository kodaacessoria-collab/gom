import React, { useState, useEffect } from 'react';
import { Plus, Search, X, Trash2, Edit3, Save, Layers } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { saveLog } from '../lib/logger';
import type { Product, Category, Deposit, Role } from '../types';

interface InventoryProps {
  userRole?: Role | null;
}

const Inventory: React.FC<InventoryProps> = ({ userRole }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedDeposit, setSelectedDeposit] = useState<Deposit | 'SELECIONE'>(
    userRole === 'red' ? 'Depósito-RED' : 'Depósito-Grupo OM'
  );

  useEffect(() => {
    if (userRole === 'red') {
      setSelectedDeposit('Depósito-RED');
    } else if (userRole === 'om') {
      setSelectedDeposit('Depósito-Grupo OM');
    }
  }, [userRole]);
  const [selectedCategory, setSelectedCategory] = useState<Category | 'TODAS'>('TODAS');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [bulkData, setBulkData] = useState<Record<string, { qty: number, type: 'ENTRADA' | 'SAIDA' }>>({});
  const [formData, setFormData] = useState<Partial<Product>>({
    name: '',
    category: 'Estocáveis',
    unit: '',
    brand: '',
    batch: '',
    quantity: 0,
    min_stock: 0,
    deposit: 'Depósito-Grupo OM',
  });

  useEffect(() => {
    fetchProducts();
  }, []);



  const fetchProducts = async () => {
    setLoading(true);
    const { data } = await supabase.from('products').select('*').order('name');
    if (data) setProducts(data);
    setLoading(false);
  };

  const openEditModal = (p: Product) => {
    setFormData(p);
    setIsEditing(true);
    setIsModalOpen(true);
  };

  const deleteProduct = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este produto? Todos os romaneios vinculados também serão apagados.')) return;
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) alert(error.message);
    else {
      saveLog('EXCLUIR', 'PRODUTO', `Produto removido ID: ${id}`);
      fetchProducts();
    }
  };



  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Explicitly define fields to avoid sending internal Supabase fields or joined data
    const dataToSave = {
      name: formData.name,
      category: formData.category,
      unit: formData.unit,
      brand: formData.brand,
      batch: formData.batch,
      expiry_date: formData.expiry_date,
      quantity: formData.quantity,
      min_stock: formData.min_stock,
      deposit: formData.deposit
    };
    
    const id = formData.id;
    
    if (isEditing && id) {
      const { error } = await supabase.from('products').update(dataToSave).eq('id', id);
      if (error) {
        console.error('Erro ao editar produto:', error);
        alert('Erro ao editar produto: ' + error.message);
      } else {
        saveLog('EDITAR', 'PRODUTO', `Produto editado: ${dataToSave.name}`);
        setIsModalOpen(false);
        setIsEditing(false);
        fetchProducts();
      }
    } else {
      const { error } = await supabase.from('products').insert([dataToSave]);
      if (error) {
        console.error('Erro ao cadastrar produto:', error);
        alert('Erro ao cadastrar produto: ' + error.message);
      } else {
        saveLog('CRIAR', 'PRODUTO', `Novo produto cadastrado: ${dataToSave.name}`);
        setIsModalOpen(false);
        fetchProducts();
      }
    }
  };

  const handleBulkSubmit = async () => {
    const slips = Object.entries(bulkData)
      .filter(([_, data]) => data.qty > 0)
      .map(([id, data]) => {
        const p = products.find(prod => prod.id === id);
        return {
          product_id: id,
          quantity: data.qty,
          type: data.type,
          date: new Date().toISOString().split('T')[0],
          category: p?.category || 'Estocáveis',
          unit: p?.unit || 'UN',
          destination: 'Lançamento em Massa'
        };
      });

    if (slips.length === 0) return;

    const { error } = await supabase.from('slips').insert(slips);
    if (error) alert(error.message);
    else {
      alert('Lançamentos realizados com sucesso!');
      setIsBulkOpen(false);
      setBulkData({});
      fetchProducts();
    }
  };

  const filteredProducts = products.filter(p => {
    if (selectedDeposit === 'SELECIONE') return false;
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.category.toLowerCase().includes(search.toLowerCase());
    const matchDeposit = p.deposit === selectedDeposit;
    const matchCategory = selectedCategory === 'TODAS' || p.category === selectedCategory;
    return matchSearch && matchDeposit && matchCategory;
  });

  return (
    <div>
      <div className="view-header">
        <div className="view-title">
          <h1>ESTOQUE</h1>
          <p>Gerencie seus produtos, marcas e quantidades.</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button className="button" style={{ backgroundColor: '#4f46e5', border: 'none' }} onClick={() => setIsBulkOpen(true)}>
            <Layers size={18} style={{ marginRight: '0.5rem' }} />
            Lançar em Massa
          </button>
          <button className="button" onClick={() => { setFormData({ category: 'Estocáveis', unit: 'UN', quantity: 0, min_stock: 10, deposit: 'Depósito-Grupo OM' }); setIsEditing(false); setIsModalOpen(true); }}>
            <Plus size={18} style={{ marginRight: '0.5rem' }} />
            Novo Produto
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: '1rem', marginBottom: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '250px' }}>
          <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input 
            type="text" 
            placeholder="Buscar por produto..." 
            className="input" 
            style={{ paddingLeft: '3rem', width: '100%', height: '44px', borderRadius: '0.5rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div style={{ width: '200px', minWidth: '150px' }}>
          <select 
            className="input-field" 
            style={{ height: '44px' }}
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value as Category | 'TODAS')}
          >
            <option value="TODAS">Todas as Categorias</option>
            <option value="Estocáveis">Estocáveis</option>
            <option value="DIETA">DIETA</option>
            <option value="LIMPEZA">LIMPEZA</option>
            <option value="PAPELARIA">PAPELARIA</option>
          </select>
        </div>
        <div style={{ width: '250px', minWidth: '200px' }}>
          <select 
            className="input-field" 
            style={{ height: '44px' }}
            value={selectedDeposit}
            onChange={(e) => setSelectedDeposit(e.target.value as Deposit | 'SELECIONE')}
          >
            <option value="SELECIONE">Selecione um Depósito...</option>
            <option value="Depósito-Grupo OM">Depósito-Grupo OM</option>
            <option value="Depósito-RED">Depósito-RED</option>
          </select>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Categoria</th>
              <th>UND</th>
              <th>Marca</th>
              <th>Lote</th>
              <th>Vencimento</th>
              <th>QTD</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {selectedDeposit === 'SELECIONE' ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '2rem' }}>Selecione um depósito para visualizar os produtos.</td></tr>
            ) : loading ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '2rem' }}>Carregando...</td></tr>
            ) : filteredProducts.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Nenhum produto encontrado neste depósito.</td></tr>
            ) : filteredProducts.map((p) => (
              <tr key={p.id}>
                <td style={{ fontWeight: 600 }}>{p.name}</td>
                <td><span className={`badge badge-blue`}>{p.category}</span></td>
                <td>{p.unit}</td>
                <td>{p.brand}</td>
                <td>{p.batch}</td>
                <td>{p.expiry_date ? p.expiry_date.split('-').reverse().join('/') : '-'}</td>
                <td style={{ fontWeight: 700 }}>{p.quantity}</td>
                <td>
                  {p.quantity <= p.min_stock ? (
                    <span className="badge badge-red">Crítico</span>
                  ) : (
                    <span className="badge badge-green">OK</span>
                  )}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={() => openEditModal(p)} style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', padding: '0.5rem' }} title="Editar">
                      <Edit3 size={18} />
                    </button>
                    <button onClick={() => deleteProduct(p.id)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '0.5rem' }} title="Excluir">
                      <Trash2 size={18} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="modal-overlay" style={{ display: 'flex', justifyContent: 'center', paddingTop: '10vh', overflowY: 'auto' }}>
          <div className="card" style={{ width: '100%', maxWidth: '600px', position: 'relative', margin: '0 auto', height: 'fit-content' }}>
            <div className="view-header">
              <h2>{isEditing ? 'Editar Produto' : 'Novo Produto'}</h2>
              <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}><X size={24} /></button>
            </div>
            <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ gridColumn: 'span 2' }}>
                <label>Nome do Produto</label>
                <input className="input-field" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
              </div>
              <div>
                <label>Categoria</label>
                <select className="input-field" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value as Category})}>
                  <option value="Estocáveis">Estocáveis</option>
                  <option value="DIETA">DIETA</option>
                  <option value="LIMPEZA">LIMPEZA</option>
                  <option value="PAPELARIA">PAPELARIA</option>
                </select>
              </div>
              <div>
                <label>Unidade (UND)</label>
                <input className="input-field" required value={formData.unit} onChange={e => setFormData({...formData, unit: e.target.value})} />
              </div>
              <div>
                <label>Marca</label>
                <input className="input-field" value={formData.brand} onChange={e => setFormData({...formData, brand: e.target.value})} />
              </div>
              <div>
                <label>Lote</label>
                <input className="input-field" value={formData.batch} onChange={e => setFormData({...formData, batch: e.target.value})} />
              </div>
              <div>
                <label>Vencimento</label>
                <input type="date" className="input-field" value={formData.expiry_date || ''} onChange={e => setFormData({...formData, expiry_date: e.target.value})} />
              </div>
              <div>
                <label>Estoque Mínimo</label>
                <input type="number" className="input-field" value={formData.min_stock} onChange={e => setFormData({...formData, min_stock: Number(e.target.value)})} />
              </div>
              <div>
                <label>Depósito</label>
                <select className="input-field" value={formData.deposit || 'Depósito-Grupo OM'} onChange={e => setFormData({...formData, deposit: e.target.value as Deposit})}>
                  <option value="Depósito-Grupo OM">Depósito-Grupo OM</option>
                  <option value="Depósito-RED">Depósito-RED</option>
                </select>
              </div>
              <div style={{ gridColumn: 'span 2', marginTop: '1rem' }}>
                <button type="submit" className="button">{isEditing ? 'Salvar Alterações' : 'Salvar Produto'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isBulkOpen && (
        <div className="modal-overlay">
          <div className="card" style={{ width: '100%', maxWidth: '850px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="view-header" style={{ marginBottom: '1.5rem' }}>
              <div>
                <h2>Lançamento em Massa</h2>
                <p style={{ fontSize: '0.9rem', opacity: 0.7 }}>Ajuste o estoque de vários itens simultaneamente.</p>
              </div>
              <button onClick={() => setIsBulkOpen(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}><X size={24} /></button>
            </div>
            
            <div style={{ overflowX: 'auto', width: '100%', borderRadius: '0.5rem', border: '1px solid var(--border)' }}>
              <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', border: 'none' }}>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Marca</th>
                    <th>Saldo Real</th>
                    <th>Tipo</th>
                    <th>Quantidade</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td>{p.brand || '-'}</td>
                      <td style={{ fontWeight: 700 }}>{p.quantity}</td>
                      <td>
                         <select 
                          className="input-field" 
                          style={{ padding: '0.4rem', height: 'auto', minWidth: '130px' }}
                          value={bulkData[p.id]?.type || 'ENTRADA'}
                          onChange={e => setBulkData({...bulkData, [p.id]: { ...bulkData[p.id], type: e.target.value as any, qty: bulkData[p.id]?.qty || 0 }})}
                        >
                          <option value="ENTRADA">ENTRADA (+)</option>
                          <option value="SAIDA">SAÍDA (-)</option>
                        </select>
                      </td>
                      <td>
                        <input 
                          type="number" 
                          className="input-field" 
                          style={{ padding: '0.4rem', height: 'auto', width: '90px' }}
                          placeholder="0"
                          value={bulkData[p.id]?.qty || ''}
                          onChange={e => setBulkData({...bulkData, [p.id]: { ...bulkData[p.id], qty: Number(e.target.value), type: bulkData[p.id]?.type || 'ENTRADA' }})}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
              <button className="button button-outline" onClick={() => setIsBulkOpen(false)} style={{ flex: '1 1 auto', minWidth: '120px' }}>Cancelar</button>
              <button className="button" onClick={handleBulkSubmit} style={{ flex: '1 1 auto', minWidth: '220px' }}>
                <Save size={18} style={{ marginRight: '0.5rem' }} />
                Confirmar Todos os Lançamentos
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Inventory;
