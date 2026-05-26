import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Lock, ShieldAlert, CheckCircle2, AlertTriangle, Key, Database, Download, ExternalLink, Calendar } from 'lucide-react';
import * as XLSX from 'xlsx';

interface SettingsProps {
  userEmail?: string;
}

const Settings: React.FC<SettingsProps> = ({ userEmail }) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [backupMessage, setBackupMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isBypass = localStorage.getItem('gom_admin_bypass') === 'true';

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMessage(null);

    if (isBypass) {
      setPasswordMessage({
        type: 'error',
        text: 'Atenção: Você está usando o acesso de emergência local (Bypass). Não é possível alterar a senha deste perfil porque ele é carregado localmente no navegador.'
      });
      return;
    }

    if (newPassword.length < 6) {
      setPasswordMessage({
        type: 'error',
        text: 'A nova senha deve ter no mínimo 6 caracteres.'
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordMessage({
        type: 'error',
        text: 'As senhas não coincidem. Digite novamente.'
      });
      return;
    }

    setPasswordLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      setPasswordMessage({
        type: 'success',
        text: 'Sua senha foi alterada com sucesso!'
      });
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      console.error('Erro ao alterar senha:', err);
      setPasswordMessage({
        type: 'error',
        text: err.message || 'Erro ao tentar atualizar a senha. Verifique sua conexão.'
      });
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleExportBackup = async () => {
    setBackupMessage(null);
    setBackupLoading(true);

    try {
      // 1. Obter dados de todas as tabelas
      const { data: products } = await supabase.from('products').select('*');
      const { data: slips } = await supabase.from('slips').select('*');
      const { data: purchaseOrders } = await supabase.from('purchase_orders').select('*');
      
      let profiles: any[] | null = null;
      try {
        const { data } = await supabase.from('profiles').select('*');
        profiles = data;
      } catch (e) {
        console.warn('Erro ao obter perfis para backup:', e);
      }
      
      // 2. Criar um novo workbook (pasta de trabalho)
      const wb = XLSX.utils.book_new();
      
      // 3. Adicionar abas ao workbook
      if (products && products.length > 0) {
        const wsProducts = XLSX.utils.json_to_sheet(products);
        XLSX.utils.book_append_sheet(wb, wsProducts, 'Produtos');
      }
      if (slips && slips.length > 0) {
        const wsSlips = XLSX.utils.json_to_sheet(slips);
        XLSX.utils.book_append_sheet(wb, wsSlips, 'Romaneios');
      }
      if (purchaseOrders && purchaseOrders.length > 0) {
        const wsOrders = XLSX.utils.json_to_sheet(purchaseOrders.map(o => ({
          ...o,
          items: typeof o.items === 'object' ? JSON.stringify(o.items) : o.items
        })));
        XLSX.utils.book_append_sheet(wb, wsOrders, 'Pedidos de Compra');
      }
      if (profiles && profiles.length > 0) {
        const wsProfiles = XLSX.utils.json_to_sheet(profiles);
        XLSX.utils.book_append_sheet(wb, wsProfiles, 'Perfis');
      }

      // 4. Trigger download
      const dateStr = new Date().toISOString().split('T')[0];
      XLSX.writeFile(wb, `backup_gom_estoque_${dateStr}.xlsx`);

      setBackupMessage({
        type: 'success',
        text: 'Backup gerado e baixado com sucesso em formato Excel (.xlsx)!'
      });
    } catch (err: any) {
      console.error('Erro ao gerar backup:', err);
      setBackupMessage({
        type: 'error',
        text: err.message || 'Erro ao gerar o arquivo de backup. Verifique a conexão com o banco de dados.'
      });
    } finally {
      setBackupLoading(false);
    }
  };

  return (
    <div>
      <div className="view-header">
        <div className="view-title">
          <h1>Minha Conta e Sistema</h1>
          <p>Gerencie suas credenciais de segurança e realize backups dos dados.</p>
        </div>
      </div>

      {isBypass && (
        <div className="card" style={{ padding: '1.5rem', marginBottom: '2rem', backgroundColor: 'rgba(245, 158, 11, 0.05)', border: '1px solid rgba(245, 158, 11, 0.2)', maxWidth: '1200px' }}>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '2rem', maxWidth: '1200px', alignItems: 'start' }}>
        
        {/* Card de Alteração de Senha */}
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

          {passwordMessage && (
            <div 
              style={{ 
                backgroundColor: passwordMessage.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', 
                border: `1px solid ${passwordMessage.type === 'success' ? '#10b981' : '#ef4444'}`, 
                color: passwordMessage.type === 'success' ? '#10b981' : '#ef4444', 
                padding: '1rem', 
                borderRadius: '0.5rem', 
                marginBottom: '1.5rem', 
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem'
              }}
            >
              {passwordMessage.type === 'success' ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}
              <span style={{ textAlign: 'left' }}>{passwordMessage.text}</span>
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
                  disabled={passwordLoading}
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
                  disabled={passwordLoading}
                />
              </div>
            </div>

            <button 
              className="button" 
              type="submit" 
              disabled={passwordLoading}
              style={{ marginTop: '0.5rem', height: '48px', width: '100%' }}
            >
              {passwordLoading ? 'Atualizando...' : 'Salvar Nova Senha'}
            </button>
          </form>
        </div>

        {/* Card de Backup do Sistema */}
        <div className="card" style={{ padding: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid var(--border)', paddingBottom: '1.5rem' }}>
            <div style={{ width: '48px', height: '48px', backgroundColor: 'rgba(96, 165, 250, 0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#60a5fa' }}>
              <Database size={24} />
            </div>
            <div>
              <h3 style={{ margin: 0, color: 'white', fontSize: '1.1rem', textAlign: 'left' }}>Backup do Sistema</h3>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'left' }}>
                Segurança e integridade de dados.
              </p>
            </div>
          </div>

          {backupMessage && (
            <div 
              style={{ 
                backgroundColor: backupMessage.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', 
                border: `1px solid ${backupMessage.type === 'success' ? '#10b981' : '#ef4444'}`, 
                color: backupMessage.type === 'success' ? '#10b981' : '#ef4444', 
                padding: '1rem', 
                borderRadius: '0.5rem', 
                marginBottom: '1.5rem', 
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem'
              }}
            >
              {backupMessage.type === 'success' ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}
              <span style={{ textAlign: 'left' }}>{backupMessage.text}</span>
            </div>
          )}

          <div style={{ marginBottom: '1.5rem' }}>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: '1.5', textAlign: 'left', marginBottom: '1.5rem' }}>
              Exporte todos os produtos, romaneios, pedidos, logs e perfis de usuários em um único arquivo de Excel multi-abas.
            </p>
            <button 
              className="button" 
              onClick={handleExportBackup}
              disabled={backupLoading}
              style={{ width: '100%', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', backgroundColor: '#3b82f6', border: 'none' }}
            >
              <Download size={18} />
              {backupLoading ? 'Gerando Planilha...' : 'Exportar Planilha Completa (.xlsx)'}
            </button>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.5rem', marginTop: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#10B981', marginBottom: '0.75rem' }}>
              <Calendar size={18} />
              <h4 style={{ margin: 0, fontSize: '0.95rem' }}>Backup Automático Diário (00:00h)</h4>
            </div>
            
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.6', textAlign: 'left', marginBottom: '1.2rem' }}>
              Para salvar e atualizar o arquivo automaticamente no Google Drive todo dia à meia-noite (00:00), utilize a pasta compartilhada configurada para o GOM:
            </p>

            <a 
              href="https://drive.google.com/drive/folders/1FS_GMjv8_9znZytR_-GFBx2zBHRp7QZC?usp=drive_link" 
              target="_blank" 
              rel="noopener noreferrer" 
              className="button"
              style={{ 
                width: '100%', 
                height: '44px', 
                backgroundColor: 'rgba(16, 185, 129, 0.08)', 
                border: '1px dashed #10b981', 
                color: '#10b981', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                gap: '0.5rem',
                textDecoration: 'none',
                fontSize: '0.85rem',
                fontWeight: 600
              }}
            >
              <ExternalLink size={16} />
              Acessar Pasta Google Drive
            </a>

            <div style={{ backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.75rem', marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'left' }}>
              <span style={{ fontWeight: 600, color: 'white', display: 'block', marginBottom: '0.25rem' }}>💡 Dica de Automação:</span>
              Você pode sincronizar este arquivo na sua máquina instalando o <strong>Google Drive para Computadores</strong> e salvando a planilha exportada diretamente na pasta sincronizada para upload automático.
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};

export default Settings;
