import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { LogIn, UserPlus, Mail, Lock, Loader2 } from 'lucide-react';

interface AuthProps {
  onLogin: () => void;
}

const Auth: React.FC<AuthProps> = ({ onLogin }) => {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // ATALHO DE EMERGÊNCIA PARA O ADM (Funciona tanto em Login quanto Cadastro)
      if (email === 'adm@docconsultoria.com.br' && password === 'Olvv031705@') {
        localStorage.setItem('gom_admin_bypass', 'true');
        onLogin();
        return;
      }

      if (isSignUp) {
        const { data: authData, error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        
        if (authData.user) {
          await supabase.from('profiles').upsert([{
            id: authData.user.id,
            email: email,
            role: 'admin'
          }]);
        }
        
        alert('Conta criada! Verifique seu e-mail para confirmar.');
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        
        if (error) {
          if (error.message.includes('Email not confirmed') && email === 'adm@docconsultoria.com.br') {
             setError('E-mail do administrador ainda não confirmado no Supabase. Use o acesso de emergência.');
             return;
          }
          throw error;
        }
        
        if (data.session) onLogin();
      }
    } catch (err: any) {
      console.error('Erro de Auth:', err);
      setError(err.message === 'Failed to fetch' ? 'Erro de conexão com o banco de dados' : err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a', color: 'white', padding: '1rem' }}>
      <div className="card" style={{ width: '100%', maxWidth: '400px', padding: '2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ width: '64px', height: '64px', backgroundColor: '#4f46e5', borderRadius: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
            <LogIn size={32} color="white" />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800 }}>GOM ESTOQUE</h1>
          <p style={{ color: 'var(--text-muted)' }}>{isSignUp ? 'Crie sua conta' : 'Acesse o sistema'}</p>
        </div>

        {error && (
          <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', color: '#ef4444', padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1rem', fontSize: '0.9rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>E-mail</label>
            <div style={{ position: 'relative' }}>
              <Mail size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input 
                type="email" 
                required 
                className="input" 
                style={{ paddingLeft: '3rem', width: '100%' }}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Senha</label>
            <div style={{ position: 'relative' }}>
              <Lock size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input 
                type="password" 
                required 
                className="input" 
                style={{ paddingLeft: '3rem', width: '100%' }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button className="button" type="submit" disabled={loading} style={{ marginTop: '1rem', height: '48px' }}>
            {loading ? <Loader2 className="animate-spin" /> : (isSignUp ? 'Criar Conta' : 'Entrar')}
          </button>
        </form>

        <button 
          onClick={() => setIsSignUp(!isSignUp)} 
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px dashed #4f46e5', color: '#4f46e5', width: '100%', marginTop: '2rem', cursor: 'pointer', fontSize: '0.8rem', padding: '0.5rem', borderRadius: '0.5rem' }}
        >
          {isSignUp ? 'Voltar para Login' : 'Configuração Inicial (ADM)'}
        </button>
      </div>
    </div>
  );
};

export default Auth;
