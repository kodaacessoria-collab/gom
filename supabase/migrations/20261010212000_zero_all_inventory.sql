-- Zeragem geral de estoque solicitada em 10/10/2026.
-- Migração única: preserva os cadastros dos produtos e redefine somente os saldos.
UPDATE public.products
SET quantity = 0,
    updated_at = NOW()
WHERE quantity IS DISTINCT FROM 0;
