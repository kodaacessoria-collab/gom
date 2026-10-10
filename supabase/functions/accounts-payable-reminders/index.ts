import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const destination = '5514998688551';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const accessToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  const templateName = Deno.env.get('WHATSAPP_TEMPLATE_NAME');
  if (!accessToken || !phoneNumberId || !templateName) return Response.json({ error: 'WhatsApp secrets are not configured' }, { status: 503 });

  const currentDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const baseDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
  const dueDates = [0, 1, 2].map(days => {
    const date = new Date(baseDate); date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  });

  const { data: accounts, error } = await supabase.from('accounts_payable').select('*, companies(*)').eq('status', 'PENDENTE').in('due_date', dueDates);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const results = [];
  for (const account of accounts || []) {
    const daysBefore = Math.round((new Date(`${account.due_date}T12:00:00Z`).getTime() - new Date(`${dueDates[0]}T12:00:00Z`).getTime()) / 86400000);
    const { data: existing } = await supabase.from('payable_reminder_log').select('id').eq('account_id', account.id).eq('reminder_date', dueDates[0]).eq('days_before', daysBefore).maybeSingle();
    if (existing) continue;
    const when = daysBefore === 0 ? 'vence hoje' : `vence em ${daysBefore} dia${daysBefore > 1 ? 's' : ''}`;
    const parameters = [account.companies.trade_name, account.beneficiary, Number(account.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), account.due_date.split('-').reverse().join('/'), when].map(text => ({ type: 'text', text }));
    const response = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: destination, type: 'template', template: { name: templateName, language: { code: 'pt_BR' }, components: [{ type: 'body', parameters }] } }) });
    if (response.ok) await supabase.from('payable_reminder_log').insert({ account_id: account.id, reminder_date: dueDates[0], days_before: daysBefore });
    results.push({ account_id: account.id, sent: response.ok, status: response.status });
  }
  return Response.json({ date: dueDates[0], destination, results });
});
