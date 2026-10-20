-- Financeiro (F1 + F2 + importação de extrato OFX)
--   fin_categorias  plano de contas: Grupo → Subgrupo → Categoria (+ linha da DRE)
--   fin_contas      onde o dinheiro fica (banco, caixa da loja, carteira digital)
--   fin_titulos     contas a pagar e a receber (o que vai vencer)
--   fin_lancamentos o que de fato entrou/saiu (inclui a baixa de um título e as transferências)
-- Valores sempre positivos; o "tipo" diz o sentido.
-- Um título está pago quando os lançamentos ligados a ele somam o valor dele
-- (assim "dar baixa" é gravar 1 lançamento, e desfazer é apagá-lo).
-- Pode rodar mais de uma vez sem erro.

create table if not exists public.fin_categorias (
  id         uuid primary key default gen_random_uuid(),
  tipo       text        not null check (tipo in ('entrada','saida')),
  grupo      text        not null check (length(trim(grupo)) > 0),
  subgrupo   text        not null check (length(trim(subgrupo)) > 0),
  nome       text        not null check (length(trim(nome)) > 0),
  -- Linha da DRE onde a categoria entra; 'fora' = não entra no resultado (empréstimo, aporte, investimento).
  linha_dre  text        not null default 'despesas_operacionais'
    check (linha_dre in ('receita_bruta','deducoes','impostos','custos','despesas_operacionais','financeiras','fora')),
  ordem      integer     not null default 0,
  ativo      boolean     not null default true,
  criado_em  timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint fin_categorias_unica unique (tipo, grupo, subgrupo, nome)
);

create table if not exists public.fin_contas (
  id            uuid primary key default gen_random_uuid(),
  nome          text          not null check (length(trim(nome)) > 0),
  tipo          text          not null default 'banco' check (tipo in ('banco','caixa','carteira')),
  saldo_inicial numeric(14,2) not null default 0,
  -- Data do saldo inicial: lançamentos antes dela não mexem no saldo.
  saldo_em      date          not null default current_date,
  ativo         boolean       not null default true,
  criado_em     timestamptz   not null default now(),
  atualizado_em timestamptz   not null default now()
);

create table if not exists public.fin_titulos (
  id            uuid primary key default gen_random_uuid(),
  tipo          text          not null check (tipo in ('pagar','receber')),
  descricao     text          not null check (length(trim(descricao)) > 0),
  pessoa        text,           -- cliente ou fornecedor
  categoria_id  uuid          references public.fin_categorias(id) on delete restrict,
  conta_id      uuid          references public.fin_contas(id) on delete set null, -- conta prevista
  valor         numeric(14,2) not null check (valor > 0),
  emissao       date          not null default current_date,
  vencimento    date          not null,
  -- Parcelas e recorrência: títulos do mesmo grupo (ex.: "2/6").
  grupo_id      uuid,
  parcela       text,
  nota_fiscal   text,
  observacao    text,
  criado_em     timestamptz   not null default now(),
  atualizado_em timestamptz   not null default now()
);

create table if not exists public.fin_lancamentos (
  id               uuid primary key default gen_random_uuid(),
  tipo             text          not null check (tipo in ('entrada','saida','transferencia')),
  data             date          not null,
  descricao        text          not null check (length(trim(descricao)) > 0),
  pessoa           text,
  categoria_id     uuid          references public.fin_categorias(id) on delete restrict,
  conta_id         uuid          not null references public.fin_contas(id) on delete restrict,
  -- Só em transferências: para onde o dinheiro foi.
  conta_destino_id uuid          references public.fin_contas(id) on delete restrict,
  valor            numeric(14,2) not null check (valor > 0),
  forma_pagamento  text,
  titulo_id        uuid          references public.fin_titulos(id) on delete set null,
  -- Identificador da transação no extrato OFX (evita importar duas vezes).
  ofx_fitid        text,
  observacao       text,
  criado_em        timestamptz   not null default now(),
  atualizado_em    timestamptz   not null default now(),
  constraint fin_lancamentos_transferencia check (
    (tipo = 'transferencia') = (conta_destino_id is not null)
    and (conta_destino_id is null or conta_destino_id <> conta_id)
  ),
  constraint fin_lancamentos_titulo_sentido check (titulo_id is null or tipo <> 'transferencia')
);

create unique index if not exists fin_lancamentos_ofx_unico on public.fin_lancamentos (conta_id, ofx_fitid) where ofx_fitid is not null;
create index if not exists fin_lancamentos_data_idx on public.fin_lancamentos (data desc);
create index if not exists fin_lancamentos_titulo_idx on public.fin_lancamentos (titulo_id) where titulo_id is not null;
create index if not exists fin_titulos_vencimento_idx on public.fin_titulos (vencimento);

create or replace trigger fin_categorias_atualizado_em before insert or update on public.fin_categorias
  for each row execute function public.set_atualizado_em();
create or replace trigger fin_contas_atualizado_em before insert or update on public.fin_contas
  for each row execute function public.set_atualizado_em();
create or replace trigger fin_titulos_atualizado_em before insert or update on public.fin_titulos
  for each row execute function public.set_atualizado_em();
create or replace trigger fin_lancamentos_atualizado_em before insert or update on public.fin_lancamentos
  for each row execute function public.set_atualizado_em();

alter table public.fin_categorias enable row level security;
alter table public.fin_contas enable row level security;
alter table public.fin_titulos enable row level security;
alter table public.fin_lancamentos enable row level security;
revoke all on public.fin_categorias, public.fin_contas, public.fin_titulos, public.fin_lancamentos from anon;

