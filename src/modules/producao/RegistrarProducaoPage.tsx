import { AlertTriangle, ChevronRight, Minus, Plus } from 'lucide-react'
import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAviso } from '../../components/Aviso'
import { BarraAcao, Botao, Campo, Carregando, Cartao, Entrada, EntradaNumero, Erro, TituloPagina, classeEntrada } from '../../components/ui'
import { novoId } from '../../lib/db'
import { milesimos, movimentosDaProducao, planoProducao, subReceitasDaProducao } from '../../lib/estoque'
import { lerNumero, moeda, numero, paraCampo } from '../../lib/format'
import { calcularCusto, plural, rendimentoBase, textoRendimento, unidadeVenda, type Contexto, type ReceitaCalculo } from '../../lib/receitas'
import { lerMeuNome } from '../compras/api'
import { hoje } from '../financeiro/api'
import { Voltar } from '../financeiro/componentes/Comum'
import { mensagemDe } from '../financeiro/util'
import { useRegistrarProducao, useSaldos, type DadosMovimento, type DadosProducao } from '../estoque/api'
import { useContextoCalculo, type Receita } from '../receitas/api'
import { SeletorReceita } from './componentes/SeletorReceita'
import { descreverItem, textoPreparado } from './componentes/formato'

// Registrar uma produção: entra no estoque o que rendeu e saem os insumos (e os preparados
// que já estavam prontos). Pode ficar negativo: avisa, mas deixa registrar.

type Escolha = 'estoque' | 'fazer'

const ROTULO_UNIDADE = { un: '', g: 'g', kg: 'kg', ml: 'ml', l: 'L' } as const

export default function RegistrarProducaoPage() {
  const [params] = useSearchParams()
  const calc = useContextoCalculo()
  const saldos = useSaldos()

  if (calc.carregando || saldos.isPending) return <Carregando />
  if (calc.erro || saldos.isError)
    return (
      <Erro
        mensagem={mensagemDe(calc.erro ?? saldos.error)}
        tentarDeNovo={() => {
          calc.tentarDeNovo()
          void saldos.refetch()
        }}
      />
    )
  if (!calc.contexto || !saldos.data) return <Carregando />

  const pedida = params.get('receita')
  const inicial = pedida && calc.receitasAtivas.some((r) => r.id === pedida) ? pedida : null

  return (
    <Formulario
      contexto={calc.contexto}
      receitas={calc.receitasAtivas}
      saldosInsumos={saldos.data.insumos}
      saldosReceitas={saldos.data.receitas}
      receitaInicial={inicial}
    />
  )
}

interface Erros {
  receita?: string
  data?: string
  lotes?: string
  rendeu?: string
}

