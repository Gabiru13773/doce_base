import { custoPorUnidadeBase, type CompraInsumo } from './custos'
import {
  arredondarPreco,
  custoMaoDeObra,
  margemReal,
  precoPorMarkupDivisor,
  type ConfigPrecificacao,
} from './precificacao'
import { unidadeBase, type UnidadeBase } from './unidades'

// Cálculos de receitas: custo (com sub-receitas), preço de venda e
// "explosão" dos insumos para a produção. Funções puras, sem acesso a banco.

export type UnidadeRendimento = 'un' | 'g' | 'kg' | 'ml' | 'l'

export interface ItemReceita {
  tipo: 'insumo' | 'receita'
  id: string
  /** Quantidade na unidade base do item: g, ml ou un. */
  quantidade: number
}

/** Campos da receita usados nos cálculos. */
export interface ReceitaCalculo {
  id: string
  nome: string
  rendimento_qtd: number
  rendimento_unidade: UnidadeRendimento
  rendimento_nome: string | null
  itens: ItemReceita[]
  tempo_preparo_min: number
  pct_custos_fixos: number | null
  pct_taxas: number | null
  pct_margem: number | null
  pv_manual: number | null
}

export interface InsumoCalculo extends CompraInsumo {
  id: string
  nome: string
}

export interface Contexto {
  receitas: Map<string, ReceitaCalculo>
  insumos: Map<string, InsumoCalculo>
  valorHora: number
}

// ---- Rendimento e unidades ---------------------------------------------------

const FATOR_RENDIMENTO: Record<UnidadeRendimento, number> = { un: 1, g: 1, kg: 1000, ml: 1, l: 1000 }
const BASE_RENDIMENTO: Record<UnidadeRendimento, UnidadeBase> = { un: 'un', g: 'g', kg: 'g', ml: 'ml', l: 'ml' }

/** Unidade base em que a receita é medida quando usada dentro de outra (g, ml ou un). */
export function unidadeBaseReceita(r: Pick<ReceitaCalculo, 'rendimento_unidade'>): UnidadeBase {
  return BASE_RENDIMENTO[r.rendimento_unidade]
}

/** Rendimento na unidade base (ex.: 1,2 kg → 1200 g; 10 fatias → 10). */
export function rendimentoBase(r: Pick<ReceitaCalculo, 'rendimento_qtd' | 'rendimento_unidade'>): number {
  return r.rendimento_qtd * FATOR_RENDIMENTO[r.rendimento_unidade]
}

/**
 * Unidade de venda usada para mostrar custo e preço:
 * receitas em unidades → por unidade (fatia, brigadeiro…); em peso → por kg; em volume → por litro.
 */
export function unidadeVenda(r: Pick<ReceitaCalculo, 'rendimento_unidade' | 'rendimento_nome'>): {
  rotulo: string
  /** Quantas unidades base cabem numa unidade de venda (1 para un, 1000 para kg/L). */
  fator: number
} {
  if (r.rendimento_unidade === 'un') return { rotulo: (r.rendimento_nome || 'unidade').trim().toLowerCase(), fator: 1 }
  if (r.rendimento_unidade === 'g' || r.rendimento_unidade === 'kg') return { rotulo: 'kg', fator: 1000 }
  return { rotulo: 'litro', fator: 1000 }
}

/** Plural simples em português: fatia → fatias, porção → porções, pastel → pastéis, flor → flores. */
export function plural(palavra: string, qtd: number): string {
  const p = palavra.trim()
  if (Math.abs(qtd) <= 1 || p === '' || /^(kg|g|ml|l|un)$/i.test(p)) return p
  if (/ão$/i.test(p)) return p.replace(/ão$/i, 'ões')
  if (/el$/i.test(p)) return p.replace(/el$/i, 'éis')
  if (/al$/i.test(p)) return p.replace(/al$/i, 'ais')
  if (/[rz]$/i.test(p)) return p + 'es'
  if (/s$/i.test(p)) return p
  return p + 's'
}

/** Texto do rendimento: "10 fatias", "1,2 kg", "500 ml". */
export function textoRendimento(r: Pick<ReceitaCalculo, 'rendimento_qtd' | 'rendimento_unidade' | 'rendimento_nome'>): string {
  const n = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(r.rendimento_qtd)
  if (r.rendimento_unidade === 'un') return `${n} ${plural(r.rendimento_nome || 'unidade', r.rendimento_qtd)}`
  const rot: Record<UnidadeRendimento, string> = { un: '', g: 'g', kg: 'kg', ml: 'ml', l: 'L' }
  return `${n} ${rot[r.rendimento_unidade]}`
}

