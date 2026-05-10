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
import { Menu } from 'lucide-react';
import { supabase } from './lib/supabase';
import './index.css';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const checkSession = async () => {
    // 1. Verifica primeiro o bypass de emergência
    const bypass = localStorage.getItem('gom_admin_bypass');
    if (bypass === 'true') {
      setSession({ user: { email: 'adm@docconsultoria.com.br' } });
      setLoading(false);
      return;
    }

    // 2. Se não houver bypass, verifica a sessão real do Supabase
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    setSession(currentSession);
    setLoading(false);
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

    // Ouvir mudanças de estado (login/logout oficial)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (localStorage.getItem('gom_admin_bypass') !== 'true') {
        setSession(newSession);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) return null;

  if (!session) {
    return <Auth onLogin={checkSession} />;
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard />;
      case 'inventory': return <Inventory />;
      case 'slips': return <Slips />;
      case 'purchase-orders': return <PurchaseOrders />;
      case 'reports': return <Reports />;
      case 'logs': return <Logs />;
      case 'users': return <Users />;
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
      />
      
      <main className="main-content">
        <button className="mobile-menu-btn" onClick={() => setIsSidebarOpen(true)}>
          <Menu size={24} />
        </button>
        {renderContent()}
      </main>
    </div>
  );
}

export default App;
