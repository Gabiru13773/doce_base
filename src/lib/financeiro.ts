// Contas do financeiro: saldo das contas, situação das contas a pagar/receber e parcelas.
// Funções puras; datas no formato do banco (AAAA-MM-DD), comparadas como texto.

export interface LancamentoCalc {
  id: string
  tipo: 'entrada' | 'saida' | 'transferencia'
  data: string
  conta_id: string
  conta_destino_id: string | null
  valor: number
  titulo_id: string | null
}

export interface ContaCalc {
  id: string
  saldo_inicial: number
  saldo_em: string
}

export interface TituloCalc {
  id: string
  tipo: 'pagar' | 'receber'
  valor: number
  vencimento: string
}

const centavos = (n: number) => Math.round(n * 100) / 100

/** Efeito de um lançamento no saldo de uma conta (+ entra, − sai, 0 não mexe). */
export function efeitoNaConta(l: LancamentoCalc, contaId: string): number {
  if (l.tipo === 'transferencia') {
    if (l.conta_id === contaId) return -l.valor
    if (l.conta_destino_id === contaId) return l.valor
    return 0
  }
  if (l.conta_id !== contaId) return 0
  return l.tipo === 'entrada' ? l.valor : -l.valor
}

/** Saldo da conta: saldo inicial + movimentos a partir da data do saldo inicial, até `ate` (inclusive). */
export function saldoConta(conta: ContaCalc, lancamentos: LancamentoCalc[], ate?: string): number {
  let saldo = conta.saldo_inicial
  for (const l of lancamentos) {
    if (l.data < conta.saldo_em) continue
    if (ate && l.data > ate) continue
    saldo += efeitoNaConta(l, conta.id)
  }
  return centavos(saldo)
}

export type Situacao = 'pago' | 'parcial' | 'atrasado' | 'vence_hoje' | 'aberto'

export interface SituacaoTitulo {
  situacao: Situacao
  /** Quanto já foi pago/recebido (soma dos lançamentos de baixa). */
  pago: number
  /** Quanto falta. */
  falta: number
  /** Data do último pagamento, se houver. */
  pagoEm: string | null
}

/** Soma das baixas por título (para não percorrer os lançamentos a cada título). */
export function baixasPorTitulo(lancamentos: LancamentoCalc[]): Map<string, { total: number; ultima: string }> {
  const m = new Map<string, { total: number; ultima: string }>()
  for (const l of lancamentos) {
    if (!l.titulo_id || l.tipo === 'transferencia') continue
    const atual = m.get(l.titulo_id) ?? { total: 0, ultima: '' }
    m.set(l.titulo_id, { total: atual.total + l.valor, ultima: l.data > atual.ultima ? l.data : atual.ultima })
  }
  return m
}

export function situacaoTitulo(t: TituloCalc, baixas: Map<string, { total: number; ultima: string }>, hoje: string): SituacaoTitulo {
  const b = baixas.get(t.id)
  const pago = centavos(b?.total ?? 0)
  const falta = centavos(Math.max(0, t.valor - pago))
  if (falta === 0) return { situacao: 'pago', pago, falta, pagoEm: b?.ultima || null }
  const situacao: Situacao = t.vencimento < hoje ? 'atrasado' : t.vencimento === hoje ? 'vence_hoje' : pago > 0 ? 'parcial' : 'aberto'
  return { situacao, pago, falta, pagoEm: b?.ultima || null }
}

/** Soma `meses` a uma data AAAA-MM-DD, segurando o fim do mês (31/01 + 1 mês = 28 ou 29/02). */
export function somarMeses(data: string, meses: number): string {
  const [a, m, d] = data.split('-').map(Number)
  const total = a * 12 + (m - 1) + meses
  const ano = Math.floor(total / 12)
  const mes = (total % 12) + 1
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  return `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(d, ultimoDia)).padStart(2, '0')}`
}

/** Soma dias a uma data AAAA-MM-DD. */
export function somarDias(data: string, dias: number): string {
  const [a, m, d] = data.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10)
}

/**
 * Divide um valor em parcelas mensais. Os centavos que sobram vão na primeira parcela
 * (ex.: R$ 100 em 3× = 33,34 + 33,33 + 33,33), para a soma bater exatamente.
 */
export function parcelar(total: number, vezes: number, primeiroVencimento: string) {
  const n = Math.max(1, Math.floor(vezes))
  const emCentavos = Math.round(total * 100)
  const base = Math.floor(emCentavos / n)
  const resto = emCentavos - base * n
  return Array.from({ length: n }, (_, i) => ({
    parcela: n > 1 ? `${i + 1}/${n}` : null,
    valor: (base + (i === 0 ? resto : 0)) / 100,
    vencimento: somarMeses(primeiroVencimento, i),
  }))
}

/** Conta que se repete todo mês com o mesmo valor (aluguel, internet…), por `meses` meses. */
export function repetirMensal(valor: number, meses: number, primeiroVencimento: string) {
  const n = Math.max(1, Math.floor(meses))
  return Array.from({ length: n }, (_, i) => ({ parcela: null, valor: centavos(valor), vencimento: somarMeses(primeiroVencimento, i) }))
}
