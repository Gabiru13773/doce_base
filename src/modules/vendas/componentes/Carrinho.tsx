import { Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { moeda, numero } from '../../../lib/format'
import type { TotaisVenda } from '../../../lib/vendas'
import type { DescontoCarrinho, ItemCarrinho } from './carrinho'

// Itens do carrinho (− qtd +), subtotal, desconto e total. Usado no painel do lado (tablet e
// computador) e na folha do carrinho (celular).

export function ItensCarrinho({
  itens,
  aoMudarQtd,
  aoEditarPreco,
}: {
  itens: ItemCarrinho[]
  aoMudarQtd: (variacaoId: string, delta: number) => void
  aoEditarPreco: (item: ItemCarrinho) => void
}) {
  if (itens.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-suave">
        <ShoppingBag className="size-10 text-borda" aria-hidden />
        <p>Toque nos produtos para colocar no carrinho.</p>
      </div>
    )
  }
  return (
    <ul className="flex flex-col divide-y divide-borda">
      {itens.map((i) => (
        <li key={i.variacao_id} className="flex flex-col gap-2 py-3">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 font-semibold break-words">{i.nome}</p>
            <p className="shrink-0 font-bold">{moeda(i.qtd * i.preco)}</p>
          </div>
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => aoEditarPreco(i)}
              className="-ml-2 min-h-12 rounded-xl px-2 text-left text-sm text-suave underline decoration-dotted underline-offset-4 active:bg-marca-clara"
              aria-label={`Mudar o preço de ${i.nome}`}
            >
              {moeda(i.preco)} cada{i.manual ? ' (digitado)' : ''}
            </button>
            <div className="flex items-center gap-1" role="group" aria-label={`Quantidade de ${i.nome}`}>
              <button
                type="button"
                onClick={() => aoMudarQtd(i.variacao_id, -1)}
                aria-label={i.qtd === 1 ? `Tirar ${i.nome}` : 'Um a menos'}
                className={`flex size-12 items-center justify-center rounded-full border border-borda bg-superficie active:bg-marca-clara ${
                  i.qtd === 1 ? 'text-perigo' : 'text-marca'
                }`}
              >
                {i.qtd === 1 ? <Trash2 className="size-5" aria-hidden /> : <Minus className="size-5" aria-hidden />}
              </button>
              <span className="min-w-10 text-center text-lg font-bold tabular-nums" aria-live="polite">
                {numero(i.qtd, 0)}
              </span>
              <button
                type="button"
                onClick={() => aoMudarQtd(i.variacao_id, 1)}
                aria-label="Um a mais"
                className="flex size-12 items-center justify-center rounded-full border border-borda bg-superficie text-marca active:bg-marca-clara"
              >
                <Plus className="size-5" aria-hidden />
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function TotaisCarrinho({
  totais,
  desconto,
  aoDesconto,
}: {
  totais: TotaisVenda
  desconto: DescontoCarrinho
  aoDesconto: () => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-suave">
        <span>
          Subtotal · {totais.itens} {totais.itens === 1 ? 'item' : 'itens'}
        </span>
        <span className="tabular-nums">{moeda(totais.subtotal)}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={aoDesconto}
          disabled={totais.subtotal <= 0}
          className="-ml-2 min-h-12 rounded-xl px-2 font-semibold text-marca active:bg-marca-clara disabled:opacity-50"
        >
          {totais.desconto > 0 ? `Desconto${desconto.tipo === 'pct' ? ` (${numero(desconto.valor, 1)}%)` : ''}` : '+ Dar desconto'}
        </button>
        {totais.desconto > 0 && <span className="font-semibold text-ok tabular-nums">− {moeda(totais.desconto)}</span>}
      </div>
      <div className="flex items-baseline justify-between gap-3 border-t border-borda pt-2">
        <span className="text-lg font-semibold">Total</span>
        <span className="text-3xl font-bold text-tinta tabular-nums">{moeda(totais.total)}</span>
      </div>
    </div>
  )
}
