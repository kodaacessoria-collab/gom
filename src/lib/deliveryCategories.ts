export const DEFAULT_DELIVERY_CATEGORIES = [
  'Hortifrutigranjeiro',
  'Estocáveis',
  'Dietas e Fórmulas',
  'Proteínas',
  'Limpeza',
  'CESTA BASICA',
  'PAPELARIA',
];

export const deliveryCategoryKey = (name: string) =>
  name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
