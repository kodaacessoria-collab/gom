import { useId, useState } from 'react';
import { BILLING_CATEGORIES } from '../lib/igeveBilling';
import { decimal2, digits, documentReference, documentToday, unitsForCnpj, validCnpj, validDocumentDate } from '../lib/igeveDocuments';
import type { DocumentSupplier, IgeveUnit, NfeDocument } from '../lib/igeveDocuments';
import { importNfePdf, NFE_REVIEW_REMINDER } from '../lib/nfePdfImport';

const MAX_INVOICES = 12;
const categories = [...new Set<string>([...BILLING_CATEGORIES, 'Papelaria'])];
const categoryAliases: [RegExp, string][] = [
  [/\bHORTI(?:FRUTI(?:GRANJEIRO)?)?\b/, 'Hortifrutigranjeiro'],
  [/\bESTOCAVE(?:L|IS)\b/, 'Estocáveis'],
  [/\b(?:DIETAS?|FORMULAS?)\b/, 'Dietas e Fórmulas'],
  [/\bPROTEINAS?\b/, 'Proteínas'],
  [/\bLIMPEZA\b/, 'Limpeza'],
  [/\bCESTAS? BASICAS?\b/, 'Cesta Básica'],
  [/\bPAPELARIA\b/, 'Papelaria'],
];

interface BatchInvoice {
  id: string;
  filename: string;
  document?: NfeDocument;
  unitId: string;
  category: string;
  district: string;
  importError?: string;
}

export interface BatchQuotePartner {
  supplier: DocumentSupplier;
  markup: 8.75 | 12.35;
}

interface Props {
  units: IgeveUnit[];
  suppliers: DocumentSupplier[];
  renderQuote: (invoice: NfeDocument, quotationDate: string, partner?: BatchQuotePartner) => Promise<Blob>;
  download: (blob: Blob, filename: string) => void;
}

function categoryFromFilename(filename: string) {
  const text = filename.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ');
  const matches = categoryAliases.filter(([pattern]) => pattern.test(text));
  return matches.length === 1 ? matches[0][1] : '';
}

