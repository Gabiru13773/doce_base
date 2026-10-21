const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** R$ 1.234,56 */
export function moeda(v: number): string {
  return brl.format(Number.isFinite(v) ? v : 0)
}

/** Formata número no padrão brasileiro com até `casas` decimais (sem zeros sobrando). */
export function numero(v: number, casas = 2): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: casas }).format(Number.isFinite(v) ? v : 0)
}

/** Formata percentual: 25 → "25%", 12.5 → "12,5%" */
export function pct(v: number): string {
  return `${numero(v, 1)}%`
}

/**
 * Lê um número digitado no padrão brasileiro: "6,50", "1.234,5", "6.5" ou "395".
 * Retorna NaN quando o texto não é um número.
 */
export function lerNumero(texto: string): number {
  const t = texto.trim().replace(/\s/g, '').replace(/^R\$/i, '')
  if (t === '') return NaN
  let normal = t
  if (t.includes(',')) {
    // Vírgula é o separador decimal; pontos são de milhar.
    normal = t.replace(/\./g, '').replace(',', '.')
  } else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(t)) {
    // Sem vírgula, "1.500" ou "2.000.000" é milhar (jeito brasileiro), não 1,5.
    // Primeiro grupo começando por 0 ("0.500") nunca é milhar: é decimal com ponto.
    normal = t.replace(/\./g, '')
  }
  return /^-?\d+(\.\d+)?$/.test(normal) ? Number(normal) : NaN
}

/** Texto para preencher um campo a partir de um número (6.5 → "6,5"). */
export function paraCampo(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return ''
  return String(v).replace('.', ',')
}
