import type { SituacaoEstoque } from '../../../lib/estoque'

// Etiqueta da situação do item no estoque.

const SELOS: Partial<Record<SituacaoEstoque, { texto: string; classe: string }>> = {
  sem_contagem: { texto: 'Não contado', classe: 'bg-creme text-suave' },
  negativo: { texto: 'Conferir', classe: 'bg-laranja-clara text-tinta' },
  zerado: { texto: 'Zerado', classe: 'bg-perigo-claro text-perigo' },
  acabando: { texto: 'Acabando', classe: 'bg-alerta-claro text-alerta' },
  ok: { texto: 'Ok', classe: 'bg-ok-claro text-ok' },
}

export function SeloSituacao({ situacao, className = '' }: { situacao: SituacaoEstoque; className?: string }) {
  const selo = SELOS[situacao]
  if (!selo) return null
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-sm font-semibold ${selo.classe} ${className}`}>{selo.texto}</span>
}

export const DICA_NEGATIVO = 'Saiu mais do que entrou. Falta lançar uma compra ou contar de novo.'
