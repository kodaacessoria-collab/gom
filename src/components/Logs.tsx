import React, { useState, useEffect } from 'react';
import { Search, Calendar } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface AuditLog {
  id: string;
  user_email: string;
  action: string;
  entity: string;
  details: string;
  created_at: string;
}

const Logs: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (data) setLogs(data);
    setLoading(false);
  };

  const getActionColor = (action: string) => {
    if (action.includes('INSERT') || action.includes('CRIAR')) return '#10b981';
    if (action.includes('UPDATE') || action.includes('EDITAR')) return '#3b82f6';
    if (action.includes('DELETE') || action.includes('EXCLUIR')) return '#ef4444';
    return 'var(--text-muted)';
  };

  const filteredLogs = logs.filter(l => 
    l.user_email?.toLowerCase().includes(search.toLowerCase()) ||
    l.details?.toLowerCase().includes(search.toLowerCase()) ||
    l.entity?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="view-header">
        <div className="view-title">
          <h1>Log de Alterações</h1>
          <p>Rastreabilidade de todas as ações realizadas no sistema.</p>
        </div>
      </div>

      <div className="card" style={{ padding: '1rem', marginBottom: '2rem', display: 'flex', gap: '1rem' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input 
            type="text" 
            placeholder="Filtrar por usuário, ação ou detalhe..." 
            className="input" 
            style={{ paddingLeft: '3rem', width: '100%', height: '44px', borderRadius: '0.5rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="card" style={{ padding: '0' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Data/Hora</th>
              <th>Usuário</th>
              <th>Ação</th>
              <th>Entidade</th>
              <th>Detalhes</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }}>Carregando logs...</td></tr>
            ) : filteredLogs.map((log) => (
              <tr key={log.id}>
                <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Calendar size={14} />
                    {new Date(log.created_at).toLocaleString('pt-BR')}
                  </div>
                </td>
                <td style={{ fontWeight: 600 }}>{log.user_email || 'Sistema'}</td>
                <td>
                  <span className="badge" style={{ backgroundColor: getActionColor(log.action), color: 'white', border: 'none' }}>
                    {log.action}
                  </span>
                </td>
                <td><span className="badge badge-blue">{log.entity}</span></td>
                <td style={{ fontSize: '0.9rem', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {log.details}
                </td>
              </tr>
            ))}
            {!loading && filteredLogs.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Nenhum log encontrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Logs;