// ---- Custo ---------------------------------------------------------------------

export interface LinhaCusto {
  item: ItemReceita
  nome: string
  unidade: UnidadeBase
  /** Custo desta linha na receita. */
  custo: number
  /** Item não encontrado (apagado) ou sub-receita com problema. */
  problema?: string
}

export interface ResultadoCusto {
  /** Insumos + sub-receitas. */
  custoIngredientes: number
  /** Tempo de preparo desta receita × valor da hora. */
  custoMaoDeObra: number
  custoDireto: number
  /** Custo por unidade base (g, ml ou un) — usado quando a receita entra em outra. */
  custoPorBase: number
  linhas: LinhaCusto[]
  problemas: string[]
}

/**
 * Custo da receita, incluindo sub-receitas (com a mão de obra delas, proporcional).
 * Detecta receitas que usam umas às outras em ciclo e itens que não existem mais.
 */
export function calcularCusto(receitaId: string, ctx: Contexto): ResultadoCusto {
  return calcularComMemo(receitaId, ctx, new Map(), new Set())
}

function calcularComMemo(id: string, ctx: Contexto, memo: Map<string, ResultadoCusto>, visitando: Set<string>): ResultadoCusto {
  const pronto = memo.get(id)
  if (pronto) return pronto
  const r = ctx.receitas.get(id)
  if (!r) return vazio([`Receita não encontrada`])
  if (visitando.has(id)) return vazio([`"${r.nome}" usa a si mesma (direta ou indiretamente)`])
  visitando.add(id)

  const linhas: LinhaCusto[] = []
  const problemas: string[] = []
  for (const item of r.itens) {
    if (item.tipo === 'insumo') {
      const ins = ctx.insumos.get(item.id)
      if (!ins) {
        linhas.push({ item, nome: 'Insumo apagado', unidade: 'un', custo: 0, problema: 'Insumo não encontrado' })
        problemas.push('Um insumo desta receita foi apagado')
        continue
      }
      linhas.push({ item, nome: ins.nome, unidade: unidadeBase(ins.unidadeCompra), custo: custoPorUnidadeBase(ins) * item.quantidade })
    } else {
      const sub = ctx.receitas.get(item.id)
      if (!sub) {
        linhas.push({ item, nome: 'Receita apagada', unidade: 'un', custo: 0, problema: 'Receita não encontrada' })
        problemas.push('Uma receita usada aqui foi apagada')
        continue
      }
      const rs = calcularComMemo(item.id, ctx, memo, visitando)
      const problema = rs.problemas.length ? rs.problemas[0] : undefined
      if (problema) problemas.push(`${sub.nome}: ${problema}`)
      linhas.push({ item, nome: sub.nome, unidade: unidadeBaseReceita(sub), custo: rs.custoPorBase * item.quantidade, problema })
    }
  }

  visitando.delete(id)
  const custoIngredientes = linhas.reduce((s, l) => s + l.custo, 0)
  const custoMaoObra = custoMaoDeObra(r.tempo_preparo_min, ctx.valorHora)
  const custoDireto = custoIngredientes + custoMaoObra
  const base = rendimentoBase(r)
  const resultado: ResultadoCusto = {
    custoIngredientes,
    custoMaoDeObra: custoMaoObra,
    custoDireto,
    custoPorBase: base > 0 ? custoDireto / base : 0,
    linhas,
    problemas,
  }
  memo.set(id, resultado)
  return resultado
}

function vazio(problemas: string[]): ResultadoCusto {
  return { custoIngredientes: 0, custoMaoDeObra: 0, custoDireto: 0, custoPorBase: 0, linhas: [], problemas }
}

// ---- Preço -----------------------------------------------------------------------

export interface ResultadoPreco {
  /** Rótulo da unidade de venda: "fatia", "kg", "litro". */
  unidade: string
  /** Quantas unidades de venda a receita rende (10 fatias, 1,2 kg). */
  qtdVenda: number
  custoPorUnidade: number
  /** Preço sugerido por unidade de venda (null se os percentuais somarem 100% ou mais). */
  pvSugerido: number | null
  /** Preço usado: o manual, se houver, senão o sugerido. */
  pvFinal: number | null
  manual: boolean
  lucroPorUnidade: number
  pctMargemReal: number
  pvTotal: number
  lucroTotal: number
  abaixoDoCusto: boolean
  /** Percentuais efetivos (os da receita ou, se vazios, os gerais). */
  pcts: { pctCustosFixos: number; pctTaxas: number; pctMargem: number }
}

