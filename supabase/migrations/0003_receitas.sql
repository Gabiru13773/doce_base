-- Módulo 2: Receitas + precificação + ficha técnica
-- Ingredientes (itens) e modo de preparo (passos) ficam dentro da receita, em JSON,
-- para que salvar seja uma operação só (ou grava tudo, ou nada).
--   itens:  [{ "tipo": "insumo" | "receita", "id": "<uuid>", "quantidade": 300 }]
--           quantidade na unidade base do item (g, ml ou un)
--   passos: ["Bata os ovos com o açúcar", "Asse por 40 minutos", ...]
-- Pode rodar mais de uma vez sem erro.

create table if not exists public.receitas (
  id                  uuid primary key default gen_random_uuid(),
  nome                text          not null check (length(trim(nome)) > 0),
  categoria           text          not null default 'outro'
    check (categoria in ('bolo','doce','torta','massa','recheio','cobertura','calda','outro')),
  -- Rendimento: quantidade + unidade. Em 'un', rendimento_nome diz o que é (ex.: "fatia").
  rendimento_qtd      numeric(12,3) not null check (rendimento_qtd > 0),
  rendimento_unidade  text          not null default 'un'
    check (rendimento_unidade in ('un','g','kg','ml','l')),
  rendimento_nome     text,
  itens               jsonb         not null default '[]'::jsonb check (jsonb_typeof(itens) = 'array'),
  -- Tempos em minutos; o preparo entra no custo como mão de obra.
  tempo_preparo_min   integer       not null default 0 check (tempo_preparo_min >= 0),
  tempo_forno_min     integer       check (tempo_forno_min >= 0),
  tempo_descanso_min  integer       check (tempo_descanso_min >= 0),
  temperatura_forno   integer       check (temperatura_forno between 0 and 400),
  passos              jsonb         not null default '[]'::jsonb check (jsonb_typeof(passos) = 'array'),
  utensilios          text,
  pontos_atencao      text,
  validade            text,
  -- Ajustes de precificação só desta receita (vazio = usa as configurações gerais).
  pct_custos_fixos    numeric(5,2)  check (pct_custos_fixos >= 0),
  pct_taxas           numeric(5,2)  check (pct_taxas >= 0),
  pct_margem          numeric(5,2)  check (pct_margem >= 0),
  -- Preço de venda digitado à mão, por unidade de venda (por fatia, por kg, por litro).
  pv_manual           numeric(12,2) check (pv_manual >= 0),
  ativo               boolean       not null default true,
  criado_em           timestamptz   not null default now(),
  atualizado_em       timestamptz   not null default now()
);

create or replace trigger receitas_atualizado_em
  before insert or update on public.receitas
  for each row execute function public.set_atualizado_em();

alter table public.receitas enable row level security;
revoke all on public.receitas from anon;

drop policy if exists "usuarios logados gerenciam receitas" on public.receitas;
create policy "usuarios logados gerenciam receitas"
  on public.receitas for all to authenticated
  using ((select public.eh_usuario_do_app()))
  with check ((select public.eh_usuario_do_app()));
