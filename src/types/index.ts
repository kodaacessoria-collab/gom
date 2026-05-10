export type Category = 'Estocáveis' | 'DIETA' | 'LIMPEZA' | 'PAPELARIA';

export interface Product {
  id: string;
  name: string;
  category: Category;
  unit: string;
  brand?: string;
  batch?: string;
  mfg_date?: string;
  expiry_date?: string;
  quantity: number;
  min_stock: number;
  created_at: string;
}

export interface Slip {
  id: string;
  date: string;
  category: Category;
  product_id: string;
  unit: string;
  quantity: number;
  destination: string;
  type: 'ENTRADA' | 'SAIDA';
  created_at: string;
}

export interface PurchaseOrder {
  id: string;
  date: string;
  status: 'PENDENTE' | 'APROVADO' | 'CANCELADO';
  items: {
    product_id: string;
    product_name: string;
    quantity: number;
  }[];
  created_at: string;
}