function Formulario({
  contexto,
  receitas,
  saldosInsumos,
  saldosReceitas,
  receitaInicial,
}: {
  contexto: Contexto
  receitas: Receita[]
  saldosInsumos: Record<string, number>
  saldosReceitas: Record<string, number>
  receitaInicial: string | null
}) {
  const navegar = useNavigate()
  const avisar = useAviso()
  const registrar = useRegistrarProducao()
  const idReceita = useId()
  const idLotes = useId()

  // Ids gerados uma vez por tela: tentar de novo depois de uma falha regrava as mesmas linhas.
  const [idProducao] = useState(novoId)
  const [idsMovimento] = useState(() => new Map<string, string>())

  const [receitaId, setReceitaId] = useState<string | null>(receitaInicial)
  const [escolhendo, setEscolhendo] = useState(false)
  const [data, setData] = useState(hoje)
  const [lotes, setLotes] = useState('1')
  /** null = acompanha o previsto (receitas × rendimento) */
  const [rendeu, setRendeu] = useState<string | null>(null)
  const [escolhas, setEscolhas] = useState<Record<string, Escolha>>({})
  const [observacao, setObservacao] = useState('')
  const [tentou, setTentou] = useState(false)

  const receita: ReceitaCalculo | undefined = receitaId ? contexto.receitas.get(receitaId) : undefined
  const lotesNum = lerNumero(lotes)
  const lotesCalc = Number.isFinite(lotesNum) && lotesNum > 0 ? lotesNum : 0
  const previsto = receita ? milesimos(lotesCalc * receita.rendimento_qtd) : 0
  const rendeuNum = rendeu === null ? previsto : lerNumero(rendeu)
  const rendeuBase = receita && Number.isFinite(rendeuNum) ? milesimos(rendimentoBase({ rendimento_qtd: rendeuNum, rendimento_unidade: receita.rendimento_unidade })) : 0

  // Sub-receitas que saem prontas do estoque: a escolha da pessoa ou, sem escolha, "usar do
  // estoque" quando tem o bastante. Repete porque escolher uma muda quais aparecem dentro dela.
  const usarDoEstoque = useMemo(() => {
    if (!receitaId || !(lotesCalc > 0)) return new Set<string>()
    const fixos = Object.keys(escolhas).filter((k) => escolhas[k] === 'estoque')
    let atual = new Set(fixos)
    for (let i = 0; i < 10; i++) {
      const novo = new Set(fixos)
      for (const s of subReceitasDaProducao(receitaId, lotesCalc, contexto.receitas, atual))
        if (!escolhas[s.id] && (saldosReceitas[s.id] ?? 0) >= s.quantidade) novo.add(s.id)
      const igual = novo.size === atual.size && [...novo].every((x) => atual.has(x))
      atual = novo
      if (igual) break
    }
    return atual
  }, [receitaId, lotesCalc, contexto.receitas, escolhas, saldosReceitas])

  const subs = useMemo(
    () => (receitaId ? subReceitasDaProducao(receitaId, lotesCalc, contexto.receitas, usarDoEstoque) : []),
    [receitaId, lotesCalc, contexto.receitas, usarDoEstoque],
  )
  const plano = useMemo(
    () => (receitaId ? planoProducao(receitaId, lotesCalc, contexto.receitas, usarDoEstoque) : { entrada: 0, insumos: {}, receitas: {} }),
    [receitaId, lotesCalc, contexto.receitas, usarDoEstoque],
  )
  const custo = useMemo(() => (receitaId ? calcularCusto(receitaId, contexto) : null), [receitaId, contexto])
  const custoTotal = custo ? custo.custoDireto * lotesCalc : 0

  const saidas = useMemo(() => {
    const linhas = [
      ...Object.entries(plano.receitas).map(([id, q]) => ({ tipo: 'receita' as const, id, q, saldo: saldosReceitas[id] ?? 0 })),
      ...Object.entries(plano.insumos).map(([id, q]) => ({ tipo: 'insumo' as const, id, q, saldo: saldosInsumos[id] ?? 0 })),
    ]
    return linhas
      .filter((l) => l.q > 0)
      .map((l) => ({ ...l, ...descreverItem(l.tipo, l.id, contexto) }))
      .sort((a, b) => (a.tipo === b.tipo ? a.nome.localeCompare(b.nome, 'pt-BR') : a.tipo === 'receita' ? -1 : 1))
  }, [plano, saldosInsumos, saldosReceitas, contexto])
  const negativos = saidas.filter((s) => milesimos(s.saldo - s.q) < 0).length

  const erros: Erros = {}
  if (!receita) erros.receita = 'Escolha o que você produziu'
  if (!data) erros.data = 'Escolha a data'
  if (!(lotesCalc > 0)) erros.lotes = lotes.trim() ? 'Número inválido. Ex.: 1 ou 0,5' : 'Diga quantas receitas fez'
  if (receita && !(rendeuBase > 0))
    erros.rendeu = rendeu?.trim() || previsto > 0 ? 'Diga quanto rendeu (maior que zero). Ex.: 20' : 'Esta receita está sem rendimento: diga quanto rendeu'
  const temErro = Object.keys(erros).length > 0
  const mostrar: Erros = tentou ? erros : {}

  function trocarReceita(r: Receita) {
    setReceitaId(r.id)
    setEscolhas({})
    setRendeu(null)
    setEscolhendo(false)
  }

  function passo(delta: 1 | -1) {
    const n = Number.isFinite(lotesNum) && lotesNum > 0 ? lotesNum : delta > 0 ? 0 : 1
    const prox = delta > 0 ? n + 1 : n > 1 ? n - 1 : 0.5
    setLotes(paraCampo(milesimos(prox)))
  }

  function idDe(chave: string) {
    let id = idsMovimento.get(chave)
    if (!id) {
      id = novoId()
      idsMovimento.set(chave, id)
    }
    return id
  }

  async function aoRegistrar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (temErro || !receitaId) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    const feitoPor = lerMeuNome().trim() || null
    const producao: DadosProducao = {
      id: idProducao,
      data,
      receita_id: receitaId,
      lotes: lotesCalc,
      rendimento: rendeuBase,
      custo_total: Number.isFinite(custoTotal) ? custoTotal : null,
      observacao: observacao.trim() || null,
      feito_por: feitoPor,
    }
    const movimentos: DadosMovimento[] = movimentosDaProducao(receitaId, rendeuBase, plano).map((l) => ({
      id: idDe(l.quantidade > 0 ? 'entrada' : `${l.item_tipo}:${l.insumo_id ?? l.receita_id}`),
      data,
      item_tipo: l.item_tipo,
      insumo_id: l.insumo_id,
      receita_id: l.receita_id,
      quantidade: l.quantidade,
      origem: 'producao',
      producao_id: idProducao,
      compra_id: null,
      observacao: null,
      feito_por: feitoPor,
    }))
    try {
      await registrar.mutateAsync({ producao, movimentos })
      avisar({ texto: 'Produção registrada ✓' })
      navegar('/producao', { replace: true })
    } catch {
      // O erro aparece na tela pelo estado da mutação.
    }
  }

  const sufixoRendeu = receita
    ? receita.rendimento_unidade === 'un'
      ? plural(receita.rendimento_nome || 'unidade', Number.isFinite(rendeuNum) ? rendeuNum : 0)
      : ROTULO_UNIDADE[receita.rendimento_unidade]
    : undefined
  const diferenca = receita && rendeu !== null && Number.isFinite(rendeuNum) ? milesimos(rendeuBase - plano.entrada) : 0
  const venda = receita ? unidadeVenda(receita) : null
  const qtdVenda = venda ? rendeuBase / venda.fator : 0
  const saldoAtual = receitaId ? (saldosReceitas[receitaId] ?? 0) : 0

  return (
    <form onSubmit={aoRegistrar} noValidate>
      <Voltar padrao="/producao" />
      <TituloPagina titulo="Registrar produção" subtitulo="O que foi feito entra no estoque e os insumos saem sozinhos" />

      <div className="flex flex-col gap-8">
        {/* 1. O que e quanto */}
        <section className="flex flex-col gap-4">
          <Campo rotulo="O que você produziu?" id={idReceita} erro={mostrar.receita}>
            <button
              id={idReceita}
              type="button"
              onClick={() => setEscolhendo(true)}
              aria-invalid={mostrar.receita ? true : undefined}
              className={`${classeEntrada} flex min-h-14 items-center gap-3 text-left ${mostrar.receita ? 'border-perigo' : ''}`}
            >
              <span className="min-w-0 flex-1">
                {receita ? (
                  <>
                    <span className="block truncate font-semibold">{receita.nome}</span>
                    <span className="block truncate text-sm text-suave">
                      {rendimentoBase(receita) > 0 ? `1 receita rende ${textoRendimento(receita)}` : 'sem rendimento informado'}
                    </span>
                  </>
                ) : (
                  <span className="text-suave">Escolher receita</span>
                )}
              </span>
              <ChevronRight className="size-5 shrink-0 text-suave" aria-hidden />
            </button>
          </Campo>

          <Campo
            rotulo="Quantas receitas?"
            id={idLotes}
            erro={mostrar.lotes}
            ajuda={receita && lotesCalc > 0 && plano.entrada > 0 ? `= ${textoPreparado(plano.entrada, receita)}` : 'Pode ser meia receita: 0,5'}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => passo(-1)}
                disabled={lotesCalc > 0 && lotesCalc <= 0.5}
                aria-label="Uma receita a menos"
                className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-borda bg-superficie text-marca active:bg-marca-clara disabled:opacity-40"
              >
                <Minus className="size-6" aria-hidden />
              </button>
              <input
                id={idLotes}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={lotes}
                onChange={(e) => setLotes(e.target.value)}
                aria-invalid={mostrar.lotes ? true : undefined}
                className={`${classeEntrada} text-center text-lg font-bold ${mostrar.lotes ? 'border-perigo' : ''}`}
              />
              <button
                type="button"
                onClick={() => passo(1)}
                aria-label="Uma receita a mais"
                className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-borda bg-superficie text-marca active:bg-marca-clara"
              >
                <Plus className="size-6" aria-hidden />
              </button>
            </div>
          </Campo>

          {receita && (
            <div className="flex flex-col gap-1.5">
              <EntradaNumero
                rotulo="Rendeu"
                value={rendeu ?? paraCampo(previsto || null)}
                onChange={(e) => setRendeu(e.target.value)}
                sufixo={sufixoRendeu}
                erro={mostrar.rendeu}
                ajuda={
                  diferenca === 0
                    ? 'Mude se rendeu menos ou mais que o previsto'
                    : `${textoPreparado(Math.abs(diferenca), receita)} ${diferenca < 0 ? 'a menos' : 'a mais'} que o previsto (${textoPreparado(plano.entrada, receita)})`
                }
              />
              {rendeu !== null && diferenca !== 0 && plano.entrada > 0 && (
                <button type="button" onClick={() => setRendeu(null)} className="min-h-11 self-start text-sm font-semibold text-marca underline">
                  Voltar para o previsto ({textoPreparado(plano.entrada, receita)})
                </button>
              )}
            </div>
          )}

          <Entrada rotulo="Data" type="date" value={data} onChange={(e) => setData(e.target.value)} erro={mostrar.data} />
        </section>

        {/* 2. Sub-receitas: fazer agora ou usar o que está pronto */}
        {receita && subs.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold">Partes da receita</h2>
            <p className="text-suave">Esta receita leva outras receitas. Diga se elas já estavam prontas ou se foram feitas agora.</p>
            <ul className="flex flex-col gap-3">
              {subs.map((s) => {
                const sub = contexto.receitas.get(s.id)
                const saldo = saldosReceitas[s.id] ?? 0
                const escolha: Escolha = escolhas[s.id] ?? (usarDoEstoque.has(s.id) ? 'estoque' : 'fazer')
                return (
                  <li key={s.id} style={{ marginLeft: `${(s.nivel - 1) * 1}rem` }}>
                    <Cartao className="flex flex-col gap-3">
                      <div>
                        <p className="font-semibold">{sub?.nome ?? 'Receita apagada'}</p>
                        <p className="text-sm text-suave">
                          Precisa de {textoPreparado(s.quantidade, sub)} · tem {textoPreparado(saldo, sub)} pronto
                        </p>
                      </div>
                      <OpcoesSub
                        nome={sub?.nome ?? 'receita'}
                        valor={escolha}
                        aoMudar={(v) => setEscolhas((atual) => ({ ...atual, [s.id]: v }))}
                      />
                      {escolha === 'estoque' && saldo < s.quantidade && (
                        <Alerta>O estoque pronto não dá: vai ficar negativo. Se fez agora, escolha “Fazer agora”.</Alerta>
                      )}
                    </Cartao>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {/* 3. Prévia do estoque */}
        {receita && lotesCalc > 0 && (
          <section className="flex flex-col gap-3" aria-live="polite">
            <h2 className="text-lg font-bold">Vai entrar no estoque</h2>
            <Cartao className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{receita.nome}</p>
                <p className="text-sm text-suave">
                  tem {textoPreparado(saldoAtual, receita)} → vai ficar {textoPreparado(milesimos(saldoAtual + rendeuBase), receita)}
                </p>
              </div>
              <span className="shrink-0 font-bold text-ok">+ {textoPreparado(rendeuBase, receita)}</span>
            </Cartao>

            <h2 className="mt-2 text-lg font-bold">Vai sair do estoque</h2>
            {negativos > 0 && (
              <Alerta>
                {negativos === 1 ? '1 item vai ficar negativo' : `${negativos} itens vão ficar negativos`}. Dá para registrar mesmo
                assim e acertar depois.
              </Alerta>
            )}
            {saidas.length === 0 ? (
              <p className="text-suave">Nada sai do estoque: a receita não tem ingredientes cadastrados.</p>
            ) : (
              <ul className="divide-y divide-borda overflow-hidden rounded-2xl border border-borda bg-superficie">
                {saidas.map((s) => {
                  const depois = milesimos(s.saldo - s.q)
                  return (
                    <li key={`${s.tipo}:${s.id}`} className="flex items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">
                          {s.nome}
                          {s.tipo === 'receita' && <span className="ml-1 text-sm font-normal text-suave">(pronto)</span>}
                        </p>
                        <p className="text-sm text-suave">
                          tem {s.saldo < 0 ? `−${s.texto(-s.saldo)}` : s.texto(s.saldo)} → vai ficar {depois < 0 ? `−${s.texto(-depois)}` : s.texto(depois)}
                        </p>
                        {depois < 0 && (
                          <p className="mt-0.5 flex items-center gap-1 text-sm font-semibold text-perigo">
                            <AlertTriangle className="size-4 shrink-0" aria-hidden />
                            {s.tipo === 'insumo' ? 'vai ficar negativo — faltou registrar uma compra?' : 'vai ficar negativo — faltou registrar a produção dele?'}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 font-bold text-perigo">− {s.texto(s.q)}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}

        {/* 4. Custo */}
        {receita && custo && lotesCalc > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold">Custo da produção</h2>
            <Cartao className="flex flex-col gap-1">
              <p className="flex items-baseline justify-between gap-3">
                <span>Custo total</span>
                <span className="text-xl font-bold">{moeda(custoTotal)}</span>
              </p>
              {venda && qtdVenda > 0 && (
                <p className="flex items-baseline justify-between gap-3 text-suave">
                  <span>Por {venda.rotulo}</span>
                  <span className="font-semibold text-tinta">{moeda(custoTotal / qtdVenda)}</span>
                </p>
              )}
              <p className="text-sm text-suave">Ingredientes e mão de obra de {numero(lotesCalc, 3)} {plural('receita', lotesCalc)}.</p>
            </Cartao>
            {custo.problemas.length > 0 && (
              <Alerta>
                O custo pode estar errado: {custo.problemas[0]}
                {custo.problemas.length > 1 ? ` (e mais ${custo.problemas.length - 1})` : ''}. Dá para registrar mesmo assim.
              </Alerta>
            )}
          </section>
        )}

        <Entrada rotulo="Observação (opcional)" value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex.: forno novo, assou mais rápido" />

        {registrar.isError && <Erro mensagem={mensagemDe(registrar.error)} />}
      </div>

      <BarraAcao>
        <Botao type="submit" className="flex-1" disabled={registrar.isPending}>
          {registrar.isPending ? 'Registrando…' : 'Registrar produção'}
        </Botao>
      </BarraAcao>

      {escolhendo && (
        <SeletorReceita receitas={receitas} saldos={saldosReceitas} aoEscolher={trocarReceita} aoFechar={() => setEscolhendo(false)} />
      )}
    </form>
  )
}

/** As duas opções de uma sub-receita, lado a lado. */
function OpcoesSub({ nome, valor, aoMudar }: { nome: string; valor: Escolha; aoMudar: (v: Escolha) => void }) {
  const opcoes: { valor: Escolha; titulo: string; texto: string }[] = [
    { valor: 'estoque', titulo: 'Usar do estoque', texto: 'já está pronto' },
    { valor: 'fazer', titulo: 'Fazer agora', texto: 'sai dos insumos' },
  ]
  return (
    <div role="radiogroup" aria-label={`${nome}: de onde vem`} className="grid grid-cols-2 gap-2">
      {opcoes.map((o) => {
        const ativo = o.valor === valor
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => aoMudar(o.valor)}
            className={`flex min-h-14 flex-col items-start justify-center rounded-xl border px-3 py-2 text-left transition-colors ${
              ativo ? 'border-marca bg-marca text-white' : 'border-borda bg-superficie text-tinta active:bg-marca-clara'
            }`}
          >
            <span className="font-semibold">{o.titulo}</span>
            <span className={`text-sm ${ativo ? 'text-white/85' : 'text-suave'}`}>{o.texto}</span>
          </button>
        )
      })}
    </div>
  )
}

function Alerta({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-2xl bg-perigo-claro/60 px-4 py-3 text-[15px]">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-perigo" aria-hidden />
      <span>{children}</span>
    </p>
  )
}
