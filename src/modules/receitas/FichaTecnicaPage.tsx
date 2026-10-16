import { ArrowLeft, CalendarClock, Clock, ExternalLink, Flame, Hourglass, Printer, TriangleAlert, UtensilsCrossed } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Botao, Carregando, Cartao, Erro, Pilulas, Vazio } from '../../components/ui'
import { moeda } from '../../lib/format'
import {
  calcularCusto,
  precificar,
  rendimentoBase,
  textoQuantidade,
  textoRendimento,
  unidadeBaseReceita,
  type Contexto,
  type ItemReceita,
} from '../../lib/receitas'
import { unidadeBase, type UnidadeBase } from '../../lib/unidades'
import { CATEGORIAS_RECEITA, useContextoCalculo, type Receita } from './api'

// Ficha técnica da receita: feita para ler na cozinha (letras grandes) e
// para imprimir em A4 e treinar a equipe. Custos ficam escondidos por padrão.

type Multiplicador = '0.5' | '1' | '2' | '3'

const OPCOES_MULTIPLICADOR: { valor: Multiplicador; rotulo: string }[] = [
  { valor: '0.5', rotulo: '½×' },
  { valor: '1', rotulo: '1×' },
  { valor: '2', rotulo: '2×' },
  { valor: '3', rotulo: '3×' },
]

