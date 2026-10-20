import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { BarraAcao, Botao, Busca, Carregando, Cartao, Erro, Pilulas, TituloPagina, Vazio } from '../../components/ui'
import { efeitoNaConta, saldoConta } from '../../lib/financeiro'
import { moeda } from '../../lib/format'
import { hoje, useCategoriasFin, useContasFin, useLancamentos, type CategoriaFin, type ContaFin, type Lancamento } from './api'
import { ValorSinal } from './componentes/Comum'
import { SeletorConta, nomeCategoria } from './componentes/Seletores'
import { diaPorExtenso, dataBr, fimDoMes, mensagemDe, nomeMes, simplificar, somarMes } from './util'

type FiltroTipo = 'todos' | Lancamento['tipo']

const OPCOES_TIPO: { valor: FiltroTipo; rotulo: string }[] = [
  { valor: 'todos', rotulo: 'Todos' },
  { valor: 'entrada', rotulo: 'Entradas' },
  { valor: 'saida', rotulo: 'Saídas' },
  { valor: 'transferencia', rotulo: 'Transferências' },
]

const MES_VALIDO = /^\d{4}-(0[1-9]|1[0-2])$/

export default function LancamentosPage() {
  const navegar = useNavigate()
  const [params, setParams] = useSearchParams()
  const contas = useContasFin()
  const categorias = useCategoriasFin()
  const lancamentos = useLancamentos()
  const [tipo, setTipo] = useState<FiltroTipo>('todos')
  const [busca, setBusca] = useState('')

  // Mês e conta ficam no endereço: ao voltar de uma edição, a tela continua igual.
  const mesUrl = params.get('mes') ?? ''
  const mes = MES_VALIDO.test(mesUrl) ? mesUrl : hoje().slice(0, 7)
  const contaId = params.get('conta')

  function mudarParam(chave: string, valor: string | null) {
    const novo = new URLSearchParams(params)
    if (valor) novo.set(chave, valor)
    else novo.delete(chave)
    setParams(novo, { replace: true })
  }

  const consultas = [contas, categorias, lancamentos]
  const carregando = consultas.some((c) => c.isLoading)
  const comErro = consultas.find((c) => c.isError)

  const listaContas = contas.data ?? []
  const conta = contaId ? listaContas.find((c) => c.id === contaId) : undefined

  return (
    <>
      <TituloPagina titulo="Extrato" subtitulo={conta ? conta.nome : 'Tudo o que entrou e saiu'} />

      {carregando ? (
        <Carregando />
      ) : comErro ? (
        <Erro mensagem={mensagemDe(comErro.error)} tentarDeNovo={() => consultas.forEach((c) => void c.refetch())} />
      ) : (
        <Conteudo
          mes={mes}
          aoMudarMes={(m) => mudarParam('mes', m === hoje().slice(0, 7) ? null : m)}
          conta={conta}
          aoMudarConta={(id) => mudarParam('conta', id)}
          contas={listaContas}
          categorias={categorias.data ?? []}
          lancamentos={lancamentos.data ?? []}
          tipo={tipo}
          setTipo={setTipo}
          busca={busca}
          setBusca={setBusca}
        />
      )}

      <BarraAcao>
        <Botao className="flex-1" onClick={() => navegar('/financeiro/lancar')}>
          + Lançar
        </Botao>
      </BarraAcao>
    </>
  )
}

