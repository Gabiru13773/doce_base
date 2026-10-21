import { ArrowLeft, Landmark } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { BarraAcao, Botao, Busca, Carregando, Erro, Pilulas, TituloPagina, Vazio } from '../../../components/ui'
import { baixasPorTitulo, situacaoTitulo, somarDias, type SituacaoTitulo } from '../../../lib/financeiro'
import { moeda } from '../../../lib/format'
import { hoje, useCategoriasFin, useContasFin, useLancamentos, useTitulos, type TipoTitulo, type Titulo } from '../api'
import { nomeCategoria } from '../componentes/Seletores'
import { DarBaixa } from './DarBaixa'
import { dataBr, PALAVRAS, seloSituacao, simplificar, textoVencimento } from './util'

type Filtro = 'atrasadas' | 'hoje' | 'semana' | 'mes' | 'abertas' | 'pagas'

const FILTROS: { valor: Filtro; rotulo: string }[] = [
  { valor: 'atrasadas', rotulo: 'Atrasadas' },
  { valor: 'hoje', rotulo: 'Hoje' },
  { valor: 'semana', rotulo: 'Próximos 7 dias' },
  { valor: 'mes', rotulo: 'Este mês' },
  { valor: 'abertas', rotulo: 'Todas abertas' },
  { valor: 'pagas', rotulo: 'Pagas' },
]

const VAZIO_FILTRO: Record<Filtro, string> = {
  atrasadas: 'Nenhuma conta atrasada. Tudo em dia!',
  hoje: 'Nada vence hoje.',
  semana: 'Nada vence nos próximos 7 dias.',
  mes: 'Nada em aberto vence neste mês.',
  abertas: 'Nenhuma conta em aberto.',
  pagas: 'Nenhuma conta marcada como paga ainda.',
}

interface Linha {
  titulo: Titulo
  sit: SituacaoTitulo
}

function lerTipo(v: string | null): TipoTitulo {
  return v === 'receber' ? 'receber' : 'pagar'
}

function lerFiltro(v: string | null): Filtro {
  return FILTROS.some((f) => f.valor === v) ? (v as Filtro) : 'abertas'
}

