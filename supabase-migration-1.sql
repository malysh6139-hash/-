-- Места в партии: кто белые, кто чёрные, статус партии.
alter table public.games add column if not exists white_id bigint;
alter table public.games add column if not exists white_name text;
alter table public.games add column if not exists black_id bigint;
alter table public.games add column if not exists black_name text;
alter table public.games add column if not exists status text not null default 'open';

select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'games'
order by ordinal_position;
