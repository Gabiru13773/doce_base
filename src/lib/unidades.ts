// Unidades de medida. Todo insumo é guardado numa "unidade base" (g, ml ou un),
// e a embalagem de compra pode ser informada em qualquer unidade compatível.

export type UnidadeBase = 'g' | 'ml' | 'un'
export type UnidadeCompra = 'g' | 'kg' | 'ml' | 'l' | 'un' | 'dz'

export const UNIDADES_COMPRA: { valor: UnidadeCompra; rotulo: string; base: UnidadeBase; fator: number }[] = [
  { valor: 'kg', rotulo: 'kg (quilo)', base: 'g', fator: 1000 },
  { valor: 'g', rotulo: 'g (grama)', base: 'g', fator: 1 },
  { valor: 'l', rotulo: 'L (litro)', base: 'ml', fator: 1000 },
  { valor: 'ml', rotulo: 'ml', base: 'ml', fator: 1 },
  { valor: 'un', rotulo: 'unidade', base: 'un', fator: 1 },
  { valor: 'dz', rotulo: 'dúzia', base: 'un', fator: 12 },
]

export function infoUnidade(u: UnidadeCompra) {
  const info = UNIDADES_COMPRA.find((x) => x.valor === u)
  if (!info) throw new Error(`Unidade desconhecida: ${u}`)
  return info
}

export function unidadeBase(u: UnidadeCompra): UnidadeBase {
  return infoUnidade(u).base
}

/** Converte uma quantidade na unidade de compra para a unidade base (ex.: 1 kg → 1000 g). */
export function paraBase(qtd: number, u: UnidadeCompra): number {
  return qtd * infoUnidade(u).fator
}

export const ROTULO_BASE: Record<UnidadeBase, string> = { g: 'g', ml: 'ml', un: 'un' }
