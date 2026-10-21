-- Módulo Compras: lista de compras montada com os insumos cadastrados, feita no mercado
-- pelos dois ao mesmo tempo (cada item marcado aparece no outro celular) e, ao finalizar,
-- grava o preço pago no histórico do insumo e lança a compra no Financeiro.
-- Quantidades dos itens em EMBALAGENS (ex.: 3 pacotes de 1 kg); preço pago por embalagem.

-- Código de barras opcional no insumo (para achar o item escaneando no mercado).
alter table public.insumos add column if not exists codigo_barras text
  check (codigo_barras is null or codigo_barras ~ '^[0-9]{6,14}$');
create index if not exists insumos_codigo_barras_idx on public.insumos (codigo_barras) where codigo_barras is not null;

create table if not exists public.compras (
  id             uuid primary key default gen_random_uuid(),
  nome           text          not null check (length(trim(nome)) > 0),
  -- onde vai comprar (Atacadão, loja de embalagens…); vai para o histórico de preços e para o Financeiro
  local          text,
  data           date          not null default current_date,
  status         text          not null default 'aberta' check (status in ('aberta','finalizada')),
  -- total pago na nota (pode ter desconto ou frete em relação à soma dos itens)
  total          numeric(12,2) check (total >= 0),
  finalizada_em  timestamptz,
  observacao     text,
  criado_em      timestamptz   not null default now(),
  atualizado_em  timestamptz   not null default now(),
  constraint compras_finalizada check ((status = 'finalizada') = (finalizada_em is not null))
);

create table if not exists public.compra_itens (
  id                 uuid primary key default gen_random_uuid(),
  compra_id          uuid          not null references public.compras(id) on delete cascade,
  -- insumo pedido (fica null se o insumo for excluído de vez; o nome guardado continua)
  insumo_id          uuid          references public.insumos(id) on delete set null,
  nome               text          not null check (length(trim(nome)) > 0),
  qtd_pedida         numeric(12,3) not null check (qtd_pedida > 0),
  -- embalagem do que foi (ou vai ser) comprado, ex.: 1 kg; copiada do insumo e editável
  embalagem_qtd      numeric(12,3) not null check (embalagem_qtd > 0),
  embalagem_unidade  text          not null check (embalagem_unidade in ('g','kg','ml','l','un','dz')),
  status             text          not null default 'pendente'
    check (status in ('pendente','comprado','substituido','nao')),
  qtd_comprada       numeric(12,3) check (qtd_comprada > 0),
  preco_pago         numeric(12,2) check (preco_pago >= 0),
  motivo             text,
  -- "Trocar": o que levou no lugar (outro insumo cadastrado)
  sub_insumo_id      uuid          references public.insumos(id) on delete set null,
  sub_nome           text,
  fora_da_lista      boolean       not null default false,
  marcado_por        text,
  ordem              integer       not null default 0,
  criado_em          timestamptz   not null default now(),
  atualizado_em      timestamptz   not null default now(),
  constraint compra_itens_levou check (status not in ('comprado','substituido') or qtd_comprada is not null),
  constraint compra_itens_troca check (status <> 'substituido' or (sub_nome is not null and length(trim(sub_nome)) > 0)),
  constraint compra_itens_nao check (status <> 'nao' or (motivo is not null and length(trim(motivo)) > 0))
);

create index if not exists compra_itens_compra_idx on public.compra_itens (compra_id);
create index if not exists compra_itens_insumo_idx on public.compra_itens (insumo_id);
create index if not exists compra_itens_sub_insumo_idx on public.compra_itens (sub_insumo_id);

-- Histórico de preços: de qual compra veio e onde foi comprado.
alter table public.precos_insumo add column if not exists compra_id uuid references public.compras(id) on delete set null;
alter table public.precos_insumo add column if not exists local text;
create index if not exists precos_insumo_compra_idx on public.precos_insumo (compra_id);

-- Financeiro: de qual compra veio o lançamento ou a conta a pagar.
alter table public.fin_lancamentos add column if not exists compra_id uuid references public.compras(id) on delete set null;
alter table public.fin_titulos add column if not exists compra_id uuid references public.compras(id) on delete set null;
create index if not exists fin_lancamentos_compra_idx on public.fin_lancamentos (compra_id);
create index if not exists fin_titulos_compra_idx on public.fin_titulos (compra_id);

create or replace trigger compras_atualizado_em before insert or update on public.compras
  for each row execute function public.set_atualizado_em();
create or replace trigger compra_itens_atualizado_em before insert or update on public.compra_itens
  for each row execute function public.set_atualizado_em();

alter table public.compras enable row level security;
alter table public.compra_itens enable row level security;
revoke all on public.compras, public.compra_itens from anon;

drop policy if exists "usuarios logados gerenciam compras" on public.compras;
create policy "usuarios logados gerenciam compras" on public.compras for all to authenticated
  using ((select public.eh_usuario_do_app())) with check ((select public.eh_usuario_do_app()));
drop policy if exists "usuarios logados gerenciam itens de compra" on public.compra_itens;
create policy "usuarios logados gerenciam itens de compra" on public.compra_itens for all to authenticated
  using ((select public.eh_usuario_do_app())) with check ((select public.eh_usuario_do_app()));
