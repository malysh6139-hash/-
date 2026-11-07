-- Таблица партий: одна строка на чат (room), чтобы оба телефона играли одну партию.
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  room text not null unique,
  board_state text not null,
  is_white_turn boolean not null default true,
  moves jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.games enable row level security;

drop policy if exists "Разрешить всё всем" on public.games;
create policy "Разрешить всё всем" on public.games
  for all using (true) with check (true);

do $$
begin
  alter publication supabase_realtime add table public.games;
exception
  when duplicate_object then null;
end $$;
