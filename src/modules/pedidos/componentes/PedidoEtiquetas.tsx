import { Bike, Car, Store, type LucideIcon } from 'lucide-react'
import { numero } from '../../../lib/format'
import { STATUS_PEDIDO, TIPOS_ENTREGA, dataCurta, type ItemPedido, type StatusPedido, type TipoEntrega } from '../../../lib/pedidos'

// Pedaços pequenos usados na lista e na tela do pedido: selo de status, tipo de entrega e textos.

const COR_STATUS: Record<StatusPedido, string> = {
  confirmado: 'bg-marca-clara text-marca',
  pronto: 'bg-ok-claro text-ok',
  entregue: 'bg-borda text-suave',
  cancelado: 'bg-perigo-claro text-perigo',
}

export const rotuloStatus = (s: StatusPedido) => STATUS_PEDIDO.find((x) => x.valor === s)?.rotulo ?? s
export const rotuloEntrega = (t: TipoEntrega) => TIPOS_ENTREGA.find((x) => x.valor === t)?.rotulo ?? t

export const ICONE_ENTREGA: Record<TipoEntrega, LucideIcon> = {
  retirada: Store,
  propria: Car,
  motoboy: Bike,
}

export function SeloStatus({ status }: { status: StatusPedido }) {
  return <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm font-semibold ${COR_STATUS[status]}`}>{rotuloStatus(status)}</span>
}

export function TipoEntregaRotulo({ tipo }: { tipo: TipoEntrega }) {
  const Icone = ICONE_ENTREGA[tipo]
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icone className="size-4 shrink-0" aria-hidden />
      {rotuloEntrega(tipo)}
    </span>
  )
}

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** "2026-10-24" → "sáb" */
export function diaSemana(data: string): string {
  const [a, m, d] = data.split('-').map(Number)
  return DIAS[new Date(a, m - 1, d).getDay()] ?? ''
}

/** "sáb, 24/10 · 14:00" */
export function quandoEntrega(p: { entrega_data: string; entrega_hora: string | null }): string {
  return `${diaSemana(p.entrega_data)}, ${dataCurta(p.entrega_data)}${p.entrega_hora ? ` · ${p.entrega_hora}` : ''}`
}

/** "2x Bolo de pote, 1x Bolo personalizado" */
export function resumoItensPedido(itens: Pick<ItemPedido, 'qtd' | 'nome'>[]): string {
  return itens.map((i) => `${numero(i.qtd, 3)}x ${i.nome}`).join(', ')
}

/** Data e hora (no fuso do aparelho) de um ISO: "24/10 às 15:32" */
export function momento(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}