/** Percentuais efetivos: os ajustes da receita ou, se vazios, os das configurações. */
export function percentuaisEfetivos(r: Pick<ReceitaCalculo, 'pct_custos_fixos' | 'pct_taxas' | 'pct_margem'>, config: ConfigPrecificacao) {
  return {
    pctCustosFixos: r.pct_custos_fixos ?? config.pctCustosFixos,
    pctTaxas: r.pct_taxas ?? config.pctTaxas,
    pctMargem: r.pct_margem ?? config.pctMargem,
  }
}

/** Preço de venda da receita a partir do custo direto. */
export function precificar(r: ReceitaCalculo, custoDireto: number, config: ConfigPrecificacao): ResultadoPreco {
  const { rotulo, fator } = unidadeVenda(r)
  const qtdVenda = rendimentoBase(r) / fator
  const custoPorUnidade = qtdVenda > 0 ? custoDireto / qtdVenda : 0
  const pcts = percentuaisEfetivos(r, config)
  const bruto = precoPorMarkupDivisor(custoPorUnidade, pcts)
  const pvSugerido = bruto === null ? null : arredondarPreco(bruto, config.arredondamento)
  const manual = r.pv_manual !== null && r.pv_manual !== undefined
  const pvFinal = manual ? r.pv_manual : pvSugerido
  const { lucro, pctMargem } = pvFinal === null ? { lucro: 0, pctMargem: 0 } : margemReal(pvFinal, custoPorUnidade, pcts)
  return {
    unidade: rotulo,
    qtdVenda,
    custoPorUnidade,
    pvSugerido,
    pvFinal,
    manual,
    lucroPorUnidade: lucro,
    pctMargemReal: pctMargem,
    pvTotal: (pvFinal ?? 0) * qtdVenda,
    lucroTotal: lucro * qtdVenda,
    abaixoDoCusto: pvFinal !== null && pvFinal < custoPorUnidade,
    pcts,
  }
}

// ---- Produção ---------------------------------------------------------------------

/**
 * Quanto de cada insumo sai do estoque ao produzir `multiplicador` receitas,
 * descendo nas sub-receitas (ex.: 1 bolo = massa + calda → ovos, açúcar, chocolate…).
 * Resultado em unidade base (g, ml, un). Ciclos são ignorados com segurança.
 */
export function explodirInsumos(receitaId: string, multiplicador: number, ctx: Pick<Contexto, 'receitas'>): Map<string, number> {
  const total = new Map<string, number>()
  const visitando = new Set<string>()
  function descer(id: string, mult: number) {
    const r = ctx.receitas.get(id)
    if (!r || visitando.has(id)) return
    visitando.add(id)
    for (const item of r.itens) {
      if (item.tipo === 'insumo') {
        total.set(item.id, (total.get(item.id) ?? 0) + item.quantidade * mult)
      } else {
        const sub = ctx.receitas.get(item.id)
        const base = sub ? rendimentoBase(sub) : 0
        if (base > 0) descer(item.id, mult * (item.quantidade / base))
      }
    }
    visitando.delete(id)
  }
  descer(receitaId, multiplicador)
  return total
}

/** Receitas que usam a receita `id` como ingrediente (diretamente). */
export function usadaEm(id: string, receitas: Iterable<ReceitaCalculo>): ReceitaCalculo[] {
  return [...receitas].filter((r) => r.id !== id && r.itens.some((i) => i.tipo === 'receita' && i.id === id))
}

/** True se colocar `candidataId` dentro de `receitaId` criaria um ciclo. */
export function criariaCiclo(receitaId: string, candidataId: string, receitas: Map<string, ReceitaCalculo>): boolean {
  if (receitaId === candidataId) return true
  const pilha = [candidataId]
  const vistos = new Set<string>()
  while (pilha.length) {
    const atual = pilha.pop()!
    if (atual === receitaId) return true
    if (vistos.has(atual)) continue
    vistos.add(atual)
    for (const i of receitas.get(atual)?.itens ?? []) if (i.tipo === 'receita') pilha.push(i.id)
  }
  return false
}

/** Quantidade amigável na unidade base: 300 g, 1,5 kg, 750 ml, 2 L, 4 un. */
export function textoQuantidade(qtd: number, unidade: UnidadeBase): string {
  const f = (n: number, casas: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: casas }).format(n)
  if (unidade === 'g') return qtd >= 1000 ? `${f(qtd / 1000, 3)} kg` : `${f(qtd, 1)} g`
  if (unidade === 'ml') return qtd >= 1000 ? `${f(qtd / 1000, 3)} L` : `${f(qtd, 1)} ml`
  return `${f(qtd, 2)} un`
}
