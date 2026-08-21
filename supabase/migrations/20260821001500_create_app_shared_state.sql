create table if not exists public.app_shared_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_shared_state enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'app_shared_state'
      and policyname = 'Allow application access to shared state'
  ) then
    create policy "Allow application access to shared state"
      on public.app_shared_state
      for all
      using (true)
      with check (true);
  end if;
end
$$;
