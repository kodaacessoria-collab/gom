import React, { useState, useEffect } from 'react';
import {
  Plus, X, FileText, ArrowLeft, Search, UserPlus,
  ClipboardCheck, CheckCircle2, Save, Download, Trash2
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { saveLog } from '../lib/logger';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Category, Deposit } from '../types';
import { addPdfHeader } from '../lib/pdfBranding';

const REPORT_FONT = 'courier';
const REPORT_FONT_SIZE = 8;

/* ────────────── Types ────────────── */
interface Audit {
  id: string;
  audit_code: string;
  audit_date: string;
  deposit: string;
  auditor_name: string | null;
  auditor_cpf: string | null;
  responsible_name: string | null;
  responsible_cpf: string | null;
  status: 'ABERTA' | 'FINALIZADA';
  observations: string | null;
  created_at: string;
}

interface AuditItem {
  id: string;
  audit_id: string;
  product_id: string | null;
  product_name: string;
  category: string | null;
  unit: string | null;
  batch: string | null;
  brand: string | null;
  expiry_date: string | null;
  system_qty: number;
  audited_qty: number | null;
  difference: number | null;
  is_new_product: boolean;
}

/* ────────────── Helpers ────────────── */
const formatCPF = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
};

const fmtDate = (iso: string | null) =>
  iso ? iso.split('-').reverse().join('/') : '-';

const fmtDiff = (d: number | null) => {
  if (d === null) return '-';
  if (d > 0) return `+${d}`;
  return String(d);
};

