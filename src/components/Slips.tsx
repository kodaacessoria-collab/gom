import React, { useState, useEffect } from 'react';
import { Plus, Upload, X, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { saveLog } from '../lib/logger';
import type { Product, Slip } from '../types';
import * as XLSX from 'xlsx';

const Slips: React.FC = () => {
  const [slips, setSlips] = useState<any[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDeposit, setSelectedDeposit] = useState<'TODOS' | 'Depósito-Grupo OM' | 'Depósito-RED'>('TODOS');
  const [formDeposit, setFormDeposit] = useState<'Depósito-Grupo OM' | 'Depósito-RED'>('Depósito-Grupo OM');
  const [formData, setFormData] = useState<Partial<Slip>>({
    date: new Date().toISOString().split('T')[0],
    category: 'Estocáveis',
    type: 'SAIDA',
    quantity: 0,
    destination: '',
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: slipsData } = await supabase.from('slips').select('*, products(name, deposit)').order('created_at', { ascending: false });
    const { data: productsData } = await supabase.from('products').select('*');
    if (slipsData) setSlips(slipsData);
    if (productsData) setProducts(productsData);
    setLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from('slips').insert([formData]);
    if (error) alert(error.message);
    else {
      saveLog('CRIAR', 'ROMANEIO', `${formData.type} de ${formData.quantity} unidades para ${formData.destination}`);
      setIsModalOpen(false);
      fetchData();
    }
  };

  const deleteSlip = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este lançamento? O estoque será ajustado automaticamente.')) return;
    
    try {
      // Busca o romaneio antes de excluir para devolver o saldo ao produto.
      const { data: slip, error: fetchSlipError } = await supabase
        .from('slips')
        .select('*')
        .eq('id', id)
        .single();
      
      if (fetchSlipError) throw fetchSlipError;
      if (!slip) throw new Error('Lançamento não encontrado.');

      const { data: product, error: fetchProductError } = await supabase
        .from('products')
        .select('quantity')
        .eq('id', slip.product_id)
        .single();

      if (fetchProductError) throw fetchProductError;
      if (product) {
        const currentQty = Number(product.quantity || 0);
        const slipQty = Number(slip.quantity || 0);
        const revertedQty = slip.type === 'ENTRADA' ? (currentQty - slipQty) : (currentQty + slipQty);

        const { error: updateProductError } = await supabase
          .from('products')
          .update({ quantity: revertedQty })
          .eq('id', slip.product_id);

        if (updateProductError) throw updateProductError;
      }

      const { error: deleteError } = await supabase.from('slips').delete().eq('id', id);
      if (deleteError) throw deleteError;

      saveLog('EXCLUIR', 'ROMANEIO', `${slip.type} de ${slip.quantity} unidades removida. ID: ${id}`);
      fetchData();
    } catch (err: any) {
      alert('Erro ao excluir lançamento e atualizar estoque: ' + err.message);
    }
  };

  const deleteLastSlip = async () => {
    if (slips.length === 0) {
      alert('Nenhum lançamento de romaneio encontrado.');
      return;
    }
    
    // Find the latest slip. Since they are fetched with .order('created_at', { ascending: false }),
    // the first item slips[0] is the latest one.
    const latestSlip = slips[0];
    
    const productName = latestSlip.products?.name || 'Produto';
    const slipType = latestSlip.type;
    const qty = latestSlip.quantity;
    
    if (!confirm(`Tem certeza que deseja excluir o ÚLTIMO lançamento?\n\nProduto: ${productName}\nTipo: ${slipType}\nQuantidade: ${qty}\n\nO estoque anterior será restaurado automaticamente.`)) {
      return;
    }
    
    await deleteSlip(latestSlip.id);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(ws);

      // Helper to extract deposit from an item
      const extractDeposit = (item: any) => {
        const keys = Object.keys(item);
        const depKey = keys.find(k => ['DEPOSITO', 'DEPÓSITO', 'DEPOSIT', 'ALMOXARIFADO'].includes(k.toUpperCase().trim()));
        const rawDep = depKey ? item[depKey]?.toString().trim() : '';
        if (rawDep && rawDep.toUpperCase().includes('RED')) {
          return 'Depósito-RED';
        }
        return 'Depósito-Grupo OM'; // default fallback
      };

      // 1. Identify missing products (by name and deposit combination) and create them
      const missingProducts: { name: string; deposit: 'Depósito-Grupo OM' | 'Depósito-RED' }[] = [];
      rawData.forEach((item: any) => {
        const keys = Object.keys(item);
        const nameKey = keys.find(k => ['PRODUTO', 'NOME', 'PRODUCT', 'ITEM'].includes(k.toUpperCase().trim()));
        const productName = nameKey ? item[nameKey]?.toString().trim() : null;
        const targetDeposit = extractDeposit(item);
        
        if (productName) {
          const exists = products.find(p => 
            p.name.toLowerCase() === productName.toLowerCase() && 
            p.deposit === targetDeposit
          );
          if (!exists) {
            const alreadyInMissing = missingProducts.find(mp => 
              mp.name.toLowerCase() === productName.toLowerCase() && 
              mp.deposit === targetDeposit
            );
            if (!alreadyInMissing) {
              missingProducts.push({ name: productName, deposit: targetDeposit });
            }
          }
        }
      });

      let currentProducts: Product[];
      if (missingProducts.length > 0) {
        const { error: pError } = await supabase.from('products').insert(
          missingProducts.map(mp => ({
            name: mp.name,
            category: 'Estocáveis',
            unit: 'UN',
            quantity: 0,
            min_stock: 10,
            deposit: mp.deposit
          }))
        );
        if (pError) {
          alert('Erro ao criar novos produtos: ' + pError.message);
          return;
        }
        // Refetch products to get their IDs
        const { data: updatedProducts } = await supabase.from('products').select('*');
        if (updatedProducts) setProducts(updatedProducts);
        // Use the updated list for the next step
        currentProducts = updatedProducts || products;
      } else {
        currentProducts = products;
      }

      // 2. Prepare slips for insertion
      const slipsToInsert = rawData
        .map((item: any) => {
          const keys = Object.keys(item);
          const findValue = (possibleNames: string[]) => {
            const key = keys.find(k => possibleNames.includes(k.toUpperCase().trim()));
            return key ? item[key] : null;
          };

          const productName = (findValue(['PRODUTO', 'NOME', 'PRODUCT', 'ITEM']) || '').toString().trim();
          const targetDeposit = extractDeposit(item);
          const product = currentProducts.find(p => 
            p.name.toLowerCase() === productName.toLowerCase() && 
            p.deposit === targetDeposit
          );
          
          if (!productName || !product) return null;

          let slipDate = findValue(['DATA', 'DATE']);
          if (typeof slipDate === 'number') {
            const date = new Date((slipDate - 25569) * 86400 * 1000);
            slipDate = date.toISOString().split('T')[0];
          } else if (!slipDate) {
            slipDate = new Date().toISOString().split('T')[0];
          }

          return {
            date: slipDate,
            category: findValue(['CATEGORIA', 'CATEGORY']) || product.category || 'Estocáveis',
            product_id: product.id,
            unit: findValue(['UND', 'UNIDADE', 'UNIT']) || product.unit || 'UN',
            quantity: Number(findValue(['QTD', 'QUANTIDADE', 'AMOUNT']) || 0),
            destination: findValue(['DESTINO', 'DESTINATION', 'ORIGEM']) || '',
            type: (() => {
              const val = (findValue(['TIPO', 'TYPE']) || 'SAIDA').toString().toUpperCase().trim();
              if (['E', 'ENT', 'ENTRADA', 'IN'].includes(val)) return 'ENTRADA';
              if (['S', 'SAI', 'SAIDA', 'SAÍDA', 'OUT'].includes(val)) return 'SAIDA';
              return 'SAIDA'; // Default fallback
            })(),
          };
        })
        .filter(s => s !== null);

      if (slipsToInsert.length === 0) {
        alert('Nenhum dado válido encontrado no arquivo.');
        return;
      }

      const { error } = await supabase.from('slips').insert(slipsToInsert);
      if (error) alert('Erro ao importar romaneios: ' + error.message);
      else {
        saveLog('IMPORTAR_XLSX', 'ROMANEIO', `Importação de ${slipsToInsert.length} romaneios via Excel`);
        fetchData();
      }
    };
    reader.readAsBinaryString(file);
  };

  const clearAllSlips = async () => {
    if (!confirm('ATENÇÃO: Isso apagará TODO o histórico de romaneios. O estoque será recalculado com base nos produtos restantes. Deseja continuar?')) return;
    const { error } = await supabase.from('slips').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) alert(error.message);
    else {
      saveLog('LIMPAR_TUDO', 'ROMANEIO', 'Todo o histórico de romaneios foi apagado');
      fetchData();
    }
  };

  const filteredSlips = slips.filter(s => {
    if (selectedDeposit === 'TODOS') return true;
    return s.products?.deposit === selectedDeposit;
  });

  return (
    <div>
      <div className="view-header">
        <div className="view-title">
          <h1>Romaneios</h1>
          <p>Lançamento de entradas e saídas de mercadorias.</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <select 
            className="input-field" 
            style={{ width: '220px', height: '42px' }}
            value={selectedDeposit}
            onChange={(e) => setSelectedDeposit(e.target.value as any)}
          >
            <option value="TODOS">Todos os Depósitos</option>
            <option value="Depósito-Grupo OM">Depósito-Grupo OM</option>
            <option value="Depósito-RED">Depósito-RED</option>
          </select>

          <button className="button" style={{ backgroundColor: '#f97316', border: 'none' }} onClick={deleteLastSlip}>
            <Trash2 size={18} style={{ marginRight: '0.5rem' }} />
            Excluir Último
          </button>

          <button className="button" style={{ backgroundColor: '#ef4444', border: 'none' }} onClick={clearAllSlips}>
            <Trash2 size={18} style={{ marginRight: '0.5rem' }} />
            Limpar Tudo
          </button>
          <a href="/Modelo_Importacao_GOM.xlsx" download className="button" style={{ textDecoration: 'none', backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
            <Upload size={18} style={{ marginRight: '0.5rem', transform: 'rotate(180deg)' }} />
            Baixar Modelo
          </a>
          <label className="button" style={{ cursor: 'pointer', backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)' }}>
            <Upload size={18} style={{ marginRight: '0.5rem' }} />
            Importar Romaneio
            <input type="file" hidden onChange={handleImport} accept=".xlsx, .xls" />
          </label>
          <button className="button" onClick={() => { setFormData({ date: new Date().toISOString().split('T')[0], category: 'Estocáveis', type: 'SAIDA', quantity: 0, destination: '' }); setIsModalOpen(true); }}>
            <Plus size={18} style={{ marginRight: '0.5rem' }} />
            Novo Lançamento
          </button>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Produto</th>
              <th>Depósito</th>
              <th>Categoria</th>
              <th>QTD</th>
              <th>Destino</th>
              <th>Tipo</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>Carregando...</td></tr>
            ) : filteredSlips.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>Nenhum romaneio encontrado.</td></tr>
            ) : filteredSlips.map((s: any) => (
              <tr key={s.id}>
                <td>{s.date.split('-').reverse().join('/')}</td>
                <td style={{ fontWeight: 600 }}>{s.products?.name || 'Produto Removido'}</td>
                <td><span className="badge">{s.products?.deposit || '-'}</span></td>
                <td><span className="badge badge-blue">{s.category}</span></td>
                <td style={{ fontWeight: 700 }}>{s.quantity}</td>
                <td>{s.destination}</td>
                <td>
                  <span className={`badge ${s.type === 'ENTRADA' ? 'badge-green' : 'badge-yellow'}`}>
                    {s.type}
                  </span>
                </td>
                <td>
                  <button 
                    onClick={() => deleteSlip(s.id)} 
                    style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '0.5rem' }}
                    title="Excluir Lançamento"
                  >
                    <Trash2 size={18} />
                  </button>
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
              <h2>Novo Lançamento</h2>
              <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}><X size={24} /></button>
            </div>
            <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label>Data</label>
                <input type="date" className="input-field" required value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} />
              </div>
              <div>
                <label>Tipo</label>
                <select className="input-field" value={formData.type} onChange={e => setFormData({...formData, type: e.target.value as any})}>
                  <option value="ENTRADA">ENTRADA</option>
                  <option value="SAIDA">SAIDA</option>
                </select>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label>Depósito do Produto</label>
                <select className="input-field" value={formDeposit} onChange={e => { setFormDeposit(e.target.value as any); setFormData({...formData, product_id: ''}); }}>
                  <option value="Depósito-Grupo OM">Depósito-Grupo OM</option>
                  <option value="Depósito-RED">Depósito-RED</option>
                </select>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label>Produto</label>
                <select className="input-field" required value={formData.product_id || ''} onChange={e => {
                  const p = products.find(x => x.id === e.target.value);
                  setFormData({...formData, product_id: e.target.value, category: p?.category, unit: p?.unit});
                }}>
                  <option value="">Selecione um produto...</option>
                  {products.filter(p => p.deposit === formDeposit).map(p => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
                </select>
              </div>
              <div>
                <label>Quantidade</label>
                <input type="number" className="input-field" required value={formData.quantity} onChange={e => setFormData({...formData, quantity: Number(e.target.value)})} />
              </div>
              <div>
                <label>Destino/Origem</label>
                <input className="input-field" required value={formData.destination} onChange={e => setFormData({...formData, destination: e.target.value})} />
              </div>
              <div style={{ gridColumn: 'span 2', marginTop: '1rem' }}>
                <button type="submit" className="button">Confirmar Lançamento</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Slips;
