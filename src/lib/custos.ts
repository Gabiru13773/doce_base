import { paraBase, type UnidadeCompra } from './unidades'

/** Dados mínimos de compra de um insumo para calcular o custo. */
export interface CompraInsumo {
  qtdCompra: number
  unidadeCompra: UnidadeCompra
  precoCompra: number
}

/**
 * Custo por unidade base (R$ por g, ml ou un).
 * Ex.: leite condensado 395 g por R$ 6,50 → R$ 0,016456/g.
 * Retorna 0 quando a embalagem ainda não tem quantidade válida.
 */
export function custoPorUnidadeBase({ qtdCompra, unidadeCompra, precoCompra }: CompraInsumo): number {
  const qtdBase = paraBase(qtdCompra, unidadeCompra)
  if (!(qtdBase > 0) || !(precoCompra >= 0)) return 0
  return precoCompra / qtdBase
}

/**
 * Custo numa unidade "amigável" para mostrar na tela:
 * por kg (g), por litro (ml) ou por unidade (un).
 */
export function custoAmigavel(compra: CompraInsumo): { valor: number; por: 'kg' | 'L' | 'un' } {
  const porBase = custoPorUnidadeBase(compra)
  const u = compra.unidadeCompra
  if (u === 'g' || u === 'kg') return { valor: porBase * 1000, por: 'kg' }
  if (u === 'ml' || u === 'l') return { valor: porBase * 1000, por: 'L' }
  return { valor: porBase, por: 'un' }
}
