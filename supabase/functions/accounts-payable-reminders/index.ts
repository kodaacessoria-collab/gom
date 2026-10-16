import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TIME_ZONE = 'America/Sao_Paulo';
const DEFAULT_DESTINATION = '5514998688551';
const EXPECTED_SENDER = '5514988359798';
const REMINDER_DAYS = [0, 1, 2] as const;

const normalizePhone = (value: string) => value.replace(/\D/g, '');

const dateInTimeZone = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

const addDays = (isoDate: string, days: number) => {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
};

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const accessToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  const templateName = Deno.env.get('WHATSAPP_TEMPLATE_NAME');
  const sender = normalizePhone(Deno.env.get('WHATSAPP_SENDER_NUMBER') || EXPECTED_SENDER);
  const destination = normalizePhone(Deno.env.get('WHATSAPP_DESTINATION_NUMBER') || DEFAULT_DESTINATION);

  if (!supabaseUrl || !serviceRoleKey || !accessToken || !phoneNumberId || !templateName) {
    return Response.json({ error: 'As configurações do Supabase ou do WhatsApp estão incompletas.' }, { status: 503 });
  }
  if (sender !== EXPECTED_SENDER) {
    return Response.json({ error: 'O remetente configurado não corresponde ao WhatsApp Business autorizado.' }, { status: 503 });
  }
  if (destination !== DEFAULT_DESTINATION) {
    return Response.json({ error: 'O destinatário configurado não corresponde ao número autorizado.' }, { status: 503 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const reminderDate = dateInTimeZone();
  const dueDates = REMINDER_DAYS.map(days => addDays(reminderDate, days));
  const daysByDueDate = new Map(dueDates.map((dueDate, index) => [dueDate, REMINDER_DAYS[index]]));

  const { data: accounts, error } = await supabase
    .from('accounts_payable')
    .select('*, companies(*)')
    .eq('status', 'PENDENTE')
    .in('due_date', dueDates);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const results = [];
  for (const account of accounts || []) {
    const dueDate = String(account.due_date).slice(0, 10);
    const daysBefore = daysByDueDate.get(dueDate);
    if (daysBefore === undefined) continue;

    const { data: existing, error: logLookupError } = await supabase
      .from('payable_reminder_log')
      .select('id')
      .eq('account_id', account.id)
      .eq('reminder_date', reminderDate)
      .eq('days_before', daysBefore)
      .maybeSingle();

    if (logLookupError) {
      results.push({ account_id: account.id, sent: false, error: logLookupError.message });
      continue;
    }
    if (existing) {
      results.push({ account_id: account.id, sent: false, skipped: 'already_sent' });
      continue;
    }

    const companyName = account.companies?.trade_name || account.companies?.legal_name || 'Grupo OM';
    const when = daysBefore === 0 ? 'vence hoje' : `vence em ${daysBefore} dia${daysBefore > 1 ? 's' : ''}`;
    const parameters = [
      companyName,
      account.beneficiary,
      Number(account.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
      dueDate.split('-').reverse().join('/'),
      when,
    ].map(text => ({ type: 'text', text: String(text) }));

    try {
      const response = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: destination,
          type: 'template',
          template: {
            name: templateName,
            language: { code: 'pt_BR' },
            components: [{ type: 'body', parameters }],
          },
        }),
      });
      const responseBody = await response.json().catch(() => ({}));

      if (response.ok) {
        const { error: logInsertError } = await supabase.from('payable_reminder_log').insert({
          account_id: account.id,
          reminder_date: reminderDate,
          days_before: daysBefore,
        });
        results.push({
          account_id: account.id,
          sent: !logInsertError,
          message_id: responseBody?.messages?.[0]?.id,
          error: logInsertError?.message,
        });
      } else {
        console.error('WhatsApp API error', response.status, responseBody);
        results.push({ account_id: account.id, sent: false, status: response.status, error: responseBody?.error?.message || 'Falha no envio.' });
      }
    } catch (sendError) {
      console.error('WhatsApp request failed', sendError);
      results.push({ account_id: account.id, sent: false, error: sendError instanceof Error ? sendError.message : 'Falha de conexão.' });
    }
  }

  const failed = results.filter(result => !result.sent && !('skipped' in result));
  return Response.json(
    { date: reminderDate, sender, destination, due_dates: dueDates, results },
    { status: failed.length > 0 ? 502 : 200 },
  );
});
