import jsPDF from 'jspdf';
import logoUrl from '../assets/oliveira-mendes-logo.jpeg';
import igeveLogoUrl from '../assets/igeve-logo.png';

type Color = [number, number, number];
export type PdfLogoVariant = 'gom' | 'igeve';

interface PdfHeaderOptions {
  title: string;
  subtitle?: string;
  footer?: string;
  logoVariant?: PdfLogoVariant;
  fillColor?: Color;
  titleColor?: Color;
  textColor?: Color;
  height?: number;
  titleFontSize?: number;
  detailFontSize?: number;
}

interface CompanyLetterheadOptions {
  title: string;
  subtitle?: string;
  logoVariant?: PdfLogoVariant;
}

const logoSources: Record<PdfLogoVariant, string> = {
  gom: logoUrl,
  igeve: igeveLogoUrl,
};

const logoFormats: Record<PdfLogoVariant, 'JPEG' | 'PNG'> = {
  gom: 'JPEG',
  igeve: 'PNG',
};

const cachedLogoDataUrls = new Map<PdfLogoVariant, string>();

const loadLogoDataUrl = async (logoVariant: PdfLogoVariant) => {
  const cachedLogoDataUrl = cachedLogoDataUrls.get(logoVariant);
  if (cachedLogoDataUrl) return cachedLogoDataUrl;

  const response = await fetch(logoSources[logoVariant]);
  const blob = await response.blob();

  const logoDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  cachedLogoDataUrls.set(logoVariant, logoDataUrl);
  return logoDataUrl;
};

export const addPdfHeader = async (doc: jsPDF, options: PdfHeaderOptions) => {
  const {
    title,
    subtitle,
    footer,
    logoVariant = 'gom',
    fillColor = [255, 255, 255],
    titleColor = [10, 48, 92],
    textColor = [10, 48, 92],
    height = 34,
    titleFontSize = 11,
    detailFontSize = 11,
  } = options;

  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(...fillColor);
  doc.rect(0, 0, pageWidth, height, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.2);
  doc.line(0, height, pageWidth, height);

  try {
    const logoDataUrl = await loadLogoDataUrl(logoVariant);
    doc.addImage(logoDataUrl, logoFormats[logoVariant], 10, 4, 21, 21);
  } catch (err) {
    console.warn('Nao foi possivel carregar a logo no PDF:', err);
  }

  doc.setFont('courier', 'bold');
  doc.setFontSize(titleFontSize);
  doc.setTextColor(...titleColor);
  const titleLines = (doc.splitTextToSize(title, pageWidth - 46) as string[]).slice(0, 2);
  doc.text(titleLines, 36, 8);

  doc.setFont('courier', 'bold');
  doc.setFontSize(detailFontSize);
  doc.setTextColor(...textColor);
  if (subtitle) doc.text(subtitle, 36, 22, { maxWidth: pageWidth - 46 });
  if (footer) doc.text(footer, 36, 29, { maxWidth: pageWidth - 46 });

  doc.setTextColor(31, 41, 55);
};

export const addCompanyLetterhead = async (doc: jsPDF, options: CompanyLetterheadOptions) => {
  const {
    title,
    subtitle,
    logoVariant = 'gom',
  } = options;
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageWidth, 43, 'F');

  try {
    const logoDataUrl = await loadLogoDataUrl(logoVariant);
    doc.addImage(logoDataUrl, logoFormats[logoVariant], 12, 4, 24, 24);
  } catch (err) {
    console.warn('Nao foi possivel carregar a logo no timbre do PDF:', err);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(151, 174, 207);
  doc.text('OLIVEIRA MENDES DISTRIBUIDORA', pageWidth / 2, 11, { align: 'center' });
  doc.setFontSize(13);
  doc.text('57.135.668/0001-63', pageWidth / 2, 18, { align: 'center' });

  doc.setDrawColor(177, 145, 145);
  doc.setLineWidth(1.1);
  doc.line(10, 30, pageWidth - 10, 30);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(title, pageWidth / 2, 36, { align: 'center', maxWidth: pageWidth - 24 });
  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(subtitle, pageWidth / 2, 41, { align: 'center', maxWidth: pageWidth - 24 });
  }
  doc.setTextColor(31, 41, 55);
};