export default function TitulosPage() {
  const navegar = useNavigate()
  const [params, setParams] = useSearchParams()
  const tipo = lerTipo(params.get('tipo'))
  const filtro = lerFiltro(params.get('ver'))
  const [busca, setBusca] = useState('')
  const [baixa, setBaixa] = useState<Titulo | null>(null)

  const titulos = useTitulos()
  const lancamentos = useLancamentos()
  const { data: categorias } = useCategoriasFin()
  const { data: contas, isSuccess: contasProntas } = useContasFin()
  const palavras = PALAVRAS[tipo]
  const dia = hoje()

  function mudar(novo: { tipo?: TipoTitulo; ver?: Filtro }) {
    const p = new URLSearchParams(params)
    if (novo.tipo) p.set('tipo', novo.tipo)
    if (novo.ver) p.set('ver', novo.ver)
    setParams(p, { replace: true })
  }

  // Todas as contas do tipo escolhido, com a situação de cada uma.
  const linhas = useMemo<Linha[]>(() => {
    const baixas = baixasPorTitulo(lancamentos.data ?? [], titulos.data ?? [])
    return (titulos.data ?? [])
      .filter((t) => t.tipo === tipo)
      .map((t) => ({ titulo: t, sit: situacaoTitulo(t, baixas, dia) }))
  }, [titulos.data, lancamentos.data, tipo, dia])

  const resumo = useMemo(() => {
    let aberto = 0
    let atrasado = 0
    let qtdAtrasadas = 0
    let semana = 0
    const fimSemana = somarDias(dia, 7)
    for (const { titulo, sit } of linhas) {
      if (sit.situacao === 'pago') continue
      aberto += sit.falta
      if (sit.situacao === 'atrasado') {
        atrasado += sit.falta
        qtdAtrasadas++
      } else if (titulo.vencimento <= fimSemana) semana += sit.falta
    }
    return { aberto, atrasado, qtdAtrasadas, semana }
  }, [linhas, dia])

  const visiveis = useMemo(() => {
    const termo = simplificar(busca)
    const fimSemana = somarDias(dia, 7)
    const mes = dia.slice(0, 7)
    const lista = linhas.filter(({ titulo: t, sit }) => {
      const pago = sit.situacao === 'pago'
      if (filtro === 'pagas' ? !pago : pago) return false
      if (filtro === 'atrasadas' && sit.situacao !== 'atrasado') return false
      if (filtro === 'hoje' && t.vencimento !== dia) return false
      if (filtro === 'semana' && (t.vencimento < dia || t.vencimento > fimSemana)) return false
      if (filtro === 'mes' && t.vencimento.slice(0, 7) !== mes) return false
      if (!termo) return true
      return [t.descricao, t.pessoa].some((c) => simplificar(c).includes(termo))
    })
    // Abertas: o que vence primeiro no topo. Pagas: as mais recentes no topo.
    return lista.sort((a, b) =>
      filtro === 'pagas'
        ? b.titulo.vencimento.localeCompare(a.titulo.vencimento)
        : a.titulo.vencimento.localeCompare(b.titulo.vencimento),
    )
  }, [linhas, filtro, busca, dia])

  const totalVisivel = visiveis.reduce((s, l) => s + (filtro === 'pagas' ? l.sit.pago : l.sit.falta), 0)
  const carregando = titulos.isLoading || lancamentos.isLoading
  const erro = titulos.error ?? lancamentos.error
  const semCadastro = !carregando && !erro && linhas.length === 0
  const semContas = contasProntas && !(contas ?? []).some((c) => c.ativo)
  const novaUrl = `/financeiro/contas/nova?tipo=${tipo}`

  return (
    <>
      <Link
        to="/financeiro"
        className="-ml-2 mb-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-suave active:bg-marca-clara"
      >
        <ArrowLeft className="size-5" aria-hidden />
        Financeiro
      </Link>
      <TituloPagina titulo="Contas a pagar e receber" subtitulo="O que vence e quem ainda vai te pagar" />

      <div role="tablist" aria-label="Tipo de conta" className="mb-4 grid grid-cols-2 gap-1 rounded-2xl border border-borda bg-superficie p-1">
        {(['pagar', 'receber'] as const).map((t) => {
          const ativo = t === tipo
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={ativo}
              onClick={() => mudar({ tipo: t })}
              className={`min-h-11 rounded-xl text-base font-semibold transition-colors ${
                ativo ? 'bg-marca text-white shadow-sm' : 'text-tinta active:bg-marca-clara'
              }`}
            >
              {t === 'pagar' ? 'A pagar' : 'A receber'}
            </button>
          )
        })}
      </div>

      {carregando ? (
        <Carregando />
      ) : erro ? (
        <Erro
          mensagem={erro instanceof Error ? erro.message : 'erro ao carregar'}
          tentarDeNovo={() => {
            titulos.refetch()
            lancamentos.refetch()
          }}
        />
      ) : semCadastro ? (
        <Vazio
          titulo={tipo === 'pagar' ? 'Nenhuma conta a pagar' : 'Nenhuma conta a receber'}
          texto={
            tipo === 'pagar'
              ? 'Cadastre o aluguel, os fornecedores, a internet, o gás… O app mostra o que está vencendo e o que já atrasou.'
              : 'Cadastre as encomendas a receber, vendas fiadas e o restante do sinal das festas. Assim ninguém fica esquecido.'
          }
          acao={<Botao onClick={() => navegar(novaUrl)}>Cadastrar a primeira</Botao>}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <section aria-label="Resumo" className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-borda bg-superficie p-3">
              <p className="text-sm text-suave">{tipo === 'pagar' ? 'Falta pagar' : 'Falta receber'}</p>
              <p className="text-xl font-bold">{moeda(resumo.aberto)}</p>
              {resumo.semana > 0 && <p className="text-sm text-suave">{moeda(resumo.semana)} nos próximos 7 dias</p>}
            </div>
            <button
              type="button"
              onClick={() => mudar({ ver: 'atrasadas' })}
              className={`rounded-2xl border p-3 text-left ${
                resumo.atrasado > 0 ? 'border-perigo/30 bg-perigo-claro active:bg-perigo-claro/60' : 'border-borda bg-superficie'
              }`}
            >
              <p className={`text-sm ${resumo.atrasado > 0 ? 'text-perigo' : 'text-suave'}`}>Atrasado</p>
              <p className={`text-xl font-bold ${resumo.atrasado > 0 ? 'text-perigo' : ''}`}>{moeda(resumo.atrasado)}</p>
              {resumo.qtdAtrasadas > 0 && (
                <p className="text-sm text-perigo">
                  {resumo.qtdAtrasadas} {resumo.qtdAtrasadas === 1 ? 'conta' : 'contas'}
                </p>
              )}
            </button>
          </section>

          {semContas && (
            <div className="flex items-start gap-3 rounded-2xl border border-alerta/20 bg-alerta-claro p-4">
              <Landmark className="mt-0.5 size-5 shrink-0 text-alerta" aria-hidden />
              <div className="flex flex-col gap-2">
                <p>
                  Para marcar uma conta como {tipo === 'pagar' ? 'paga' : 'recebida'}, cadastre antes a conta do banco ou o
                  caixa, onde o dinheiro {tipo === 'pagar' ? 'sai' : 'entra'}.
                </p>
                <Link to="/financeiro/bancos/nova" className="inline-flex min-h-11 items-center font-semibold text-marca underline">
                  Cadastrar conta do banco ou caixa
                </Link>
              </div>
            </div>
          )}

          <Busca valor={busca} aoMudar={setBusca} placeholder={tipo === 'pagar' ? 'Buscar conta ou fornecedor' : 'Buscar conta ou cliente'} />
          <div className="-mx-4 overflow-x-auto px-4 pb-1">
            <Pilulas
              rotulo="Mostrar"
              valor={filtro}
              aoMudar={(v) => mudar({ ver: v })}
              opcoes={FILTROS.map((f) => (f.valor === 'pagas' && tipo === 'receber' ? { ...f, rotulo: 'Recebidas' } : f))}
            />
          </div>

          {visiveis.length === 0 ? (
            <Vazio
              titulo="Nada por aqui"
              texto={
                busca
                  ? 'Nenhuma conta com esse nome. Tente outra palavra.'
                  : tipo === 'receber' && filtro === 'pagas'
                    ? 'Nenhuma conta marcada como recebida ainda.'
                    : VAZIO_FILTRO[filtro]
              }
              acao={
                busca ? (
                  <Botao variante="secundario" onClick={() => setBusca('')}>
                    Limpar busca
                  </Botao>
                ) : filtro !== 'abertas' ? (
                  <Botao variante="secundario" onClick={() => mudar({ ver: 'abertas' })}>
                    Ver todas abertas
                  </Botao>
                ) : undefined
              }
            />
          ) : (
            <>
              <p className="text-sm text-suave" aria-live="polite">
                {visiveis.length} {visiveis.length === 1 ? 'conta' : 'contas'} ·{' '}
                {filtro === 'pagas' ? `${tipo === 'pagar' ? 'pago' : 'recebido'} ${moeda(totalVisivel)}` : `faltam ${moeda(totalVisivel)}`}
              </p>
              <ul aria-label="Lista de contas" className="flex flex-col gap-2">
                {visiveis.map((l) => (
                  <li key={l.titulo.id}>
                    <CartaoTitulo
                      linha={l}
                      dia={dia}
                      categoria={nomeCategoria(categorias ?? [], l.titulo.categoria_id, '')}
                      aoBaixar={() => setBaixa(l.titulo)}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {baixa && <DarBaixa titulo={baixa} aberto aoFechar={() => setBaixa(null)} />}

      <BarraAcao>
        <Botao className="flex-1" onClick={() => navegar(novaUrl)}>
          + {palavras.nova}
        </Botao>
      </BarraAcao>
    </>
  )
}

function CartaoTitulo({
  linha: { titulo: t, sit },
  dia,
  categoria,
  aoBaixar,
}: {
  linha: Linha
  dia: string
  categoria: string
  aoBaixar: () => void
}) {
  const selo = seloSituacao(sit.situacao, t.tipo)
  const pago = sit.situacao === 'pago'
  const detalhe = [t.pessoa, categoria].filter(Boolean).join(' · ')
  const quando = pago
    ? `${t.tipo === 'pagar' ? 'paga' : 'recebida'}${sit.pagoEm ? ` em ${dataBr(sit.pagoEm)}` : ''}`
    : textoVencimento(t.vencimento, dia)

  return (
    <div className="overflow-hidden rounded-2xl border border-borda bg-superficie">
      <Link to={`/financeiro/contas/${t.id}`} className="block px-4 pt-3 pb-2 active:bg-marca-clara">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 font-semibold break-words">
            {t.descricao}
            {t.parcela && <span className="ml-1.5 font-normal text-suave">{t.parcela}</span>}
          </p>
          <p className={`shrink-0 text-right font-bold ${pago ? 'text-ok' : sit.situacao === 'atrasado' ? 'text-perigo' : ''}`}>
            {moeda(t.valor)}
          </p>
        </div>
        {detalhe && <p className="truncate text-sm text-suave">{detalhe}</p>}
      </Link>
      <div className="flex items-center gap-2 px-4 pb-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${selo.classe}`}>{selo.texto}</span>
          {sit.situacao !== 'vence_hoje' && (
            <span className={`text-sm ${sit.situacao === 'atrasado' ? 'font-semibold text-perigo' : 'text-suave'}`}>{quando}</span>
          )}
          {!pago && sit.pago > 0 && <span className="text-sm font-semibold text-tinta">faltam {moeda(sit.falta)}</span>}
        </div>
        {!pago && (
          <Botao variante="secundario" className="shrink-0 px-4" onClick={aoBaixar} aria-label={`${PALAVRAS[t.tipo].acao} ${t.descricao}`}>
            {PALAVRAS[t.tipo].acao}
          </Botao>
        )}
      </div>
    </div>
  )
}
