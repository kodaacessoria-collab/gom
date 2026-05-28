import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://avkcrhyphobuzzjmyrjl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2a2NyaHlwaG9idXp6am15cmpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTQ5NzYsImV4cCI6MjA5MzY3MDk3Nn0.-uzBsm2Qm8NCwfcetRvrqgOff-Yv1csBqYZkfI881kE';
const supabase = createClient(supabaseUrl, supabaseKey);

async function listProducts() {
  const { data, error } = await supabase.from('products').select('name, brand, unit, category, deposit');
  if (error) {
    console.error(error);
    return;
  }
  console.log('--- ALL PRODUCTS ---');
  data.forEach((p, idx) => {
    console.log(`${idx + 1}. Name: "${p.name}" | Brand: "${p.brand}" | Unit: "${p.unit}" | Category: "${p.category}" | Deposit: "${p.deposit}"`);
  });
}
listProducts();
