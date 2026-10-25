-- PDV (ponto de venda): vendas no balcão, WhatsApp/Instagram e iFood, baixa no estoque e
-- fechamento do caixa do dia, que leva os totais para o Financeiro (dinheiro no caixa; Pix,
-- cartão e iFood como contas a receber, que o extrato OFX reconhece e dá baixa sem duplicar).

-- Preço no iFood por variação de produto (opcional; vazio = preço do balcão + acréscimo do iFood).
create or replace function public.produto_variacoes_validas(variacoes jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(variacoes) <> 'array' then false else
     jsonb_array_length(variacoes) > 0
     and not exists (
       select 1
       from jsonb_array_elements(variacoes) as e(v)
       where case
               when jsonb_typeof(v) <> 'object' then true
               when jsonb_typeof(v -> 'id') is distinct from 'string' or length(v ->> 'id') = 0 then true
               when jsonb_typeof(v -> 'nome') is distinct from 'string' or length(trim(v ->> 'nome')) = 0 then true
               when jsonb_typeof(v -> 'itens') is distinct from 'array' then true
               when not public.receita_itens_validos(v -> 'itens') then true
               when exists (select 1 from unnest(array['pct_custos_fixos','pct_taxas','pct_margem','pv_manual','pv_ifood']) k
                            where coalesce(jsonb_typeof(v -> k), 'null') not in ('number', 'null')) then true
               when coalesce(jsonb_typeof(v -> 'tempo_montagem_min'), 'number') <> 'number' then true
               when coalesce(jsonb_typeof(v -> 'ativo'), 'boolean') <> 'boolean' then true
               when exists (select 1 from unnest(array['pct_custos_fixos','pct_taxas','pct_margem','tempo_montagem_min']) k
                            where (v ->> k)::numeric < 0) then true
               when (v ->> 'pv_manual')::numeric <= 0 then true
               when (v ->> 'pv_ifood')::numeric <= 0 then true
               when coalesce((v ->> 'pct_custos_fixos')::numeric, 0) + coalesce((v ->> 'pct_taxas')::numeric, 0)
                    + coalesce((v ->> 'pct_margem')::numeric, 0) >= 100 then true
               else false
             end
     )
  end
$$;

-- Configuração do PDV (uma linha só): taxas da maquininha e do iFood, prazos de recebimento e contas.
create table if not exists public.pdv_config (
  id               text primary key default 'padrao' check (id = 'padrao'),
  taxa_debito      numeric(5,2) not null default 1.99 check (taxa_debito between 0 and 100),
  taxa_credito     numeric(5,2) not null default 4.99 check (taxa_credito between 0 and 100),
  taxa_pix         numeric(5,2) not null default 0 check (taxa_pix between 0 and 100),
  comissao_ifood   numeric(5,2) not null default 23 check (comissao_ifood between 0 and 100),
  -- preço no iFood = preço do balcão + este % (quando a variação não tem preço iFood próprio)
  acrescimo_ifood  numeric(5,2) not null default 0 check (acrescimo_ifood between 0 and 300),
  -- em quantos dias o dinheiro cai na conta
  prazo_debito     integer not null default 1 check (prazo_debito between 0 and 120),
  prazo_credito    integer not null default 30 check (prazo_credito between 0 and 120),
  prazo_ifood      integer not null default 7 check (prazo_ifood between 0 and 120),
  conta_caixa_id   uuid references public.fin_contas(id) on delete set null,
  conta_banco_id   uuid references public.fin_contas(id) on delete set null,
  fundo_troco      numeric(12,2) not null default 0 check (fundo_troco >= 0),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

create table if not exists public.caixa_fechamentos (
  id               uuid primary key default gen_random_uuid(),
  data             date not null unique,
  -- resumo do dia (totais por forma e canal, nº de vendas…), para conferir depois
  totais           jsonb not null default '{}'::jsonb check (jsonb_typeof(totais) = 'object'),
  fundo_troco      numeric(12,2) check (fundo_troco >= 0),
  dinheiro_contado numeric(12,2) check (dinheiro_contado >= 0),
  observacao       text,
  feito_por        text,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

create table if not exists public.vendas (
  id                  uuid primary key default gen_random_uuid(),
  data                date not null default current_date,
  canal               text not null default 'balcao' check (canal in ('balcao','whatsapp','ifood')),
  cliente             text,
  -- [{produto_id, variacao_id, nome, qtd, preco}] (nome e preço como estavam na hora da venda)
  itens               jsonb not null check (jsonb_typeof(itens) = 'array' and jsonb_array_length(itens) > 0),
  -- [{forma: dinheiro|pix|debito|credito|ifood, valor}]: soma = total
  pagamentos          jsonb not null check (jsonb_typeof(pagamentos) = 'array' and jsonb_array_length(pagamentos) > 0),
  subtotal            numeric(12,2) not null check (subtotal >= 0),
  desconto            numeric(12,2) not null default 0 check (desconto >= 0),
  total               numeric(12,2) not null check (total >= 0),
  -- troco devolvido no dinheiro (só para conferência do caixa)
  troco               numeric(12,2) not null default 0 check (troco >= 0),
  -- taxas estimadas (maquininha, comissão do iFood)
  taxas               numeric(12,2) not null default 0 check (taxas >= 0),
  status              text not null default 'concluida' check (status in ('concluida','cancelada')),
  motivo_cancelamento text,
  fechamento_id       uuid references public.caixa_fechamentos(id) on delete set null,
  feito_por           text,
  observacao          text,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  constraint vendas_total check (total = subtotal - desconto),
  constraint vendas_cancelada check (status <> 'cancelada' or (motivo_cancelamento is not null and length(trim(motivo_cancelamento)) > 0))
);

create index if not exists vendas_data_idx on public.vendas (data);
create index if not exists vendas_fechamento_idx on public.vendas (fechamento_id);

-- Baixa no estoque de cada venda (apagar/cancelar a venda leva junto).
alter table public.estoque_movimentos add column if not exists venda_id uuid references public.vendas(id) on delete cascade;
create index if not exists estoque_movimentos_venda_idx on public.estoque_movimentos (venda_id);

-- O que o fechamento lançou no Financeiro (desfazer o fechamento apaga junto).
alter table public.fin_lancamentos add column if not exists fechamento_id uuid references public.caixa_fechamentos(id) on delete cascade;
alter table public.fin_titulos add column if not exists fechamento_id uuid references public.caixa_fechamentos(id) on delete cascade;
-- Forma de recebimento das contas a receber do PDV (pix, debito, credito, ifood): ajuda a reconhecer no extrato.
alter table public.fin_titulos add column if not exists forma_pdv text check (forma_pdv in ('pix','debito','credito','ifood'));
create index if not exists fin_lancamentos_fechamento_idx on public.fin_lancamentos (fechamento_id);
create index if not exists fin_titulos_fechamento_idx on public.fin_titulos (fechamento_id);

create or replace trigger pdv_config_atualizado_em before insert or update on public.pdv_config
  for each row execute function public.set_atualizado_em();
create or replace trigger caixa_fechamentos_atualizado_em before insert or update on public.caixa_fechamentos
  for each row execute function public.set_atualizado_em();
create or replace trigger vendas_atualizado_em before insert or update on public.vendas
  for each row execute function public.set_atualizado_em();

alter table public.pdv_config enable row level security;
alter table public.caixa_fechamentos enable row level security;
alter table public.vendas enable row level security;
revoke all on public.pdv_config, public.caixa_fechamentos, public.vendas from anon;

drop policy if exists "usuarios logados gerenciam pdv_config" on public.pdv_config;
create policy "usuarios logados gerenciam pdv_config" on public.pdv_config for all to authenticated
  using ((select public.eh_usuario_do_app())) with check ((select public.eh_usuario_do_app()));
drop policy if exists "usuarios logados gerenciam fechamentos" on public.caixa_fechamentos;
create policy "usuarios logados gerenciam fechamentos" on public.caixa_fechamentos for all to authenticated
  using ((select public.eh_usuario_do_app())) with check ((select public.eh_usuario_do_app()));
drop policy if exists "usuarios logados gerenciam vendas" on public.vendas;
create policy "usuarios logados gerenciam vendas" on public.vendas for all to authenticated
  using ((select public.eh_usuario_do_app())) with check ((select public.eh_usuario_do_app()));
