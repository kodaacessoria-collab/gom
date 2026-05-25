import React, { useState, useEffect } from 'react';
import { Users as UsersIcon, UserPlus, Shield, Mail, Trash2, X, Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { createClient } from '@supabase/supabase-js';
import type { Role } from '../types';
import { mapDbRoleToRole, mapRoleToDbRole } from '../types';

// Separate client for user creation to avoid session conflicts
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const authClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false }
});

interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  created_at: string;
}

const Users: React.FC = () => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    full_name: '',
    role: 'om' as Role
  });

  useEffect(() => {
    fetchProfiles();
  }, []);

  const fetchProfiles = async () => {
    setLoading(true);
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (data) {
      const mapped = data.map((p: any) => ({
        ...p,
        role: mapDbRoleToRole(p.role)
      }));
      setProfiles(mapped);
    }
    setLoading(false);
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      // 1. Create Auth User
      const { data: authData, error: authError } = await authClient.auth.signUp({
        email: formData.email,
        password: formData.password,
      });

      if (authError) throw authError;

      if (authData.user) {
        // Verifica se o usuário retornou sem identidades (indicando que o e-mail já existe)
        if (authData.user.identities && authData.user.identities.length === 0) {
          throw new Error('Este e-mail já está cadastrado no sistema. Se o e-mail ainda não foi confirmado, verifique a caixa de entrada para ativar a conta.');
        }

        const { error: profError } = await supabase.from('profiles').upsert([{
          id: authData.user.id,
          email: formData.email,
          full_name: formData.full_name,
          role: mapRoleToDbRole(formData.role)
        }]);

        if (profError) throw profError;
        
        alert('Usuário cadastrado com sucesso! Ele precisará confirmar o e-mail para acessar.');
        setIsModalOpen(false);
        setFormData({ email: '', password: '', full_name: '', role: 'om' });
        fetchProfiles();
      }
    } catch (err: any) {
      let errorMessage = err.message;
      if (errorMessage.includes('rate limit')) {
        errorMessage = 'Limite de envios de e-mail excedido por segurança. Tente novamente em alguns minutos ou configure um servidor SMTP customizado no seu painel do Supabase.';
      }
      alert('Erro ao cadastrar usuário: ' + errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const updateRole = async (id: string, newRole: Role) => {
    const { error } = await supabase.from('profiles').update({ role: mapRoleToDbRole(newRole) }).eq('id', id);
    if (error) alert(error.message);
    else fetchProfiles();
  };

  const deleteProfile = async (id: string) => {
    if (!confirm('Isso removerá o perfil do usuário, mas ele ainda poderá existir no sistema de autenticação. Deseja continuar?')) return;
    const { error } = await supabase.from('profiles').delete().eq('id', id);
    if (error) alert(error.message);
    else fetchProfiles();
  };

  return (
    <div>
      <div className="view-header">
        <div className="view-title">
          <h1>Gestão de Usuários</h1>
          <p>Controle de acesso e permissões do sistema.</p>
        </div>
        <button className="button" onClick={() => setIsModalOpen(true)}>
          <UserPlus size={18} style={{ marginRight: '0.5rem' }} />
          Novo Usuário
        </button>
      </div>

      <div className="card" style={{ padding: '1.5rem', marginBottom: '2rem', backgroundColor: 'rgba(96, 165, 250, 0.05)', border: '1px solid rgba(96, 165, 250, 0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', color: '#60a5fa' }}>
          <Shield size={24} />
          <div>
            <h3 style={{ margin: 0, color: '#60a5fa' }}>Gestão de Acesso</h3>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.9rem', color: 'var(--text-muted)', textAlign: 'left' }}>
              Se o cadastro público estiver desativado no seu Supabase, utilize a opção 
              <strong style={{ color: 'white' }}> "Invite User"</strong> no painel administrativo do Supabase para novos e-mails.
            </p>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: '0' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Nome Completo</th>
              <th>E-mail</th>
              <th>Nível de Acesso</th>
              <th>Data de Cadastro</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }}>Carregando perfis...</td></tr>
            ) : profiles.map((p) => (
              <tr key={p.id}>
                <td style={{ fontWeight: 600 }}>{p.full_name || 'Usuário GOM'}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Mail size={14} style={{ color: 'var(--text-muted)' }} />
                    {p.email}
                  </div>
                </td>
                <td>
                  <select 
                    className="input-field" 
                    style={{ padding: '0.2rem', height: 'auto', width: '200px' }}
                    value={p.role}
                    onChange={(e) => updateRole(p.id, e.target.value as Role)}
                  >
                    <option value="admin">ADM (Acesso Total)</option>
                    <option value="om">Grupo OM (Estoque/Relatórios)</option>
                    <option value="red">RED (Relatórios RED)</option>
                  </select>
                </td>
                <td style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  {new Date(p.created_at).toLocaleDateString('pt-BR')}
                </td>
                <td>
                  <button 
                    onClick={() => deleteProfile(p.id)} 
                    style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '0.5rem' }}
                  >
                    <Trash2 size={18} />
                  </button>
                </td>
              </tr>
            ))}
            {!loading && profiles.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Nenhum perfil encontrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="sidebar-overlay" style={{ alignItems: 'flex-start' }}>
          <div className="card" style={{ width: '100%', maxWidth: '500px', position: 'relative', padding: '2rem' }}>
            <div className="view-header" style={{ marginBottom: '2rem' }}>
              <h2>Cadastrar Novo Usuário</h2>
              <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}><X size={24} /></button>
            </div>
            
            <form onSubmit={handleAddUser} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              <div>
                <label>Nome Completo</label>
                <div style={{ position: 'relative' }}>
                  <UsersIcon size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input type="text" className="input" style={{ paddingLeft: '3rem', width: '100%' }} required value={formData.full_name} onChange={e => setFormData({...formData, full_name: e.target.value})} />
                </div>
              </div>

              <div>
                <label>E-mail</label>
                <div style={{ position: 'relative' }}>
                  <Mail size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input type="email" className="input" style={{ paddingLeft: '3rem', width: '100%' }} required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                </div>
              </div>

              <div>
                <label>Senha</label>
                <div style={{ position: 'relative' }}>
                  <Lock size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input type="password" title="Mínimo 6 caracteres" className="input" style={{ paddingLeft: '3rem', width: '100%' }} required minLength={6} value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
                </div>
              </div>

              <div>
                <label>Nível de Acesso</label>
                <select className="input-field" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as any})}>
                  <option value="admin">ADM (Acesso Total)</option>
                  <option value="om">Grupo OM (Estoque e Relatórios)</option>
                  <option value="red">RED (Relatórios RED)</option>
                </select>
              </div>

              <div style={{ marginTop: '1rem' }}>
                <button type="submit" className="button" style={{ width: '100%', height: '48px' }} disabled={loading}>
                  {loading ? 'Cadastrando...' : 'Confirmar Cadastro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Users;