function Conteudo({
  mes,
  aoMudarMes,
  conta,
  aoMudarConta,
  contas,
  categorias,
  lancamentos,
  tipo,
  setTipo,
  busca,
  setBusca,
}: {
  mes: string
  aoMudarMes: (m: string) => void
  conta: ContaFin | undefined
  aoMudarConta: (id: string | null) => void
  contas: ContaFin[]
  categorias: CategoriaFin[]
  lancamentos: Lancamento[]
  tipo: FiltroTipo
  setTipo: (t: FiltroTipo) => void
  busca: string
  setBusca: (b: string) => void
}) {
  const nomeConta = (id: string | null) => contas.find((c) => c.id === id)?.nome ?? 'Conta apagada'

  /** Efeito do lançamento na tela: na conta filtrada, ou no total (transferência não muda o total). */
  const efeito = (l: Lancamento) =>
    conta ? efeitoNaConta(l, conta.id) : l.tipo === 'entrada' ? l.valor : l.tipo === 'saida' ? -l.valor : 0

  const doMes = useMemo(
    () =>
      lancamentos.filter(
        (l) => l.data.startsWith(mes) && (!conta || l.conta_id === conta.id || l.conta_destino_id === conta.id),
      ),
    [lancamentos, mes, conta],
  )

  const filtrados = useMemo(() => {
    const termo = simplificar(busca)
    return doMes
      .filter((l) => tipo === 'todos' || l.tipo === tipo)
      .filter(
        (l) =>
          !termo ||
          [l.descricao, l.pessoa, l.observacao, l.forma_pagamento, nomeCategoria(categorias, l.categoria_id, '')].some((t) =>
            simplificar(t).includes(termo),
          ),
      )
      .sort((a, b) => (a.data === b.data ? b.criado_em.localeCompare(a.criado_em) : b.data.localeCompare(a.data)))
  }, [doMes, tipo, busca, categorias])

  const dias = useMemo(() => {
    const m = new Map<string, Lancamento[]>()
    for (const l of filtrados) m.set(l.data, [...(m.get(l.data) ?? []), l])
    return [...m]
  }, [filtrados])

  // Cabeçalho: saldo no fim do mês e o que entrou/saiu no mês.
  const fim = fimDoMes(mes)
  const saldoFim = conta
    ? saldoConta(conta, lancamentos, fim)
    : Math.round(contas.filter((c) => c.ativo).reduce((s, c) => s + saldoConta(c, lancamentos, fim), 0) * 100) / 100
  let entrou = 0
  let saiu = 0
  for (const l of doMes) {
    const e = efeito(l)
    if (e > 0) entrou += e
    else saiu -= e
  }

  const filtrando = tipo !== 'todos' || !!busca.trim()

  return (
    <div className="flex flex-col gap-4">
      {/* Navegação de mês */}
      <div className="flex items-center justify-between gap-2 rounded-2xl border border-borda bg-superficie p-1">
        <button
          type="button"
          aria-label="Mês anterior"
          onClick={() => aoMudarMes(somarMes(mes, -1))}
          className="flex size-12 items-center justify-center rounded-xl text-marca active:bg-marca-clara"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </button>
        <p className="text-lg font-bold first-letter:uppercase" aria-live="polite">
          {nomeMes(mes)}
        </p>
        <button
          type="button"
          aria-label="Próximo mês"
          onClick={() => aoMudarMes(somarMes(mes, 1))}
          className="flex size-12 items-center justify-center rounded-xl text-marca active:bg-marca-clara"
        >
          <ChevronRight className="size-6" aria-hidden />
        </button>
      </div>

      <Cartao className="flex flex-col gap-2">
        <p className="text-suave">
          Saldo {conta ? `de ${conta.nome}` : 'total'} em {dataBr(fim)}
        </p>
        <p className={`text-2xl font-bold ${saldoFim < 0 ? 'text-perigo' : ''}`}>{moeda(saldoFim)}</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[15px]">
          <span>
            Entrou no mês <strong className="text-ok">{moeda(entrou)}</strong>
          </span>
          <span>
            Saiu no mês <strong className="text-perigo">{moeda(saiu)}</strong>
          </span>
        </div>
      </Cartao>

      <SeletorConta rotulo="Conta" contas={contas} valor={conta?.id ?? null} aoMudar={aoMudarConta} vazio="Todas as contas" />

      <div className="-mx-4 overflow-x-auto px-4 pb-1">
        <Pilulas rotulo="Filtrar por tipo" valor={tipo} aoMudar={setTipo} opcoes={OPCOES_TIPO} />
      </div>
      <Busca valor={busca} aoMudar={setBusca} placeholder="Buscar descrição, cliente, categoria…" />

      {lancamentos.length === 0 ? (
        <Vazio
          titulo="Nenhum lançamento ainda"
          texto="Anote cada venda e cada gasto para ver aqui o que entrou e saiu."
          acao={
            <Link
              to="/financeiro/lancar"
              className="flex min-h-12 items-center justify-center rounded-2xl bg-marca px-5 font-semibold text-white shadow-sm active:bg-marca-escura"
            >
              Fazer o primeiro lançamento
            </Link>
          }
        />
      ) : dias.length === 0 ? (
        <Vazio
          titulo={filtrando ? 'Nada encontrado' : 'Nada lançado neste mês'}
          texto={filtrando ? 'Tente outra palavra ou escolha “Todos”.' : 'Use as setas para ver outros meses.'}
          acao={
            filtrando ? (
              <Botao
                variante="secundario"
                onClick={() => {
                  setBusca('')
                  setTipo('todos')
                }}
              >
                Limpar filtros
              </Botao>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-5">
          {dias.map(([dia, lista]) => {
            const totalDia = lista.reduce((s, l) => s + efeito(l), 0)
            return (
              <section key={dia} aria-label={diaPorExtenso(dia, hoje())} className="flex flex-col gap-2">
                <h2 className="flex items-baseline justify-between gap-3 px-1">
                  <span className="font-semibold first-letter:uppercase">{diaPorExtenso(dia, hoje())}</span>
                  <ValorSinal valor={Math.round(totalDia * 100) / 100} className="text-sm font-semibold" />
                </h2>
                <ul className="divide-y divide-borda overflow-hidden rounded-2xl border border-borda bg-superficie">
                  {lista.map((l) => (
                    <li key={l.id}>
                      <Link
                        to={`/financeiro/lancamentos/${l.id}`}
                        className="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-marca-clara"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{l.descricao}</span>
                          <span className="block truncate text-sm text-suave">
                            {l.tipo === 'transferencia'
                              ? `${nomeConta(l.conta_id)} → ${nomeConta(l.conta_destino_id)}`
                              : nomeCategoria(categorias, l.categoria_id) === l.descricao
                                ? nomeConta(l.conta_id)
                                : `${nomeCategoria(categorias, l.categoria_id)} · ${nomeConta(l.conta_id)}`}
                          </span>
                        </span>
                        <ValorSinal
                          valor={l.tipo === 'transferencia' && !conta ? l.valor : efeito(l)}
                          neutro={l.tipo === 'transferencia' && !conta}
                          className="shrink-0 text-right font-bold"
                        />
                        <ChevronRight className="size-5 shrink-0 text-suave" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