/** 90 → "1 h 30 min"; 45 → "45 min"; 120 → "2 h". */
function formatarMinutos(min: number): string {
  const total = Math.round(min)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** "Quantidades para ½ receita", "para 1 receita", "para 2 receitas". */
function textoMultiplicador(mult: number): string {
  if (mult === 0.5) return 'Quantidades para ½ receita'
  return `Quantidades para ${mult} ${mult === 1 ? 'receita' : 'receitas'}`
}

/** Linha de ingrediente pronta para mostrar. */
interface LinhaIngrediente {
  chave: string
  nome: string
  quantidade: string
  apagado: boolean
  subReceitaId?: string
}

function montarIngredientes(itens: ItemReceita[], fator: number, ctx: Contexto): LinhaIngrediente[] {
  return itens.map((item, i) => {
    const chave = `${item.tipo}-${item.id}-${i}`
    let unidade: UnidadeBase | null = null
    let nome = ''
    if (item.tipo === 'insumo') {
      const ins = ctx.insumos.get(item.id)
      if (ins) {
        nome = ins.nome
        unidade = unidadeBase(ins.unidadeCompra)
      }
    } else {
      const sub = ctx.receitas.get(item.id)
      if (sub) {
        nome = sub.nome
        unidade = unidadeBaseReceita(sub)
      }
    }
    if (!unidade) return { chave, nome: '(item apagado)', quantidade: '—', apagado: true }
    return {
      chave,
      nome,
      quantidade: textoQuantidade(item.quantidade * fator, unidade),
      apagado: false,
      subReceitaId: item.tipo === 'receita' ? item.id : undefined,
    }
  })
}

/**
 * Sub-receitas usadas (inclusive as de dentro das sub-receitas), com o fator
 * de escala: quantas "receitas inteiras" de cada uma serão feitas.
 * Ciclos são ignorados com segurança.
 */
function coletarSubReceitas(receita: Receita, mult: number, ctx: Contexto): { receita: Receita; fator: number }[] {
  const fatores = new Map<string, number>()
  const ordem: string[] = []
  const visitando = new Set<string>([receita.id])
  function descer(r: Receita, fatorPai: number) {
    for (const item of r.itens) {
      if (item.tipo !== 'receita') continue
      const sub = ctx.receitas.get(item.id) as Receita | undefined
      if (!sub || visitando.has(sub.id)) continue
      const base = rendimentoBase(sub)
      if (base <= 0) continue
      const fator = fatorPai * (item.quantidade / base)
      if (!fatores.has(sub.id)) ordem.push(sub.id)
      fatores.set(sub.id, (fatores.get(sub.id) ?? 0) + fator)
      visitando.add(sub.id)
      descer(sub, fator)
      visitando.delete(sub.id)
    }
  }
  descer(receita, mult)
  return ordem.map((id) => ({ receita: ctx.receitas.get(id) as Receita, fator: fatores.get(id) ?? 0 }))
}

export default function FichaTecnicaPage() {
  const { id = '' } = useParams()
  const { contexto, config, carregando, erro, tentarDeNovo } = useContextoCalculo()
  const [multTexto, setMultTexto] = useState<Multiplicador>('1')
  const [mostrarCustos, setMostrarCustos] = useState(false)
  const mult = Number(multTexto)

  // O contexto guarda as receitas completas (com passos, tempos etc.).
  const receita = (contexto?.receitas.get(id) as Receita | undefined) ?? null

  const ingredientes = useMemo(
    () => (receita && contexto ? montarIngredientes(receita.itens, mult, contexto) : []),
    [receita, contexto, mult],
  )
  const subReceitas = useMemo(
    () => (receita && contexto ? coletarSubReceitas(receita, mult, contexto) : []),
    [receita, contexto, mult],
  )
  const custos = useMemo(() => {
    if (!receita || !contexto || !config) return null
    const custo = calcularCusto(receita.id, contexto)
    return { custo, preco: precificar(receita, custo.custoDireto, config) }
  }, [receita, contexto, config])

  if (carregando) return <Carregando />
  if (erro) return <Erro mensagem={erro.message} tentarDeNovo={tentarDeNovo} />
  if (!receita || !contexto) {
    return (
      <Vazio
        titulo="Receita não encontrada"
        texto="Ela pode ter sido apagada ou o endereço está errado."
        acao={
          <Link to="/receitas" className="inline-flex min-h-12 items-center rounded-2xl bg-marca px-5 font-semibold text-white active:bg-marca-escura">
            Ver receitas
          </Link>
        }
      />
    )
  }

  const categoria = CATEGORIAS_RECEITA.find((c) => c.valor === receita.categoria)?.rotulo ?? 'Outro'
  const rendimento = textoRendimento({ ...receita, rendimento_qtd: receita.rendimento_qtd * mult })
  const hoje = new Date().toLocaleDateString('pt-BR')
  const qtdReceitas = mult === 0.5 ? '½ receita' : `${mult} receitas`

  const tempos: { rotulo: string; valor: string; icone: ReactNode }[] = []
  if (receita.tempo_preparo_min > 0) {
    tempos.push({ rotulo: 'Preparo', valor: formatarMinutos(receita.tempo_preparo_min), icone: <Clock className="size-5" aria-hidden /> })
  }
  const temForno = (receita.tempo_forno_min ?? 0) > 0
  const temTemperatura = (receita.temperatura_forno ?? 0) > 0
  if (temForno || temTemperatura) {
    const partes = [temForno ? formatarMinutos(receita.tempo_forno_min!) : null, temTemperatura ? `${receita.temperatura_forno} °C` : null]
    tempos.push({ rotulo: 'Forno', valor: partes.filter(Boolean).join(' · '), icone: <Flame className="size-5" aria-hidden /> })
  }
  if ((receita.tempo_descanso_min ?? 0) > 0) {
    tempos.push({ rotulo: 'Descanso', valor: formatarMinutos(receita.tempo_descanso_min!), icone: <Hourglass className="size-5" aria-hidden /> })
  }

  return (
    <div className="flex flex-col gap-5 print:gap-4 print:bg-white print:text-[11pt] print:leading-snug">
      {/* Margens do papel A4 */}
      <style>{'@page { size: A4; margin: 14mm 12mm; }'}</style>

      {/* Topo (só na tela) */}
      <div className="no-print flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            to={`/receitas/${receita.id}`}
            className="inline-flex min-h-12 items-center gap-2 rounded-2xl px-3 font-semibold text-marca active:bg-marca-clara"
          >
            <ArrowLeft className="size-5" aria-hidden />
            Voltar
          </Link>
          <Botao onClick={() => window.print()}>
            <Printer className="size-5" aria-hidden />
            Imprimir / PDF
          </Botao>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={mostrarCustos}
          onClick={() => setMostrarCustos((v) => !v)}
          className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-borda bg-superficie px-4 text-left font-semibold active:bg-marca-clara"
        >
          Mostrar custos e preço
          <span className={`relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors ${mostrarCustos ? 'bg-marca' : 'bg-borda'}`}>
            <span
              className={`absolute top-1 size-5 rounded-full bg-white shadow transition-transform ${mostrarCustos ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </span>
        </button>
      </div>

      {/* Cabeçalho */}
      <header className="flex items-start gap-4 border-b-2 border-marca pb-4 print:pb-3">
        <img
          src="/logo-completa.webp"
          alt="Euforia Confeitaria"
          width="600"
          height="444"
          className="hidden h-20 w-auto shrink-0 print:block"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-wide text-laranja uppercase">Ficha técnica · {categoria}</p>
          <h1 className="text-3xl leading-tight font-bold text-tinta print:text-[22pt]">{receita.nome}</h1>
          <p className="mt-1 text-lg">
            <span className="text-suave">Rende:</span> <strong>{rendimento}</strong>
          </p>
        </div>
      </header>

      {/* Quantas receitas */}
      <section className="flex flex-col gap-2">
        <h2 className="no-print text-lg font-bold">Quantas receitas vai fazer?</h2>
        <div className="no-print">
          <Pilulas rotulo="Quantas receitas vai fazer?" valor={multTexto} aoMudar={setMultTexto} opcoes={OPCOES_MULTIPLICADOR} />
        </div>
        {mult !== 1 && <p className="no-print font-medium text-marca">{textoMultiplicador(mult)} — já está tudo multiplicado.</p>}
        <p className="hidden font-semibold print:block">{textoMultiplicador(mult)}</p>
      </section>

      {/* Tempos */}
      {tempos.length > 0 && (
        <section aria-label="Tempos" className="grid grid-cols-2 gap-3 break-inside-avoid sm:grid-cols-3 print:grid-cols-3">
          {tempos.map((t) => (
            <div key={t.rotulo} className="flex flex-col gap-1 rounded-2xl border border-borda bg-laranja-clara p-3 print:bg-white">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-laranja">
                {t.icone}
                {t.rotulo}
              </span>
              <span className="text-xl font-bold">{t.valor}</span>
            </div>
          ))}
        </section>
      )}

      {/* Ingredientes */}
      <Secao titulo="Ingredientes">
        {ingredientes.length === 0 ? (
          <p className="text-suave">Nenhum ingrediente cadastrado.</p>
        ) : (
          <ul className="divide-y divide-borda overflow-hidden rounded-2xl border border-borda bg-superficie print:rounded-none print:border-x-0">
            {ingredientes.map((l) => (
              <LinhaIngredienteItem key={l.chave} linha={l} comLink />
            ))}
          </ul>
        )}
      </Secao>

      {/* Modo de preparo */}
      <Secao titulo="Modo de preparo">
        <Passos passos={receita.passos} />
      </Secao>

      {/* Utensílios */}
      {receita.utensilios?.trim() && (
        <Secao titulo="Utensílios" icone={<UtensilsCrossed className="size-5 text-marca" aria-hidden />}>
          <p className="text-lg whitespace-pre-line">{receita.utensilios}</p>
        </Secao>
      )}

      {/* Pontos de atenção */}
      {receita.pontos_atencao?.trim() && (
        <section className="flex gap-3 rounded-2xl border border-alerta/30 bg-alerta-claro p-4 break-inside-avoid print:bg-white">
          <TriangleAlert className="mt-0.5 size-6 shrink-0 text-alerta" aria-hidden />
          <div>
            <h2 className="text-lg font-bold text-alerta">Pontos de atenção</h2>
            <p className="text-lg whitespace-pre-line">{receita.pontos_atencao}</p>
          </div>
        </section>
      )}

      {/* Validade */}
      {receita.validade?.trim() && (
        <Secao titulo="Validade e conservação" icone={<CalendarClock className="size-5 text-marca" aria-hidden />}>
          <p className="text-lg whitespace-pre-line">{receita.validade}</p>
        </Secao>
      )}

      {/* Custos e preço */}
      {mostrarCustos && custos && (
        <Cartao className="flex flex-col gap-3 break-inside-avoid print:shadow-none">
          <h2 className="text-xl font-bold">Custos e preço</h2>
          {custos.custo.problemas.length > 0 && (
            <p className="rounded-xl bg-alerta-claro px-3 py-2 text-sm font-medium text-alerta print:bg-white">
              Atenção: {custos.custo.problemas[0]}. Os valores podem estar incompletos.
            </p>
          )}
          <dl className="grid grid-cols-2 gap-3">
            <Valor rotulo={mult === 1 ? 'Custo total' : `Custo total (${qtdReceitas})`} valor={moeda(custos.custo.custoDireto * mult)} />
            <Valor rotulo={`Custo por ${custos.preco.unidade}`} valor={moeda(custos.preco.custoPorUnidade)} />
            <Valor
              rotulo={`Preço por ${custos.preco.unidade}`}
              valor={custos.preco.pvFinal === null ? '—' : moeda(custos.preco.pvFinal)}
              destaque
            />
            <Valor
              rotulo={mult === 1 ? 'Preço da receita inteira' : `Preço de ${qtdReceitas}`}
              valor={custos.preco.pvFinal === null ? '—' : moeda(custos.preco.pvTotal * mult)}
              destaque
            />
          </dl>
          {custos.preco.pvFinal === null && (
            <p className="text-sm text-suave">Sem preço sugerido: os percentuais de custos fixos, taxas e margem somam 100% ou mais.</p>
          )}
        </Cartao>
      )}

      {/* Fichas resumidas das receitas base (só no papel) */}
      {subReceitas.length > 0 && (
        <section className="hidden flex-col gap-4 print:flex">
          <h2 className="border-b-2 border-marca pb-1 text-xl font-bold break-after-avoid">Receitas base usadas</h2>
          {subReceitas.map(({ receita: sub, fator }) => (
            <article key={sub.id} className="flex flex-col gap-2 rounded-2xl border border-borda p-3 break-inside-avoid">
              <h3 className="text-lg font-bold">{sub.nome}</h3>
              <p className="text-suave">
                Fazer: <strong className="text-tinta">{textoRendimento({ ...sub, rendimento_qtd: sub.rendimento_qtd * fator })}</strong>
              </p>
              <ul className="divide-y divide-borda border-y border-borda">
                {montarIngredientes(sub.itens, fator, contexto).map((l) => (
                  <LinhaIngredienteItem key={l.chave} linha={l} />
                ))}
              </ul>
              {sub.passos.length > 0 && <Passos passos={sub.passos} pequeno />}
            </article>
          ))}
        </section>
      )}

      {/* Rodapé (só no papel) */}
      <footer className="hidden border-t border-borda pt-2 text-center text-sm text-suave print:block">
        Euforia Confeitaria · Ficha técnica · impresso em {hoje}
      </footer>
    </div>
  )
}

function Secao({ titulo, icone, children }: { titulo: string; icone?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-xl font-bold break-after-avoid">
        {icone}
        {titulo}
      </h2>
      {children}
    </section>
  )
}

function LinhaIngredienteItem({ linha, comLink = false }: { linha: LinhaIngrediente; comLink?: boolean }) {
  return (
    <li className="flex items-center gap-4 px-4 py-3 break-inside-avoid print:px-1 print:py-1.5">
      <span
        className={`w-28 shrink-0 text-right text-lg font-bold tabular-nums ${linha.apagado ? 'text-suave' : 'text-marca print:text-tinta'}`}
      >
        {linha.quantidade}
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`text-lg ${linha.apagado ? 'text-suave italic' : ''}`}>{linha.nome}</span>
        {linha.subReceitaId && (
          <>
            <span className="rounded-full bg-laranja-clara px-2 py-0.5 text-xs font-semibold text-laranja print:border print:border-laranja print:bg-white">
              receita base
            </span>
            {comLink && (
              <Link
                to={`/receitas/${linha.subReceitaId}/ficha`}
                className="no-print inline-flex min-h-10 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-marca active:bg-marca-clara"
              >
                ver ficha
                <ExternalLink className="size-4" aria-hidden />
              </Link>
            )}
          </>
        )}
      </span>
    </li>
  )
}

function Passos({ passos, pequeno = false }: { passos: string[]; pequeno?: boolean }) {
  if (passos.length === 0) return <p className="text-suave">Nenhum passo cadastrado.</p>
  return (
    <ol className={`flex flex-col ${pequeno ? 'gap-2' : 'gap-4'}`}>
      {passos.map((passo, i) => (
        <li key={i} className="flex items-start gap-3 break-inside-avoid">
          <span
            aria-hidden
            className={`flex shrink-0 items-center justify-center rounded-full bg-marca font-bold text-white print:border-2 print:border-marca print:bg-white print:text-marca ${
              pequeno ? 'size-7 text-sm' : 'size-10 text-lg'
            }`}
          >
            {i + 1}
          </span>
          <p className={`pt-1 whitespace-pre-line ${pequeno ? '' : 'text-lg'}`}>
            <span className="sr-only">Passo {i + 1}: </span>
            {passo}
          </p>
        </li>
      ))}
    </ol>
  )
}

function Valor({ rotulo, valor, destaque = false }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className={`flex flex-col rounded-xl p-3 ${destaque ? 'bg-marca-clara print:bg-white' : 'bg-creme print:bg-white'}`}>
      <dt className="text-sm text-suave">{rotulo}</dt>
      <dd className={`text-xl font-bold ${destaque ? 'text-marca' : ''}`}>{valor}</dd>
    </div>
  )
}
