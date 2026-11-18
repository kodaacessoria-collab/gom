import { useId, useState } from 'react';
import { BILLING_CATEGORIES } from '../lib/igeveBilling';
import { digits, documentToday, emptyNfeDocument, unitsForCnpj, validCnpj, validDocumentDate } from '../lib/igeveDocuments';
import type { DocumentSupplier, IgeveUnit, NfeDocument } from '../lib/igeveDocuments';
import type { ScannedDelivery, ScannedItem } from '../lib/igeveScannedDeliveries';

const maxFiles = 12;
const categories = [...new Set<string>([...BILLING_CATEGORIES, 'Papelaria'])];
const categoryPatterns: [RegExp, string][] = [
  [/\bHORTI\w*\b/, 'Hortifrutigranjeiro'], [/\bPROTEINAS?\b/, 'Proteínas'],
  [/\bESTOCAVE(?:L|IS)\b/, 'Estocáveis'], [/\b(?:DIETAS?|FORMULAS?)\b/, 'Dietas e Fórmulas'],
  [/\bLIMPEZA\b/, 'Limpeza'], [/\bPAPELARIA\b/, 'Papelaria'], [/\bCESTAS? BASICAS?\b/, 'Cesta Básica'],
];
const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const filenamePart = (value: string) => value.replace(/[^\p{L}\p{M}\p{N} ()&.,'-]+/gu, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80);
const blankItem = (): ScannedItem => ({ id: crypto.randomUUID(), product: '', unit: '', quantity: '' });

interface BatchRow {
  id: string;
  scan: ScannedDelivery;
  unitId: string;
  unitName: string;
  category: string;
  supplierId: string;
}
interface BatchFile {
  file: File;
  hash: string;
  rows: BatchRow[];
  error?: string;
  ocrUnavailable?: boolean;
}

interface Props {
  units: IgeveUnit[];
  suppliers: DocumentSupplier[];
  onPreview: (file: File, page: number) => void;
  renderDelivery: (document: NfeDocument, supplier: DocumentSupplier) => Promise<Blob>;
  download: (blob: Blob, filename: string) => void;
}

export default function IgeveBatchDeliveries({ units, suppliers, onPreview, renderDelivery, download }: Props) {
  const categoryList = useId();
  const [files, setFiles] = useState<BatchFile[]>([]);
  const [category, setCategory] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [date, setDate] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [progress, setProgress] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const availableSuppliers = suppliers.filter(supplier => validCnpj(supplier.cnpj));
  const rowCount = files.reduce((sum, file) => sum + file.rows.length, 0);

  function updateRow(id: string, update: (row: BatchRow) => BatchRow) {
    setFiles(current => current.map(file => ({ ...file, rows: file.rows.map(row => row.id === id ? update(row) : row) })));
    setConfirmed(false);
  }

  async function selectFiles(selected: File[]) {
    setMessage('');
    setErrors([]);
    if (files.length + selected.length > maxFiles) {
      setErrors([`Selecione até ${maxFiles} PDFs por lote.`]);
      return;
    }
    setConfirmed(false);
    setProgress('Preparando leitura dos PDFs…');
    const additions: BatchFile[] = [];
    const seen = new Set(files.map(file => file.hash));
    try {
      const { readScannedDeliveries } = await import('../lib/igeveScannedDeliveries');
      for (const file of selected) {
        try {
          const imported = await readScannedDeliveries(file, (page, total) =>
            setProgress(`Lendo ${file.name} · página ${page} de ${total}`));
          if (seen.has(imported.hash)) throw new Error('Já existe uma cópia desse PDF no lote.');
          seen.add(imported.hash);
          const foundCategories = categoryPatterns.filter(([pattern]) => pattern.test(normalize(file.name)));
          const rows = imported.deliveries.map(scan => {
            const matches = unitsForCnpj(scan.recipientCnpj, units);
            const matchingUnits = matches.length ? matches : units;
            const byName = scan.unitName && matchingUnits.find(unit => normalize(unit.name) === normalize(scan.unitName));
            const unit = byName || (matches.length === 1 ? matches[0] : undefined);
            return {
              id: crypto.randomUUID(), scan, unitId: unit?.id ?? '', unitName: scan.unitName,
              category: scan.category || (foundCategories.length === 1 ? foundCategories[0][1] : ''),
              supplierId: availableSuppliers.find(supplier => digits(supplier.cnpj) === digits(scan.issuerCnpj))?.id ?? '',
            };
          });
          additions.push({ file, hash: imported.hash, rows, ocrUnavailable: imported.ocrUnavailable });
        } catch (error) {
          additions.push({ file, hash: crypto.randomUUID(), rows: [], error: error instanceof Error ? error.message : 'Falha ao ler o PDF.' });
        }
      }
      setFiles(current => [...current, ...additions]);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Não foi possível iniciar a leitura dos PDFs.']);
    } finally { setProgress(''); }
  }

  async function generate() {
    setMessage('');
    setErrors([]);
    if (!confirmed) {
      setErrors(['Confirme a leitura das quantidades impressas.']);
      return;
    }
    setProgress('Gerando romaneios…');
    const failures = files.flatMap(file => file.error ? [`${file.file.name} — ${file.error}`] : []);
    const outputs: { filename: string; blob: Blob }[] = [];
    const names = new Set<string>();
    try {
      const { officialQuantity, renderScannedDelivery } = await import('../lib/igeveScannedDeliveries');
      for (const { file, rows } of files) for (const row of rows) {
        const { scan } = row;
        try {
          const validNumber = scan.control ? /^\d{6,10}-\d{3,6}$/.test(scan.number) : /^\d{1,15}$/.test(scan.number);
          if (!validNumber) throw new Error('Informe o número ou controle impresso do documento.');
          const supplier = scan.control ? undefined : availableSuppliers.find(candidate => candidate.id === (row.supplierId || supplierId));
          const unit = units.find(candidate => candidate.id === row.unitId);
          const unitName = row.unitName.trim() || unit?.name || '';
          const recipientCnpj = unit?.cnpj || scan.recipientCnpj;
          if (!filenamePart(unitName)) throw new Error('Informe a unidade.');
          if (recipientCnpj && !validCnpj(recipientCnpj)) throw new Error('Confira o CNPJ do destinatário.');
          if (supplier && !recipientCnpj) throw new Error('Informe o CNPJ do destinatário para usar o modelo da empresa.');
          const documentCategory = filenamePart(row.category || category);
          const district = filenamePart(scan.district);
          if (!documentCategory || !district) throw new Error('Informe a categoria e o bairro.');
          const deliveryDate = scan.date || date;
          if (!validDocumentDate(deliveryDate)) throw new Error('Informe a data de entrega do romaneio ou a data padrão do lote.');
          if (!scan.items.length) throw new Error('Inclua os itens impressos.');
          const items = scan.items.map(item => {
            const quantity = officialQuantity(item.quantity);
            if (!Number.isFinite(quantity) || !item.product.trim() || !item.unit.trim()) {
              throw new Error(`Confira o produto, a unidade de medida e a quantidade impressa de ${item.product || 'cada item'}.`);
            }
            return { id: item.id, product: item.product.trim(), unit: item.unit.trim(), quantity, code: '', price: 0, brand: '', notes: '' };
          });
          const doc: NfeDocument = {
            ...emptyNfeDocument(), number: digits(scan.number), recipientCnpj, consumption: scan.consumption,
            unitId: unit?.id ?? `scan-${row.id}`, unitName, address: scan.address || unit?.address || '',
            deliveryDate, deliverySupplierId: supplier?.id ?? '', items, confirmed: true,
          };
          const reference = scan.control ? scan.number : '00' + scan.number.replace(/^0+(?=\d)/, '');
          const blob = supplier && !scan.control
            ? await renderDelivery(doc, supplier)
            : await renderScannedDelivery(doc, reference, scan.control, documentCategory, district);
          const base = `ROMANEIO (${reference}) - ${documentCategory}_${filenamePart(unitName)} - ${district}`;
          let filename = `${base}.pdf`;
          for (let suffix = 2; names.has(filename.toLocaleLowerCase('pt-BR')); suffix++) filename = `${base} (${suffix}).pdf`;
          names.add(filename.toLocaleLowerCase('pt-BR'));
          outputs.push({ filename, blob });
        } catch (error) {
          failures.push(`${file.name} · pág. ${scan.page} — ${error instanceof Error ? error.message : 'Falha ao gerar o PDF.'}`);
        }
      }
      if (outputs.length === 1) download(outputs[0].blob, outputs[0].filename);
      if (outputs.length > 1) {
        const { zipSync } = await import('fflate');
        const entries = await Promise.all(outputs.map(async ({ filename, blob }) => [filename, new Uint8Array(await blob.arrayBuffer())] as const));
        const zip = Uint8Array.from(zipSync(Object.fromEntries(entries), { level: 0 }));
        download(new Blob([zip], { type: 'application/zip' }), `ROMANEIOS EM LOTE - ${date || documentToday()}.zip`);
      }
      if (outputs.length) setMessage(`${outputs.length} de ${rowCount} romaneio(s) gerado(s).`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'Falha ao baixar o lote.');
    } finally {
      setErrors(failures);
      setProgress('');
    }
  }

  return <section className="card igeve-panel">
    <h3>Romaneios em lote</h3>
    <p>Selecione até 12 PDFs digitalizados. Confira as quantidades impressas na própria tela do lote. Vários romaneios são baixados juntos em um ZIP.</p>
    <fieldset disabled={!!progress} className="igeve-document-fieldset">
      <div className="igeve-actions">
        <label className="button button-outline">Selecionar PDFs digitalizados
          <input aria-label="Selecionar PDFs digitalizados" className="igeve-file-input" type="file" multiple accept="application/pdf,.pdf"
            disabled={files.length >= maxFiles} onChange={event => {
              const selected = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = '';
              if (selected.length) void selectFiles(selected);
            }} />
        </label>
        <span>{files.length} de {maxFiles} arquivos</span>
      </div>
      <div className="igeve-filters">
        <label>Data padrão de entrega<input className="input-field" type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
        <label>Categoria padrão<input className="input-field" list={categoryList} value={category} maxLength={60} onChange={event => setCategory(event.target.value)} /></label>
        <label>Empresa padrão<select className="input-field" value={supplierId} onChange={event => setSupplierId(event.target.value)}>
          <option value="">Modelo padrão do romaneio</option>
          {availableSuppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select></label>
        <datalist id={categoryList}>{categories.map(value => <option key={value} value={value} />)}</datalist>
      </div>
      {files.map(({ file, hash, rows, error, ocrUnavailable }) => <section className="igeve-document-config" key={hash}>
        <div className="igeve-actions">
          <strong>{file.name}</strong>
          <button type="button" className="button button-outline" onClick={() => {
            setFiles(current => current.filter(entry => entry.hash !== hash));
            setConfirmed(false);
          }}>Remover arquivo</button>
        </div>
        {error && <p role="alert">{error}</p>}
        {ocrUnavailable && <p role="status">A leitura automática ficou indisponível. Você pode preencher os itens impressos com o PDF original aberto nesta tela.</p>}
        {rows.map(row => {
          const { scan } = row;
          const name = `${file.name}, página ${scan.page}`;
          const patchScan = (patch: Partial<ScannedDelivery>) => updateRow(row.id, current => ({ ...current, scan: { ...current.scan, ...patch } }));
          const patchItem = (id: string, patch: Partial<ScannedItem>) =>
            patchScan({ items: scan.items.map(item => item.id === id ? { ...item, ...patch } : item) });
          return <section className="igeve-document-config" key={row.id} aria-label={name}>
            <div className="igeve-actions">
              <strong>Página {scan.page} · {scan.items.length} item(ns)</strong>
              <button type="button" className="button button-outline" onClick={() => onPreview(file, scan.page)}>Ver original</button>
              {rows.length > 1 && <button type="button" className="button button-outline" onClick={() => {
                setFiles(current => current.map(entry => entry.hash === hash ? { ...entry, rows: entry.rows.filter(item => item.id !== row.id) } : entry));
                setConfirmed(false);
              }}>Remover página</button>}
            </div>
            <div className="igeve-filters">
              <label>Número ou controle<input className="input-field" maxLength={17} value={scan.number} onChange={event => {
                const number = event.target.value.replace(/[^0-9-]/g, '');
                patchScan({ number, control: number.includes('-') });
              }} /></label>
              <label>Categoria<input className="input-field" list={categoryList} placeholder={category || 'Informe a categoria'} maxLength={60} value={row.category}
                onChange={event => updateRow(row.id, current => ({ ...current, category: event.target.value }))} /></label>
              {!scan.control && <label>Empresa<select className="input-field" value={row.supplierId} onChange={event => updateRow(row.id, current => ({ ...current, supplierId: event.target.value }))}>
                <option value="">Usar empresa padrão</option>
                {availableSuppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
              </select></label>}
              <label>Data de entrega<input className="input-field" type="date" value={scan.date} onChange={event => patchScan({ date: event.target.value })} /></label>
              <label>Unidade cadastrada<select className="input-field" value={row.unitId} onChange={event => {
                const unit = units.find(candidate => candidate.id === event.target.value);
                updateRow(row.id, current => ({ ...current, unitId: unit?.id ?? '', unitName: unit?.name ?? current.unitName }));
              }}>
                <option value="">Preencher manualmente</option>
                {units.map(unit => <option key={unit.id} value={unit.id}>{unit.name} - {unit.city}</option>)}
              </select></label>
              <label>Nome da unidade<input className="input-field" value={row.unitName} onChange={event => updateRow(row.id, current => ({ ...current, unitName: event.target.value }))} /></label>
              {!row.unitId && <label>CNPJ do destinatário<input className="input-field" inputMode="numeric" maxLength={18} value={scan.recipientCnpj}
                onChange={event => patchScan({ recipientCnpj: event.target.value })} /></label>}
              <label>Bairro<input className="input-field" value={scan.district} maxLength={60} onChange={event => patchScan({ district: event.target.value })} /></label>
              <label>Endereço<input className="input-field" value={scan.address} onChange={event => patchScan({ address: event.target.value })} /></label>
            </div>
            {!scan.items.length && <p role="status">A coluna de quantidades impressas ficou ilegível ou o formato não foi reconhecido. Compare com o original e inclua os itens oficiais.</p>}
            {!!scan.items.length && <div className="table-container"><table>
              <thead><tr><th>Produto</th><th>Unidade de medida</th><th>Quantidade impressa</th><th>Ação</th></tr></thead>
              <tbody>{scan.items.map((item, index) => <tr key={item.id}>
                <td><input className="input-field" aria-label={`Produto ${index + 1}`} value={item.product} onChange={event => patchItem(item.id, { product: event.target.value })} /></td>
                <td><input className="input-field" aria-label={`Unidade de medida ${index + 1}`} value={item.unit} onChange={event => patchItem(item.id, { unit: event.target.value })} /></td>
                <td><input className="input-field" aria-label={`Quantidade impressa ${index + 1}`} inputMode="decimal" placeholder="Conferir no original" value={item.quantity} onChange={event => patchItem(item.id, { quantity: event.target.value })} /></td>
                <td><button type="button" className="button button-outline" aria-label={`Remover item ${index + 1}`} onClick={() => patchScan({ items: scan.items.filter(candidate => candidate.id !== item.id) })}>Remover</button></td>
              </tr>)}</tbody>
            </table></div>}
            <div className="igeve-actions"><button type="button" className="button button-outline" onClick={() => patchScan({ items: [...scan.items, blankItem()] })}>Adicionar item impresso</button></div>
          </section>;
        })}
      </section>)}
      {!!rowCount && <label className="igeve-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
        Conferi os itens com os PDFs e usei as quantidades oficiais impressas.
      </label>}
      <div className="igeve-actions"><button type="button" className="button" disabled={!confirmed || !rowCount} onClick={() => void generate()}>Gerar romaneios em lote</button></div>
    </fieldset>
    {progress && <p role="status">{progress}</p>}
    {message && <p role="status">{message}</p>}
    {!!errors.length && <ul className="igeve-document-notice" role="alert">{errors.map((error, index) => <li key={index}>{error}</li>)}</ul>}
  </section>;
}
