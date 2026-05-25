import React, { useEffect } from 'react';
import { LayoutDashboard, Package, FileText, ShoppingCart, BarChart3, X, History, Users, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Role } from '../types';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isOpen: boolean;
  toggle: () => void;
  userEmail?: string;
  userRole?: Role | null;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, isOpen, toggle, userEmail, userRole }) => {
  const allMenuItems = [
    { id: 'dashboard', label: 'Painel', icon: LayoutDashboard },
    { id: 'inventory', label: 'Estoque', icon: Package },
    { id: 'slips', label: 'Romaneios', icon: FileText },
    { id: 'purchase-orders', label: 'Pedidos de Compra', icon: ShoppingCart },
    { id: 'reports', label: 'Relatórios', icon: BarChart3 },
    { id: 'logs', label: 'Logs', icon: History },
    { id: 'users', label: 'Usuários', icon: Users },
  ];

  const getMenuItems = () => {
    if (!userRole || userRole === 'admin') return allMenuItems;
    if (userRole === 'om') return allMenuItems.filter(i => ['inventory', 'reports'].includes(i.id));
    if (userRole === 'red') return allMenuItems.filter(i => ['reports'].includes(i.id));
    return [];
  };

  const menuItems = getMenuItems();

  const handleLogout = async () => {
    localStorage.removeItem('gom_admin_bypass');
    await supabase.auth.signOut();
  };

  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('menu-open');
      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') toggle();
      };
      window.addEventListener('keydown', handleEsc);
      return () => {
        document.body.classList.remove('menu-open');
        window.removeEventListener('keydown', handleEsc);
        // Retorna o foco ao botão hambúrguer ao fechar o menu (acessibilidade)
        document.getElementById('mobile-menu-btn')?.focus();
      };
    } else {
      document.body.classList.remove('menu-open');
    }
  }, [isOpen, toggle]);

  return (
    <>
      {isOpen && (
        <div 
          className="menu-overlay" 
          onClick={toggle}
          aria-hidden="true"
        ></div>
      )}
      <aside 
        id="sidebar-menu"
        className={`menu ${isOpen ? 'open' : ''}`}
        aria-label="Menu Lateral"
      >
        <div className="sidebar-header">
          <div>
            <h2 style={{ marginBottom: '0.25rem' }}>GOM ESTOQUE</h2>
            <p style={{ fontSize: '0.75rem', opacity: 0.8, color: 'var(--indigo-light)', fontWeight: 500 }}>
              {userEmail || 'Usuário Conectado'}
            </p>
          </div>
          <button 
            className="mobile-close" 
            onClick={toggle}
            aria-label="Fechar menu"
          >
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
              aria-current={activeTab === item.id ? 'page' : undefined}
            >
              <item.icon size={20} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          ))}
          
          <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
            <button 
              className="nav-item" 
              onClick={handleLogout} 
              style={{ color: '#ef4444', width: '100%' }}
              aria-label="Sair do sistema"
            >
              <LogOut size={20} aria-hidden="true" />
              <span>Sair</span>
            </button>
          </div>
        </nav>
      </aside>

      {/* Bottom Navigation for Mobile */}
      <nav className="bottom-nav">
        {menuItems.map((item) => (
          <button
            key={`bottom-${item.id}`}
            className={`bottom-nav-item ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => setActiveTab(item.id)}
            aria-current={activeTab === item.id ? 'page' : undefined}
          >
            <item.icon size={20} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        ))}
        <button
          className="bottom-nav-item"
          onClick={handleLogout}
          style={{ color: '#ef4444' }}
        >
          <LogOut size={20} aria-hidden="true" />
          <span>Sair</span>
        </button>
      </nav>
    </>
  );
};

export default Sidebar;
