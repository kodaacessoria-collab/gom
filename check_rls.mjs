import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://avkcrhyphobuzzjmyrjl.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2a2NyaHlwaG9idXp6am15cmpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTQ5NzYsImV4cCI6MjA5MzY3MDk3Nn0.-uzBsm2Qm8NCwfcetRvrqgOff-Yv1csBqYZkfI881kE';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
  // Can we fetch by ID?
  const { data, error } = await supabase.from('profiles').select('*').limit(1);
  if (error) {
    console.log("Error selecting profiles:", error);
  } else {
    console.log("Success selecting profiles!");
  }
}

main();
