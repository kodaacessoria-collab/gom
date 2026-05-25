import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Inventory from './components/Inventory';
import Slips from './components/Slips';
import PurchaseOrders from './components/PurchaseOrders';
import Reports from './components/Reports';
import Logs from './components/Logs';
import Users from './components/Users';
import Auth from './components/Auth';
import Settings from './components/Settings';
import { supabase } from './lib/supabase';
import type { Role } from './types';
import { mapDbRoleToRole } from './types';
import './index.css';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [userRole, setUserRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  const checkSession = async () => {
    // 1. Verifica primeiro o bypass de emergência
    const bypass = localStorage.getItem('gom_admin_bypass');
    if (bypass === 'true') {
      setSession({ user: { email: 'adm@docconsultoria.com.br' } });
      setUserRole('admin');
      setLoading(false);
      return;
    }

    // 2. Se não houver bypass, verifica a sessão real do Supabase
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      setSession(currentSession);
      
      if (currentSession?.user) {
        const { data } = await supabase.from('profiles').select('role').eq('id', currentSession.user.id).single();
        if (data) setUserRole(mapDbRoleToRole(data.role));
      }
    } catch (err) {
      console.error('Erro ao verificar sessão do Supabase:', err);
    } finally {
      setLoading(false);
    }
  };

  const fixCategoryTypos = async () => {
    try {
      // Corrigir erro de digitação 'Estabeláveis' para 'Estocáveis'
      await supabase.from('products').update({ category: 'Estocáveis' }).eq('category', 'Estabeláveis');
      await supabase.from('slips').update({ category: 'Estocáveis' }).eq('category', 'Estabeláveis');
    } catch (err) {
      console.error('Erro ao corrigir categorias:', err);
    }
  };

  useEffect(() => {
    fixCategoryTypos();
    checkSession();

    let subscription: any = null;
    try {
      // Ouvir mudanças de estado (login/logout oficial)
      const { data } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
        if (localStorage.getItem('gom_admin_bypass') !== 'true') {
          setSession(newSession);
          if (newSession?.user) {
            const { data: profileData } = await supabase.from('profiles').select('role').eq('id', newSession.user.id).single();
            if (profileData) setUserRole(mapDbRoleToRole(profileData.role));
          } else {
            setUserRole(null);
          }
        }
      });
      subscription = data?.subscription;
    } catch (err) {
      console.error('Erro ao assinar mudanças de autenticação:', err);
    }

    return () => {
      if (subscription) subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (userRole === 'red') {
      setActiveTab('reports');
    } else if (userRole === 'om' && activeTab === 'dashboard') {
      setActiveTab('inventory');
    }
  }, [userRole]);

  if (loading) return null;

  if (!session) {
    return <Auth onLogin={checkSession} />;
  }

  const renderContent = () => {
    // Role-based route protection
    const allowedTabs: Record<Role, string[]> = {
      admin: ['dashboard', 'inventory', 'slips', 'purchase-orders', 'reports', 'logs', 'users', 'settings'],
      om: ['inventory', 'reports', 'settings'],
      red: ['reports', 'settings']
    };

    const currentRole = userRole || 'admin';
    const isAllowed = allowedTabs[currentRole]?.includes(activeTab);

    if (!isAllowed) {
      const defaultTab = allowedTabs[currentRole]?.[0] || 'reports';
      switch (defaultTab) {
        case 'inventory': return <Inventory />;
        case 'reports': return <Reports userRole={userRole} />;
        default: return <Dashboard />;
      }
    }

    switch (activeTab) {
      case 'dashboard': return <Dashboard />;
      case 'inventory': return <Inventory />;
      case 'slips': return <Slips />;
      case 'purchase-orders': return <PurchaseOrders />;
      case 'reports': return <Reports userRole={userRole} />;
      case 'logs': return <Logs />;
      case 'users': return <Users />;
      case 'settings': return <Settings userEmail={session?.user?.email} />;
      default: return <Dashboard />;
    }
  };

  return (
    <div className="layout">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        isOpen={isSidebarOpen} 
        toggle={() => setIsSidebarOpen(!isSidebarOpen)} 
        userEmail={session?.user?.email}
        userRole={userRole}
      />
      
      <main className="main-content">
        {renderContent()}
      </main>
    </div>
  );
}

export default App;
