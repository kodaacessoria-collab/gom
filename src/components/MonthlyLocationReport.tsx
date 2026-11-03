import { useMemo, useState } from 'react';
import { FileSpreadsheet, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';
import type jsPDF from 'jspdf';
import { buildMonthlyLocationReport, getReportMonth } from '../lib/monthlyLocationReport';
import type { MonthlyLocationGroup, MonthlyReportOrder, MonthlyReportPoint } from '../lib/monthlyLocationReport';
import { buildMonthlyLocationPdf, buildMonthlyLocationWorkbook } from '../lib/monthlyLocationExport';
import { addPdfHeader } from '../lib/pdfBranding';
import type { PdfLogoVariant } from '../lib/pdfBranding';
import { addCanindeHeader } from '../lib/canindePdf';
import { isMaceioBasicBasket } from '../lib/basicBasket';

interface Props {
  operation: { id: string; name: string; city: string; uf: string; logoVariant?: PdfLogoVariant };
  orders: MonthlyReportOrder[];
  points: MonthlyReportPoint[];
  savePdf: (doc: jsPDF, fileName: string) => Promise<unknown>;
}

const previousMonth = () => {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const safeName = (value: string) => value.replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim();

export default function MonthlyLocationReport({ operation, orders, points, savePdf }: Props) {
  const [month, setMonth] = useState(previousMonth);
  const [category, setCategory] = useState('Todas');
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const period = getReportMonth(month);
  const categories = useMemo(() => [...new Set(orders.filter(order => order.operationId === operation.id).map(order => order.category))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [orders, operation.id]);
  const allGroups = useMemo(() => buildMonthlyLocationReport(orders, points, operation.id, month, category), [orders, points, operation.id, month, category]);
  const groups = selectedIds === null ? allGroups : allGroups.filter(group => selectedIds.includes(group.id));
  const locations = useMemo(() => {
    const names = new Map(points.filter(point => point.operationId === operation.id).map(point => [point.id, point.name]));
    allGroups.forEach(group => names.set(group.id, group.name));
    return [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
  }, [points, operation.id, allGroups]);
  const visibleLocations = locations.filter(point => point.name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  const toggle = (id: string) => setSelectedIds(current => {
    const ids = current ?? locations.map(point => point.id);
    return ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id];
  });
  const categoryLabel = category === 'Todas' ? 'Todas as categorias' : category;

  const exportReport = async (format: 'pdf' | 'xlsx', selectedGroups = groups) => {
    if (!period || !selectedGroups.length || busy) return;
    setBusy(true);
    setError('');
    try {
      const scope = { operation: operation.name, monthLabel: period.label, category: categoryLabel, groups: selectedGroups };
      const locationLabel = selectedGroups.length === 1 ? `${selectedGroups[0].name} - ${selectedGroups[0].id}` : `${selectedGroups.length} locais`;
      const fileName = safeName(`RELATORIO MENSAL POR LOCAL - ${operation.name} - ${period.label} - ${categoryLabel} - ${locationLabel}`);
      if (format === 'xlsx') {
        XLSX.writeFile(buildMonthlyLocationWorkbook(scope), `${fileName}.xlsx`);
      } else {
        const doc = await buildMonthlyLocationPdf(scope, async (pdf, group, continuation) => {
          const options = {
            title: 'RELATÓRIO MENSAL DE PRODUTOS POR LOCAL',
            subtitle: `${operation.name} | ${period.label} | Mês completo`,
            footer: continuation ? 'Continuação do local' : undefined,
          };
          const basketOnly = group.rows.every(row => isMaceioBasicBasket(operation, row));
          if (basketOnly) await addCanindeHeader(pdf, options);
          else await addPdfHeader(pdf, { ...options, logoVariant: operation.logoVariant || 'gom' });
        });
        await savePdf(doc, `${fileName}.pdf`);
      }
    } catch (cause) {
      setError(`Não foi possível gerar o relatório: ${cause instanceof Error ? cause.message : 'tente novamente.'}`);
    } finally {
      setBusy(false);
    }
  };

  const exportButtons = (scope?: MonthlyLocationGroup[]) => <>
    <button type="button" className="button button-outline" disabled={busy || !(scope || groups).length || !period} onClick={() => void exportReport('pdf', scope)}><FileText size={16} /> Gerar PDF</button>
    <button type="button" className="button button-outline excel-action" disabled={busy || !(scope || groups).length || !period} onClick={() => void exportReport('xlsx', scope)}><FileSpreadsheet size={16} /> Gerar Excel</button>
  </>;

  return <>
    <h2>Produtos por local — mês completo</h2>
    <p className="report-description">{operation.name}. Soma as entregas do primeiro ao último dia do mês, separando local, categoria, produto e unidade.</p>
    <div className="period-report-filters">
      <label>Mês/ano<input type="month" className="input-field" value={month} onChange={event => setMonth(event.target.value)} /></label>
      <label>Categoria<select aria-label="Categoria" className="input-field" value={category} onChange={event => setCategory(event.target.value)}><option value="Todas">Todas as categorias</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
    </div>
    <fieldset className="monthly-location-selection" disabled={busy}>
      <legend>Locais de entrega</legend>
      <div className="monthly-location-actions">
        <button type="button" className="button button-outline" onClick={() => setSelectedIds(null)}>Selecionar todos</button>
        <button type="button" className="button button-outline" onClick={() => setSelectedIds([])}>Desmarcar todos</button>
        <input type="search" className="input-field" aria-label="Buscar local de entrega" placeholder="Buscar local..." value={search} onChange={event => setSearch(event.target.value)} />
      </div>
      <div className="monthly-location-options">{visibleLocations.map(point => <label className="operation-checkbox-option" key={point.id}><input type="checkbox" checked={selectedIds === null || selectedIds.includes(point.id)} onChange={() => toggle(point.id)} /><span>{point.name}</span></label>)}</div>
      {!visibleLocations.length && <p>Nenhum local encontrado.</p>}
    </fieldset>
    <div className="monthly-location-actions">{exportButtons()}<span>{busy ? 'Gerando relatório...' : `${groups.length} local(is) com entregas · ${period?.label || 'Selecione o mês'}`}</span></div>
    <p className="report-description">O PDF separa cada local em uma nova página. Para gerar somente um local, use os botões no quadro correspondente. Locais sem entregas no mês e na categoria escolhidos não geram páginas vazias.</p>
    {error && <p role="alert">{error}</p>}
    {!groups.length && <p role="status">{selectedIds?.length === 0 ? 'Selecione pelo menos um local para gerar o relatório.' : 'Nenhum produto encontrado para o mês, a categoria e os locais selecionados.'}</p>}
    {groups.map(group => <section className="monthly-location-result" key={group.id}>
      <div className="view-header"><div><h3>{group.name}</h3><p className="report-description">{group.orderCount} pedido(s) · {group.deliveryCount} entrega(s) · {period?.label}</p></div><div className="monthly-location-actions">{exportButtons([group])}</div></div>
      <div className="table-container"><table className="data-table"><thead><tr><th>Categoria</th><th>Produto</th><th>Unidade</th><th>Quantidade no mês</th></tr></thead><tbody>{group.rows.map((row, index) => <tr key={index}><td>{row.category}</td><td>{row.product}</td><td>{row.unit}</td><td>{row.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</td></tr>)}</tbody></table></div>
    </section>)}
  </>;
}
