import { LayoutDashboard, Package, FileText, ShoppingCart, BarChart3, X, History, Users, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';

import { createPortal } from 'react-dom';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isOpen: boolean;
  toggle: () => void;
  userEmail?: string;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, isOpen, toggle, userEmail }) => {
  const menuItems = [
    { id: 'dashboard', label: 'Painel', icon: LayoutDashboard },
    { id: 'inventory', label: 'Estoque', icon: Package },
    { id: 'slips', label: 'Romaneios', icon: FileText },
    { id: 'purchase-orders', label: 'Pedidos de Compra', icon: ShoppingCart },
    { id: 'reports', label: 'Relatórios', icon: BarChart3 },
    { id: 'logs', label: 'Logs', icon: History },
    { id: 'users', label: 'Usuários', icon: Users },
  ];

  const handleLogout = async () => {
    localStorage.removeItem('gom_admin_bypass');
    await supabase.auth.signOut();
  };

  const content = (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={toggle}></div>}
      <div className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div>
            <h2 style={{ marginBottom: '0.25rem' }}>GOM ESTOQUE</h2>
            <p style={{ fontSize: '0.75rem', opacity: 0.8, color: 'var(--indigo-light)', fontWeight: 500 }}>
              {userEmail || 'Usuário Conectado'}
            </p>
          </div>
          <button className="mobile-close" onClick={toggle}>
            <X size={24} />
          </button>
        </div>
        <nav className="sidebar-nav">
          {menuItems.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => {
                setActiveTab(item.id);
                if (window.innerWidth < 1024) toggle();
              }}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
            </button>
          ))}
          
          <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
            <button className="nav-item" onClick={handleLogout} style={{ color: '#ef4444', width: '100%' }}>
              <LogOut size={20} />
              <span>Sair</span>
            </button>
          </div>
        </nav>
      </div>
    </>
  );

  return createPortal(content, document.body);
};

export default Sidebar;
