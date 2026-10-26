-- Clientes e Pedidos (encomendas): cliente encomenda para um dia, paga um sinal e o resto na
-- entrega. Cada pagamento do pedido é uma venda do PDV (vendas.pedido_id): entra no fechamento
-- do caixa do dia em que foi recebido, como qualquer venda. A baixa no estoque é feita na entrega
-- (estoque_movimentos.pedido_id).

create table if not exists public.clientes (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (length(trim(nome)) > 0),
  telefone      text,
  instagram     text,
  endereco      text,
  observacao    text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.pedidos (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid references public.clientes(id) on delete restrict,
  -- nome e telefone como estavam na hora do pedido
  cliente_nome        text not null check (length(trim(cliente_nome)) > 0),
  telefone            text,
  canal               text not null default 'whatsapp' check (canal in ('balcao','whatsapp')),
  entrega_data        date not null,
  -- "14:30" (opcional)
  entrega_hora        text check (entrega_hora is null or entrega_hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  entrega_tipo        text not null default 'retirada' check (entrega_tipo in ('retirada','propria','motoboy')),
  endereco            text,
  taxa_entrega        numeric(12,2) not null default 0 check (taxa_entrega >= 0),
  -- [{id, produto_id|null, variacao_id|null, nome, qtd, preco, personalizacao?}]
  -- produto_id null = item avulso (preço combinado na hora)
  itens               jsonb not null check (jsonb_typeof(itens) = 'array' and jsonb_array_length(itens) > 0),
  observacao          text,
  -- fotos de referência: caminhos no Storage (bucket "pedidos")
  fotos               jsonb not null default '[]'::jsonb check (jsonb_typeof(fotos) = 'array'),
  subtotal            numeric(12,2) not null check (subtotal >= 0),
  desconto            numeric(12,2) not null default 0 check (desconto >= 0),
  total               numeric(12,2) not null check (total >= 0),
  status              text not null default 'confirmado' check (status in ('confirmado','pronto','entregue','cancelado')),
  motivo_cancelamento text,
  entregue_em         timestamptz,
  feito_por           text,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  constraint pedidos_total check (total = subtotal - desconto + taxa_entrega and desconto <= subtotal),
  constraint pedidos_cancelado check (status <> 'cancelado' or (motivo_cancelamento is not null and length(trim(motivo_cancelamento)) > 0)),
  constraint pedidos_entregue check (status <> 'entregue' or entregue_em is not null)
);

create index if not exists pedidos_entrega_idx on public.pedidos (entrega_data);
create index if not exists pedidos_cliente_idx on public.pedidos (cliente_id);

-- Pagamentos do pedido (sinal, restante): são vendas do PDV.
alter table public.vendas add column if not exists pedido_id uuid references public.pedidos(id) on delete set null;
create index if not exists vendas_pedido_idx on public.vendas (pedido_id);

-- Baixa no estoque na entrega do pedido (desfazer a entrega ou apagar o pedido leva junto).
alter table public.estoque_movimentos add column if not exists pedido_id uuid references public.pedidos(id) on delete cascade;
create index if not exists estoque_movimentos_pedido_idx on public.estoque_movimentos (pedido_id);

-- Sinal sugerido (% do total) ao receber um pedido.
alter table public.pdv_config add column if not exists pct_sinal numeric(5,2) not null default 50 check (pct_sinal between 0 and 100);

create or replace trigger clientes_atualizado_em before insert or update on public.clientes
  for each row execute function public.set_atualizado_em();
create or replace trigger pedidos_atualizado_em before insert or update on public.pedidos
  for each row execute function public.set_atualizado_em();

alter table public.clientes enable row level security;
alter table public.pedidos enable row level security;
revoke all on public.clientes, public.pedidos from anon;

drop policy if exists "usuarios logados gerenciam clientes" on public.clientes;
create policy "usuarios logados gerenciam clientes" on public.clientes for all to authenticated
  using ((select public.eh_usuario_do_app())) with check ((select public.eh_usuario_do_app()));
drop policy if exists "usuarios logados gerenciam pedidos" on public.pedidos;
create policy "usuarios logados gerenciam pedidos" on public.pedidos for all to authenticated
  using ((select public.eh_usuario_do_app())) with check ((select public.eh_usuario_do_app()));

-- Fotos de referência dos pedidos (bucket privado; o app mostra com link temporário).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pedidos', 'pedidos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "usuarios do app leem fotos de pedidos" on storage.objects;
create policy "usuarios do app leem fotos de pedidos" on storage.objects for select to authenticated
  using (bucket_id = 'pedidos' and (select public.eh_usuario_do_app()));
drop policy if exists "usuarios do app enviam fotos de pedidos" on storage.objects;
create policy "usuarios do app enviam fotos de pedidos" on storage.objects for insert to authenticated
  with check (bucket_id = 'pedidos' and (select public.eh_usuario_do_app()));
drop policy if exists "usuarios do app apagam fotos de pedidos" on storage.objects;
create policy "usuarios do app apagam fotos de pedidos" on storage.objects for delete to authenticated
  using (bucket_id = 'pedidos' and (select public.eh_usuario_do_app()));