/* ══════════════ COMPONENT ══════════════ */
const StockAudit: React.FC = () => {
  /* ── View state ── */
  const [view, setView] = useState<'list' | 'active'>('list');

  /* ── Data state ── */
  const [audits, setAudits] = useState<Audit[]>([]);
  const [activeAudit, setActiveAudit] = useState<Audit | null>(null);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [localQtys, setLocalQtys] = useState<Record<string, string>>({});
  const [localBrands, setLocalBrands] = useState<Record<string, string>>({});
  const [localBatches, setLocalBatches] = useState<Record<string, string>>({});
  const [localExpiries, setLocalExpiries] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [search, setSearch] = useState('');

  /* ── New Audit modal ── */
  const [showNewAuditModal, setShowNewAuditModal] = useState(false);
  const initNewAudit = {
    deposit: 'Depósito-Grupo OM' as Deposit,
    auditor_name: '',
    auditor_cpf: '',
    responsible_name: '',
    responsible_cpf: '',
    observations: '',
  };
  const [newAuditForm, setNewAuditForm] = useState(initNewAudit);

  /* ── Add uncatalogued product modal ── */
  const [showNewProductModal, setShowNewProductModal] = useState(false);
  const initNewProduct = {
    name: '',
    category: 'Estocáveis' as Category,
    unit: 'UN',
    brand: '',
    batch: '',
    expiry_date: '',
    audited_qty: '',
  };
  const [newProductForm, setNewProductForm] = useState(initNewProduct);

  /* ══ Fetch ══ */
  useEffect(() => { fetchAudits(); }, []);

  /* ══ Auto-save to localStorage on every keystroke ══ */
  useEffect(() => {
    if (!activeAudit) return;
    const key = `audit_draft_${activeAudit.id}`;
    localStorage.setItem(key, JSON.stringify({ localQtys, localBrands, localBatches, localExpiries }));
  }, [localQtys, localBrands, localBatches, localExpiries, activeAudit]);

  const fetchAudits = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('stock_audits')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setAudits(data);
    setLoading(false);
  };

  /* ══ Generate audit code ══ */
  const generateAuditCode = async (): Promise<string> => {
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const prefix = `AUD-${dateStr}-`;
    const { data } = await supabase
      .from('stock_audits')
      .select('audit_code')
      .like('audit_code', `${prefix}%`)
      .order('audit_code', { ascending: false })
      .limit(1);
    let seq = 1;
    if (data && data.length > 0) {
      const last = parseInt(data[0].audit_code.split('-').pop() || '0', 10);
      seq = last + 1;
    }
    return `${prefix}${String(seq).padStart(4, '0')}`;
  };

  /* ══ Start new audit ══ */
  const startNewAudit = async () => {
    if (!newAuditForm.auditor_name.trim() || !newAuditForm.responsible_name.trim()) {
      alert('Informe o nome do auditor e do conferente responsável.');
      return;
    }
    setSaving(true);
    try {
      const code = await generateAuditCode();
      const { data: auditData, error: auditError } = await supabase
        .from('stock_audits')
        .insert([{
          audit_code: code,
          deposit: newAuditForm.deposit,
          auditor_name: newAuditForm.auditor_name,
          auditor_cpf: newAuditForm.auditor_cpf,
          responsible_name: newAuditForm.responsible_name,
          responsible_cpf: newAuditForm.responsible_cpf,
          observations: newAuditForm.observations,
          status: 'ABERTA',
        }])
        .select()
        .single();
      if (auditError) throw auditError;

      /* Load products from chosen deposit */
      const { data: products } = await supabase
        .from('products')
        .select('*')
        .eq('deposit', newAuditForm.deposit)
        .order('name');

      if (products && products.length > 0) {
        const items = products.map((p) => ({
          audit_id: auditData.id,
          product_id: p.id,
          product_name: p.name,
          category: p.category,
          unit: p.unit,
          batch: p.batch || null,
          brand: p.brand || null,
          expiry_date: p.expiry_date || null,
          system_qty: p.quantity,
          audited_qty: null,
          difference: null,
          is_new_product: false,
        }));
        const { error: itemsErr } = await supabase.from('stock_audit_items').insert(items);
        if (itemsErr) throw itemsErr;
      }

      setShowNewAuditModal(false);
      setNewAuditForm(initNewAudit);
      saveLog('CRIAR', 'AUDITORIA', `Auditoria iniciada: ${code}`);
      await openAudit(auditData);
    } catch (err: any) {
      alert('Erro ao iniciar auditoria: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  /* ══ Open existing audit ══ */
  const openAudit = async (audit: Audit) => {
    setLoading(true);
    const { data: items } = await supabase
      .from('stock_audit_items')
      .select('*')
      .eq('audit_id', audit.id)
      .order('product_name');

    setActiveAudit(audit);
    setAuditItems(items || []);

    /* Restore from DB */
    const qtys: Record<string, string> = {};
    const brands: Record<string, string> = {};
    const batches: Record<string, string> = {};
    const expiries: Record<string, string> = {};
    (items || []).forEach((item) => {
      if (item.audited_qty !== null) qtys[item.id] = String(item.audited_qty);
      if (item.brand) brands[item.id] = item.brand;
      if (item.batch) batches[item.id] = item.batch;
      if (item.expiry_date) expiries[item.id] = item.expiry_date;
    });

    /* For items missing brand/batch/expiry, pull from the product catalog as default */
    const productIds = (items || [])
      .filter((i) => i.product_id && (!i.brand || !i.batch || !i.expiry_date))
      .map((i) => i.product_id as string);

    if (productIds.length > 0) {
      const { data: products } = await supabase
        .from('products')
        .select('id, brand, batch, expiry_date')
        .in('id', productIds);

      if (products) {
        const prodMap: Record<string, { brand: string | null; batch: string | null; expiry_date: string | null }> = {};
        products.forEach((p) => { prodMap[p.id] = p; });

        (items || []).forEach((item) => {
          if (!item.product_id) return;
          const prod = prodMap[item.product_id];
          if (!prod) return;
          if (!brands[item.id] && prod.brand) brands[item.id] = prod.brand;
          if (!batches[item.id] && prod.batch) batches[item.id] = prod.batch;
          if (!expiries[item.id] && prod.expiry_date) expiries[item.id] = prod.expiry_date;
        });
      }
    }

    /* Merge with localStorage draft (draft takes priority — more recent than DB) */
    const draftKey = `audit_draft_${audit.id}`;
    const draftRaw = localStorage.getItem(draftKey);
    if (draftRaw) {
      try {
        const draft = JSON.parse(draftRaw);
        Object.assign(qtys, draft.localQtys || {});
        Object.assign(brands, draft.localBrands || {});
        Object.assign(batches, draft.localBatches || {});
        Object.assign(expiries, draft.localExpiries || {});
      } catch (_) { /* ignore corrupt draft */ }
    }

    setLocalQtys(qtys);
    setLocalBrands(brands);
    setLocalBatches(batches);
    setLocalExpiries(expiries);
    setSearch('');
    setView('active');
    setLoading(false);
  };

  /* ══ Qty helpers ══ */
  const getQty = (itemId: string) => localQtys[itemId] ?? '';
  const getLiveDiff = (item: AuditItem) => {
    const v = localQtys[item.id];
    if (v === undefined || v === '') return null;
    return Number(v) - item.system_qty;
  };

  /* ══ Add uncatalogued product ══ */
  const addUncataloguedProduct = async () => {
    if (!newProductForm.name.trim() || !activeAudit) return;
    setSaving(true);
    try {
      const { data: product, error: pErr } = await supabase
        .from('products')
        .insert([{
          name: newProductForm.name,
          category: newProductForm.category,
          unit: newProductForm.unit,
          brand: newProductForm.brand || null,
          batch: newProductForm.batch || null,
          expiry_date: newProductForm.expiry_date || null,
          quantity: 0,
          min_stock: 10,
          deposit: activeAudit.deposit,
        }])
        .select()
        .single();
      if (pErr) throw pErr;

      const { data: auditItem, error: aiErr } = await supabase
        .from('stock_audit_items')
        .insert([{
          audit_id: activeAudit.id,
          product_id: product.id,
          product_name: product.name,
          category: product.category,
          unit: product.unit,
          batch: product.batch || null,
          brand: product.brand || null,
          expiry_date: product.expiry_date || null,
          system_qty: 0,
          audited_qty: null,
          difference: null,
          is_new_product: true,
        }])
        .select()
        .single();
      if (aiErr) throw aiErr;

      setAuditItems((prev) => [...prev, auditItem]);
      if (newProductForm.audited_qty) {
        setLocalQtys((prev) => ({ ...prev, [auditItem.id]: newProductForm.audited_qty }));
      }
      setShowNewProductModal(false);
      setNewProductForm(initNewProduct);
      saveLog('CRIAR', 'PRODUTO', `Produto "${product.name}" cadastrado durante auditoria ${activeAudit.audit_code}`);
    } catch (err: any) {
      alert('Erro ao adicionar produto: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  /* ══ Finalize audit ══ */
  const finalizeAudit = async () => {
    if (!activeAudit) return;

    const missing = auditItems.filter((i) => getQty(i.id) === '');
    if (missing.length > 0) {
      if (!confirm(
        `${missing.length} produto(s) sem quantidade auditada.\n` +
        'Eles serão tratados como 0 (zero). Deseja continuar?'
      )) return;
    }

    if (!confirm(
      'Finalizar a auditoria irá:\n' +
      '• Salvar todas as quantidades auditadas\n' +
      '• Criar romaneios de ajuste para as divergências\n' +
      '• Ajustar o estoque automaticamente\n' +
      '• Gerar o PDF da auditoria\n\nConfirmar?'
    )) return;

    setSaving(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const slipsToInsert: any[] = [];

      /* Update all items and prepare adjustment slips */
      await Promise.all(auditItems.map(async (item) => {
        const raw = getQty(item.id);
        const auditedQty = raw !== '' ? Number(raw) : 0;
        const diff = auditedQty - item.system_qty;

        const brand = localBrands[item.id] ?? item.brand ?? null;
        const batch = localBatches[item.id] ?? item.batch ?? null;
        const expiry_date = localExpiries[item.id] ?? item.expiry_date ?? null;

        await supabase.rpc('upsert_audit_item_progress', {
          p_id: item.id,
          p_audited_qty: auditedQty,
          p_difference: diff,
          p_brand: brand,
          p_batch: batch,
          p_expiry_date: expiry_date,
        });

        /* Sync brand/batch/expiry back to the product record */
        if (item.product_id && (brand || batch || expiry_date)) {
          await supabase.from('products').update({ brand, batch, expiry_date }).eq('id', item.product_id);
        }

        if (diff !== 0 && item.product_id) {
          slipsToInsert.push({
            date: today,
            category: item.category || 'Estocáveis',
            product_id: item.product_id,
            unit: item.unit || 'UN',
            quantity: Math.abs(diff),
            destination: `Ajuste Auditoria ${activeAudit.audit_code}`,
            type: diff > 0 ? 'ENTRADA' : 'SAIDA',
          });
        }
      }));

      /* Insert all adjustment slips at once (trigger updates product qty) */
      if (slipsToInsert.length > 0) {
        const { error: slipsErr } = await supabase.from('slips').insert(slipsToInsert);
        if (slipsErr) throw slipsErr;
      }

      await Promise.all(auditItems.map(async (item) => {
        const raw = getQty(item.id);
        const auditedQty = raw !== '' ? Number(raw) : 0;
        if (!item.product_id) return;

        const { error: productQtyErr } = await supabase
          .from('products')
          .update({ quantity: auditedQty })
          .eq('id', item.product_id);

        if (productQtyErr) throw productQtyErr;
      }));

      /* Mark audit as finalized */
      await supabase
        .from('stock_audits')
        .update({ status: 'FINALIZADA' })
        .eq('id', activeAudit.id);

      const finalizedAudit: Audit = { ...activeAudit, status: 'FINALIZADA' };

      /* Reload items with saved values for PDF */
      const { data: finalItems } = await supabase
        .from('stock_audit_items')
        .select('*')
        .eq('audit_id', activeAudit.id)
        .order('product_name');

      saveLog('FINALIZAR', 'AUDITORIA',
        `Auditoria ${activeAudit.audit_code} finalizada — ${slipsToInsert.length} ajuste(s) de estoque`);

      await generatePDF(finalizedAudit, finalItems || []);

      alert(`✅ Auditoria ${activeAudit.audit_code} finalizada!\n${slipsToInsert.length} ajuste(s) de estoque gerados.\nPDF baixado automaticamente.`);

      setView('list');
      /* Clear localStorage draft after successful finalization */
      localStorage.removeItem(`audit_draft_${activeAudit.id}`);

      setActiveAudit(null);
      setAuditItems([]);
      setLocalQtys({});
      setLocalBrands({});
      setLocalBatches({});
      setLocalExpiries({});
      fetchAudits();
    } catch (err: any) {
      alert('Erro ao finalizar auditoria: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  /* ══ Save progress (without finalizing) ══ */
  const saveProgress = async () => {
    if (!activeAudit || saving) return;
    setSaving(true);
    try {
      const errors: string[] = [];

      await Promise.all(
        auditItems.map(async (item) => {
          const rawQty = localQtys[item.id];
          const audited_qty = rawQty !== undefined && rawQty !== '' ? Number(rawQty) : item.audited_qty;
          const difference =
            audited_qty !== null && audited_qty !== undefined
              ? audited_qty - item.system_qty
              : item.difference;

          const brand = localBrands[item.id] ?? item.brand ?? null;
          const batch = localBatches[item.id] ?? item.batch ?? null;
          const expiry_date = localExpiries[item.id] ?? item.expiry_date ?? null;

          const { error: updateErr } = await supabase.rpc('upsert_audit_item_progress', {
            p_id: item.id,
            p_audited_qty: audited_qty ?? null,
            p_difference: difference ?? null,
            p_brand: brand,
            p_batch: batch,
            p_expiry_date: expiry_date,
          });

          if (updateErr) {
            errors.push(`${item.product_name}: ${updateErr.message}`);
            return; // continue saving other items
          }

          if (item.product_id && (brand || batch || expiry_date)) {
            await supabase
              .from('products')
              .update({ brand, batch, expiry_date })
              .eq('id', item.product_id);
          }
        })
      );

      if (errors.length > 0) {
        throw new Error(`Falha em ${errors.length} item(ns):\n${errors.slice(0, 3).join('\n')}`);
      }

      /* Refresh items from DB so local state reflects saved values */
      const { data: refreshed } = await supabase
        .from('stock_audit_items')
        .select('*')
        .eq('audit_id', activeAudit.id)
        .order('product_name');
      if (refreshed) setAuditItems(refreshed);

      /* Clear localStorage draft — DB is now in sync */
      localStorage.removeItem(`audit_draft_${activeAudit.id}`);

      saveLog('SALVAR', 'AUDITORIA', `Progresso salvo: ${activeAudit.audit_code}`);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err: any) {
      alert('Erro ao salvar progresso: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  /* ══ Generate PDF ══ */
  const generatePDF = async (audit: Audit, items: AuditItem[]) => {
    items = items.filter((item) => !(item.system_qty === 0 && item.audited_qty === 0));
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    doc.setFont(REPORT_FONT, 'normal');
    doc.setFontSize(REPORT_FONT_SIZE);

    /* ── Header ── */
    await addPdfHeader(doc, {
      title: 'RELATÓRIO DE AUDITORIA DE ESTOQUE',
      subtitle: `Código: ${audit.audit_code}`,
      footer: `Data/Hora: ${new Date(audit.audit_date).toLocaleString('pt-BR')}`,
    });

    /* ── Info section ── */
    let y = 38;
    doc.setFontSize(REPORT_FONT_SIZE);
    doc.setTextColor(30, 30, 30);

    doc.setFillColor(241, 245, 249);
    doc.roundedRect(10, y - 5, 190, 28, 2, 2, 'F');

    doc.setFont(REPORT_FONT, 'bold');
    doc.setTextColor(99, 102, 241);
    doc.text('INFORMAÇÕES DA AUDITORIA', 14, y + 1);

    doc.setFont(REPORT_FONT, 'normal');
    doc.setTextColor(50, 50, 50);
    doc.text(`Depósito: ${audit.deposit}`, 14, y + 7);
    doc.text(`Status: ${audit.status}`, 110, y + 7);
    doc.text(`Auditor: ${audit.auditor_name || '-'}`, 14, y + 13);
    doc.text(`CPF Auditor: ${audit.auditor_cpf || '-'}`, 110, y + 13);
    doc.text(`Conferente: ${audit.responsible_name || '-'}`, 14, y + 19);
    doc.text(`CPF Conferente: ${audit.responsible_cpf || '-'}`, 110, y + 19);

    if (audit.observations) {
      y += 32;
      doc.setFillColor(255, 251, 235);
      doc.roundedRect(10, y - 2, 190, 12, 2, 2, 'F');
      doc.setTextColor(146, 64, 14);
      doc.text(`Observações: ${audit.observations}`, 14, y + 5);
    }

    /* ── Summary stats ── */
    const totalItems = items.length;
    const withDiff = items.filter((i) => i.difference !== null && i.difference !== 0).length;
    const newProds = items.filter((i) => i.is_new_product).length;

    y = audit.observations ? y + 20 : y + 34;

    doc.setFillColor(239, 246, 255);
    doc.roundedRect(10, y - 4, 58, 18, 2, 2, 'F');
    doc.setFillColor(240, 253, 244);
    doc.roundedRect(76, y - 4, 58, 18, 2, 2, 'F');
    doc.setFillColor(255, 241, 242);
    doc.roundedRect(142, y - 4, 58, 18, 2, 2, 'F');

    doc.setFontSize(REPORT_FONT_SIZE);
    doc.setFont(REPORT_FONT, 'bold');
    doc.setTextColor(37, 99, 235);
    doc.text(String(totalItems), 39, y + 8, { align: 'center' });
    doc.setTextColor(22, 163, 74);
    doc.text(String(withDiff), 105, y + 8, { align: 'center' });
    doc.setTextColor(220, 38, 38);
    doc.text(String(newProds), 171, y + 8, { align: 'center' });

    doc.setFontSize(REPORT_FONT_SIZE);
    doc.setFont(REPORT_FONT, 'normal');
    doc.setTextColor(70, 70, 70);
    doc.text('Total de Itens', 39, y + 14, { align: 'center' });
    doc.text('Com Divergência', 105, y + 14, { align: 'center' });
    doc.text('Novos Cadastros', 171, y + 14, { align: 'center' });

    y += 24;

    /* ── Items table ── */
    const tableResult = autoTable(doc, {
      startY: y,
      head: [['#', 'Produto', 'Categoria', 'UND', 'Marca', 'Lote', 'Vencimento', 'Qtd Sistema', 'Qtd Auditada', 'Diferença']],
      body: items.map((item, idx) => [
        String(idx + 1).padStart(3, '0'),
        item.product_name + (item.is_new_product ? ' ✦' : ''),
        item.category || '-',
        item.unit || '-',
        item.brand || '-',
        item.batch || '-',
        fmtDate(item.expiry_date),
        item.system_qty,
        item.audited_qty ?? '-',
        fmtDiff(item.difference),
      ]),
      styles: { font: REPORT_FONT, fontSize: REPORT_FONT_SIZE, cellPadding: 1.5, lineColor: [226, 232, 240], lineWidth: 0.2 },
      headStyles: {
        fillColor: [99, 102, 241],
        textColor: 255,
        font: REPORT_FONT,
        fontStyle: 'bold',
        fontSize: REPORT_FONT_SIZE,
      },
      bodyStyles: { font: REPORT_FONT, fontSize: REPORT_FONT_SIZE },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        3: { cellWidth: 14, halign: 'center' },
        7: { halign: 'center' },
        8: { halign: 'center' },
        9: { halign: 'center', fontStyle: 'bold' },
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 9) {
          const val = String(data.cell.raw);
          if (val.startsWith('+')) data.cell.styles.textColor = [16, 185, 129];
          else if (val.startsWith('-')) data.cell.styles.textColor = [239, 68, 68];
        }
      },
    } as any);

    const finalY: number =
      (tableResult as any)?.finalY ??
      (doc as any).lastAutoTable?.finalY ??
      200;

    /* ── Legend ── */
    let ly = finalY + 6;
    if (newProds > 0) {
      doc.setFont(REPORT_FONT, 'normal');
      doc.setFontSize(REPORT_FONT_SIZE);
      doc.setTextColor(100, 100, 100);
      doc.text('✦ Produto cadastrado durante a auditoria', 14, ly);
      ly += 6;
    }

    /* ── Signature section ── */
    const sigY = ly + 14;

    // Check if signatures fit, otherwise add page
    const needNewPage = sigY + 60 > 280;
    if (needNewPage) {
      doc.addPage();
    }
    const sy = needNewPage ? 30 : sigY;

    doc.setFontSize(REPORT_FONT_SIZE);
    doc.setFont(REPORT_FONT, 'bold');
    doc.setTextColor(40, 40, 40);
    doc.text('ASSINATURAS', 105, sy, { align: 'center' });

    doc.setDrawColor(99, 102, 241);
    doc.setLineWidth(0.3);
    doc.line(14, sy + 2, 196, sy + 2);

    /* Left — Auditor */
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(10, sy + 8, 90, 50, 2, 2, 'F');
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.roundedRect(10, sy + 8, 90, 50, 2, 2, 'S');

    doc.setFont(REPORT_FONT, 'bold');
    doc.setFontSize(REPORT_FONT_SIZE);
    doc.setTextColor(99, 102, 241);
    doc.text('AUDITOR', 55, sy + 16, { align: 'center' });

    doc.setDrawColor(60, 60, 60);
    doc.setLineWidth(0.5);
    doc.line(20, sy + 40, 90, sy + 40);

    doc.setFont(REPORT_FONT, 'normal');
    doc.setFontSize(REPORT_FONT_SIZE);
    doc.setTextColor(50, 50, 50);
    doc.text(`Nome: ${audit.auditor_name || '_______________________'}`, 14, sy + 46);
    doc.text(`CPF: ${audit.auditor_cpf || '___.___.___-__'}`, 14, sy + 52);

    /* Right — Conferente */
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(110, sy + 8, 90, 50, 2, 2, 'F');
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(110, sy + 8, 90, 50, 2, 2, 'S');

    doc.setFont(REPORT_FONT, 'bold');
    doc.setFontSize(REPORT_FONT_SIZE);
    doc.setTextColor(16, 185, 129);
    doc.text('CONFERENTE RESPONSÁVEL', 155, sy + 16, { align: 'center' });

    doc.setDrawColor(60, 60, 60);
    doc.setLineWidth(0.5);
    doc.line(120, sy + 40, 190, sy + 40);

    doc.setFont(REPORT_FONT, 'normal');
    doc.setFontSize(REPORT_FONT_SIZE);
    doc.setTextColor(50, 50, 50);
    doc.text(`Nome: ${audit.responsible_name || '_______________________'}`, 114, sy + 46);
    doc.text(`CPF: ${audit.responsible_cpf || '___.___.___-__'}`, 114, sy + 52);

    /* Footer */
    const pageCount = (doc as any).getNumberOfPages ? (doc as any).getNumberOfPages() : 1;
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont(REPORT_FONT, 'normal');
      doc.setFontSize(REPORT_FONT_SIZE);
      doc.setTextColor(180, 180, 180);
      doc.text(
        `GOM ESTOQUE — Auditoria ${audit.audit_code} — Pág. ${i}/${pageCount} — Gerado em: ${new Date().toLocaleString('pt-BR')}`,
        105, 292, { align: 'center' }
      );
    }

    doc.save(`auditoria-${audit.audit_code}.pdf`);
  };

  /* ══ Download PDF for finalized audit ══ */
  const downloadPDF = async (audit: Audit) => {
    const { data: items } = await supabase
      .from('stock_audit_items')
      .select('*')
      .eq('audit_id', audit.id)
      .order('product_name');
    await generatePDF(audit, items || []);
  };

  /* ══ Delete audit ══ */
  const deleteAudit = async (audit: Audit) => {
    const label = audit.status === 'FINALIZADA'
      ? `A auditoria "${audit.audit_code}" já foi FINALIZADA.\nExcluir não desfaz os ajustes de estoque já aplicados.\n\nDeseja excluir apenas o registro?`
      : `Excluir a auditoria "${audit.audit_code}"?\nOs itens vinculados também serão removidos.`;
    if (!confirm(label)) return;
    const { error } = await supabase
      .from('stock_audits')
      .delete()
      .eq('id', audit.id);
    if (error) alert('Erro ao excluir: ' + error.message);
    else {
      saveLog('EXCLUIR', 'AUDITORIA', `Auditoria ${audit.audit_code} excluída`);
      fetchAudits();
    }
  };

  /* ────────────── Filtered items in active view ────────────── */
  const searchLower = search.toLowerCase();
  const filteredItems = auditItems.filter((i) =>
    i.product_name.toLowerCase().includes(searchLower) ||
    (i.brand || '').toLowerCase().includes(searchLower) ||
    (i.batch || '').toLowerCase().includes(searchLower) ||
    (i.expiry_date || '').includes(search)
  );

  /* ══════════════ RENDER ══════════════ */

  /* ── Active Audit View ── */
  if (view === 'active' && activeAudit) {
    const auditedCount = auditItems.filter((i) => getQty(i.id) !== '').length;
    const progress = auditItems.length > 0 ? Math.round((auditedCount / auditItems.length) * 100) : 0;
    const isFinalizada = activeAudit.status === 'FINALIZADA';

    return (
      <div>
        {/* Topbar */}
        <div className="view-header" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button
              onClick={() => { setView('list'); setActiveAudit(null); setAuditItems([]); setLocalBrands({}); setLocalBatches({}); setLocalExpiries({}); fetchAudits(); }}
              style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer', padding: '0.5rem 0.75rem', borderRadius: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
            >
              <ArrowLeft size={16} /> Voltar
            </button>
            <div>
              <h1 style={{ fontSize: '1.5rem', marginBottom: 0 }}>{activeAudit.audit_code}</h1>
              <p style={{ marginBottom: 0, fontSize: '0.8rem' }}>
                {activeAudit.deposit} — {new Date(activeAudit.audit_date).toLocaleString('pt-BR')}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {!isFinalizada && (
              <button
                id="btn-add-uncatalogued"
                className="button button-outline"
                style={{ width: 'auto', padding: '0.6rem 1rem', fontSize: '0.85rem' }}
                onClick={() => setShowNewProductModal(true)}
              >
                <UserPlus size={16} style={{ marginRight: '0.4rem' }} />
                Produto Não Cadastrado
              </button>
            )}
            {!isFinalizada && (
              <button
                id="btn-save-progress"
                className="button"
                style={{
                  width: 'auto',
                  padding: '0.6rem 1.1rem',
                  fontSize: '0.85rem',
                  backgroundColor: saveSuccess ? '#16a34a' : '#f59e0b',
                  color: '#fff',
                  transition: 'background-color 0.4s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
                onClick={saveProgress}
                disabled={saving}
              >
                {saveSuccess
                  ? <><CheckCircle2 size={16} /> Salvo!</>
                  : <><Save size={16} /> {saving ? 'Salvando...' : 'Salvar Progresso'}</>
                }
              </button>
            )}
            {isFinalizada ? (
              <button
                className="button"
                style={{ width: 'auto', padding: '0.6rem 1rem', fontSize: '0.85rem', backgroundColor: '#0891b2' }}
                onClick={() => downloadPDF(activeAudit)}
              >
                <Download size={16} style={{ marginRight: '0.4rem' }} />
                Baixar PDF
              </button>
            ) : (
              <button
                id="btn-finalize-audit"
                className="button"
                style={{ width: 'auto', padding: '0.6rem 1rem', fontSize: '0.85rem', backgroundColor: '#10b981' }}
                onClick={finalizeAudit}
                disabled={saving}
              >
                <CheckCircle2 size={16} style={{ marginRight: '0.4rem' }} />
                {saving ? 'Finalizando...' : 'Finalizar Auditoria'}
              </button>
            )}
          </div>
        </div>

        {/* Info cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '1rem' }}>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Auditor</p>
            <p style={{ fontSize: '0.9rem', color: 'white', margin: 0, fontWeight: 600 }}>{activeAudit.auditor_name || '-'}</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>{activeAudit.auditor_cpf || '-'}</p>
          </div>
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '1rem' }}>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Conferente</p>
            <p style={{ fontSize: '0.9rem', color: 'white', margin: 0, fontWeight: 600 }}>{activeAudit.responsible_name || '-'}</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>{activeAudit.responsible_cpf || '-'}</p>
          </div>
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '1rem' }}>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Progresso</p>
            <p style={{ fontSize: '1.25rem', color: 'white', margin: 0, fontWeight: 700 }}>{auditedCount} / {auditItems.length}</p>
            <div style={{ height: '4px', background: 'var(--border)', borderRadius: '2px', marginTop: '0.5rem' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: progress === 100 ? '#10b981' : '#6366f1', borderRadius: '2px', transition: 'width 0.3s' }} />
            </div>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem', margin: 0 }}>{progress}% auditado</p>
          </div>
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '1rem' }}>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</p>
            <span className={`badge ${isFinalizada ? 'badge-green' : 'badge-yellow'}`} style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}>
              {isFinalizada ? '✓ Finalizada' : '● Em Andamento'}
            </span>
          </div>
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: '1rem' }}>
          <Search size={16} style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            id="audit-search"
            type="text"
            placeholder="Buscar por produto, marca, lote ou vencimento..."
            className="input-field"
            style={{ paddingLeft: '2.5rem', height: '40px' }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Items table */}
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Produto</th>
                <th>Categoria</th>
                <th>UND</th>
                <th>Marca</th>
                <th>Lote</th>
                <th>Vencimento</th>
                <th>Qtd Sistema</th>
                <th>Qtd Auditada</th>
                <th>Diferença</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    Nenhum produto encontrado.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item, idx) => {
                  const diff = getLiveDiff(item) ?? item.difference;
                  const diffColor = diff === null ? 'var(--text-muted)' : diff > 0 ? '#4ade80' : diff < 0 ? '#f87171' : '#94a3b8';
                  return (
                    <tr key={item.id} style={{ opacity: item.is_new_product ? 0.9 : 1 }}>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        {String(idx + 1).padStart(3, '0')}
                        {item.is_new_product && (
                          <span title="Cadastrado durante auditoria" style={{ marginLeft: '0.25rem', color: '#c084fc' }}>✦</span>
                        )}
                      </td>
                      <td style={{ fontWeight: 600 }}>{item.product_name}</td>
                      <td><span className="badge badge-blue">{item.category || '-'}</span></td>
                      <td style={{ textAlign: 'center' }}>
                        <span className="badge" style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', fontWeight: 600, fontSize: '0.75rem' }}>
                          {item.unit || '-'}
                        </span>
                      </td>

                      {/* ── Marca ── */}
                      <td>
                        {isFinalizada ? (
                          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                            {localBrands[item.id] ?? item.brand ?? '-'}
                          </span>
                        ) : (
                          <input
                            type="text"
                            className="input-field"
                            style={{ width: '100px', padding: '0.3rem 0.5rem', height: 'auto', fontSize: '0.8rem' }}
                            placeholder="Marca"
                            value={localBrands[item.id] ?? item.brand ?? ''}
                            onChange={(e) => setLocalBrands((prev) => ({ ...prev, [item.id]: e.target.value }))}
                          />
                        )}
                      </td>

                      {/* ── Lote ── */}
                      <td>
                        {isFinalizada ? (
                          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                            {localBatches[item.id] ?? item.batch ?? '-'}
                          </span>
                        ) : (
                          <input
                            type="text"
                            className="input-field"
                            style={{ width: '100px', padding: '0.3rem 0.5rem', height: 'auto', fontSize: '0.8rem' }}
                            placeholder="Lote"
                            value={localBatches[item.id] ?? item.batch ?? ''}
                            onChange={(e) => setLocalBatches((prev) => ({ ...prev, [item.id]: e.target.value }))}
                          />
                        )}
                      </td>

                      {/* ── Vencimento ── */}
                      <td>
                        {isFinalizada ? (
                          <span>{fmtDate(localExpiries[item.id] ?? item.expiry_date)}</span>
                        ) : (
                          <input
                            type="date"
                            className="input-field"
                            style={{ width: '130px', padding: '0.3rem 0.5rem', height: 'auto', fontSize: '0.8rem' }}
                            value={localExpiries[item.id] ?? item.expiry_date ?? ''}
                            onChange={(e) => setLocalExpiries((prev) => ({ ...prev, [item.id]: e.target.value }))}
                          />
                        )}
                      </td>
                      <td style={{ fontWeight: 700, textAlign: 'center' }}>{item.system_qty}</td>
                      <td>
                        {isFinalizada ? (
                          <span style={{ fontWeight: 700, textAlign: 'center', display: 'block' }}>
                            {item.audited_qty ?? '-'}
                          </span>
                        ) : (
                          <input
                            id={`audit-qty-${item.id}`}
                            type="number"
                            min="0"
                            className="input-field"
                            style={{ width: '90px', padding: '0.4rem 0.6rem', height: 'auto', textAlign: 'center' }}
                            placeholder="0"
                            value={getQty(item.id)}
                            onChange={(e) => setLocalQtys((prev) => ({ ...prev, [item.id]: e.target.value }))}
                          />
                        )}
                      </td>
                      <td style={{ fontWeight: 700, color: diffColor, textAlign: 'center' }}>
                        {diff === null ? '—' : fmtDiff(diff)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Add uncatalogued product modal */}
        {showNewProductModal && (
          <div className="modal-overlay">
            <div className="card" style={{ width: '100%', maxWidth: '560px', position: 'relative' }}>
              <div className="view-header" style={{ marginBottom: '1.5rem' }}>
                <div>
                  <h2 style={{ fontSize: '1.25rem' }}>Produto Não Cadastrado</h2>
                  <p style={{ marginBottom: 0, fontSize: '0.8rem' }}>
                    Cadastre o produto no sistema e inclua na auditoria.
                  </p>
                </div>
                <button onClick={() => setShowNewProductModal(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
                  <X size={22} />
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <label>Nome do Produto *</label>
                  <input className="input-field" required value={newProductForm.name} onChange={(e) => setNewProductForm({ ...newProductForm, name: e.target.value })} />
                </div>
                <div>
                  <label>Categoria</label>
                  <select className="input-field" value={newProductForm.category} onChange={(e) => setNewProductForm({ ...newProductForm, category: e.target.value as Category })}>
                    <option>Estocáveis</option>
                    <option>DIETA</option>
                    <option>LIMPEZA</option>
                    <option>PAPELARIA</option>
                  </select>
                </div>
                <div>
                  <label>Unidade (UND)</label>
                  <input className="input-field" value={newProductForm.unit} onChange={(e) => setNewProductForm({ ...newProductForm, unit: e.target.value })} />
                </div>
                <div>
                  <label>Marca</label>
                  <input className="input-field" value={newProductForm.brand} onChange={(e) => setNewProductForm({ ...newProductForm, brand: e.target.value })} />
                </div>
                <div>
                  <label>Lote</label>
                  <input className="input-field" value={newProductForm.batch} onChange={(e) => setNewProductForm({ ...newProductForm, batch: e.target.value })} />
                </div>
                <div>
                  <label>Vencimento</label>
                  <input type="date" className="input-field" value={newProductForm.expiry_date} onChange={(e) => setNewProductForm({ ...newProductForm, expiry_date: e.target.value })} />
                </div>
                <div>
                  <label>Qtd Física Encontrada</label>
                  <input type="number" min="0" className="input-field" value={newProductForm.audited_qty} onChange={(e) => setNewProductForm({ ...newProductForm, audited_qty: e.target.value })} />
                </div>
                <div style={{ gridColumn: 'span 2', marginTop: '0.5rem', display: 'flex', gap: '0.75rem' }}>
                  <button className="button button-outline" onClick={() => setShowNewProductModal(false)} style={{ flex: 1 }}>Cancelar</button>
                  <button className="button" onClick={addUncataloguedProduct} disabled={saving || !newProductForm.name.trim()} style={{ flex: 1, backgroundColor: '#7c3aed' }}>
                    {saving ? 'Salvando...' : 'Cadastrar e Adicionar'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ── List View ── */
  return (
    <div>
      <div className="view-header">
        <div className="view-title">
          <h1>AUDITORIA DE ESTOQUE</h1>
          <p>Inventário físico com ajuste automático de estoque. Acesso exclusivo para Administradores.</p>
        </div>
        <button
          id="btn-nova-auditoria"
          className="button"
          style={{ width: 'auto', padding: '0.75rem 1.25rem' }}
          onClick={() => setShowNewAuditModal(true)}
        >
          <Plus size={18} style={{ marginRight: '0.5rem' }} />
          Nova Auditoria
        </button>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        {[
          { label: 'Total de Auditorias', value: audits.length, color: '#818cf8' },
          { label: 'Em Andamento', value: audits.filter((a) => a.status === 'ABERTA').length, color: '#facc15' },
          { label: 'Finalizadas', value: audits.filter((a) => a.status === 'FINALIZADA').length, color: '#4ade80' },
        ].map((stat) => (
          <div key={stat.label} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '1.25rem' }}>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{stat.label}</p>
            <p style={{ fontSize: '1.75rem', fontWeight: 800, color: stat.color, margin: 0 }}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Audits table */}
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Data / Hora</th>
              <th>Depósito</th>
              <th>Auditor</th>
              <th>Conferente</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem' }}>Carregando...</td></tr>
            ) : audits.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  <ClipboardCheck size={40} style={{ display: 'block', margin: '0 auto 1rem', opacity: 0.3 }} />
                  Nenhuma auditoria registrada. Clique em "Nova Auditoria" para começar.
                </td>
              </tr>
            ) : (
              audits.map((audit) => (
                <tr key={audit.id}>
                  <td style={{ fontWeight: 700, color: '#818cf8', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                    {audit.audit_code}
                  </td>
                  <td style={{ fontSize: '0.8rem' }}>{new Date(audit.audit_date).toLocaleString('pt-BR')}</td>
                  <td style={{ fontSize: '0.85rem' }}>{audit.deposit}</td>
                  <td style={{ fontSize: '0.85rem' }}>{audit.auditor_name || '-'}</td>
                  <td style={{ fontSize: '0.85rem' }}>{audit.responsible_name || '-'}</td>
                  <td>
                    <span className={`badge ${audit.status === 'FINALIZADA' ? 'badge-green' : 'badge-yellow'}`}>
                      {audit.status === 'FINALIZADA' ? '✓ Finalizada' : '● Aberta'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {audit.status === 'ABERTA' && (
                        <button
                          onClick={() => openAudit(audit)}
                          style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8', cursor: 'pointer', padding: '0.4rem 0.75rem', borderRadius: '0.375rem', fontSize: '0.8rem', fontWeight: 600 }}
                        >
                          Continuar
                        </button>
                      )}
                      {audit.status === 'FINALIZADA' && (
                        <>
                          <button
                            onClick={() => openAudit(audit)}
                            style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', color: '#818cf8', cursor: 'pointer', padding: '0.4rem 0.75rem', borderRadius: '0.375rem', fontSize: '0.8rem', fontWeight: 600 }}
                          >
                            Ver
                          </button>
                          <button
                            onClick={() => downloadPDF(audit)}
                            style={{ background: 'rgba(8,145,178,0.15)', border: '1px solid rgba(8,145,178,0.3)', color: '#22d3ee', cursor: 'pointer', padding: '0.4rem 0.75rem', borderRadius: '0.375rem', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                          >
                            <FileText size={14} /> PDF
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => deleteAudit(audit)}
                        title="Excluir auditoria"
                        style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', cursor: 'pointer', padding: '0.4rem 0.6rem', borderRadius: '0.375rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* New Audit Modal */}
      {showNewAuditModal && (
        <div className="modal-overlay" style={{ alignItems: 'flex-start', paddingTop: '5vh' }}>
          <div className="card" style={{ width: '100%', maxWidth: '620px', position: 'relative' }}>
            {/* Modal header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.75rem' }}>
              <div>
                <h2 style={{ fontSize: '1.3rem', marginBottom: '0.25rem' }}>
                  <ClipboardCheck size={22} style={{ marginRight: '0.5rem', verticalAlign: 'middle', color: '#818cf8' }} />
                  Nova Auditoria de Estoque
                </h2>
                <p style={{ fontSize: '0.8rem', marginBottom: 0 }}>Preencha as informações para iniciar a auditoria.</p>
              </div>
              <button onClick={() => setShowNewAuditModal(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
                <X size={22} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {/* Deposit */}
              <div style={{ gridColumn: 'span 2' }}>
                <label>Depósito a Auditar *</label>
                <select
                  id="audit-deposit"
                  className="input-field"
                  value={newAuditForm.deposit}
                  onChange={(e) => setNewAuditForm({ ...newAuditForm, deposit: e.target.value as Deposit })}
                >
                  <option value="Depósito-Grupo OM">Depósito-Grupo OM</option>
                  <option value="Depósito-RED">Depósito-RED</option>
                </select>
              </div>

              {/* Auditor section */}
              <div style={{ gridColumn: 'span 2', borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '0.25rem' }}>
                <p style={{ fontSize: '0.7rem', color: '#818cf8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
                  ● Auditor
                </p>
              </div>
              <div>
                <label>Nome do Auditor *</label>
                <input
                  id="audit-auditor-name"
                  className="input-field"
                  required
                  value={newAuditForm.auditor_name}
                  onChange={(e) => setNewAuditForm({ ...newAuditForm, auditor_name: e.target.value })}
                />
              </div>
              <div>
                <label>CPF do Auditor</label>
                <input
                  id="audit-auditor-cpf"
                  className="input-field"
                  placeholder="000.000.000-00"
                  value={newAuditForm.auditor_cpf}
                  onChange={(e) => setNewAuditForm({ ...newAuditForm, auditor_cpf: formatCPF(e.target.value) })}
                />
              </div>

              {/* Responsible section */}
              <div style={{ gridColumn: 'span 2', borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '0.25rem' }}>
                <p style={{ fontSize: '0.7rem', color: '#4ade80', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
                  ● Conferente Responsável
                </p>
              </div>
              <div>
                <label>Nome do Conferente *</label>
                <input
                  id="audit-responsible-name"
                  className="input-field"
                  required
                  value={newAuditForm.responsible_name}
                  onChange={(e) => setNewAuditForm({ ...newAuditForm, responsible_name: e.target.value })}
                />
              </div>
              <div>
                <label>CPF do Conferente</label>
                <input
                  id="audit-responsible-cpf"
                  className="input-field"
                  placeholder="000.000.000-00"
                  value={newAuditForm.responsible_cpf}
                  onChange={(e) => setNewAuditForm({ ...newAuditForm, responsible_cpf: formatCPF(e.target.value) })}
                />
              </div>

              {/* Observations */}
              <div style={{ gridColumn: 'span 2', borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '0.25rem' }}>
                <label>Observações (opcional)</label>
                <textarea
                  id="audit-observations"
                  className="input-field"
                  rows={3}
                  style={{ resize: 'vertical', fontFamily: 'inherit' }}
                  value={newAuditForm.observations}
                  onChange={(e) => setNewAuditForm({ ...newAuditForm, observations: e.target.value })}
                />
              </div>

              {/* Buttons */}
              <div style={{ gridColumn: 'span 2', display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button className="button button-outline" onClick={() => setShowNewAuditModal(false)} style={{ flex: 1 }}>
                  Cancelar
                </button>
                <button
                  id="btn-iniciar-auditoria"
                  className="button"
                  onClick={startNewAudit}
                  disabled={saving}
                  style={{ flex: 2, backgroundColor: '#6366f1' }}
                >
                  <ClipboardCheck size={16} style={{ marginRight: '0.5rem' }} />
                  {saving ? 'Iniciando...' : 'Iniciar Auditoria'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StockAudit;
