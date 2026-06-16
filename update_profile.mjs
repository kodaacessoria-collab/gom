import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://avkcrhyphobuzzjmyrjl.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2a2NyaHlwaG9idXp6am15cmpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTQ5NzYsImV4cCI6MjA5MzY3MDk3Nn0.-uzBsm2Qm8NCwfcetRvrqgOff-Yv1csBqYZkfI881kE';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
  const emailToUpdate = process.argv[2];
  if (!emailToUpdate) {
    console.log("Provide an email.");
    return;
  }
  const { data: profile, error: fetchErr } = await supabase.from('profiles').select('*').eq('email', emailToUpdate).single();
  if (fetchErr) {
    console.error('Error fetching profile:', fetchErr);
    return;
  }
  
  console.log(`Updating ${emailToUpdate} to admin...`);
  const { error: updateErr } = await supabase.from('profiles').update({ role: 'admin' }).eq('id', profile.id);
  
  if (updateErr) {
    console.error('Error updating:', updateErr);
  } else {
    console.log('Update successful!');
  }
}

main();
