do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_shared_state'
  ) then
    alter publication supabase_realtime add table public.app_shared_state;
  end if;
end
$$;
