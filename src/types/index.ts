export type Category = 'Estocáveis' | 'DIETA' | 'LIMPEZA' | 'PAPELARIA';
export type Deposit = 'Depósito-Grupo OM' | 'Depósito-RED';
export type Role = 'admin' | 'om' | 'red';

export const mapDbRoleToRole = (dbRole: string): Role => {
  if (dbRole === 'manager') return 'om';
  if (dbRole === 'user') return 'red';
  return dbRole as Role;
};

export const mapRoleToDbRole = (role: Role): string => {
  if (role === 'om') return 'manager';
  if (role === 'red') return 'user';
  return role;
};

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  created_at: string;
}

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
  deposit?: Deposit;
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
