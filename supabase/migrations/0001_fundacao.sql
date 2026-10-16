-- Módulo 0: Fundação
-- Funções reutilizáveis + configurações de precificação (uma linha só, id = 'padrao').
-- Acesso liberado apenas para usuários logados (os dois donos do app; cadastro público desativado).
-- Pode rodar mais de uma vez sem erro.

-- Mantém atualizado_em com a hora do servidor. Reutilizada em toda tabela que tem a coluna.
create or replace function public.set_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

-- Quem pode usar o app: usuário logado de verdade (login anônimo do Supabase não vale).
create or replace function public.eh_usuario_do_app()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
$$;

revoke all on function public.set_atualizado_em() from public, anon, authenticated;
revoke all on function public.eh_usuario_do_app() from public, anon;
grant execute on function public.eh_usuario_do_app() to authenticated;

-- Defesa extra: tabelas criadas daqui em diante não dão nenhum acesso ao papel anon.
alter default privileges in schema public revoke all on tables from anon;

-- Configurações de precificação
create table if not exists public.config_precificacao (
  id               text primary key default 'padrao' check (id = 'padrao'),
  valor_hora       numeric(10,2) not null default 20 check (valor_hora >= 0),
  pct_custos_fixos numeric(5,2)  not null default 20 check (pct_custos_fixos >= 0),
  pct_taxas        numeric(5,2)  not null default 5  check (pct_taxas >= 0),
  pct_margem       numeric(5,2)  not null default 25 check (pct_margem >= 0),
  arredondamento   text          not null default 'centavos90'
    check (arredondamento in ('nenhum','centavos90','meio_real','real')),
  atualizado_em    timestamptz   not null default now(),
  -- markup divisor: a soma precisa ficar abaixo de 100%, senão o preço é impossível
  constraint pct_validos check (pct_custos_fixos + pct_taxas + pct_margem < 100)
);

insert into public.config_precificacao (id) values ('padrao') on conflict do nothing;

create or replace trigger config_precificacao_atualizado_em
  before insert or update on public.config_precificacao
  for each row execute function public.set_atualizado_em();

alter table public.config_precificacao enable row level security;
revoke all on public.config_precificacao from anon;

drop policy if exists "usuarios logados leem e editam a configuracao" on public.config_precificacao;
create policy "usuarios logados leem e editam a configuracao"
  on public.config_precificacao for all to authenticated
  using ((select public.eh_usuario_do_app()))
  with check ((select public.eh_usuario_do_app()));
