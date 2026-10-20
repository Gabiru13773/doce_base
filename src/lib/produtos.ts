import type { ConfigPrecificacao } from './precificacao'
import {
  calcularCusto,
  precificar,
  type Contexto,
  type ItemReceita,
  type ResultadoCusto,
  type ResultadoPreco,
} from './receitas'

// Produtos = o que é vendido: receitas prontas + embalagens/extras, com variações
// (ex.: "Prato MDF" / "Bandeja plástica"), cada uma com o próprio custo e preço.
// Reaproveita os cálculos de receitas: uma variação é tratada como uma "receita"
// que rende 1 unidade, cujos itens são as receitas e os insumos que ela leva.

/** Uma variação de um produto. Itens na unidade base: receita em fatias/un, g ou ml; insumo em g, ml ou un. */
export interface VariacaoCalculo {
  id: string
  nome: string
  itens: ItemReceita[]
  /** Tempo para montar/embalar uma unidade (entra como mão de obra). */
  tempo_montagem_min: number
  pct_custos_fixos: number | null
  pct_taxas: number | null
  pct_margem: number | null
  /** Preço digitado à mão para 1 unidade do produto (null = usa o sugerido). */
  pv_manual: number | null
}

const ID_VARIACAO = '__variacao__'

function comoReceita(v: VariacaoCalculo) {
  return {
    id: ID_VARIACAO,
    nome: v.nome,
    rendimento_qtd: 1,
    rendimento_unidade: 'un' as const,
    rendimento_nome: 'unidade',
    itens: v.itens,
    tempo_preparo_min: v.tempo_montagem_min,
    pct_custos_fixos: v.pct_custos_fixos,
    pct_taxas: v.pct_taxas,
    pct_margem: v.pct_margem,
    pv_manual: v.pv_manual,
  }
}

/** Custo de 1 unidade da variação: receitas (proporcional, com a mão de obra delas) + embalagens + montagem. */
export function custoVariacao(v: VariacaoCalculo, ctx: Contexto): ResultadoCusto {
  const receitas = new Map(ctx.receitas)
  receitas.set(ID_VARIACAO, comoReceita(v))
  return calcularCusto(ID_VARIACAO, { ...ctx, receitas })
}

/** Preço de 1 unidade da variação (mesmo markup divisor das receitas). */
export function precificarVariacao(v: VariacaoCalculo, custoDireto: number, config: ConfigPrecificacao): ResultadoPreco {
  return precificar(comoReceita(v), custoDireto, config)
}

/**
 * O que sai do estoque ao vender/montar `quantidade` unidades da variação:
 * receitas prontas (na unidade base delas: fatias, g, ml) e insumos (embalagens, extras).
 * Diferente da produção, aqui NÃO desce nas sub-receitas: o bolo já está pronto no estoque.
 */
export function baixaVariacao(v: Pick<VariacaoCalculo, 'itens'>, quantidade: number) {
  const receitas = new Map<string, number>()
  const insumos = new Map<string, number>()
  for (const item of v.itens) {
    const alvo = item.tipo === 'receita' ? receitas : insumos
    alvo.set(item.id, (alvo.get(item.id) ?? 0) + item.quantidade * quantidade)
  }
  return { receitas, insumos }
}
