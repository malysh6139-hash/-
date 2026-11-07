alter table public.games
  drop constraint if exists games_room_key;

drop index if exists public.games_room_key;

alter table public.games
  add column if not exists game_no integer not null default 1;

update public.games
   set game_no = 1
 where game_no is null or game_no < 1;

create index if not exists games_room_status_no_idx
  on public.games (room, status, game_no desc);
