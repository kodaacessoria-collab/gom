import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://avkcrhyphobuzzjmyrjl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2a2NyaHlwaG9idXp6am15cmpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTQ5NzYsImV4cCI6MjA5MzY3MDk3Nn0.-uzBsm2Qm8NCwfcetRvrqgOff-Yv1csBqYZkfI881kE';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRoles() {
  const { data, error } = await supabase.from('profiles').select('role');
  if (error) {
    console.error('Error fetching roles:', error);
    return;
  }
  if (!data) {
    console.log('No profiles found.');
    return;
  }
  const roles = [...new Set(data.map(r => r.role))];
  console.log('Roles found in database:', roles);
}

checkRoles();