drop policy if exists "usuarios logados gerenciam categorias" on public.fin_categorias;
create policy "usuarios logados gerenciam categorias" on public.fin_categorias for all to authenticated
  using ((select public.eh_usuario_do_app())) with check ((select public.eh_usuario_do_app()));
drop policy if exists "usuarios logados gerenciam contas" on public.fin_contas;
create policy "usuarios logados gerenciam contas" on public.fin_contas for all to authenticated
  using ((select public.eh_usuario_do_app())) with check ((select public.eh_usuario_do_app()));
drop policy if exists "usuarios logados gerenciam titulos" on public.fin_titulos;
create policy "usuarios logados gerenciam titulos" on public.fin_titulos for all to authenticated
  using ((select public.eh_usuario_do_app())) with check ((select public.eh_usuario_do_app()));
drop policy if exists "usuarios logados gerenciam lancamentos" on public.fin_lancamentos;
create policy "usuarios logados gerenciam lancamentos" on public.fin_lancamentos for all to authenticated
  using ((select public.eh_usuario_do_app())) with check ((select public.eh_usuario_do_app()));

-- Plano de contas inicial, adaptado da planilha "Demonstrativos Financeiros" para a confeitaria.
-- (O app cria o mesmo plano no modo local; ver src/modules/financeiro/planoPadrao.ts.)
insert into public.fin_categorias (tipo, grupo, subgrupo, nome, linha_dre, ordem) values
  ('entrada','Receitas de Venda','Vendas','Vendas no balcão','receita_bruta',1),
  ('entrada','Receitas de Venda','Vendas','Encomendas','receita_bruta',2),
  ('entrada','Receitas de Venda','Vendas','iFood e aplicativos','receita_bruta',3),
  ('entrada','Receitas de Venda','Vendas','Eventos e festas','receita_bruta',4),
  ('entrada','Outras Entradas','Outras entradas','Aporte dos sócios','fora',10),
  ('entrada','Outras Entradas','Outras entradas','Empréstimos recebidos','fora',11),
  ('entrada','Outras Entradas','Outras entradas','Rendimentos','financeiras',12),
  ('entrada','Outras Entradas','Outras entradas','Outras entradas','fora',13),
  ('saida','Deduções da Receita','Taxas e descontos','Taxas de cartão/maquininha','deducoes',20),
  ('saida','Deduções da Receita','Taxas e descontos','Taxas do iFood e apps','deducoes',21),
  ('saida','Deduções da Receita','Taxas e descontos','Descontos e devoluções','deducoes',22),
  ('saida','Despesas com Impostos','Impostos','Simples Nacional / DAS-MEI','impostos',30),
  ('saida','Despesas com Impostos','Impostos','Outros impostos','impostos',31),
  ('saida','Despesas com Produto','Custos de produção','Ingredientes e insumos','custos',40),
  ('saida','Despesas com Produto','Custos de produção','Embalagens','custos',41),
  ('saida','Despesas com Produto','Custos de produção','Gás','custos',42),
  ('saida','Despesas com Produto','Custos de produção','Fretes e entregas','custos',43),
  ('saida','Despesas Operacionais','Pessoal','Salários','despesas_operacionais',50),
  ('saida','Despesas Operacionais','Pessoal','Pró-labore (sócios)','despesas_operacionais',51),
  ('saida','Despesas Operacionais','Pessoal','Diárias e freelancers','despesas_operacionais',52),
  ('saida','Despesas Operacionais','Pessoal','Encargos e benefícios','despesas_operacionais',53),
  ('saida','Despesas Operacionais','Imóvel','Aluguel','despesas_operacionais',60),
  ('saida','Despesas Operacionais','Imóvel','Manutenção e conservação','despesas_operacionais',61),
  ('saida','Despesas Operacionais','Concessionárias','Energia elétrica','despesas_operacionais',70),
  ('saida','Despesas Operacionais','Concessionárias','Água','despesas_operacionais',71),
  ('saida','Despesas Operacionais','Concessionárias','Internet e telefone','despesas_operacionais',72),
  ('saida','Despesas Operacionais','Veículo','Combustível','despesas_operacionais',80),
  ('saida','Despesas Operacionais','Veículo','Manutenção do veículo','despesas_operacionais',81),
  ('saida','Despesas Operacionais','Marketing','Anúncios e redes sociais','despesas_operacionais',90),
  ('saida','Despesas Operacionais','Marketing','Fotos, vídeos e material de divulgação','despesas_operacionais',91),
  ('saida','Despesas Operacionais','Administrativas','Contabilidade','despesas_operacionais',100),
  ('saida','Despesas Operacionais','Administrativas','Sistemas e assinaturas','despesas_operacionais',101),
  ('saida','Despesas Operacionais','Administrativas','Material de limpeza e escritório','despesas_operacionais',102),
  ('saida','Despesas Financeiras','Financeiras','Tarifas bancárias','financeiras',110),
  ('saida','Despesas Financeiras','Financeiras','Juros e multas','financeiras',111),
  ('saida','Investimentos e Empréstimos','Fora do resultado','Equipamentos e utensílios','fora',120),
  ('saida','Investimentos e Empréstimos','Fora do resultado','Pagamento de empréstimos','fora',121),
  ('saida','Investimentos e Empréstimos','Fora do resultado','Retirada dos sócios','fora',122)
on conflict on constraint fin_categorias_unica do nothing;
