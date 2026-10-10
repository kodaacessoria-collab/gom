import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, FileDown, Plus, RefreshCw, Trash2, WalletCards } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../lib/supabase';
import { addPdfHeader } from '../lib/pdfBranding';
import type { AccountPayable, Company } from '../types';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const today = () => new Date().toISOString().slice(0, 10);
const formatDate = (value?: string | null) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '-';

const AccountsPayable: React.FC = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<AccountPayable[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'TODOS' | 'PENDENTE' | 'PAGO'>('TODOS');
  const [companyFilter, setCompanyFilter] = useState('TODAS');
  const [form, setForm] = useState({ company_id: '', beneficiary: '', amount: '', due_date: '', notes: '' });

  const loadData = async () => {
    setLoading(true);
    const [{ data: companyData, error: companyError }, { data: accountData, error: accountError }] = await Promise.all([
      supabase.from('companies').select('*').order('legal_name'),
      supabase.from('accounts_payable').select('*, companies(*)').order('due_date', { ascending: true }),
    ]);
    if (companyError || accountError) alert(companyError?.message || accountError?.message);
    const loadedCompanies = (companyData || []) as Company[];
    setCompanies(loadedCompanies);
    setAccounts((accountData || []) as AccountPayable[]);
    setForm(current => ({ ...current, company_id: current.company_id || loadedCompanies[0]?.id || '' }));
    setLoading(false);
  };

  useEffect(() => {
    // Initial remote synchronization is intentionally performed on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, []);

  const filtered = useMemo(() => accounts.filter(account =>
    (statusFilter === 'TODOS' || account.status === statusFilter) &&
    (companyFilter === 'TODAS' || account.company_id === companyFilter)
  ), [accounts, statusFilter, companyFilter]);

  const totals = useMemo(() => ({
    pending: accounts.filter(item => item.status === 'PENDENTE').reduce((sum, item) => sum + Number(item.amount), 0),
    paid: accounts.filter(item => item.status === 'PAGO').reduce((sum, item) => sum + Number(item.amount), 0),
    overdue: accounts.filter(item => item.status === 'PENDENTE' && item.due_date < today()).reduce((sum, item) => sum + Number(item.amount), 0),
  }), [accounts]);

  const createAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.company_id || !form.beneficiary.trim() || !form.amount || !form.due_date) return;
    setSaving(true);
    const { error } = await supabase.from('accounts_payable').insert({
      company_id: form.company_id,
      beneficiary: form.beneficiary.trim(),
      amount: Number(form.amount.replace(',', '.')),
      due_date: form.due_date,
      notes: form.notes.trim() || null,
    });
    setSaving(false);
    if (error) return alert(error.message);
    setForm(current => ({ ...current, beneficiary: '', amount: '', due_date: '', notes: '' }));
    await loadData();
  };

  const markAsPaid = async (account: AccountPayable) => {
    const paymentDate = window.prompt('Data do pagamento (AAAA-MM-DD):', today());
    if (!paymentDate) return;
    const { error } = await supabase.from('accounts_payable').update({ status: 'PAGO', paid_at: paymentDate }).eq('id', account.id);
    if (error) return alert(error.message);
    await loadData();
  };

  const deleteAccount = async (account: AccountPayable) => {
    if (!window.confirm(`Excluir a conta de ${account.beneficiary}?`)) return;
    const { error } = await supabase.from('accounts_payable').delete().eq('id', account.id);
    if (error) return alert(error.message);
    await loadData();
  };

  const copyReminder = async (account: AccountPayable) => {
    const companyName = account.companies?.trade_name || account.companies?.legal_name || 'Grupo OM';
    const notes = account.notes?.trim() ? `\nObservações: ${account.notes.trim()}` : '';
    const message = [
      'Olá! Passando para lembrar sobre a conta a pagar:',
      `Empresa: ${companyName}`,
      `Favorecido: ${account.beneficiary}`,
      `Valor: ${currency.format(Number(account.amount))}`,
      `Vencimento: ${formatDate(account.due_date)}${notes}`,
      '',
      'Por favor, confirme o recebimento deste lembrete.',
    ].join('\n');

    try {
      await navigator.clipboard.writeText(message);
      alert('Lembrete copiado. Agora é só colar no WhatsApp.');
    } catch {
      window.prompt('Copie o lembrete abaixo para enviar no WhatsApp:', message);
    }
  };

  const generatePdf = async () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const company = companies.find(item => item.id === companyFilter);
    await addPdfHeader(doc, {
      title: 'RELATÓRIO DE CONTAS A PAGAR',
      subtitle: company ? `${company.legal_name} - CNPJ ${company.cnpj}` : 'GRUPO OM - Consolidado das 3 empresas',
      footer: `Situação: ${statusFilter === 'TODOS' ? 'Todas' : statusFilter} | Emissão: ${new Date().toLocaleString('pt-BR')}`,
    });
    autoTable(doc, {
      startY: 40,
      head: [['Empresa', 'Favorecido', 'Vencimento', 'Valor', 'Situação', 'Pagamento']],
      body: filtered.map(item => [item.companies?.trade_name || item.companies?.legal_name || '-', item.beneficiary, formatDate(item.due_date), currency.format(Number(item.amount)), item.status, formatDate(item.paid_at)]),
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 9 },
      headStyles: { fillColor: [79, 70, 229] },
      foot: [['', 'TOTAL', '', currency.format(filtered.reduce((sum, item) => sum + Number(item.amount), 0)), '', '']],
      footStyles: { fillColor: [30, 41, 59], fontStyle: 'bold' },
    });
    doc.save(`contas-a-pagar-${today()}.pdf`);
  };

  return (
    <div className="accounts-payable-page">
      <div className="view-header">
        <div className="view-title"><h1>Contas a Pagar</h1><p>Controle financeiro das três empresas do Grupo OM.</p></div>
        <button className="button accounts-icon-button" onClick={loadData}><RefreshCw size={18} /> Atualizar</button>
      </div>

      <div className="accounts-summary-grid">
        <div className="accounts-summary-card"><span>Em aberto</span><strong>{currency.format(totals.pending)}</strong></div>
        <div className="accounts-summary-card danger"><span>Vencidas</span><strong>{currency.format(totals.overdue)}</strong></div>
        <div className="accounts-summary-card success"><span>Pagas</span><strong>{currency.format(totals.paid)}</strong></div>
      </div>

      <form className="card accounts-form" onSubmit={createAccount}>
        <div className="accounts-section-title"><Plus size={20} /><h2>Novo lançamento</h2></div>
        <div className="accounts-form-grid">
          <label>Empresa<select className="input-field" value={form.company_id} onChange={e => setForm({ ...form, company_id: e.target.value })} required>{companies.map(company => <option key={company.id} value={company.id}>{company.trade_name} - {company.cnpj}</option>)}</select></label>
          <label>Favorecido<input className="input-field" value={form.beneficiary} onChange={e => setForm({ ...form, beneficiary: e.target.value })} required /></label>
          <label>Valor (R$)<input className="input-field" type="number" min="0.01" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required /></label>
          <label>Vencimento<input className="input-field" type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} required /></label>
          <label className="accounts-notes">Observações<input className="input-field" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
          <button className="button" type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Adicionar conta'}</button>
        </div>
      </form>

      <div className="accounts-toolbar">
        <select className="input-field" value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}><option value="TODAS">Todas as empresas</option>{companies.map(company => <option key={company.id} value={company.id}>{company.trade_name}</option>)}</select>
        <select className="input-field" value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}><option value="TODOS">Todas as situações</option><option value="PENDENTE">Pendentes</option><option value="PAGO">Pagas</option></select>
        <button className="button" onClick={generatePdf}><FileDown size={18} /> Gerar relatório PDF</button>
      </div>

      <div className="accounts-reminder-note"><WalletCards size={20} /><span>Lembretes automáticos: 2 dias antes, 1 dia antes e no vencimento para o WhatsApp (14) 99868-8551. Contas baixadas deixam de gerar aviso.</span></div>

      <div className="accounts-table-wrap">
        <table className="data-table"><thead><tr><th>Empresa</th><th>Favorecido</th><th>Vencimento</th><th>Valor</th><th>Situação</th><th>Ações</th></tr></thead>
          <tbody>{loading ? <tr><td colSpan={6}>Carregando...</td></tr> : filtered.length === 0 ? <tr><td colSpan={6}>Nenhuma conta encontrada.</td></tr> : filtered.map(account => {
            const overdue = account.status === 'PENDENTE' && account.due_date < today();
            return <tr key={account.id}><td><strong>{account.companies?.trade_name}</strong><small className="accounts-cnpj">{account.companies?.cnpj}</small></td><td>{account.beneficiary}</td><td>{formatDate(account.due_date)}</td><td><strong>{currency.format(Number(account.amount))}</strong></td><td><span className={`badge ${account.status === 'PAGO' ? 'badge-green' : overdue ? 'badge-red' : 'badge-yellow'}`}>{account.status === 'PAGO' ? `Pago em ${formatDate(account.paid_at)}` : overdue ? 'Vencida' : 'Pendente'}</span></td><td><div className="accounts-actions">{account.status === 'PENDENTE' && <><button title="Copiar lembrete para WhatsApp" aria-label={`Copiar lembrete da conta de ${account.beneficiary}`} className="accounts-action whatsapp" onClick={() => copyReminder(account)}><Copy size={18} /></button><button title="Dar baixa" aria-label={`Dar baixa na conta de ${account.beneficiary}`} className="accounts-action success" onClick={() => markAsPaid(account)}><CheckCircle2 size={18} /></button></>}<button title="Excluir" aria-label={`Excluir conta de ${account.beneficiary}`} className="accounts-action danger" onClick={() => deleteAccount(account)}><Trash2 size={18} /></button></div></td></tr>;
          })}</tbody></table>
      </div>
    </div>
  );
};

export default AccountsPayable;
