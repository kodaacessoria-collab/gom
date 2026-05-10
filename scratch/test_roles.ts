import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://avkcrhyphobuzzjmyrjl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2a2NyaHlwaG9idXp6am15cmpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTQ5NzYsImV4cCI6MjA5MzY3MDk3Nn0.-uzBsm2Qm8NCwfcetRvrqgOff-Yv1csBqYZkfI881kE';
const supabase = createClient(supabaseUrl, supabaseKey);

const rolesToTry = [
  'ADMIN', 'MANAGER', 'USER',
  'admin', 'manager', 'user',
  'GERENTE', 'OPERADOR',
  'gerente', 'operador',
  'GESTOR', 'FUNCIONARIO',
  'ADMINISTRADOR', 'COLABORADOR'
];

async function findValidRoles() {
  console.log('Testing roles...');
  for (const role of rolesToTry) {
    // Try to insert a dummy row (will likely fail due to RLS or other things, but we want to see the error message)
    const { error } = await supabase.from('profiles').insert([{ 
      id: '00000000-0000-0000-0000-000000000000', 
      email: 'test@example.com',
      role: role 
    }]);

    if (error) {
      if (error.message.includes('violates check constraint "profiles_role_check"')) {
        console.log(`Role "${role}" is INVALID.`);
      } else {
        // If it's a different error (like RLS or duplicate key), it might mean the role IS valid!
        console.log(`Role "${role}" returned a DIFFERENT error: ${error.message}. It might be VALID!`);
      }
    } else {
      console.log(`Role "${role}" was ACCEPTED!`);
    }
  }
}

findValidRoles();
