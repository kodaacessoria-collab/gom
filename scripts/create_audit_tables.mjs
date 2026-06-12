// Script para criar as tabelas de auditoria no Supabase
// Execute: node scripts/create_audit_tables.mjs

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Lê o .env manualmente
const envPath = join(__dirname, '..', '.env');
const envContent = readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if (k && v.length) env[k.trim()] = v.join('=').trim();
});

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

const sql = `
CREATE TABLE IF NOT EXISTS stock_audits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  audit_code TEXT NOT NULL UNIQUE,
  audit_date TIMESTAMPTZ DEFAULT NOW(),
  deposit TEXT NOT NULL,
  auditor_name TEXT,
  auditor_cpf TEXT,
  responsible_name TEXT,
  responsible_cpf TEXT,
  status TEXT DEFAULT 'ABERTA',
  observations TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_audit_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  audit_id UUID REFERENCES stock_audits(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  category TEXT,
  unit TEXT,
  expiry_date DATE,
  system_qty DECIMAL NOT NULL DEFAULT 0,
  audited_qty DECIMAL,
  difference DECIMAL,
  is_new_product BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE stock_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_audit_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all access to stock_audits') THEN
        CREATE POLICY "Allow all access to stock_audits" ON stock_audits FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all access to stock_audit_items') THEN
        CREATE POLICY "Allow all access to stock_audit_items" ON stock_audit_items FOR ALL USING (true) WITH CHECK (true);
    END IF;
END
$$;
`;

try {
  const { error } = await supabase.rpc('exec_sql', { sql_query: sql });
  if (error) {
    // Try direct execute if rpc not available
    console.log('RPC não disponível. Execute o SQL manualmente no Supabase SQL Editor.');
    console.log('\n--- SQL PARA EXECUTAR ---\n');
    console.log(sql);
    console.log('\n--- FIM DO SQL ---\n');
  } else {
    console.log('✅ Tabelas de auditoria criadas com sucesso!');
  }
} catch (err) {
  console.log('Execute o SQL abaixo no Supabase SQL Editor (https://supabase.com/dashboard):');
  console.log('\n--- SQL PARA EXECUTAR ---\n');
  console.log(sql);
  console.log('\n--- FIM DO SQL ---\n');
}
