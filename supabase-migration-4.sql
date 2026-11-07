alter table public.games
  add column if not exists white_photo text,
  add column if not exists black_photo text;

alter table public.chess_messages
  add column if not exists photo text;
