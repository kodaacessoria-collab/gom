import React, { useState, useEffect } from 'react';
import { Plus, Upload, Search, X, Trash2, Edit3, Save, Layers } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { saveLog } from '../lib/logger';
import type { Product, Category } from '../types';
import * as XLSX from 'xlsx';

const Inventory: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
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

  const clearInventory = async () => {
    if (!confirm('ATENÇÃO: Isso apagará TODOS os produtos e romaneios do sistema. Deseja continuar?')) return;
    const { error } = await supabase.from('products').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) alert(error.message);
    else {
      saveLog('LIMPAR_TUDO', 'ESTOQUE', 'Banco de dados de produtos zerado');
      fetchProducts();
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws);

      const parseDate = (val: any) => {
        if (!val) return null;
        if (typeof val === 'number') {
          const date = new Date(Math.round((val - 25569) * 86400 * 1000));
          return date.toISOString().split('T')[0];
        }
        return val.toString();
      };

      const parseNumber = (val: any) => {
        if (val === null || val === undefined || val === '') return 0;
        if (typeof val === 'number') return val;
        const cleaned = val.toString().replace(/\./g, '').replace(',', '.');
        return parseFloat(cleaned) || 0;
      };

      // Aggregate products by Name + Brand + Unit
      const aggregated: Record<string, any> = {};

      data.forEach((item: any) => {
        const keys = Object.keys(item);
        const findValue = (possibleNames: string[]) => {
          const key = keys.find(k => possibleNames.includes(k.toUpperCase().trim()));
          return key ? item[key] : null;
        };

        const name = findValue(['PRODUTO', 'NOME', 'PRODUCT', 'ITEM']);
        if (!name) return;

        const pName = name.toString().trim();
        const pBrand = findValue(['MARCA', 'BRAND', 'FABRICANTE']) || '';
        const pUnit = findValue(['UND', 'UNIDADE', 'UNIT', 'MEDIDA']) || 'UN';
        const key = `${pName}|${pBrand}|${pUnit}`.toUpperCase();

        const qty = parseNumber(findValue(['QTD', 'QUANTIDADE', 'STOCK', 'ESTOQUE']));

        const rawCat = findValue(['CATEGORIA', 'CATEGORY', 'TIPO']) || 'Estocáveis';
        const pCategory = rawCat.toString().trim() === 'Estabeláveis' ? 'Estocáveis' : rawCat;

        if (aggregated[key]) {
          aggregated[key].quantity += qty;
        } else {
          aggregated[key] = {
            name: pName,
            brand: pBrand,
            unit: pUnit,
            category: pCategory,
            batch: findValue(['LOTE', 'BATCH'])?.toString() || '',
            expiry_date: parseDate(findValue(['VENCIMENTO', 'EXPIRY', 'EXPIRY_DATE', 'VALIDADE'])),
            quantity: qty,
            min_stock: parseNumber(findValue(['MINIMO', 'MIN', 'ESTOQUE MINIMO', 'MIN_STOCK'])) || 10,
          };
        }
      });

      const productsToInsert = Object.values(aggregated);

      if (productsToInsert.length === 0) {
        alert('Nenhum produto válido encontrado no arquivo.');
        return;
      }

      // To handle existing products, we'll try to match and update or just insert
      // For now, if "Limpar Tudo" wasn't used, this will create duplicates. 
      // But it SOLVES the "splitting" issue within the Excel itself.
      const { error } = await supabase.from('products').insert(productsToInsert);
      if (error) alert('Erro ao importar: ' + error.message);
      else {
        saveLog('IMPORTAR_XLSX', 'ESTOQUE', `Importação de ${productsToInsert.length} itens via Excel`);
        fetchProducts();
      }
    };
    reader.readAsBinaryString(file);
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
      min_stock: formData.min_stock
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

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.category.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="view-header">
        <div className="view-title">
          <h1>Controle de Estoque</h1>
          <p>Gerencie seus produtos, marcas e quantidades.</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button className="button" style={{ backgroundColor: '#4f46e5', border: 'none' }} onClick={() => setIsBulkOpen(true)}>
            <Layers size={18} style={{ marginRight: '0.5rem' }} />
            Lançar em Massa
          </button>
          <button className="button" style={{ backgroundColor: '#ef4444', border: 'none' }} onClick={clearInventory}>
            <Trash2 size={18} style={{ marginRight: '0.5rem' }} />
            Limpar Tudo
          </button>
          <label className="button" style={{ cursor: 'pointer', backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)' }}>
            <Upload size={18} style={{ marginRight: '0.5rem' }} />
            Importar XLSX
            <input type="file" hidden onChange={handleImport} accept=".xlsx, .xls" />
          </label>
          <button className="button" onClick={() => { setFormData({ category: 'Estocáveis', unit: 'UN', quantity: 0, min_stock: 10 }); setIsEditing(false); setIsModalOpen(true); }}>
            <Plus size={18} style={{ marginRight: '0.5rem' }} />
            Novo Produto
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: '1rem', marginBottom: '2rem', display: 'flex', gap: '1rem' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input 
            type="text" 
            placeholder="Buscar por produto ou categoria..." 
            className="input" 
            style={{ paddingLeft: '3rem', width: '100%', height: '44px', borderRadius: '0.5rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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
            {loading ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '2rem' }}>Carregando...</td></tr>
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
        <div className="sidebar-overlay" style={{ alignItems: 'flex-start' }}>
          <div className="card" style={{ width: '100%', maxWidth: '600px', position: 'relative' }}>
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
              <div style={{ gridColumn: 'span 2', marginTop: '1rem' }}>
                <button type="submit" className="button">{isEditing ? 'Salvar Alterações' : 'Salvar Produto'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isBulkOpen && (
        <div className="sidebar-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: '100%', maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="view-header">
              <div>
                <h2>Lançamento em Massa</h2>
                <p style={{ fontSize: '0.9rem', opacity: 0.7 }}>Ajuste o estoque de vários itens simultaneamente.</p>
              </div>
              <button onClick={() => setIsBulkOpen(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}><X size={24} /></button>
            </div>
            
            <table className="data-table" style={{ marginTop: '1rem' }}>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Saldo Atual</th>
                  <th>Tipo</th>
                  <th>Quantidade</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.quantity}</td>
                    <td>
                      <select 
                        className="input-field" 
                        style={{ padding: '0.2rem', height: 'auto' }}
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
                        style={{ padding: '0.2rem', height: 'auto', width: '80px' }}
                        placeholder="0"
                        value={bulkData[p.id]?.qty || ''}
                        onChange={e => setBulkData({...bulkData, [p.id]: { ...bulkData[p.id], qty: Number(e.target.value), type: bulkData[p.id]?.type || 'ENTRADA' }})}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              <button className="button button-outline" onClick={() => setIsBulkOpen(false)}>Cancelar</button>
              <button className="button" onClick={handleBulkSubmit}>
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
