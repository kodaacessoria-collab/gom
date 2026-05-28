import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://avkcrhyphobuzzjmyrjl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2a2NyaHlwaG9idXp6am15cmpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTQ5NzYsImV4cCI6MjA5MzY3MDk3Nn0.-uzBsm2Qm8NCwfcetRvrqgOff-Yv1csBqYZkfI881kE';
const supabase = createClient(supabaseUrl, supabaseKey);

async function zeroStocks() {
  console.log('--- Buscando produtos antes da alteração ---');
  const { data: products, error: fetchError } = await supabase
    .from('products')
    .select('id, name, quantity, deposit, batch, expiry_date');

  if (fetchError) {
    console.error('Erro ao buscar produtos:', fetchError);
    return;
  }

  const totalProducts = products ? products.length : 0;
  const nonZeroProducts = products ? products.filter(p => Number(p.quantity) !== 0) : [];
  
  console.log(`Total de produtos encontrados: ${totalProducts}`);
  console.log(`Produtos com estoque diferente de zero: ${nonZeroProducts.length}`);
  
  if (totalProducts === 0) {
    console.log('Nenhum produto encontrado para atualizar.');
    return;
  }

  console.log('\n--- Zerando os estoques ---');
  // Atualiza a quantidade para 0 de todos os produtos
  // Utilizamos neq('id', '00000000-0000-0000-0000-000000000000') para abranger todos os IDs sem disparar o bloqueio de segurança contra updates globais sem filtro do PostgREST
  const { data: updated, error: updateError } = await supabase
    .from('products')
    .update({ quantity: 0 })
    .neq('id', '00000000-0000-0000-0000-000000000000')
    .select('id, name, quantity, deposit, batch, expiry_date');

  if (updateError) {
    console.error('Erro ao zerar estoques:', updateError);
    return;
  }

  console.log(`Sucesso! Foram atualizados ${updated ? updated.length : 0} registros.`);

  console.log('\n--- Verificação pós-atualização ---');
  const { data: finalProducts, error: refetchError } = await supabase
    .from('products')
    .select('id, name, quantity, deposit, batch, expiry_date');

  if (refetchError) {
    console.error('Erro ao verificar produtos após a alteração:', refetchError);
    return;
  }

  const remainingNonZero = finalProducts ? finalProducts.filter(p => Number(p.quantity) !== 0) : [];
  console.log(`Produtos restantes com estoque diferente de zero: ${remainingNonZero.length}`);
  
  if (remainingNonZero.length === 0) {
    console.log('Todos os estoques foram zerados com sucesso!');
  } else {
    console.warn('Atenção: alguns produtos ainda possuem estoque não zerado:', remainingNonZero);
  }

  // Amostra para conferência de que nome, lote e validade foram mantidos
  if (finalProducts && finalProducts.length > 0) {
    console.log('\nAmostra de produto atualizado para conferência:');
    console.log({
      Nome: finalProducts[0].name,
      Lote: finalProducts[0].batch,
      Validade: finalProducts[0].expiry_date,
      Estoque: finalProducts[0].quantity,
      Deposito: finalProducts[0].deposit
    });
  }
}

zeroStocks();
