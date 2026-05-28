import React, { useState, useEffect } from 'react';
import { Filter, Calendar, Package, AlertTriangle, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Deposit, Role } from '../types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface ReportsProps {
  userRole?: Role | null;
}

const Reports: React.FC<ReportsProps> = ({ userRole }) => {
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('TODAS');
  const [selectedDeposit, setSelectedDeposit] = useState<Deposit | 'TODOS'>('TODOS');
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (userRole === 'red') {
      setSelectedDeposit('Depósito-RED');
    }
  }, [userRole]);

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase.from('products').select('category');
      if (error) throw error;
      if (data) {
        const uniqueCats = Array.from(new Set(data.map(item => item.category).filter(Boolean)));
        setCategories(uniqueCats.sort() as string[]);
      }
    } catch (err) {
      console.error('Erro ao buscar categorias:', err);
    }
  };

  const generatePDF = async (mode: 'estoque_total' | 'estoque_categoria' | 'validade' | 'movimentacao', type: 'sintetico' | 'analitico' = 'sintetico') => {
    setLoading(true);
    
    try {
      let queryProducts = supabase.from('products').select('*').order('name');
      
      const depositToQuery = userRole === 'red' ? 'Depósito-RED' : selectedDeposit;
      if (depositToQuery !== 'TODOS') {
        queryProducts = queryProducts.eq('deposit', depositToQuery);
      }

      if (mode === 'estoque_categoria') {
        if (selectedCategory === 'TODAS') {
          alert('Por favor, selecione uma categoria específica.');
          setLoading(false);
          return;
        }
        queryProducts = queryProducts.eq('category', selectedCategory);
      }

      const { data: products, error: pError } = await queryProducts;
      if (pError) throw pError;

      if (!products || products.length === 0) {
        alert('Nenhum produto encontrado.');
        setLoading(false);
        return;
      }

      const doc = new jsPDF();
      let title = 'Relatório de Estoque';
      
      if (mode === 'estoque_total') title = 'Relatório de Estoque Total (Saldos > 0)';
      if (mode === 'estoque_categoria') title = `Estoque: ${selectedCategory} (Saldos > 0)`;
      if (mode === 'validade') title = 'Relatório de Vencimentos (Saldos > 0)';
      if (mode === 'movimentacao') title = 'Relatório de Movimentação';

      // Header
      doc.setFontSize(20);
      doc.setTextColor(31, 41, 55);
      doc.text(title, 14, 22);
      
      doc.setFontSize(10);
      doc.setTextColor(107, 114, 128);
      doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 30);
      
      let startY = 40;

      if (mode === 'estoque_total' || mode === 'estoque_categoria') {
        const tableData = products
          .filter(p => p.quantity > 0) // Only items with stock
          .map(p => [
            p.name,
            p.category,
            p.unit,
            p.brand || '-',
            p.expiry_date ? p.expiry_date.split('-').reverse().join('/') : '-',
            p.quantity
          ]);

        autoTable(doc, {
          startY: startY,
          head: [['Produto', 'Categoria', 'UND', 'Marca', 'Vencimento', 'Saldo']],
          body: tableData,
          headStyles: { fillColor: [79, 70, 229] }, // Indigo
          theme: 'grid'
        });
      } else if (mode === 'validade') {
        const tableData = products
          .filter(p => p.quantity > 0 && p.expiry_date) // Only items with stock and expiry
          .sort((a, b) => {
            if (!a.expiry_date) return 1;
            if (!b.expiry_date) return -1;
            return new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime();
          })
          .map(p => [
            p.name,
            p.category,
            p.batch || '-',
            p.expiry_date ? p.expiry_date.split('-').reverse().join('/') : 'N/D',
            p.quantity
          ]);

        autoTable(doc, {
          startY: startY,
          head: [['Produto', 'Categoria', 'Lote', 'Vencimento', 'Saldo']],
          body: tableData,
          headStyles: { fillColor: [153, 27, 27] }, // Dark Red for Expiry
          theme: 'grid'
        });
      } else if (mode === 'movimentacao') {
        if (!dateStart || !dateEnd) {
          alert('Por favor, selecione o período para o relatório de movimentação.');
          setLoading(false);
          return;
        }

        doc.setFontSize(11);
        doc.text(`Período: ${dateStart.split('-').reverse().join('/')} até ${dateEnd.split('-').reverse().join('/')}`, 14, startY);

        let querySlips = supabase.from('slips').select('*, products(name, deposit)')
          .gte('date', dateStart)
          .lte('date', dateEnd);
        
        if (selectedCategory !== 'TODAS') {
          querySlips = querySlips.eq('category', selectedCategory);
        }
        
        const { data: rawSlips, error: sError } = await querySlips;
        if (sError) throw sError;

        let slips = rawSlips || [];
        const depositToFilter = userRole === 'red' ? 'Depósito-RED' : selectedDeposit;
        if (depositToFilter !== 'TODOS') {
          slips = slips.filter((s: any) => s.products?.deposit === depositToFilter);
        }

        if (slips.length === 0) {
          alert('Nenhuma movimentação encontrada para este período com os filtros selecionados.');
          setLoading(false);
          return;
        }

        if (type === 'analitico') {
          slips.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
          const tableData = slips.map(s => [
            s.date.split('-').reverse().join('/'),
            s.products?.name || 'N/A',
            s.quantity,
            s.type,
            s.destination || '-'
          ]);

          autoTable(doc, {
            startY: startY + 10,
            head: [['Data', 'Produto', 'QTD', 'Tipo', 'Destino/Origem']],
            body: tableData,
            headStyles: { fillColor: [5, 150, 105] }, // Green for Movement
            theme: 'grid'
          });
        } else {
          // Sintético (Resumo por produto)
          const summary: Record<string, any> = {};
          slips.forEach(s => {
            const pName = s.products?.name || 'N/A';
            if (!summary[pName]) summary[pName] = { in: 0, out: 0, cat: s.category };
            if (s.type === 'ENTRADA') summary[pName].in += s.quantity;
            else summary[pName].out += s.quantity;
          });

          const tableData = Object.entries(summary).map(([name, data]) => [
            name,
            data.cat,
            data.in,
            data.out,
            data.in - data.out
          ]);

          autoTable(doc, {
            startY: startY + 10,
            head: [['Produto', 'Categoria', 'Entradas', 'Saídas', 'Saldo Período']],
            body: tableData,
            headStyles: { fillColor: [5, 150, 105] }, // Green for Movement
            theme: 'grid'
          });
        }
      }

      const fileName = `relatorio_${mode}_${new Date().getTime()}`.toLowerCase();
      doc.save(`${fileName}.pdf`);
      
    } catch (err: any) {
      console.error('Erro ao gerar relatório:', err);
      alert('Erro ao gerar relatório: ' + (err.message || 'Erro desconhecido'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="reports-container">
      <div className="view-header" style={{ flexWrap: 'wrap' }}>
        <div className="view-title">
          <h1>Central de Relatórios</h1>
          <p>Selecione um tipo de relatório para visualizar o estoque e movimentações.</p>
        </div>
        <div style={{ width: '250px', marginLeft: 'auto' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.2rem', display: 'block' }}>Depósito Base:</label>
          <select 
            className="input-field" 
            value={selectedDeposit}
            onChange={(e) => setSelectedDeposit(e.target.value as Deposit | 'TODOS')}
            disabled={userRole === 'red'}
          >
            {userRole !== 'red' && <option value="TODOS">Todos os Depósitos</option>}
            {userRole !== 'red' && <option value="Depósito-Grupo OM">Depósito-Grupo OM</option>}
            <option value="Depósito-RED">Depósito-RED</option>
          </select>
        </div>
      </div>

      <div className="reports-grid">
        {/* Estoque Total */}
        <div className="card report-card">
          <div className="report-icon bg-indigo">
            <Package size={24} />
          </div>
          <div className="report-info">
            <h3>Estoque Total</h3>
            <p className="report-description">Listagem completa de todos os itens com saldo em estoque (acima de zero).</p>
            <button className="button" disabled={loading} onClick={() => generatePDF('estoque_total')}>
              <ChevronRight size={16} /> Relatório Total
            </button>
          </div>
        </div>

        {/* Por Categoria */}
        <div className="card report-card">
          <div className="report-icon bg-blue">
            <Filter size={24} />
          </div>
          <div className="report-info">
            <h3>Estoque por Categoria</h3>
            <p className="report-description">Gere a listagem de uma categoria específica com saldo disponível.</p>
            <div className="report-filter">
              <label>Filtrar por Categoria:</label>
              <select className="input-field" value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}>
                <option value="TODAS">Selecione...</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button 
                className="button" 
                style={{ marginTop: '0.5rem' }} 
                disabled={loading || selectedCategory === 'TODAS'} 
                onClick={() => generatePDF('estoque_categoria')}
              >
                <ChevronRight size={16} /> Gerar Relatório
              </button>
            </div>
          </div>
        </div>

        {/* Validade */}
        <div className="card report-card">
          <div className="report-icon bg-red">
            <AlertTriangle size={24} />
          </div>
          <div className="report-info">
            <h3>Relatório de Validade</h3>
            <p className="report-description">Produtos com saldo, ordenado pela data de vencimento mais próxima.</p>
            <button className="button" disabled={loading} onClick={() => generatePDF('validade')}>
              <ChevronRight size={16} /> Gerar Relatório de Validade
            </button>
          </div>
        </div>

        {/* Movimentação */}
        <div className="card report-card">
          <div className="report-icon bg-green">
            <Calendar size={24} />
          </div>
          <div className="report-info">
            <h3>Movimentação de Período</h3>
            <p className="report-description">Relatório de entradas e saídas realizadas em um intervalo de datas.</p>
            <div className="report-filter" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <div>
                <label>Início:</label>
                <input type="date" className="input-field" value={dateStart} onChange={e => setDateStart(e.target.value)} />
              </div>
              <div>
                <label>Fim:</label>
                <input type="date" className="input-field" value={dateEnd} onChange={e => setDateEnd(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button 
                className="button button-outline" 
                style={{ flex: 1 }}
                disabled={loading || !dateStart || !dateEnd} 
                onClick={() => generatePDF('movimentacao', 'sintetico')}
              >
                Sintético
              </button>
              <button 
                className="button" 
                style={{ flex: 1 }}
                disabled={loading || !dateStart || !dateEnd} 
                onClick={() => generatePDF('movimentacao', 'analitico')}
              >
                Analítico
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Reports;
