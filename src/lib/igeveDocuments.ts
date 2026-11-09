export const DOCUMENT_PREFIX = 'gom_igeve_document_';
export const SUPPLIER_PREFIX = 'gom_igeve_supplier_';
export const UNIT_PREFIX = 'gom_igeve_unit_';
export type DocumentLayout = 'caninde' | 'nobre' | 'om' | 'lm' | 'red' | 'delicias' | 'manu' | 'rionutri' | 'generic';
export interface DocumentSupplier {
  id: string; name: string; cnpj: string; address: string; contact: string;
  layout: DocumentLayout; color: string; payment: string; validity: number;
  footer: string; logo?: string; referenceName?: string; referencePdf?: string;
}
export interface IgeveUnit { id: string; name: string; cnpj: string; city: string; address: string }
export interface NfeItem { id: string; code: string; product: string; unit: string; quantity: number; price: number; brand: string; notes: string }
export interface Quotation {
  supplierId: string; date: string; reference: string; markupPercent?: number; automaticPrices?: boolean; prices: Record<string, number | null>;
}
export interface NfeDocument {
  id: string; number: string; issuedAt: string; issuer: string; issuerCnpj: string;
  recipient: string; recipientCnpj: string; unitId: string; unitName: string; address: string;
  deliveryDate: string; consumption: string; baskets: number; notes: string;
  items: NfeItem[]; quotations: Quotation[]; deliverySupplierId: string;
  sourceName: string; sourceHash: string; importedAt: string; confirmed: boolean;
}
export const digits = (value: string) => value.replace(/\D/g, '');
export const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const decimal2 = (value: number) => value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const documentToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
export function parseBrazilianNumber(value: string): number {
  const clean = value.replace(/R\$|\s/g, '');
  if (!/^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(clean)) return NaN;
  return Number(clean.replace(/\./g, '').replace(',', '.'));
}
export function validDocumentDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
export function validCnpj(value: string) {
  const s = digits(value);
  if (s.length !== 14 || /^(\d)\1+$/.test(s)) return false;
  const check = (part: string) => {
    let weight = part.length - 7;
    const sum = [...part].reduce((sum, n) => { const v = Number(n) * weight; weight = weight === 2 ? 9 : weight - 1; return sum + v; }, 0);
    const rest = sum % 11; return rest < 2 ? 0 : 11 - rest;
  };
  return check(s.slice(0, 12)) === Number(s[12]) && check(s.slice(0, 13)) === Number(s[13]);
}
export function unitsForCnpj(cnpj: string, units: IgeveUnit[]) {
  return digits(cnpj).length === 14 ? units.filter(unit => digits(unit.cnpj) === digits(cnpj)) : [];
}
export function documentFilename(supplier: DocumentSupplier, doc: NfeDocument, kind: 'quote' | 'delivery') {
  const safe = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100);
  const words = safe(supplier.name).split('_').filter(Boolean);
  const initials = supplier.layout === 'manu' ? 'MA' : words.length > 1 ? words.slice(0, 2).map(w => w[0]).join('') : words[0]?.slice(0, 2);
  return `${(initials || 'FO').toUpperCase()}-${kind === 'quote' ? 'ORÇAMENTO' : `ROMANEIO_${safe(doc.number)}`}-${safe(doc.unitName)}.pdf`;
}
export function documentTotal(items: NfeItem[], prices?: Record<string, number | null>) {
  return items.reduce((sum, item) => sum + Math.round(round2(item.quantity * (prices ? prices[item.id] ?? 0 : item.price)) * 100), 0) / 100;
}
// Automatic quotations always use the original NF-e unit price as their base.
export function quotationPrices(items: NfeItem[], markupPercent: number) {
  return Object.fromEntries(items.map(item => [item.id, Number.isFinite(item.price) ? round2(item.price * (1 + markupPercent / 100)) : null]));
}
export function createAutomaticQuotation(doc: NfeDocument, supplier: DocumentSupplier, suppliers: DocumentSupplier[]): Quotation {
  const isIssuer = (id: string) => {
    const company = suppliers.find(s => s.id === id);
    return digits(doc.issuerCnpj).length === 14 && digits(company?.cnpj || '') === digits(doc.issuerCnpj);
  };
  const used = doc.quotations.filter(q => !isIssuer(q.supplierId));
  const markupPercent = isIssuer(supplier.id) ? 0 : used.some(q => q.markupPercent === 8.75 || q.markupPercent == null) ? 12.35 : 8.75;
  if (!isIssuer(supplier.id) && used.length >= 2) throw new Error('Selecione até dois parceiros e o emitente da NF-e.');
  return { supplierId: supplier.id, date: documentToday(), reference: markupPercent ? `Orçamento calculado: NF-e ${doc.number} + ${decimal2(markupPercent)}%` : `NF-e ${doc.number}`, markupPercent, automaticPrices: true, prices: quotationPrices(doc.items, markupPercent) };
}
export function validateNfeDocument(doc: NfeDocument, suppliers: DocumentSupplier[], kind?: 'quote' | 'delivery') {
  if (!doc.number.trim()) return 'Informe o número da NF-e.';
  if (!doc.recipient.trim()) return 'Informe o nome do destinatário.';
  if (doc.issuedAt && !validDocumentDate(doc.issuedAt)) return 'Confira a data de emissão da NF-e.';
  if (doc.issuerCnpj && !validCnpj(doc.issuerCnpj)) return 'Confira o CNPJ do emitente da NF-e.';
  if (!validCnpj(doc.recipientCnpj)) return 'Confira o CNPJ do destinatário.';
  if (!doc.unitId || !doc.unitName.trim()) return 'Selecione a unidade de atendimento.';
  if (!doc.items.length) return 'Inclua os produtos da nota.';
  if (doc.items.some(i => !i.product.trim() || !i.unit.trim() || !Number.isFinite(i.quantity) || i.quantity <= 0 || !Number.isFinite(i.price) || i.price < 0 || round2(i.quantity) !== i.quantity || round2(i.price) !== i.price)) return 'Confira produtos, unidades, quantidades e preços. Use no máximo duas casas decimais.';
  if (!Number.isFinite(doc.baskets) || doc.baskets < 0 || round2(doc.baskets) !== doc.baskets) return 'Confira a quantidade de cestas (até duas casas decimais).';
  if (!doc.confirmed) return 'Confirme a conferência dos dados da NF-e e da unidade.';
  if (kind === 'delivery') {
    if (!validDocumentDate(doc.deliveryDate)) return 'Informe a data de entrega.';
    if (!suppliers.some(s => s.id === doc.deliverySupplierId && validCnpj(s.cnpj))) return 'Selecione uma empresa de entrega com CNPJ válido.';
  }
  if (kind === 'quote') {
    if (!doc.quotations.length || doc.quotations.length > 3) return 'Selecione de um a três fornecedores para os orçamentos.';
    if (new Set(doc.quotations.map(q => q.supplierId)).size !== doc.quotations.length) return 'Selecione fornecedores diferentes.';
    for (const q of doc.quotations) {
      if (!suppliers.some(s => s.id === q.supplierId && validCnpj(s.cnpj))) return 'Confira o cadastro e o CNPJ de cada fornecedor selecionado.';
      if (!validDocumentDate(q.date) || q.date > documentToday()) return 'Informe a data efetiva de cada cotação, até a data de hoje.';
      if (!q.reference.trim()) return 'Informe a referência da cotação recebida de cada fornecedor.';
      if (doc.items.some(i => q.prices[i.id] == null || !Number.isFinite(q.prices[i.id]) || q.prices[i.id]! < 0 || round2(q.prices[i.id]!) !== q.prices[i.id])) return 'Informe o preço real de todos os itens de cada fornecedor, com até duas casas decimais.';
    }
  }
  return '';
}
const supplier = (id: string, name: string, cnpj: string, address: string, layout: DocumentLayout, color: string): DocumentSupplier => ({ id, name, cnpj, address, layout, color, contact: '', payment: 'PIX / à vista', validity: 90, footer: '' });
export const DEFAULT_DOCUMENT_SUPPLIERS: DocumentSupplier[] = [
  supplier('caninde', 'CANINDÉ DISTRIBUIDORA EM GERAL LTDA', '66.321.676/0001-95', 'Rua Manoel Feitosa Sobrinho, 278 - Centro - Canindé de São Francisco/SE - CEP 49.820-000', 'caninde', '#203b50'),
  supplier('nobre', 'GRANTERRA COMÉRCIO DE ALIMENTOS LTDA - NOBRE', '07.019.669/0001-74', 'Rua Lauro de Gusmão Silveira, 849 - Jd. São Geraldo - Guarulhos/SP - CEP 07146-010', 'nobre', '#eaa116'),
  supplier('om', 'OM LOGÍSTICA E DISTRIBUIÇÃO LTDA', '68.673.515/0001-96', 'Rua Professor José Augusto de Oliveira, 548 - Jardim Beatriz - Ourinhos/SP - CEP 19915-280', 'om', '#254c84'),
  supplier('lm', 'L M DE OLIVEIRA COMERCIAL LTDA', '66.036.822/0001-30', 'Rua Jornalista Eron Domingues, 553 - Vila Brasil - Ourinhos/SP - CEP 19915-200', 'lm', '#333333'),
  supplier('red', 'RED SOLUÇÕES E SERVIÇOS DO BRASIL LTDA', '12.484.640/0001-01', 'Av. Mofarrej, 348 - Conj. 1308 - Vila Leopoldina - São Paulo/SP - CEP 05311-000', 'red', '#356345'),
  supplier('delicias', 'DELICIAS ALIMENTOS', '', '', 'delicias', '#4d4d4d'),
  { ...supplier('manu', 'MANU DISTRIBUIDORA DE ALIMENTOS EIRELI', '17.979.701/0001-17', 'Rua Visconde de Pirajá, 414 - Sala 718 - Ipanema - Rio de Janeiro/RJ', 'manu', '#08265b'), contact: 'Telefone (21) 96595-8320', payment: 'Pix / Dep. Bancário' },
  { ...supplier('rionutri', 'RioNutri Distribuidora Ltda.', '69.599.208/0001-75', 'Rua Visconde de Pirajá, 414, Sala 718/1021 - Ipanema - Rio de Janeiro/RJ - CEP 22410-002', 'rionutri', '#008777'), contact: '(14) 99868-8551 | comercial.grupoom@gmail.com', payment: 'Banco C6 (336) - Ag. 0001 - CC 44609673-3 | PIX: 69.599.208/0001-75', referenceName: 'Romaneio_0003 - PROTEINAS.pdf', footer: 'Rio Nutri Distribuição | Inscrição estadual: 16.782.29-7' },
];
const unitRows: [string, string, string][] = [
  ['MATRIZ - RATEIO', '0001-92', 'Campinas/SP'], ['CEI IGEVE RUBI', '0007-88', 'Guaianases/SP'], ['CEI IGEVE MENDONÇA', '0012-45', 'Guaianases/SP'],
  ['IGEVE - MARIA ENAIDE', '0003-54', 'Guarulhos/SP'], ['IGEVE - INOCOOP', '0001-92', 'Guarulhos/SP'], ['IGEVE CEDRAL', '0023-06', 'Cedral/SP'],
  ['PROAF', '0022-17', 'São Vicente/SP'], ['IGEVE CAMPINAS-COSMOS', '0036-12', 'Campinas/SP'], ['IGEVE - CEI 143', '0037-01', 'Sorocaba/SP'],
  ['CEI DÓRIS REGINA HOLTZ', '0038-84', 'Boituva/SP'], ['IGEVE - JUNDIAÍ', '0033-70', 'Jundiaí/SP'], ['IGEVE - VALINHOS', '0047-75', 'Valinhos/SP'],
  ['CRECHE NOSSA SENHORA APARECIDA', '0050-70', 'Mongaguá/SP'], ['CRECHE PROF.ª RAUDNA MARIA EVANGELISTA DA SILVA', '0050-70', 'Mongaguá/SP'], ['CRECHE WALTER GOMES SEABRA', '0050-70', 'Mongaguá/SP'],
  ['IGEVE - RIO DE JANEIRO', '0040-07', 'Rio de Janeiro/RJ'], ['IGEVE - CANOAS', '0042-60', 'Canoas/RS'],
  ['ANTARES', '0029-93', 'Maceió/AL'], ['SANTOS DUMONT', '0025-60', 'Maceió/AL'], ['TABULEIRO', '0026-40', 'Maceió/AL'], ['CHÃ DA JAQUEIRA', '0027-21', 'Maceió/AL'], ['PONTA DA TERRA', '0030-27', 'Maceió/AL'], ['JACINTINHO FEITOSA', '0031-08', 'Maceió/AL'],
  ['GARÇA TORTA', '0041-80', 'Maceió/AL'], ['NOVO JARDIM', '0043-41', 'Maceió/AL'], ['OITICICA', '0046-94', 'Maceió/AL'], ['PETROPOLIS', '0032-99', 'Maceió/AL'], ['MORADA PLANALTO', '0044-22', 'Maceió/AL'], ['TRAPICHE', '0034-50', 'Maceió/AL'], ['SALVADOR LIRA (DUBEUX LEÃO)', '0045-03', 'Maceió/AL'],
];
export const DEFAULT_IGEVE_UNITS: IgeveUnit[] = unitRows.map(([name, suffix, city], i) => ({ id: `igeve-unit-${i + 1}`, name, cnpj: `28.413.401/${suffix}`, city, address: '' }));
export function emptyNfeDocument(): NfeDocument {
  return { id: `${DOCUMENT_PREFIX}${crypto.randomUUID()}`, number: '', issuedAt: '', issuer: '', issuerCnpj: '', recipient: 'INSTITUTO DE GESTÃO EDUCACIONAL E VALORIZAÇÃO DO ENSINO - IGEVE', recipientCnpj: '', unitId: '', unitName: '', address: '', deliveryDate: '', consumption: '', baskets: 0, notes: '', items: [], quotations: [], deliverySupplierId: '', sourceName: '', sourceHash: '', importedAt: '', confirmed: false };
}
