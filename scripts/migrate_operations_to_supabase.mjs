import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, '..');
const recoveredDir = resolve(process.argv[2] || join(projectDir, 'recovery_2026-08-20_1800', 'extracted_1845'));
const env = Object.fromEntries(
  readFileSync(join(projectDir, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.trim().startsWith('#'))
    .map(line => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    })
);

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const keys = [
  'gom_delivery_operations',
  'gom_delivery_sectors',
  'gom_delivery_points',
  'gom_delivery_operation_orders',
];
const rows = keys.map(key => ({
  key,
  value: JSON.parse(readFileSync(join(recoveredDir, `${key}.json`), 'utf8')),
  updated_at: new Date().toISOString(),
}));

const { error: importError } = await supabase.from('app_shared_state').upsert(rows, { onConflict: 'key' });
if (importError) throw new Error(`Não foi possível importar os dados: ${importError.message}`);

const { data, error: verifyError } = await supabase.from('app_shared_state').select('key,value,updated_at').in('key', keys);
if (verifyError) throw new Error(`Não foi possível conferir a migração: ${verifyError.message}`);

const summary = Object.fromEntries((data || []).map(row => [row.key, {
  count: Array.isArray(row.value) ? row.value.length : 0,
  updated_at: row.updated_at,
}]));
process.stdout.write(JSON.stringify(summary, null, 2));
