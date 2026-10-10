CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  legal_name TEXT NOT NULL,
  trade_name TEXT NOT NULL,
  cnpj TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO companies (legal_name, trade_name, cnpj) VALUES
  ('L M DE OLIVEIRA COMERCIAL LTDA', 'OM SOLUCOES E SERVICOS', '66.036.822/0001-30'),
  ('L. MENDES DE OLIVEIRA COMERCIAL LTDA', 'OLIVEIRA MENDES DISTRIBUIDORA', '57.135.668/0001-63'),
  ('OM LOGISTICA E DISTRIBUICAO LTDA', 'OM LOG', '68.673.515/0001-96')
ON CONFLICT (cnpj) DO UPDATE SET legal_name = EXCLUDED.legal_name, trade_name = EXCLUDED.trade_name;

CREATE TABLE IF NOT EXISTS accounts_payable (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  beneficiary TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE', 'PAGO')),
  paid_at DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT paid_account_requires_date CHECK (status <> 'PAGO' OR paid_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS payable_reminder_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts_payable(id) ON DELETE CASCADE,
  reminder_date DATE NOT NULL,
  days_before INTEGER NOT NULL CHECK (days_before IN (0, 1, 2)),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, reminder_date, days_before)
);

CREATE INDEX IF NOT EXISTS accounts_payable_due_status_idx ON accounts_payable (status, due_date);
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts_payable ENABLE ROW LEVEL SECURITY;
ALTER TABLE payable_reminder_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view companies" ON companies FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage accounts payable" ON accounts_payable FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage reminder log" ON payable_reminder_log FOR ALL TO service_role USING (true) WITH CHECK (true);
