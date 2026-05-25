import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Lock, ShieldAlert, CheckCircle2, AlertTriangle, Key } from 'lucide-react';

interface SettingsProps {
  userEmail?: string;
}

const Settings: React.FC<SettingsProps> = ({ userEmail }) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isBypass = localStorage.getItem('gom_admin_bypass') === 'true';

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (isBypass) {
      setMessage({
        type: 'error',
        text: 'Atenção: Você está usando o acesso de emergência local (Bypass). Não é possível alterar a senha deste perfil porque ele é carregado localmente no navegador.'
      });
      return;
    }

    if (newPassword.length < 6) {
      setMessage({
        type: 'error',
        text: 'A nova senha deve ter no mínimo 6 caracteres.'
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({
        type: 'error',
        text: 'As senhas não coincidem. Digite novamente.'
      });
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      setMessage({
        type: 'success',
        text: 'Sua senha foi alterada com sucesso!'
      });
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      console.error('Erro ao alterar senha:', err);
      setMessage({
        type: 'error',
        text: err.message || 'Erro ao tentar atualizar a senha. Verifique sua conexão.'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="view-header">
        <div className="view-title">
          <h1>Minha Conta</h1>
          <p>Gerencie suas credenciais e configurações de segurança.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem', maxWidth: '600px' }}>
        {isBypass && (
          <div className="card" style={{ padding: '1.5rem', backgroundColor: 'rgba(245, 158, 11, 0.05)', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', color: '#f59e0b' }}>
              <AlertTriangle size={24} />
              <div>
                <h3 style={{ margin: 0, color: '#f59e0b', textAlign: 'left' }}>Acesso de Emergência (Bypass)</h3>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.9rem', color: 'var(--text-muted)', textAlign: 'left' }}>
                  Você está logado com a conta de bypass local. Para gerenciar usuários e alterar senhas de contas reais, verifique se a conexão com o banco de dados Supabase está ativa.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="card" style={{ padding: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid var(--border)', paddingBottom: '1.5rem' }}>
            <div style={{ width: '48px', height: '48px', backgroundColor: 'rgba(79, 70, 229, 0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4f46e5' }}>
              <Key size={24} />
            </div>
            <div>
              <h3 style={{ margin: 0, color: 'white', fontSize: '1.1rem', textAlign: 'left' }}>Alterar Senha</h3>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'left' }}>
                Usuário: <strong style={{ color: 'white' }}>{userEmail}</strong>
              </p>
            </div>
          </div>

          {message && (
            <div 
              style={{ 
                backgroundColor: message.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', 
                border: `1px solid ${message.type === 'success' ? '#10b981' : '#ef4444'}`, 
                color: message.type === 'success' ? '#10b981' : '#ef4444', 
                padding: '1rem', 
                borderRadius: '0.5rem', 
                marginBottom: '1.5rem', 
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem'
              }}
            >
              {message.type === 'success' ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}
              <span style={{ textAlign: 'left' }}>{message.text}</span>
            </div>
          )}

          <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)', textAlign: 'left' }}>
                Nova Senha
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input 
                  type="password" 
                  required 
                  minLength={6}
                  placeholder="Mínimo 6 caracteres"
                  className="input" 
                  style={{ paddingLeft: '3rem', width: '100%' }}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)', textAlign: 'left' }}>
                Confirmar Nova Senha
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input 
                  type="password" 
                  required 
                  placeholder="Confirme a nova senha"
                  className="input" 
                  style={{ paddingLeft: '3rem', width: '100%' }}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>

            <button 
              className="button" 
              type="submit" 
              disabled={loading}
              style={{ marginTop: '0.5rem', height: '48px', width: '100%' }}
            >
              {loading ? 'Atualizando...' : 'Salvar Nova Senha'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Settings;
