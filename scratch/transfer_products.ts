import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://avkcrhyphobuzzjmyrjl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2a2NyaHlwaG9idXp6am15cmpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTQ5NzYsImV4cCI6MjA5MzY3MDk3Nn0.-uzBsm2Qm8NCwfcetRvrqgOff-Yv1csBqYZkfI881kE';
const supabase = createClient(supabaseUrl, supabaseKey);

async function transfer() {
  console.log('--- Checking current product distribution ---');
  const { data: initialData, error: checkError } = await supabase
    .from('products')
    .select('id, category, deposit');
  
  if (checkError) {
    console.error('Error fetching products:', checkError);
    return;
  }

  const counts: Record<string, number> = {};
  initialData.forEach(p => {
    const key = `${p.category} | ${p.deposit}`;
    counts[key] = (counts[key] || 0) + 1;
  });
  console.log('Current distribution:', counts);

  console.log('\n--- Performing transfer ---');
  const { data: updatedData, error: updateError } = await supabase
    .from('products')
    .update({ deposit: 'Depósito-RED' })
    .in('category', ['Estocáveis', 'DIETA'])
    .eq('deposit', 'Depósito-Grupo OM')
    .select();

  if (updateError) {
    console.error('Error during update:', updateError);
    return;
  }

  console.log(`Successfully updated ${updatedData ? updatedData.length : 0} products.`);

  console.log('\n--- Checking post-transfer distribution ---');
  const { data: finalData } = await supabase
    .from('products')
    .select('id, category, deposit');
  
  const finalCounts: Record<string, number> = {};
  if (finalData) {
    finalData.forEach(p => {
      const key = `${p.category} | ${p.deposit}`;
      finalCounts[key] = (finalCounts[key] || 0) + 1;
    });
  }
  console.log('Final distribution:', finalCounts);
}

transfer();