function filenamePart(value: string) {
  return value.normalize('NFC').replace(/[^\p{L}\p{M}\p{N} ()&.,'-]+/gu, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
}

function quoteFilename(number: string, category: string, unit: string, district: string, partner?: DocumentSupplier) {
  const reference = documentReference(number);
  const company = partner ? ` - ${filenamePart(partner.name).slice(0, 60)}` : '';
  return `ORÇAMENTO (${reference}) - ${filenamePart(category)}_${filenamePart(unit)} - ${filenamePart(district)}${company}.pdf`;
}

export default function IgeveBatchQuotes({ units, suppliers, renderQuote, download }: Props) {
  const categoryListId = useId();
  const [invoices, setInvoices] = useState<BatchInvoice[]>([]);
  const [quotationDate, setQuotationDate] = useState(documentToday);
  const [batchCategory, setBatchCategory] = useState('');
  const [includeIssuer, setIncludeIssuer] = useState(true);
  const [partnerIds, setPartnerIds] = useState<Record<BatchQuotePartner['markup'], string>>({ 8.75: '', 12.35: '' });
  const partnerMarkups = [8.75, 12.35] as const;
  const eligiblePartners = suppliers.filter(supplier => supplier.name.trim() && validCnpj(supplier.cnpj));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  function updateInvoice(id: string, patch: Partial<BatchInvoice>) {
    setInvoices(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row));
  }

  async function selectFiles(files: File[]) {
    setMessage('');
    setErrors([]);
    if (invoices.length + files.length > MAX_INVOICES) {
      setErrors([`Selecione até ${MAX_INVOICES} NF-e por lote. Há ${invoices.length} no lote atual.`]);
      return;
    }

    setBusy(true);
    const rows: BatchInvoice[] = [];
    const seen = new Set(invoices.flatMap(row => row.document ? [row.document.sourceHash] : []));
    for (const file of files) {
      const row: BatchInvoice = {
        id: crypto.randomUUID(), filename: file.name, unitId: '',
        category: categoryFromFilename(file.name) || batchCategory, district: '',
      };
      try {
        const imported = await importNfePdf(file);
        if (seen.has(imported.document.sourceHash)) throw new Error('Este PDF já está no lote.');
        const warnings = imported.warnings.filter(warning => warning !== NFE_REVIEW_REMINDER);
        if (warnings.length) throw new Error(warnings.join(' '));
        seen.add(imported.document.sourceHash);
        row.document = imported.document;
        row.district = imported.district;
        const matches = unitsForCnpj(imported.document.recipientCnpj, units);
        if (matches.length === 1) row.unitId = matches[0].id;
      } catch (error) {
        row.importError = error instanceof Error ? error.message : 'Não foi possível ler o PDF.';
      }
      rows.push(row);
    }
    setInvoices(current => [...current, ...rows]);
    setBusy(false);
  }

  async function generate() {
    setMessage('');
    setErrors([]);
    if (!validDocumentDate(quotationDate) || quotationDate > documentToday()) {
      setErrors(['Informe a data do orçamento, até a data de hoje.']);
      return;
    }
    const partners: BatchQuotePartner[] = [];
    for (const markup of partnerMarkups) {
      if (!partnerIds[markup]) continue;
      const supplier = eligiblePartners.find(candidate => candidate.id === partnerIds[markup]);
      if (!supplier || partners.some(partner => digits(partner.supplier.cnpj) === digits(supplier.cnpj))) {
        setErrors(['Selecione empresas parceiras diferentes e com cadastro válido.']);
        return;
      }
      partners.push({ supplier, markup });
    }
    const targets = includeIssuer ? [undefined, ...partners] : partners;
    if (!targets.length) return;

    setBusy(true);
    const failures: string[] = [];
    const skipped: string[] = [];
    const outputs: { filename: string; blob: Blob }[] = [];
    const filenames = new Set<string>();
    let invoicesWithQuotes = 0;
    try {
      for (const row of invoices) {
        try {
          if (!row.document) throw new Error(row.importError || 'NF-e indisponível.');
          if (!digits(row.document.number)) throw new Error('Número da NF-e não identificado.');
          const unit = unitsForCnpj(row.document.recipientCnpj, units).find(match => match.id === row.unitId);
          if (!unit) throw new Error('Selecione a unidade que corresponde ao CNPJ do destinatário.');
          if (!filenamePart(row.category) || !filenamePart(row.district)) throw new Error('Informe a categoria e o bairro.');
          const invoice = {
            ...row.document,
            unitId: unit.id,
            unitName: unit.name,
            address: unit.address || row.document.address,
          };
          const previousCount = outputs.length;
          for (const partner of targets) {
            if (partner && digits(partner.supplier.cnpj) === digits(invoice.issuerCnpj)) {
              skipped.push(`${row.filename} — ${partner.supplier.name} é a emitente desta NF-e.`);
              continue;
            }
            try {
              const blob = await renderQuote(invoice, quotationDate, partner);
              const base = quoteFilename(invoice.number, row.category, unit.name, row.district, partner?.supplier);
              let filename = base;
              for (let suffix = 2; filenames.has(filename.toLocaleLowerCase('pt-BR')); suffix++) {
                filename = base.replace(/\.pdf$/, ` (${suffix}).pdf`);
              }
              filenames.add(filename.toLocaleLowerCase('pt-BR'));
              outputs.push({ filename, blob });
            } catch (error) {
              const company = partner?.supplier.name ?? 'Empresa principal';
              failures.push(`${row.filename} — ${company}: ${error instanceof Error ? error.message : 'Erro ao gerar o orçamento.'}`);
            }
          }
          if (outputs.length > previousCount) invoicesWithQuotes++;
        } catch (error) {
          failures.push(`${row.filename}: ${error instanceof Error ? error.message : 'Erro ao gerar o orçamento.'}`);
        }
      }
      if (outputs.length === 1) {
        download(outputs[0].blob, outputs[0].filename);
      } else if (outputs.length > 1) {
        const { zipSync } = await import('fflate');
        const files = await Promise.all(outputs.map(async ({ filename, blob }) => [filename, new Uint8Array(await blob.arrayBuffer())] as const));
        const zip = Uint8Array.from(zipSync(Object.fromEntries(files), { level: 0 }));
        download(new Blob([zip], { type: 'application/zip' }), `ORÇAMENTOS EM LOTE - ${quotationDate}.zip`);
      }
      if (outputs.length) setMessage(`${outputs.length} orçamento(s) gerado(s) para ${invoicesWithQuotes} de ${invoices.length} NF-e.`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'Não foi possível baixar o lote.');
    } finally {
      setErrors([...failures, ...skipped]);
      setBusy(false);
    }
  }

  return <section className="card igeve-panel">
    <h3>Orçamentos em lote</h3>
    <p>Selecione até 12 NF-e em PDF. Escolha o orçamento espelho da empresa emitente e até duas parceiras para cada nota.</p>
    <fieldset disabled={busy} className="igeve-document-fieldset">
      <div className="igeve-actions">
        <label className="button button-outline">Selecionar NF-e em PDF
          <input aria-label="Selecionar NF-e em PDF para o lote" className="igeve-file-input" type="file" multiple accept="application/pdf,.pdf" disabled={invoices.length === MAX_INVOICES} onChange={event => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = '';
            if (files.length) void selectFiles(files);
          }} />
        </label>
        <span>{invoices.length} de {MAX_INVOICES} NF-e selecionadas</span>
      </div>
      <div className="igeve-filters">
        <label>Data do orçamento<input className="input-field" type="date" max={documentToday()} value={quotationDate} onChange={event => setQuotationDate(event.target.value)} /></label>
        <label>Categoria para o lote<input className="input-field" list={categoryListId} value={batchCategory} onChange={event => setBatchCategory(event.target.value)} maxLength={60} /></label>
        <button type="button" className="button button-outline" disabled={!batchCategory.trim() || !invoices.some(row => row.document && !row.category.trim())} onClick={() => setInvoices(rows => rows.map(row => row.category.trim() ? row : { ...row, category: batchCategory }))}>Preencher categorias em branco</button>
        <datalist id={categoryListId}>{categories.map(category => <option key={category} value={category} />)}</datalist>
      </div>
      <div className="igeve-filters">
        <label className="igeve-check">
          <input type="checkbox" checked={includeIssuer} onChange={event => setIncludeIssuer(event.target.checked)} />
          Incluir empresa principal (emitente da NF-e)
        </label>
        {partnerMarkups.map(markup => {
          const otherId = partnerIds[markup === 8.75 ? 12.35 : 8.75];
          const otherCnpj = digits(eligiblePartners.find(supplier => supplier.id === otherId)?.cnpj ?? '');
          return <label key={markup}>Parceira (+{decimal2(markup)}%)
            <select className="input-field" value={partnerIds[markup]} onChange={event => {
              const id = event.target.value;
              setPartnerIds(previous => ({ ...previous, [markup]: id }));
            }}>
              <option value="">Selecione uma parceira (opcional)</option>
              {eligiblePartners.map(supplier => <option key={supplier.id} value={supplier.id} disabled={digits(supplier.cnpj) === otherCnpj}>{supplier.name}</option>)}
            </select>
          </label>;
        })}
      </div>
      {invoices.length > 0 && <div className="table-container"><table>
        <thead><tr><th>Arquivo / número</th><th>Categoria</th><th>Unidade de entrega</th><th>Bairro</th><th>Ação</th></tr></thead>
        <tbody>{invoices.map(row => {
          const matches = row.document ? unitsForCnpj(row.document.recipientCnpj, units) : [];
          return <tr key={row.id}>
            <td>{row.filename}{row.document?.number && <div><small>Nº {row.document.number}</small></div>}</td>
            {row.importError ? <td colSpan={3}>{row.importError} Use o preparo individual se for necessário revisar a NF-e.</td> : <>
              <td><input className="input-field" aria-label={`Categoria de ${row.filename}`} list={categoryListId} value={row.category} maxLength={60} onChange={event => updateInvoice(row.id, { category: event.target.value })} /></td>
              <td>{matches.length > 0 ? <select className="input-field" aria-label={`Unidade de ${row.filename}`} value={row.unitId} onChange={event => updateInvoice(row.id, { unitId: event.target.value })}>
                <option value="">Selecione a unidade</option>
                {matches.map(unit => <option key={unit.id} value={unit.id}>{unit.name} - {unit.city}</option>)}
              </select> : 'CNPJ sem unidade cadastrada'}</td>
              <td><input className="input-field" aria-label={`Bairro de ${row.filename}`} value={row.district} maxLength={60} onChange={event => updateInvoice(row.id, { district: event.target.value })} /></td>
            </>}
            <td><button type="button" className="button button-outline" aria-label={`Remover ${row.filename}`} onClick={() => setInvoices(rows => rows.filter(item => item.id !== row.id))}>Remover</button></td>
          </tr>;
        })}</tbody>
      </table></div>}
      <div className="igeve-actions">
        <button type="button" className="button" disabled={!invoices.some(row => row.document) || !(includeIssuer || partnerIds[8.75] || partnerIds[12.35])} onClick={() => void generate()}>Gerar orçamentos em lote</button>
      </div>
    </fieldset>
    {busy && <p role="status">Processando NF-e...</p>}
    {message && <p role="status">{message}</p>}
    {errors.length > 0 && <ul className="igeve-document-notice" role="alert">{errors.map((error, index) => <li key={index}>{error}</li>)}</ul>}
  </section>;
}
