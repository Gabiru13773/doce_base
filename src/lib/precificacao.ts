// Precificação pelo "markup divisor":
//   PV = custo direto ÷ (1 − %custos fixos − %taxas − %margem)
// Assim, depois de pagar custos fixos e taxas sobre o preço de venda,
// sobra exatamente a margem desejada.

export interface ConfigPrecificacao {
  valorHora: number // R$ por hora de trabalho
  pctCustosFixos: number // ex.: 20 (= 20%)
  pctTaxas: number // ex.: 5
  pctMargem: number // ex.: 25
  arredondamento: Arredondamento
}

/** Como arredondar o preço sugerido. */
export type Arredondamento = 'nenhum' | 'centavos90' | 'meio_real' | 'real'

export const CONFIG_PADRAO: ConfigPrecificacao = {
  valorHora: 20,
  pctCustosFixos: 20,
  pctTaxas: 5,
  pctMargem: 25,
  arredondamento: 'centavos90',
}

export const ARREDONDAMENTOS: { valor: Arredondamento; rotulo: string }[] = [
  { valor: 'centavos90', rotulo: 'Terminar em ,90 (ex.: R$ 12,90)' },
  { valor: 'meio_real', rotulo: 'De 50 em 50 centavos (ex.: R$ 12,50)' },
  { valor: 'real', rotulo: 'Real inteiro (ex.: R$ 13,00)' },
  { valor: 'nenhum', rotulo: 'Não arredondar' },
]

/** Soma dos percentuais que saem do preço de venda. */
export function somaPercentuais(c: Pick<ConfigPrecificacao, 'pctCustosFixos' | 'pctTaxas' | 'pctMargem'>): number {
  return c.pctCustosFixos + c.pctTaxas + c.pctMargem
}

/** Custo de mão de obra a partir do tempo (minutos) e do valor da hora. */
export function custoMaoDeObra(minutos: number, valorHora: number): number {
  if (!(minutos > 0) || !(valorHora > 0)) return 0
  return (minutos / 60) * valorHora
}

/**
 * Preço de venda pelo markup divisor, sem arredondar.
 * Retorna null se os percentuais somarem 100% ou mais (preço impossível).
 */
export function precoPorMarkupDivisor(custoDireto: number, c: Pick<ConfigPrecificacao, 'pctCustosFixos' | 'pctTaxas' | 'pctMargem'>): number | null {
  const divisor = 1 - somaPercentuais(c) / 100
  if (divisor <= 0) return null
  return custoDireto / divisor
}

/** Arredonda sempre para cima, para nunca reduzir a margem. */
export function arredondarPreco(valor: number, modo: Arredondamento): number {
  // Corrige ruído de ponto flutuante (ex.: 59.99999999) antes de arredondar para cima.
  const v = Math.round(valor * 100) / 100
  switch (modo) {
    case 'nenhum':
      return v
    case 'real':
      return Math.ceil(v)
    case 'meio_real':
      return Math.ceil(v * 2) / 2
    case 'centavos90': {
      const r = Math.floor(v) + 0.9
      return r >= v ? round2(r) : round2(r + 1)
    }
  }
}

/**
 * Margem real obtida com um preço de venda (ex.: digitado à mão).
 * Margem = (PV − custo direto − custos fixos e taxas sobre o PV) ÷ PV.
 */
export function margemReal(pv: number, custoDireto: number, c: Pick<ConfigPrecificacao, 'pctCustosFixos' | 'pctTaxas'>) {
  if (!(pv > 0)) return { lucro: 0, pctMargem: 0 }
  const descontos = pv * ((c.pctCustosFixos + c.pctTaxas) / 100)
  const lucro = pv - custoDireto - descontos
  return { lucro, pctMargem: (lucro / pv) * 100 }
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}
