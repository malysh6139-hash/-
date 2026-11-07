create table if not exists public.chess_messages (
  id uuid primary key default gen_random_uuid(),
  room text not null,
  user_id bigint,
  name text,
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists chess_messages_room_created_idx
  on public.chess_messages (room, created_at desc);

alter table public.chess_messages enable row level security;

drop policy if exists "chess messages all" on public.chess_messages;
create policy "chess messages all" on public.chess_messages
  for all using (true) with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chess_messages'
  ) then
    alter publication supabase_realtime add table public.chess_messages;
  end if;
end $$;
