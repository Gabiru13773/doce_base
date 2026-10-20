// Textos e contas pequenas usados nas telas de contas a pagar e a receber.
import type { Situacao } from '../../../lib/financeiro'
import type { Lancamento, TipoTitulo, Titulo } from '../api'

/** Minúsculas e sem acentos, para a busca achar "acucar" em "Açúcar". */
export function simplificar(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** Diferença em dias entre duas datas AAAA-MM-DD (b − a). */
export function diasEntre(a: string, b: string): number {
  const [aa, am, ad] = a.split('-').map(Number)
  const [ba, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(ba, bm - 1, bd) - Date.UTC(aa, am - 1, ad)) / 86_400_000)
}

/** 2026-10-20 → 20/10/2026 */
export function dataBr(data: string): string {
  const [a, m, d] = data.split('-')
  return `${d}/${m}/${a}`
}

/** "vence hoje", "venceu há 3 dias", "vence em 5 dias" ou a data. */
export function textoVencimento(vencimento: string, hoje: string): string {
  const d = diasEntre(hoje, vencimento)
  if (d === 0) return 'vence hoje'
  if (d === 1) return 'vence amanhã'
  if (d === -1) return 'venceu ontem'
  if (d < 0) return d >= -60 ? `venceu há ${-d} dias` : `venceu em ${dataBr(vencimento)}`
  if (d <= 30) return `vence em ${d} dias`
  return `vence em ${dataBr(vencimento)}`
}

export const PALAVRAS: Record<
  TipoTitulo,
  { titulo: string; acao: string; feito: string; nova: string; pessoa: string; exemploDescricao: string; exemploPessoa: string }
> = {
  pagar: {
    titulo: 'Contas a pagar',
    acao: 'Pagar',
    feito: 'Paga',
    nova: 'Nova conta a pagar',
    pessoa: 'Fornecedor (para quem vai pagar)',
    exemploDescricao: 'Ex.: Aluguel da cozinha',
    exemploPessoa: 'Ex.: Embalagens Silva',
  },
  receber: {
    titulo: 'Contas a receber',
    acao: 'Receber',
    feito: 'Recebida',
    nova: 'Nova conta a receber',
    pessoa: 'Cliente (quem vai te pagar)',
    exemploDescricao: 'Ex.: Encomenda bolo de casamento',
    exemploPessoa: 'Ex.: Ana',
  },
}

/** Rótulo e cores do selo de situação. */
export function seloSituacao(s: Situacao, tipo: TipoTitulo): { texto: string; classe: string } {
  switch (s) {
    case 'pago':
      return { texto: PALAVRAS[tipo].feito, classe: 'bg-ok-claro text-ok' }
    case 'atrasado':
      return { texto: 'Atrasada', classe: 'bg-perigo-claro text-perigo' }
    case 'vence_hoje':
      return { texto: 'Vence hoje', classe: 'bg-alerta-claro text-alerta' }
    case 'parcial':
      return { texto: tipo === 'pagar' ? 'Paga em parte' : 'Recebida em parte', classe: 'bg-laranja-clara text-alerta' }
    default:
      return { texto: 'Em aberto', classe: 'bg-creme text-suave border border-borda' }
  }
}

/** Descrição do lançamento de baixa: a do título, com a parcela ("Embalagens (2/3)"). */
export function descricaoBaixa(t: Pick<Titulo, 'descricao' | 'parcela'>): string {
  return t.parcela ? `${t.descricao} (${t.parcela})` : t.descricao
}

/** Conta usada na baixa mais recente (para já vir escolhida na próxima). */
export function ultimaContaUsada(lancamentos: Lancamento[] | undefined): string | null {
  let melhor: Lancamento | null = null
  for (const l of lancamentos ?? []) {
    if (!l.titulo_id) continue
    if (!melhor || l.criado_em > melhor.criado_em) melhor = l
  }
  return melhor?.conta_id ?? null
}

export function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : 'tente novamente'
}
