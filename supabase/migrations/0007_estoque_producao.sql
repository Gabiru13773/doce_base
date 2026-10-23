-- Estoque e Produção.
-- O estoque é um livro de movimentos: cada entrada (+) ou saída (−) é uma linha, e o saldo de
-- um item é a soma das linhas dele. Assim nada se perde: dá para ver de onde veio cada número
-- e desfazer uma produção ou compra apaga os movimentos dela.
-- Quantidades sempre na unidade base do item: insumo em g, ml ou un; receita (preparado) na
-- unidade base do rendimento (g, ml ou un, ex.: fatias).

-- Estoque mínimo também para os preparados (recheio, massa…), na unidade base do rendimento.
alter table public.receitas add column if not exists estoque_minimo numeric(12,3) check (estoque_minimo >= 0);

create table if not exists public.producoes (
  id             uuid primary key default gen_random_uuid(),
  data           date          not null default current_date,
  receita_id     uuid          not null references public.receitas(id) on delete restrict,
  -- quantas vezes a receita foi feita (ex.: 2 = receita dobrada)
  lotes          numeric(10,3) not null check (lotes > 0),
  -- o que entrou no estoque, na unidade base do rendimento (pode diferir do previsto)
  rendimento     numeric(14,3) not null check (rendimento > 0),
  -- custo dos ingredientes e da mão de obra no dia (fica guardado mesmo se os preços mudarem)
  custo_total    numeric(12,2) check (custo_total >= 0),
  observacao     text,
  feito_por      text,
  criado_em      timestamptz   not null default now(),
  atualizado_em  timestamptz   not null default now()
);

create table if not exists public.estoque_movimentos (
  id             uuid primary key default gen_random_uuid(),
  data           date          not null default current_date,
  item_tipo      text          not null check (item_tipo in ('insumo','receita')),
  insumo_id      uuid          references public.insumos(id) on delete cascade,
  receita_id     uuid          references public.receitas(id) on delete cascade,
  -- positivo entra, negativo sai
  quantidade     numeric(14,3) not null check (quantidade <> 0),
  origem         text          not null
    check (origem in ('compra','producao','contagem','perda','venda','uso','entrada')),
  producao_id    uuid          references public.producoes(id) on delete cascade,
  compra_id      uuid          references public.compras(id) on delete cascade,
  observacao     text,
  feito_por      text,
  criado_em      timestamptz   not null default now(),
  atualizado_em  timestamptz   not null default now(),
  constraint estoque_movimentos_item check (
    (item_tipo = 'insumo' and insumo_id is not null and receita_id is null)
    or (item_tipo = 'receita' and receita_id is not null and insumo_id is null)
  )
);

create index if not exists producoes_receita_idx on public.producoes (receita_id);
create index if not exists producoes_data_idx on public.producoes (data);
create index if not exists estoque_movimentos_insumo_idx on public.estoque_movimentos (insumo_id);
create index if not exists estoque_movimentos_receita_idx on public.estoque_movimentos (receita_id);
create index if not exists estoque_movimentos_producao_idx on public.estoque_movimentos (producao_id);
create index if not exists estoque_movimentos_compra_idx on public.estoque_movimentos (compra_id);
create index if not exists estoque_movimentos_data_idx on public.estoque_movimentos (data);

create or replace trigger producoes_atualizado_em before insert or update on public.producoes
  for each row execute function public.set_atualizado_em();
create or replace trigger estoque_movimentos_atualizado_em before insert or update on public.estoque_movimentos
  for each row execute function public.set_atualizado_em();

alter table public.producoes enable row level security;
alter table public.estoque_movimentos enable row level security;
revoke all on public.producoes, public.estoque_movimentos from anon;

drop policy if exists "usuarios logados gerenciam producoes" on public.producoes;
create policy "usuarios logados gerenciam producoes" on public.producoes for all to authenticated
  using ((select public.eh_usuario_do_app())) with check ((select public.eh_usuario_do_app()));
drop policy if exists "usuarios logados gerenciam estoque" on public.estoque_movimentos;
create policy "usuarios logados gerenciam estoque" on public.estoque_movimentos for all to authenticated
  using ((select public.eh_usuario_do_app())) with check ((select public.eh_usuario_do_app()));
