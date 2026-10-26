create table public.boards (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Tablero sin título',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.items (
  id text primary key,
  board_id uuid not null references public.boards(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index items_board_idx on public.items(board_id);

alter table public.boards enable row level security;
alter table public.items enable row level security;

-- Acceso por enlace: quien conoce el UUID del tablero puede verlo y editarlo.
create policy "boards read" on public.boards for select to anon, authenticated using (true);
create policy "boards insert" on public.boards for insert to anon, authenticated with check (true);
create policy "boards update" on public.boards for update to anon, authenticated using (true) with check (true);
create policy "items read" on public.items for select to anon, authenticated using (true);
create policy "items insert" on public.items for insert to anon, authenticated with check (true);
create policy "items update" on public.items for update to anon, authenticated using (true) with check (true);
create policy "items delete" on public.items for delete to anon, authenticated using (true);
