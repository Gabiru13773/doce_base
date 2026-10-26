import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useId } from 'react'
import { classeEntrada } from '../../../components/ui'
import { somarDias } from '../../../lib/financeiro'
import { moeda, numero } from '../../../lib/format'
import { CANAIS, FORMAS, type Canal, type FormaPagamento, type ItemVenda } from '../../../lib/vendas'
import type { Venda } from '../api'

// Lista das vendas do dia e ajudantes de texto usados nas telas de vendas.

export const rotuloCanal = (c: Canal) => CANAIS.find((x) => x.valor === c)?.rotulo ?? c
export const rotuloForma = (f: FormaPagamento) => FORMAS.find((x) => x.valor === f)?.rotulo ?? f

/** "14:05" a partir do criado_em */
export function hora(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/** "2× Fatia de bolo, 1× Brigadeiro" */
export function resumoItens(itens: ItemVenda[]): string {
  return itens.map((i) => `${numero(i.qtd, 3)}× ${i.nome}`).join(', ')
}

const COR_CANAL: Record<Canal, string> = {
  balcao: 'bg-marca-clara text-marca',
  whatsapp: 'bg-ok-claro text-ok',
  ifood: 'bg-perigo-claro text-perigo',
}

export function EtiquetaCanal({ canal }: { canal: Canal }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${COR_CANAL[canal]}`}>{rotuloCanal(canal)}</span>
}

/** Venda que é pagamento de um pedido (sinal ou restante). */
export function EtiquetaPedido() {
  return <span className="rounded-full bg-laranja-clara px-2 py-0.5 text-xs font-semibold text-tinta">Pedido</span>
}

/** ◀ Hoje ▶ e o campo de data. */
export function SeletorDia({ data, hoje, aoMudar }: { data: string; hoje: string; aoMudar: (d: string) => void }) {
  const id = useId()
  const seta = 'flex size-12 shrink-0 items-center justify-center rounded-2xl border border-borda bg-superficie text-marca active:bg-marca-clara'
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={seta} aria-label="Dia anterior" onClick={() => aoMudar(somarDias(data, -1))}>
        <ChevronLeft className="size-6" aria-hidden />
      </button>
      <label htmlFor={id} className="sr-only">
        Dia
      </label>
      <input
        id={id}
        type="date"
        value={data}
        onChange={(e) => e.target.value && aoMudar(e.target.value)}
        className={`${classeEntrada} min-w-0 flex-1`}
      />
      <button type="button" className={seta} aria-label="Próximo dia" onClick={() => aoMudar(somarDias(data, 1))}>
        <ChevronRight className="size-6" aria-hidden />
      </button>
      {data !== hoje && (
        <button
          type="button"
          onClick={() => aoMudar(hoje)}
          className="min-h-12 shrink-0 rounded-2xl border border-borda bg-superficie px-4 font-semibold text-marca active:bg-marca-clara"
        >
          Hoje
        </button>
      )}
    </div>
  )
}

export function ListaVendas({ vendas, aoAbrir }: { vendas: Venda[]; aoAbrir: (v: Venda) => void }) {
  return (
    <ul className="divide-y divide-borda overflow-hidden rounded-2xl border border-borda bg-superficie">
      {vendas.map((v) => (
        <li key={v.id}>
          <LinhaVenda venda={v} aoAbrir={() => aoAbrir(v)} />
        </li>
      ))}
    </ul>
  )
}

function LinhaVenda({ venda: v, aoAbrir }: { venda: Venda; aoAbrir: () => void }) {
  const cancelada = v.status === 'cancelada'
  return (
    <button
      type="button"
      onClick={aoAbrir}
      className={`flex min-h-16 w-full items-start gap-3 px-4 py-3 text-left active:bg-marca-clara ${cancelada ? 'opacity-60' : ''}`}
    >
      <span className="w-12 shrink-0 pt-0.5 text-sm font-semibold text-suave">{hora(v.criado_em)}</span>
      <span className="min-w-0 flex-1">
        <span className={`block font-semibold ${cancelada ? 'line-through' : ''}`}>{resumoItens(v.itens) || 'Venda'}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-suave">
          <EtiquetaCanal canal={v.canal} />
          {v.pedido_id && <EtiquetaPedido />}
          <span>{v.pagamentos.map((p) => rotuloForma(p.forma)).join(' + ')}</span>
          {v.feito_por && <span>· {v.feito_por}</span>}
          {v.pendente && <span className="rounded-full bg-alerta-claro px-2 text-alerta">por enviar</span>}
        </span>
        {cancelada && <span className="mt-1 block text-sm font-medium text-perigo">Cancelada: {v.motivo_cancelamento}</span>}
      </span>
      <span className={`shrink-0 font-bold ${cancelada ? 'line-through' : ''}`}>{moeda(v.total)}</span>
    </button>
  )
}
