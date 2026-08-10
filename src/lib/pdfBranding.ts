import jsPDF from 'jspdf';
import logoUrl from '../assets/oliveira-mendes-logo.jpeg';

type Color = [number, number, number];

interface PdfHeaderOptions {
  title: string;
  subtitle?: string;
  footer?: string;
  fillColor?: Color;
  titleColor?: Color;
  textColor?: Color;
  height?: number;
}

let cachedLogoDataUrl: string | null = null;

const loadLogoDataUrl = async () => {
  if (cachedLogoDataUrl) return cachedLogoDataUrl;

  const response = await fetch(logoUrl);
  const blob = await response.blob();

  cachedLogoDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  return cachedLogoDataUrl;
};

export const addPdfHeader = async (doc: jsPDF, options: PdfHeaderOptions) => {
  const {
    title,
    subtitle,
    footer,
    fillColor = [15, 23, 42],
    titleColor = [255, 255, 255],
    textColor = [226, 232, 240],
    height = 30,
  } = options;

  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(...fillColor);
  doc.rect(0, 0, pageWidth, height, 'F');

  try {
    const logoDataUrl = await loadLogoDataUrl();
    doc.addImage(logoDataUrl, 'JPEG', 10, 4, 21, 21);
  } catch (err) {
    console.warn('Nao foi possivel carregar a logo no PDF:', err);
  }

  doc.setFont('courier', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...titleColor);
  doc.text(title, 36, 10, { maxWidth: pageWidth - 46 });

  doc.setFont('courier', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...textColor);
  if (subtitle) doc.text(subtitle, 36, 18, { maxWidth: pageWidth - 46 });
  if (footer) doc.text(footer, 36, 26, { maxWidth: pageWidth - 46 });

  doc.setTextColor(31, 41, 55);
};
