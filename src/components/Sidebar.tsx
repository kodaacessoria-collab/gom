import { LayoutDashboard, Package, FileText, ShoppingCart, BarChart3, X, History, Users, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isOpen: boolean;
  toggle: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, isOpen, toggle }) => {
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

  return (
    <>
      <div className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>GOM ESTOQUE</h2>
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
      {isOpen && <div className="sidebar-overlay" onClick={toggle}></div>}
    </>
  );
};

export default Sidebar;
