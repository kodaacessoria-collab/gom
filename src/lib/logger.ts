import { supabase } from './supabase';

export const saveLog = async (action: string, entity: string, details: string) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    await supabase.from('audit_logs').insert([{
      user_email: user?.email || 'Sistema/Visitante',
      action,
      entity,
      details
    }]);
  } catch (error) {
    console.error('Erro ao salvar log:', error);
  }
};
