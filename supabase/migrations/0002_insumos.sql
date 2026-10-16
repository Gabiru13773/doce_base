-- Módulo 1: Insumos (ingredientes, embalagens, materiais, corantes)
-- Pode rodar mais de uma vez sem erro.

create table if not exists public.insumos (
  id              uuid primary key default gen_random_uuid(),
  nome            text          not null check (length(trim(nome)) > 0),
  categoria       text          not null default 'ingrediente'
    check (categoria in ('ingrediente','embalagem','material','corante','outro')),
  unidade_compra  text          not null default 'g'
    check (unidade_compra in ('g','kg','ml','l','un','dz')),
  qtd_compra      numeric(12,3) not null check (qtd_compra > 0),
  preco_compra    numeric(12,2) not null check (preco_compra >= 0),
  marca           text,
  fornecedor      text,
  estoque_minimo  numeric(12,3) check (estoque_minimo >= 0),
  observacao      text,
  ativo           boolean       not null default true,
  criado_em       timestamptz   not null default now(),
  atualizado_em   timestamptz   not null default now()
);

create or replace trigger insumos_atualizado_em
  before insert or update on public.insumos
  for each row execute function public.set_atualizado_em();

-- Histórico de preços: cada vez que o preço ou a embalagem mudam, guardamos a compra.
-- (Apagar o insumo apaga o histórico junto.)
create table if not exists public.precos_insumo (
  id             uuid primary key default gen_random_uuid(),
  insumo_id      uuid          not null references public.insumos(id) on delete cascade,
  qtd_compra     numeric(12,3) not null check (qtd_compra > 0),
  unidade_compra text          not null
    check (unidade_compra in ('g','kg','ml','l','un','dz')),
  preco_compra   numeric(12,2) not null check (preco_compra >= 0),
  registrado_em  timestamptz   not null default now()
);

-- Serve à tela de histórico (filtra por insumo, mais recente primeiro) e ao cascade.
create index if not exists precos_insumo_insumo_idx on public.precos_insumo (insumo_id, registrado_em desc);

alter table public.insumos enable row level security;
alter table public.precos_insumo enable row level security;
revoke all on public.insumos, public.precos_insumo from anon;

drop policy if exists "usuarios logados gerenciam insumos" on public.insumos;
create policy "usuarios logados gerenciam insumos"
  on public.insumos for all to authenticated
  using ((select public.eh_usuario_do_app()))
  with check ((select public.eh_usuario_do_app()));

drop policy if exists "usuarios logados gerenciam historico de precos" on public.precos_insumo;
create policy "usuarios logados gerenciam historico de precos"
  on public.precos_insumo for all to authenticated
  using ((select public.eh_usuario_do_app()))
  with check ((select public.eh_usuario_do_app()));
