-- Módulo 3: Produtos (o que é vendido) com variações.
-- Cada variação (ex.: "Prato MDF", "Bandeja plástica") tem os próprios itens e preço.
-- Variações ficam dentro do produto, em JSON, para salvar tudo de uma vez:
--   variacoes: [{ "id": "<uuid>", "nome": "Prato MDF", "ativo": true,
--                 "itens": [{ "tipo": "receita"|"insumo", "id": "<uuid>", "quantidade": 10 }],
--                 "tempo_montagem_min": 5, "pct_custos_fixos": null, "pct_taxas": null,
--                 "pct_margem": null, "pv_manual": 89.9 }]
--   quantidade na unidade base do item (receita: fatias/un, g ou ml; insumo: g, ml ou un).
-- Pode rodar mais de uma vez sem erro.

create table if not exists public.produtos (
  id            uuid primary key default gen_random_uuid(),
  nome          text        not null check (length(trim(nome)) > 0),
  categoria     text        not null default 'outro'
    check (categoria in ('bolo','fatia','doce','torta','kit','outro')),
  descricao     text,
  variacoes     jsonb       not null,
  ativo         boolean     not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Formato mínimo de cada variação. Os itens usam a mesma validação das receitas.
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
               -- tipos: % e preço são número ou vazio; tempo é número; ativo é verdadeiro/falso
               when exists (select 1 from unnest(array['pct_custos_fixos','pct_taxas','pct_margem','pv_manual']) k
                            where coalesce(jsonb_typeof(v -> k), 'null') not in ('number', 'null')) then true
               when coalesce(jsonb_typeof(v -> 'tempo_montagem_min'), 'number') <> 'number' then true
               when coalesce(jsonb_typeof(v -> 'ativo'), 'boolean') <> 'boolean' then true
               -- daqui em diante os valores já são números (ou vazios), então converter é seguro
               when exists (select 1 from unnest(array['pct_custos_fixos','pct_taxas','pct_margem','tempo_montagem_min']) k
                            where (v ->> k)::numeric < 0) then true
               when (v ->> 'pv_manual')::numeric <= 0 then true
               when coalesce((v ->> 'pct_custos_fixos')::numeric, 0) + coalesce((v ->> 'pct_taxas')::numeric, 0)
                    + coalesce((v ->> 'pct_margem')::numeric, 0) >= 100 then true
               else false
             end
     )
  end
$$;

revoke all on function public.produto_variacoes_validas(jsonb) from public, anon;
grant execute on function public.produto_variacoes_validas(jsonb) to authenticated;

alter table public.produtos drop constraint if exists produtos_variacoes_formato;
alter table public.produtos add constraint produtos_variacoes_formato
  check (public.produto_variacoes_validas(variacoes));

create or replace trigger produtos_atualizado_em
  before insert or update on public.produtos
  for each row execute function public.set_atualizado_em();

alter table public.produtos enable row level security;
revoke all on public.produtos from anon;

drop policy if exists "usuarios logados gerenciam produtos" on public.produtos;
create policy "usuarios logados gerenciam produtos"
  on public.produtos for all to authenticated
  using ((select public.eh_usuario_do_app()))
  with check ((select public.eh_usuario_do_app()));
