import React, { useState, useEffect, useRef } from 'react';
import { Plus, Search, X, Trash2, Edit3, Save, Layers, ArrowRight, ArrowDownCircle, AlertTriangle, PlusCircle, MinusCircle, FileInput, Upload, Link2 } from 'lucide-react';
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
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isEntradaOpen, setIsEntradaOpen] = useState(false);
  const [isBaixaOpen, setIsBaixaOpen] = useState(false);
  const [baixaProduct, setBaixaProduct] = useState<Product | null>(null);
  const [baixaForm, setBaixaForm] = useState({
    date: new Date().toISOString().split('T')[0],
    motivo: 'Produto Vencido' as 'Produto Vencido' | 'Avariado',
    batch: '',
    quantity: 0,
    observation: '',
  });
  const [bulkData, setBulkData] = useState<Record<string, { qty: number, type: 'ENTRADA' | 'SAIDA' }>>({});
  const [transferData, setTransferData] = useState<Record<string, number>>({});
  // Multi-lot state for Novo Produto
  interface LotRow { id: number; batch: string; expiry_date: string; quantity: number; }
  const newLotRow = (): LotRow => ({ id: Date.now() + Math.random(), batch: '', expiry_date: '', quantity: 0 });
  const [multiLots, setMultiLots] = useState<LotRow[]>([newLotRow()]);

  // Inserir Entrada — multi-lot
  interface EntradaLotRow { id: number; batch: string; expiry_date: string; brand: string; quantity: number; cost: string; }
  const newEntradaLot = (): EntradaLotRow => ({ id: Date.now() + Math.random(), batch: '', expiry_date: '', brand: '', quantity: 0, cost: '' });
  const [entradaLots, setEntradaLots] = useState<EntradaLotRow[]>([newEntradaLot()]);
  const [entradaDate, setEntradaDate] = useState(new Date().toISOString().split('T')[0]);
  const [entradaDeposit, setEntradaDeposit] = useState<Deposit>('Depósito-Grupo OM');
  const [entradaProductName, setEntradaProductName] = useState('');
  const [entradaCategory, setEntradaCategory] = useState<Category>('Estocáveis');
  const [entradaUnit, setEntradaUnit] = useState('');

  /* ─── NFe XML import state ─── */
  const [isNFeOpen, setIsNFeOpen] = useState(false);
  interface NFeItem {
    xProd: string;       // description from XML
    uCom: string;        // unit
    qCom: number;        // quantity
    vUnCom: number;      // unit price
    cProd: string;       // supplier product code
    selectedProductId: string;  // linked product id in our system
    createNew: boolean;  // create new product?
    newName: string;
    newBatch: string;
    newExpiry: string;
    newBrand: string;
  }
  const [nfeItems, setNfeItems] = useState<NFeItem[]>([]);
  const [nfeType, setNfeType] = useState<'ENTRADA' | 'SAIDA'>('ENTRADA');
  const [nfeInfo, setNfeInfo] = useState<{ nNF: string; dhEmi: string; xNome: string } | null>(null);
  const [nfeDeposit, setNfeDeposit] = useState<Deposit>('Depósito-Grupo OM');
  const [nfeDate, setNfeDate] = useState(new Date().toISOString().split('T')[0]);
  const [nfeSaving, setNfeSaving] = useState(false);
  const nfeFileRef = useRef<HTMLInputElement>(null);

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

    if (isEditing) {
      // --- EDIT mode: single product update (unchanged) ---
      const dataToSave = {
        name: formData.name,
        category: formData.category,
        unit: formData.unit,
        brand: formData.brand,
        batch: formData.batch,
        expiry_date: formData.expiry_date,
        quantity: formData.quantity,
        min_stock: formData.min_stock,
        deposit: formData.deposit,
      };
      const id = formData.id;
      const { error } = await supabase.from('products').update(dataToSave).eq('id', id!);
      if (error) {
        alert('Erro ao editar produto: ' + error.message);
      } else {
        saveLog('EDITAR', 'PRODUTO', `Produto editado: ${dataToSave.name}`);
        setIsModalOpen(false);
        setIsEditing(false);
        fetchProducts();
      }
      return;
    }

    // --- CREATE mode: multi-lot ---
    const validLots = multiLots.filter(l => l.batch.trim() && l.expiry_date && l.quantity > 0);
    if (validLots.length === 0) {
      alert('Adicione ao menos um lote com lote, validade e quantidade preenchidos.');
      return;
    }

    const productsToInsert = validLots.map(l => ({
      name: formData.name,
      category: formData.category,
      unit: formData.unit,
      brand: formData.brand || null,
      deposit: formData.deposit || 'Depósito-Grupo OM',
      min_stock: formData.min_stock || 0,
      batch: l.batch.trim(),
      expiry_date: l.expiry_date,
      quantity: l.quantity,
    }));

    const { error } = await supabase.from('products').insert(productsToInsert);
    if (error) {
      alert('Erro ao cadastrar produto(s): ' + error.message);
    } else {
      saveLog('CRIAR', 'PRODUTO', `${validLots.length} lote(s) de "${formData.name}" cadastrados`);
      setIsModalOpen(false);
      setMultiLots([newLotRow()]);
      fetchProducts();
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

  const handleTransfer = async () => {
    const itemsToTransfer = Object.entries(transferData)
      .filter(([_, qty]) => qty > 0)
      .map(([id, qty]) => {
        const p = products.find(prod => prod.id === id);
        return { product: p!, qty };
      });

    if (itemsToTransfer.length === 0) return;

    setLoading(true);

    try {
      const { data: redProducts } = await supabase.from('products').select('*').eq('deposit', 'Depósito-RED');
      const currentRedProducts = redProducts || [];

      const slipsToInsert = [];

      for (const item of itemsToTransfer) {
        const pOM = item.product;
        const qty = item.qty;

        if (pOM.quantity < qty) {
          alert(`Quantidade insuficiente de ${pOM.name} para transferência.`);
          setLoading(false);
          return;
        }

        let pRED = currentRedProducts.find(r => r.name.toLowerCase() === pOM.name.toLowerCase());

        if (!pRED) {
          const newProductData = {
            name: pOM.name,
            category: pOM.category,
            unit: pOM.unit,
            brand: pOM.brand,
            batch: pOM.batch,
            quantity: 0,
            min_stock: pOM.min_stock,
            deposit: 'Depósito-RED'
          };
          const { data: createdData, error: createError } = await supabase.from('products').insert([newProductData]).select().single();
          if (createError) throw createError;
          pRED = createdData;
        }

        slipsToInsert.push({
          date: new Date().toISOString().split('T')[0],
          category: pOM.category,
          product_id: pOM.id,
          unit: pOM.unit,
          quantity: qty,
          destination: 'Transf. para Depósito-RED',
          type: 'SAIDA'
        });

        slipsToInsert.push({
          date: new Date().toISOString().split('T')[0],
          category: pRED.category,
          product_id: pRED.id,
          unit: pRED.unit,
          quantity: qty,
          destination: 'Transf. de Depósito-Grupo OM',
          type: 'ENTRADA'
        });
      }

      const { error: slipsError } = await supabase.from('slips').insert(slipsToInsert);
      if (slipsError) throw slipsError;

      saveLog('TRANSFERIR', 'ESTOQUE', `Transferidos ${itemsToTransfer.length} produtos estocáveis de OM para RED`);
      alert('Transferência concluída com sucesso!');
      setIsTransferOpen(false);
      setTransferData({});
      fetchProducts();
    } catch (err: any) {
      console.error('Erro na transferência:', err);
      alert('Erro na transferência: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const openEntradaModal = (p: Product) => {
    // Pre-fill product info from clicked row
    setEntradaProductName(p.name);
    setEntradaCategory(p.category);
    setEntradaUnit(p.unit);
    setEntradaDeposit((p.deposit as Deposit) || 'Depósito-Grupo OM');
    setEntradaDate(new Date().toISOString().split('T')[0]);
    setEntradaLots([{ ...newEntradaLot(), batch: p.batch || '', brand: p.brand || '', expiry_date: p.expiry_date || '' }]);
    setIsEntradaOpen(true);
  };

  const handleEntradaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entradaProductName.trim()) {
      alert('Informe o nome do produto.');
      return;
    }
    const validLots = entradaLots.filter(l => l.batch.trim() && l.expiry_date && l.quantity > 0);
    if (validLots.length === 0) {
      alert('Adicione ao menos um lote com lote, validade e quantidade válidos.');
      return;
    }

    try {
      for (const lot of validLots) {
        // 1. Find existing product with same name + batch + deposit
        const { data: existing } = await supabase
          .from('products')
          .select('*')
          .eq('deposit', entradaDeposit)
          .ilike('name', entradaProductName.trim())
          .ilike('batch', lot.batch.trim())
          .maybeSingle();

        let productId: string;

        if (existing) {
          // Update brand/expiry if provided
          const updates: any = {};
          if (lot.brand) updates.brand = lot.brand;
          if (lot.expiry_date) updates.expiry_date = lot.expiry_date;
          if (Object.keys(updates).length > 0) {
            await supabase.from('products').update(updates).eq('id', existing.id);
          }
          productId = existing.id;
        } else {
          // Create new product record for this lot
          const { data: created, error: createErr } = await supabase
            .from('products')
            .insert([{
              name: entradaProductName.trim(),
              category: entradaCategory,
              unit: entradaUnit || 'UN',
              brand: lot.brand || null,
              batch: lot.batch.trim(),
              expiry_date: lot.expiry_date,
              quantity: 0,
              min_stock: 10,
              deposit: entradaDeposit,
            }])
            .select()
            .single();
          if (createErr) throw createErr;
          productId = created.id;
        }

        // 2. Insert ENTRADA slip
        const slipPayload = {
          product_id: productId,
          quantity: lot.quantity,
          type: 'ENTRADA',
          date: entradaDate,
          category: entradaCategory,
          unit: entradaUnit || 'UN',
          destination: `Entrada manual${lot.cost ? ` - Custo: R$${lot.cost}` : ''}`,
        };
        const { error: slipErr } = await supabase.from('slips').insert([slipPayload]);
        if (slipErr) throw slipErr;
      }

      saveLog('ENTRADA', 'ESTOQUE', `${validLots.length} lote(s) de entrada para "${entradaProductName}"`);
      setIsEntradaOpen(false);
      setEntradaLots([newEntradaLot()]);
      fetchProducts();
      alert(`Entrada de ${validLots.length} lote(s) de "${entradaProductName}" registrada com sucesso!`);
    } catch (err: any) {
      console.error('Erro ao registrar entrada:', err);
      alert('Erro ao registrar entrada: ' + err.message);
    }
  };

  const openBaixaModal = (p: Product) => {
    setBaixaProduct(p);
    setBaixaForm({
      date: new Date().toISOString().split('T')[0],
      motivo: 'Produto Vencido',
      batch: p.batch || '',
      quantity: 0,
      observation: '',
    });
    setIsBaixaOpen(true);
  };

  const handleBaixaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!baixaProduct) return;

    if (baixaForm.quantity <= 0) {
      alert('Quantidade deve ser maior que zero.');
      return;
    }
    if (baixaForm.quantity > baixaProduct.quantity) {
      alert(`Quantidade informada (${baixaForm.quantity}) é maior que o saldo atual (${baixaProduct.quantity}).`);
      return;
    }

    try {
      const destinationLabel = `Baixa - ${baixaForm.motivo}${baixaForm.observation ? ` | Obs: ${baixaForm.observation}` : ''}`;

      // 1. Insert SAIDA slip
      const slipPayload = {
        product_id: baixaProduct.id,
        quantity: baixaForm.quantity,
        type: 'SAIDA',
        date: baixaForm.date,
        category: baixaProduct.category,
        unit: baixaProduct.unit,
        destination: destinationLabel,
      };
      const { error: slipError } = await supabase.from('slips').insert([slipPayload]);
      if (slipError) throw slipError;

      saveLog('BAIXA', 'ESTOQUE', `Baixa de ${baixaForm.quantity} unidades de "${baixaProduct.name}" - Motivo: ${baixaForm.motivo}`);
      setIsBaixaOpen(false);
      setBaixaProduct(null);
      fetchProducts();
      alert(`Baixa de ${baixaForm.quantity} unidade(s) de "${baixaProduct.name}" registrada com sucesso!`);
    } catch (err: any) {
      console.error('Erro ao registrar baixa:', err);
      alert('Erro ao registrar baixa: ' + err.message);
    }
  };

  /* ─── Parse NFe XML ─── */
  const parseNFe = (xmlText: string) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');
    const ns = 'http://www.portalfiscal.inf.br/nfe';
    const getT = (parent: Element | Document, tag: string) =>
      parent.getElementsByTagNameNS(ns, tag)[0]?.textContent ||
      parent.getElementsByTagName(tag)[0]?.textContent || '';

    const ide = doc.getElementsByTagNameNS(ns, 'ide')[0] || doc.getElementsByTagName('ide')[0];
    const emit = doc.getElementsByTagNameNS(ns, 'emit')[0] || doc.getElementsByTagName('emit')[0];
    const nNF = ide ? getT(ide, 'nNF') : '';
    const dhEmi = ide ? (getT(ide, 'dhEmi') || getT(ide, 'dEmi')) : '';
    const xNome = emit ? getT(emit, 'xNome') : '';
    setNfeInfo({ nNF, dhEmi: dhEmi.split('T')[0], xNome });
    setNfeDate(dhEmi ? dhEmi.split('T')[0] : new Date().toISOString().split('T')[0]);

    const dets = Array.from(
      doc.getElementsByTagNameNS(ns, 'det').length > 0
        ? doc.getElementsByTagNameNS(ns, 'det')
        : doc.getElementsByTagName('det')
    );

    const items: NFeItem[] = dets.map((det) => {
      const prod = det.getElementsByTagNameNS(ns, 'prod')[0] || det.getElementsByTagName('prod')[0];
      return {
        cProd: prod ? getT(prod, 'cProd') : '',
        xProd: prod ? getT(prod, 'xProd') : '',
        uCom: prod ? getT(prod, 'uCom') : 'UN',
        qCom: parseFloat(prod ? getT(prod, 'qCom') : '0') || 0,
        vUnCom: parseFloat(prod ? getT(prod, 'vUnCom') : '0') || 0,
        selectedProductId: '',
        createNew: false,
        newName: prod ? getT(prod, 'xProd') : '',
        newBatch: '',
        newExpiry: '',
        newBrand: '',
      };
    });
    setNfeItems(items);
  };

  const handleNFeFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { if (ev.target?.result) parseNFe(ev.target.result as string); };
    reader.readAsText(file, 'ISO-8859-1');
  };

  const updateNfeItem = (idx: number, patch: Partial<NFeItem>) =>
    setNfeItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));

  const handleNFeSubmit = async () => {
    const validItems = nfeItems.filter(it => it.selectedProductId || (nfeType === 'ENTRADA' && it.createNew && it.newName.trim() && it.newBatch.trim() && it.newExpiry));
    if (validItems.length === 0) {
      alert('Vincule ao menos um item da NF a um produto válido.');
      return;
    }
    setNfeSaving(true);
    try {
      for (const item of nfeItems) {
        if (!item.selectedProductId && !item.createNew) continue;
        let productId = item.selectedProductId;

        if (nfeType === 'SAIDA') {
          if (!productId) continue;
          const prod = products.find(p => p.id === productId);
          if (!prod) continue;
          if (prod.quantity < item.qCom) {
            throw new Error(`Estoque insuficiente para "${prod.name}" (Necessário: ${item.qCom}, Disponível: ${prod.quantity}).`);
          }
          const { error: slipErr } = await supabase.from('slips').insert([{
            product_id: productId,
            quantity: item.qCom,
            type: 'SAIDA',
            date: nfeDate,
            category: prod.category || 'Estocáveis',
            unit: item.uCom || prod.unit || 'UN',
            destination: `Baixa NFe nº${nfeInfo?.nNF || '?'} - ${nfeInfo?.xNome || 'Cliente'}`,
          }]);
          if (slipErr) throw slipErr;
        } else {
          if (item.createNew) {
            // Try to find existing same name+batch
            const { data: existing } = await supabase
              .from('products').select('id').eq('deposit', nfeDeposit)
              .ilike('name', item.newName.trim()).ilike('batch', item.newBatch.trim()).maybeSingle();
            if (existing) {
              productId = existing.id;
              if (item.newBrand || item.newExpiry) {
                await supabase.from('products').update({ brand: item.newBrand || undefined, expiry_date: item.newExpiry || undefined }).eq('id', existing.id);
              }
            } else {
              const { data: created, error: cErr } = await supabase.from('products').insert([{
                name: item.newName.trim(),
                category: 'Estocáveis',
                unit: item.uCom || 'UN',
                brand: item.newBrand || null,
                batch: item.newBatch.trim(),
                expiry_date: item.newExpiry || null,
                quantity: 0,
                min_stock: 10,
                deposit: nfeDeposit,
              }]).select().single();
              if (cErr) throw cErr;
              productId = created.id;
            }
          }

          if (!productId) continue;
          const prod = products.find(p => p.id === productId);
          const { error: slipErr } = await supabase.from('slips').insert([{
            product_id: productId,
            quantity: item.qCom,
            type: 'ENTRADA',
            date: nfeDate,
            category: prod?.category || 'Estocáveis',
            unit: item.uCom || prod?.unit || 'UN',
            destination: `Entrada NFe nº${nfeInfo?.nNF || '?'} - ${nfeInfo?.xNome || 'Fornecedor'}${item.vUnCom ? ` - R$${item.vUnCom.toFixed(2)}/un` : ''}`,
          }]);
          if (slipErr) throw slipErr;
        }
      }
      saveLog(nfeType, 'ESTOQUE', `${nfeType === 'ENTRADA' ? 'Entrada' : 'Baixa'} via NFe nº${nfeInfo?.nNF} — ${validItems.length} item(ns)`);
      alert(`✅ ${nfeType === 'ENTRADA' ? 'Entrada' : 'Baixa'} da NFe nº${nfeInfo?.nNF} registrada com sucesso!\n${validItems.length} item(ns) lançados.`);
      setIsNFeOpen(false);
      setNfeItems([]);
      setNfeInfo(null);
      if (nfeFileRef.current) nfeFileRef.current.value = '';
      fetchProducts();
    } catch (err: any) {
      alert('Erro ao registrar entrada: ' + err.message);
    } finally {
      setNfeSaving(false);
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
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button
            className="button"
            style={{ backgroundColor: '#0e7490', border: 'none' }}
            onClick={() => { setNfeType('ENTRADA'); setIsNFeOpen(true); setNfeItems([]); setNfeInfo(null); }}
          >
            <FileInput size={18} style={{ marginRight: '0.5rem' }} />
            Entrada NFe (XML)
          </button>
          <button
            className="button"
            style={{ backgroundColor: '#b91c1c', border: 'none' }}
            onClick={() => { setNfeType('SAIDA'); setIsNFeOpen(true); setNfeItems([]); setNfeInfo(null); }}
          >
            <FileInput size={18} style={{ marginRight: '0.5rem' }} />
            Baixa NFe (XML)
          </button>
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
                  <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                    <button onClick={() => openEntradaModal(p)} style={{ background: 'none', border: 'none', color: '#34d399', cursor: 'pointer', padding: '0.4rem' }} title="Inserir Entrada">
                      <ArrowDownCircle size={17} />
                    </button>
                    <button onClick={() => openBaixaModal(p)} style={{ background: 'none', border: 'none', color: '#fb923c', cursor: 'pointer', padding: '0.4rem' }} title="Dar Baixa (Vencido/Avariado)">
                      <AlertTriangle size={17} />
                    </button>
                    <button onClick={() => openEditModal(p)} style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', padding: '0.4rem' }} title="Editar">
                      <Edit3 size={17} />
                    </button>
                    <button onClick={() => deleteProduct(p.id)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '0.4rem' }} title="Excluir">
                      <Trash2 size={17} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isBaixaOpen && baixaProduct && (
        <div className="modal-overlay" style={{ display: 'flex', justifyContent: 'center', paddingTop: '10vh', overflowY: 'auto' }}>
          <div className="card" style={{ width: '100%', maxWidth: '520px', position: 'relative', margin: '0 auto', height: 'fit-content' }}>
            <div className="view-header">
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertTriangle size={22} color="#fb923c" />
                  Dar Baixa no Estoque
                </h2>
                <p style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: '0.2rem' }}>
                  {baixaProduct.name} &nbsp;|&nbsp; Saldo atual: <strong>{baixaProduct.quantity}</strong>
                </p>
              </div>
              <button onClick={() => setIsBaixaOpen(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}><X size={24} /></button>
            </div>

            <form onSubmit={handleBaixaSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>

              {/* DATA DA BAIXA */}
              <div>
                <label>Data da Baixa *</label>
                <input
                  type="date"
                  className="input-field"
                  required
                  value={baixaForm.date}
                  onChange={e => setBaixaForm({ ...baixaForm, date: e.target.value })}
                />
              </div>

              {/* MOTIVO */}
              <div>
                <label>Motivo *</label>
                <select
                  className="input-field"
                  value={baixaForm.motivo}
                  onChange={e => setBaixaForm({ ...baixaForm, motivo: e.target.value as any })}
                >
                  <option value="Produto Vencido">Produto Vencido</option>
                  <option value="Avariado">Avariado</option>
                </select>
              </div>

              {/* LOTE */}
              <div>
                <label>Lote *</label>
                <input
                  className="input-field"
                  required
                  value={baixaForm.batch}
                  onChange={e => setBaixaForm({ ...baixaForm, batch: e.target.value })}
                  placeholder="Ex: LOT2024001"
                />
              </div>

              {/* QUANTIDADE */}
              <div>
                <label>Quantidade *</label>
                <input
                  type="number"
                  className="input-field"
                  required
                  min={1}
                  max={baixaProduct.quantity}
                  value={baixaForm.quantity || ''}
                  onChange={e => setBaixaForm({ ...baixaForm, quantity: Number(e.target.value) })}
                  placeholder="0"
                />
              </div>

              {/* OBSERVAÇÃO */}
              <div style={{ gridColumn: 'span 2' }}>
                <label>Observação <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>opcional</span></label>
                <input
                  className="input-field"
                  value={baixaForm.observation}
                  onChange={e => setBaixaForm({ ...baixaForm, observation: e.target.value })}
                  placeholder="Ex: Produto com embalagem danificada..."
                />
              </div>

              {/* Aviso visual */}
              <div style={{ gridColumn: 'span 2', background: 'rgba(251,146,60,0.1)', border: '1px solid rgba(251,146,60,0.3)', borderRadius: '0.5rem', padding: '0.75rem', fontSize: '0.82rem', color: '#fb923c' }}>
                ⚠️ Esta ação irá <strong>reduzir o saldo</strong> do produto em <strong>{baixaForm.quantity || 0}</strong> unidade(s) e registrar uma saída do tipo <em>{baixaForm.motivo}</em>.
              </div>

              <div style={{ gridColumn: 'span 2', display: 'flex', gap: '1rem' }}>
                <button type="button" className="button button-outline" style={{ flex: 1 }} onClick={() => setIsBaixaOpen(false)}>Cancelar</button>
                <button type="submit" className="button" style={{ flex: 1, backgroundColor: '#fb923c', border: 'none' }}>
                  <AlertTriangle size={18} style={{ marginRight: '0.5rem' }} />
                  Confirmar Baixa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="modal-overlay" style={{ display: 'flex', justifyContent: 'center', paddingTop: '5vh', overflowY: 'auto' }}>
          <div className="card" style={{ width: '100%', maxWidth: '720px', position: 'relative', margin: '0 auto', height: 'fit-content' }}>
            <div className="view-header">
              <h2>{isEditing ? 'Editar Produto' : 'Novo Produto'}</h2>
              <button onClick={() => { setIsModalOpen(false); setMultiLots([newLotRow()]); }} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}><X size={24} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              {/* Shared fields */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <label>Nome do Produto *</label>
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
                  <label>Unidade (UND) *</label>
                  <input className="input-field" required value={formData.unit} onChange={e => setFormData({...formData, unit: e.target.value})} />
                </div>
                <div>
                  <label>Marca</label>
                  <input className="input-field" value={formData.brand} onChange={e => setFormData({...formData, brand: e.target.value})} />
                </div>
                <div>
                  <label>Depósito</label>
                  <select className="input-field" value={formData.deposit || 'Depósito-Grupo OM'} onChange={e => setFormData({...formData, deposit: e.target.value as Deposit})}>
                    <option value="Depósito-Grupo OM">Depósito-Grupo OM</option>
                    <option value="Depósito-RED">Depósito-RED</option>
                  </select>
                </div>
                <div>
                  <label>Estoque Mínimo</label>
                  <input type="number" className="input-field" value={formData.min_stock} onChange={e => setFormData({...formData, min_stock: Number(e.target.value)})} />
                </div>
              </div>

              {/* Lots section — only for new products */}
              {!isEditing && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <label style={{ margin: 0, fontWeight: 700, color: '#34d399' }}>Lotes</label>
                    <button
                      type="button"
                      onClick={() => setMultiLots([...multiLots, newLotRow()])}
                      style={{ background: 'none', border: '1px solid #34d399', color: '#34d399', cursor: 'pointer', borderRadius: '0.4rem', padding: '0.3rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                    >
                      <PlusCircle size={15} /> Adicionar Lote
                    </button>
                  </div>
                  <div style={{ border: '1px solid var(--border)', borderRadius: '0.5rem', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: 'rgba(52,211,153,0.08)' }}>
                          <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', color: '#34d399', fontWeight: 600 }}>Lote *</th>
                          <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', color: '#34d399', fontWeight: 600 }}>Validade *</th>
                          <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', color: '#34d399', fontWeight: 600 }}>Quantidade *</th>
                          <th style={{ width: '36px' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {multiLots.map((lot, idx) => (
                          <tr key={lot.id} style={{ borderTop: idx > 0 ? '1px solid var(--border)' : 'none' }}>
                            <td style={{ padding: '0.4rem 0.5rem' }}>
                              <input
                                className="input-field"
                                style={{ height: '36px', fontSize: '0.85rem' }}
                                value={lot.batch}
                                placeholder="LOT001"
                                onChange={e => setMultiLots(multiLots.map(l => l.id === lot.id ? { ...l, batch: e.target.value } : l))}
                              />
                            </td>
                            <td style={{ padding: '0.4rem 0.5rem' }}>
                              <input
                                type="date"
                                className="input-field"
                                style={{ height: '36px', fontSize: '0.85rem' }}
                                value={lot.expiry_date}
                                onChange={e => setMultiLots(multiLots.map(l => l.id === lot.id ? { ...l, expiry_date: e.target.value } : l))}
                              />
                            </td>
                            <td style={{ padding: '0.4rem 0.5rem' }}>
                              <input
                                type="number"
                                className="input-field"
                                style={{ height: '36px', fontSize: '0.85rem', width: '90px' }}
                                min={0}
                                placeholder="0"
                                value={lot.quantity || ''}
                                onChange={e => setMultiLots(multiLots.map(l => l.id === lot.id ? { ...l, quantity: Number(e.target.value) } : l))}
                              />
                            </td>
                            <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>
                              {multiLots.length > 1 && (
                                <button type="button" onClick={() => setMultiLots(multiLots.filter(l => l.id !== lot.id))} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '0.2rem' }}>
                                  <MinusCircle size={16} />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Edit mode: show single lot fields */}
              {isEditing && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.5rem' }}>
                  <div>
                    <label>Lote</label>
                    <input className="input-field" value={formData.batch} onChange={e => setFormData({...formData, batch: e.target.value})} />
                  </div>
                  <div>
                    <label>Vencimento</label>
                    <input type="date" className="input-field" value={formData.expiry_date || ''} onChange={e => setFormData({...formData, expiry_date: e.target.value})} />
                  </div>
                  <div>
                    <label>Quantidade</label>
                    <input type="number" className="input-field" value={formData.quantity} onChange={e => setFormData({...formData, quantity: Number(e.target.value)})} />
                  </div>
                </div>
              )}

              <div style={{ marginTop: '1.25rem' }}>
                <button type="submit" className="button">{isEditing ? 'Salvar Alterações' : `Salvar ${multiLots.filter(l=>l.batch&&l.expiry_date&&l.quantity>0).length || ''} Lote(s)`}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isEntradaOpen && (
        <div className="modal-overlay" style={{ display: 'flex', justifyContent: 'center', paddingTop: '5vh', overflowY: 'auto' }}>
          <div className="card" style={{ width: '100%', maxWidth: '780px', position: 'relative', margin: '0 auto', height: 'fit-content' }}>
            <div className="view-header">
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <ArrowDownCircle size={22} color="#34d399" />
                  Inserir Entrada
                </h2>
                <p style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: '0.2rem' }}>Registre entradas por lote — o sistema cria ou atualiza automaticamente</p>
              </div>
              <button onClick={() => { setIsEntradaOpen(false); setEntradaLots([newEntradaLot()]); }} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}><X size={24} /></button>
            </div>

            <form onSubmit={handleEntradaSubmit}>
              {/* Header fields */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.25rem', marginTop: '0.5rem' }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <label>Produto *</label>
                  <select
                    className="input-field"
                    required
                    value={entradaProductName}
                    onChange={e => {
                      setEntradaProductName(e.target.value);
                      // Auto-fill category and unit from matching product
                      const match = products.find(p => p.name === e.target.value && p.deposit === entradaDeposit);
                      if (match) { setEntradaCategory(match.category); setEntradaUnit(match.unit); }
                    }}
                  >
                    <option value="">Selecione o produto...</option>
                    {/* Unique names per deposit */}
                    {Array.from(new Set(products.filter(p => p.deposit === entradaDeposit).map(p => p.name))).sort().map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Data *</label>
                  <input type="date" className="input-field" required value={entradaDate} onChange={e => setEntradaDate(e.target.value)} />
                </div>
                <div>
                  <label>Depósito</label>
                  <select className="input-field" value={entradaDeposit} onChange={e => { setEntradaDeposit(e.target.value as Deposit); setEntradaProductName(''); }}>
                    <option value="Depósito-Grupo OM">Depósito-Grupo OM</option>
                    <option value="Depósito-RED">Depósito-RED</option>
                  </select>
                </div>
                <div>
                  <label>Categoria</label>
                  <select className="input-field" value={entradaCategory} onChange={e => setEntradaCategory(e.target.value as Category)}>
                    <option value="Estocáveis">Estocáveis</option>
                    <option value="DIETA">DIETA</option>
                    <option value="LIMPEZA">LIMPEZA</option>
                    <option value="PAPELARIA">PAPELARIA</option>
                  </select>
                </div>
                <div>
                  <label>Unidade (UND)</label>
                  <input className="input-field" value={entradaUnit} onChange={e => setEntradaUnit(e.target.value)} placeholder="UN" />
                </div>
              </div>

              {/* Lots table */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                <label style={{ margin: 0, fontWeight: 700, color: '#34d399' }}>Lotes de Entrada</label>
                <button
                  type="button"
                  onClick={() => setEntradaLots([...entradaLots, newEntradaLot()])}
                  style={{ background: 'none', border: '1px solid #34d399', color: '#34d399', cursor: 'pointer', borderRadius: '0.4rem', padding: '0.3rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                >
                  <PlusCircle size={15} /> Adicionar Lote
                </button>
              </div>

              <div style={{ border: '1px solid var(--border)', borderRadius: '0.5rem', overflow: 'auto', marginBottom: '1.25rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
                  <thead>
                    <tr style={{ background: 'rgba(52,211,153,0.08)' }}>
                      <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', color: '#34d399', fontWeight: 600 }}>Lote *</th>
                      <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', color: '#34d399', fontWeight: 600 }}>Validade *</th>
                      <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', color: '#34d399', fontWeight: 600 }}>Marca</th>
                      <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', color: '#34d399', fontWeight: 600 }}>Qtd *</th>
                      <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', color: '#34d399', fontWeight: 600 }}>Custo (R$)</th>
                      <th style={{ width: '36px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {entradaLots.map((lot, idx) => (
                      <tr key={lot.id} style={{ borderTop: idx > 0 ? '1px solid var(--border)' : 'none' }}>
                        <td style={{ padding: '0.4rem 0.5rem' }}>
                          <input className="input-field" style={{ height: '34px', fontSize: '0.85rem', minWidth: '100px' }} value={lot.batch} placeholder="LOT001" onChange={e => setEntradaLots(entradaLots.map(l => l.id === lot.id ? { ...l, batch: e.target.value } : l))} />
                        </td>
                        <td style={{ padding: '0.4rem 0.5rem' }}>
                          <input type="date" className="input-field" style={{ height: '34px', fontSize: '0.85rem' }} value={lot.expiry_date} onChange={e => setEntradaLots(entradaLots.map(l => l.id === lot.id ? { ...l, expiry_date: e.target.value } : l))} />
                        </td>
                        <td style={{ padding: '0.4rem 0.5rem' }}>
                          <input className="input-field" style={{ height: '34px', fontSize: '0.85rem', minWidth: '90px' }} value={lot.brand} placeholder="Marca" onChange={e => setEntradaLots(entradaLots.map(l => l.id === lot.id ? { ...l, brand: e.target.value } : l))} />
                        </td>
                        <td style={{ padding: '0.4rem 0.5rem' }}>
                          <input type="number" min={1} className="input-field" style={{ height: '34px', fontSize: '0.85rem', width: '80px' }} value={lot.quantity || ''} placeholder="0" onChange={e => setEntradaLots(entradaLots.map(l => l.id === lot.id ? { ...l, quantity: Number(e.target.value) } : l))} />
                        </td>
                        <td style={{ padding: '0.4rem 0.5rem' }}>
                          <input type="number" step="0.01" min={0} className="input-field" style={{ height: '34px', fontSize: '0.85rem', width: '90px' }} value={lot.cost} placeholder="0,00" onChange={e => setEntradaLots(entradaLots.map(l => l.id === lot.id ? { ...l, cost: e.target.value } : l))} />
                        </td>
                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>
                          {entradaLots.length > 1 && (
                            <button type="button" onClick={() => setEntradaLots(entradaLots.filter(l => l.id !== lot.id))} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}>
                              <MinusCircle size={16} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="button" className="button button-outline" style={{ flex: 1 }} onClick={() => { setIsEntradaOpen(false); setEntradaLots([newEntradaLot()]); }}>Cancelar</button>
                <button type="submit" className="button" style={{ flex: 2, backgroundColor: '#10b981', border: 'none' }}>
                  <ArrowDownCircle size={18} style={{ marginRight: '0.5rem' }} />
                  Confirmar {entradaLots.filter(l=>l.batch&&l.expiry_date&&l.quantity>0).length || ''} Entrada(s)
                </button>
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
                    <th>UND</th>
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
                      <td>{p.unit || '-'}</td>
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

      {isTransferOpen && (
        <div className="modal-overlay">
          <div className="card" style={{ width: '100%', maxWidth: '850px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="view-header" style={{ marginBottom: '1.5rem' }}>
              <div>
                <h2>Transferência de Estocáveis</h2>
                <p style={{ fontSize: '0.9rem', opacity: 0.7 }}>Mova produtos estocáveis do Depósito-Grupo OM para o Depósito-RED.</p>
              </div>
              <button onClick={() => setIsTransferOpen(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}><X size={24} /></button>
            </div>
            
            <div style={{ overflowX: 'auto', width: '100%', borderRadius: '0.5rem', border: '1px solid var(--border)' }}>
              <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', border: 'none' }}>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Marca</th>
                    <th>UND</th>
                    <th>Saldo Atual OM</th>
                    <th>Quantidade a Transferir</th>
                  </tr>
                </thead>
                <tbody>
                  {products
                    .filter(p => p.category === 'Estocáveis' && p.deposit === 'Depósito-Grupo OM' && p.quantity > 0)
                    .map(p => (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 600 }}>{p.name}</td>
                        <td>{p.brand || '-'}</td>
                        <td>{p.unit || '-'}</td>
                        <td style={{ fontWeight: 700 }}>{p.quantity}</td>
                        <td>
                          <input 
                            type="number" 
                            className="input-field" 
                            style={{ padding: '0.4rem', height: 'auto', width: '120px' }}
                            placeholder="0"
                            min="0"
                            max={p.quantity}
                            value={transferData[p.id] || ''}
                            onChange={e => {
                              const val = Math.min(p.quantity, Math.max(0, Number(e.target.value)));
                              setTransferData({...transferData, [p.id]: val});
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  {products.filter(p => p.category === 'Estocáveis' && p.deposit === 'Depósito-Grupo OM' && p.quantity > 0).length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                        Nenhum produto estocável com saldo disponível no Depósito-Grupo OM.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            
            <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
              <button className="button button-outline" onClick={() => setIsTransferOpen(false)} style={{ flex: '1 1 auto', minWidth: '120px' }}>Cancelar</button>
              <button className="button" onClick={handleTransfer} style={{ flex: '1 1 auto', minWidth: '220px', backgroundColor: '#10b981' }}>
                <ArrowRight size={18} style={{ marginRight: '0.5rem' }} />
                Confirmar Transferência
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ NFe XML Import Modal ══ */}
      {isNFeOpen && (
        <div className="modal-overlay" style={{ display: 'flex', justifyContent: 'center', paddingTop: '3vh', overflowY: 'auto' }}>
          <div className="card" style={{ width: '100%', maxWidth: '960px', position: 'relative', margin: '0 auto', height: 'fit-content' }}>
            {/* Header */}
            <div className="view-header" style={{ marginBottom: '1.5rem' }}>
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <FileInput size={22} color={nfeType === 'ENTRADA' ? "#22d3ee" : "#f87171"} />
                  {nfeType === 'ENTRADA' ? 'Entrada por NFe (XML)' : 'Baixa por NFe (XML)'}
                </h2>
                <p style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: '0.2rem' }}>
                  {nfeType === 'ENTRADA' ? 'Importe o XML da Nota Fiscal de Entrada para registrar as entradas no estoque automaticamente.' : 'Importe o XML da Nota Fiscal de Saída para dar baixa no estoque automaticamente.'}
                </p>
              </div>
              <button onClick={() => { setIsNFeOpen(false); setNfeItems([]); setNfeInfo(null); if (nfeFileRef.current) nfeFileRef.current.value = ''; }} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
                <X size={24} />
              </button>
            </div>

            {/* Step 1 — Upload & settings */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem', alignItems: 'end' }}>
              <div style={{ gridColumn: 'span 1' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>📎 Arquivo XML da NFe *</label>
                <label
                  htmlFor="nfe-xml-upload"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', background: nfeType === 'ENTRADA' ? 'rgba(34,211,238,0.07)' : 'rgba(248,113,113,0.07)', border: nfeType === 'ENTRADA' ? '1.5px dashed #22d3ee' : '1.5px dashed #f87171', borderRadius: '0.5rem', padding: '0.6rem 1rem', color: nfeType === 'ENTRADA' ? '#22d3ee' : '#f87171', fontSize: '0.85rem', fontWeight: 600 }}
                >
                  <Upload size={16} /> Selecionar XML
                </label>
                <input
                  id="nfe-xml-upload"
                  ref={nfeFileRef}
                  type="file"
                  accept=".xml,text/xml,application/xml"
                  style={{ display: 'none' }}
                  onChange={handleNFeFileChange}
                />
              </div>
              <div>
                <label>Depósito de Destino</label>
                <select className="input-field" value={nfeDeposit} onChange={e => setNfeDeposit(e.target.value as Deposit)}>
                  <option value="Depósito-Grupo OM">Depósito-Grupo OM</option>
                  <option value="Depósito-RED">Depósito-RED</option>
                </select>
              </div>
              <div>
                <label>Data da Entrada</label>
                <input type="date" className="input-field" value={nfeDate} onChange={e => setNfeDate(e.target.value)} />
              </div>
            </div>

            {/* NF Info */}
            {nfeInfo && (
              <div style={{ background: nfeType === 'ENTRADA' ? 'rgba(34,211,238,0.07)' : 'rgba(248,113,113,0.07)', border: nfeType === 'ENTRADA' ? '1px solid rgba(34,211,238,0.25)' : '1px solid rgba(248,113,113,0.25)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1.25rem', display: 'flex', gap: '2rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                <span>📄 <strong>NF nº</strong> {nfeInfo.nNF}</span>
                <span>📅 <strong>Emissão:</strong> {nfeInfo.dhEmi ? nfeInfo.dhEmi.split('-').reverse().join('/') : '-'}</span>
                <span>🏭 <strong>{nfeType === 'ENTRADA' ? 'Fornecedor' : 'Cliente'}:</strong> {nfeInfo.xNome}</span>
                <span>📦 <strong>Itens:</strong> {nfeItems.length}</span>
              </div>
            )}

            {/* Items table */}
            {nfeItems.length > 0 && (
              <>
                <p style={{ fontSize: '0.78rem', color: nfeType === 'ENTRADA' ? '#22d3ee' : '#f87171', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.6rem' }}>
                  Vincule cada item da NF ao produto correspondente no estoque:
                </p>
                <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '0.5rem', marginBottom: '1.25rem' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
                    <thead>
                      <tr style={{ background: nfeType === 'ENTRADA' ? 'rgba(34,211,238,0.08)' : 'rgba(248,113,113,0.08)' }}>
                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', color: nfeType === 'ENTRADA' ? '#22d3ee' : '#f87171', fontWeight: 600 }}>Descrição (NF)</th>
                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', color: nfeType === 'ENTRADA' ? '#22d3ee' : '#f87171', fontWeight: 600 }}>UND</th>
                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', color: nfeType === 'ENTRADA' ? '#22d3ee' : '#f87171', fontWeight: 600 }}>Qtd</th>
                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', color: nfeType === 'ENTRADA' ? '#22d3ee' : '#f87171', fontWeight: 600 }}>R$/un</th>
                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', color: nfeType === 'ENTRADA' ? '#22d3ee' : '#f87171', fontWeight: 600 }}>Vincular ao Produto</th>
                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', color: nfeType === 'ENTRADA' ? '#22d3ee' : '#f87171', fontWeight: 600 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nfeItems.map((item, idx) => (
                        <tr key={idx} style={{ borderTop: idx > 0 ? '1px solid var(--border)' : 'none', background: item.selectedProductId || item.createNew ? 'rgba(34,211,238,0.04)' : 'transparent' }}>
                          <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem', fontWeight: 600, maxWidth: '200px' }}>{item.xProd}</td>
                          <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem' }}>{item.uCom}</td>
                          <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem', fontWeight: 700 }}>{item.qCom}</td>
                          <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{item.vUnCom > 0 ? `R$${item.vUnCom.toFixed(2)}` : '-'}</td>
                          <td style={{ padding: '0.5rem 0.75rem', minWidth: '220px' }}>
                            <select
                              className="input-field"
                              style={{ height: '32px', fontSize: '0.82rem' }}
                              value={item.createNew ? '__NEW__' : item.selectedProductId}
                              onChange={e => {
                                if (e.target.value === '__NEW__') {
                                  updateNfeItem(idx, { createNew: true, selectedProductId: '' });
                                } else {
                                  updateNfeItem(idx, { createNew: false, selectedProductId: e.target.value });
                                }
                              }}
                            >
                              <option value="">— Ignorar este item —</option>
                              {nfeType === 'ENTRADA' && <option value="__NEW__">✦ Criar novo produto</option>}
                              {Array.from(new Set(products.filter(p => p.deposit === nfeDeposit).map(p => p.name))).sort().map(name => {
                                const prod = products.filter(p => p.deposit === nfeDeposit && p.name === name);
                                return prod.map(p => (
                                  <option key={p.id} value={p.id}>{p.name}{p.batch ? ` [${p.batch}]` : ''}{p.brand ? ` - ${p.brand}` : ''}</option>
                                ));
                              })}
                            </select>
                          </td>
                          <td style={{ padding: '0.5rem 0.5rem', minWidth: '260px' }}>
                            {item.createNew && nfeType === 'ENTRADA' ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                <input className="input-field" style={{ height: '30px', fontSize: '0.78rem' }} placeholder="Nome do produto *" value={item.newName} onChange={e => updateNfeItem(idx, { newName: e.target.value })} />
                                <div style={{ display: 'flex', gap: '0.3rem' }}>
                                  <input className="input-field" style={{ height: '30px', fontSize: '0.78rem', flex: 1 }} placeholder="Lote *" value={item.newBatch} onChange={e => updateNfeItem(idx, { newBatch: e.target.value })} />
                                  <input type="date" className="input-field" style={{ height: '30px', fontSize: '0.78rem', flex: 1 }} value={item.newExpiry} onChange={e => updateNfeItem(idx, { newExpiry: e.target.value })} />
                                </div>
                                <input className="input-field" style={{ height: '30px', fontSize: '0.78rem' }} placeholder="Marca" value={item.newBrand} onChange={e => updateNfeItem(idx, { newBrand: e.target.value })} />
                              </div>
                            ) : item.selectedProductId ? (
                              <span style={{ fontSize: '0.78rem', color: nfeType === 'ENTRADA' ? '#34d399' : '#f87171' }}>
                                <Link2 size={12} style={{ marginRight: '0.3rem', verticalAlign: 'middle' }} />
                                {nfeType === 'ENTRADA' ? 'Entrada' : 'Baixa'} de <strong>{item.qCom}</strong> {item.uCom} será lançada
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Selecione um produto →</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button
                    type="button"
                    className="button button-outline"
                    style={{ flex: 1 }}
                    onClick={() => { setIsNFeOpen(false); setNfeItems([]); setNfeInfo(null); if (nfeFileRef.current) nfeFileRef.current.value = ''; }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="button"
                    style={{ flex: 2, backgroundColor: nfeType === 'ENTRADA' ? '#0e7490' : '#b91c1c', border: 'none' }}
                    onClick={handleNFeSubmit}
                    disabled={nfeSaving}
                  >
                    <ArrowDownCircle size={18} style={{ marginRight: '0.5rem' }} />
                    {nfeSaving ? 'Registrando...' : `Confirmar ${nfeType === 'ENTRADA' ? 'Entrada' : 'Baixa'} (${nfeItems.filter(it => it.selectedProductId || (nfeType === 'ENTRADA' && it.createNew && it.newName.trim() && it.newBatch.trim() && it.newExpiry)).length} itens)`}
                  </button>
                </div>
              </>
            )}

            {nfeItems.length === 0 && (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                <Upload size={48} style={{ margin: '0 auto 1rem', display: 'block', opacity: 0.2 }} />
                <p>Selecione um arquivo XML de NFe para começar.</p>
                <p style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>Suportado: NF-e padrão SEFAZ (NFe v3.10 e v4.00)</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Inventory;
