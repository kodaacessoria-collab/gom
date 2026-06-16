import React, { useEffect } from 'react';
import { LayoutDashboard, Package, FileText, ShoppingCart, BarChart3, X, History, Users, LogOut, Lock, ClipboardCheck } from 'lucide-react';
import type { Role } from '../types';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isOpen: boolean;
  toggle: () => void;
  userEmail?: string;
  userRole?: Role | null;
  handleLogout: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, isOpen, toggle, userEmail, userRole, handleLogout }) => {
  const allMenuItems = [
    { id: 'dashboard', label: 'Painel', icon: LayoutDashboard },
    { id: 'inventory', label: 'Estoque', icon: Package },
    { id: 'slips', label: 'Romaneios', icon: FileText },
    { id: 'purchase-orders', label: 'Pedidos de Compra', icon: ShoppingCart },
    { id: 'reports', label: 'Relatórios', icon: BarChart3 },
    { id: 'audit', label: 'Auditoria', icon: ClipboardCheck, adminOnly: true },
    { id: 'logs', label: 'Logs', icon: History },
    { id: 'users', label: 'Usuários', icon: Users },
  ];

  const getMenuItems = () => {
    let items = [...allMenuItems];
    const currentRole = userRole || 'admin'; // fallback for safety, matching App.tsx
    if (currentRole === 'om') {
      items = allMenuItems.filter(i => ['inventory', 'reports'].includes(i.id));
    } else if (currentRole === 'red') {
      items = allMenuItems.filter(i => ['reports'].includes(i.id));
    } else {
      // admin: show all, but filter out adminOnly if not admin (safety)
      items = allMenuItems.filter(i => !i.adminOnly || currentRole === 'admin');
    }
    
    // Todos os usuários têm acesso à aba "Minha Conta" para alterar senha
    items.push({ id: 'settings', label: 'Minha Conta', icon: Lock });
    return items;
  };

  const menuItems = getMenuItems();

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
    </>
  );
};

export default Sidebar;
