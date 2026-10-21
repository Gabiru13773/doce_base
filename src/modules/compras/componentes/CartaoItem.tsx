import { ArrowLeftRight, Check } from 'lucide-react'
import { memo, useMemo } from 'react'
import { faixaPrecos, type PrecoHistorico } from '../../../lib/compras'
import { moeda, numero } from '../../../lib/format'
import type { ItemCompra } from '../api'
import { PrecosReferencia } from './PrecosReferencia'
import { textoEmbalagem, textoQtd } from './formato'

export type AcaoItem = 'pegar' | 'trocar' | 'nao' | 'alterar'

const botaoAcao = 'min-h-12 rounded-2xl px-2 font-semibold transition-colors'

/** Um item da lista na hora da compra. `memo`: com a lista atualizando a cada 4 s, só redesenha o que mudou. */
export const CartaoItem = memo(function CartaoItem({
  item,
  historico,
  aoAcao,
}: {
  item: ItemCompra
  /** histórico de preços do insumo (na troca, do que foi levado) */
  historico: PrecoHistorico[] | undefined
  aoAcao: (id: string, acao: AcaoItem) => void
}) {
  const faixa = useMemo(
    () => (historico && item.embalagem_qtd > 0 ? faixaPrecos(historico, { qtd: item.embalagem_qtd, unidade: item.embalagem_unidade }) : null),
    [historico, item.embalagem_qtd, item.embalagem_unidade],
  )
  const pendente = item.status === 'pendente'
  const umaUnidade = item.embalagem_unidade === 'un' && item.embalagem_qtd === 1
  const cada = item.preco_pago != null ? ` · ${moeda(item.preco_pago)} cada` : ''

  return (
    <article className={`rounded-2xl border border-borda p-4 ${pendente ? 'bg-superficie' : 'bg-superficie/60'}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {item.fora_da_lista && (
            <span className="mb-1 inline-block rounded-full bg-laranja-clara px-2 py-0.5 text-xs font-semibold text-tinta">Fora da lista</span>
          )}
          <h3 className={`text-lg leading-snug font-semibold break-words ${item.status === 'substituido' ? 'text-suave line-through' : ''}`}>
            {item.nome}
          </h3>
          {item.status === 'substituido' && (
            <p className="flex items-center gap-1.5">
              <ArrowLeftRight className="size-4 shrink-0 text-marca" aria-hidden />
              <span>
                Levou no lugar: <b className="font-semibold">{item.sub_nome}</b>
              </span>
            </p>
          )}
          {item.status !== 'nao' && <PrecosReferencia faixa={faixa} className="mt-1" />}
        </div>
        <div className="shrink-0 text-right" aria-label={`Na lista: ${textoQtd(item.qtd_pedida, item)}`}>
          <span className="block text-2xl leading-none font-bold tabular-nums">{numero(item.qtd_pedida, 3)}</span>
          <span className="block text-sm text-suave">{umaUnidade ? 'un' : `× ${textoEmbalagem(item.embalagem_qtd, item.embalagem_unidade)}`}</span>
        </div>
      </div>

      {pendente ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <button type="button" onClick={() => aoAcao(item.id, 'pegar')} className={`${botaoAcao} bg-marca text-white shadow-sm active:bg-marca-escura`}>
            Peguei
          </button>
          <button
            type="button"
            onClick={() => aoAcao(item.id, 'trocar')}
            className={`${botaoAcao} border border-borda bg-superficie text-marca active:bg-marca-clara`}
          >
            Trocar
          </button>
          <button
            type="button"
            onClick={() => aoAcao(item.id, 'nao')}
            className={`${botaoAcao} border border-borda bg-superficie text-tinta active:bg-marca-clara`}
          >
            Não levei
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            {item.status === 'comprado' && (
              <span className="inline-flex items-center gap-1.5 self-start rounded-xl bg-ok-claro px-3 py-1.5 font-semibold text-ok tabular-nums">
                <Check className="size-4 shrink-0" aria-hidden />
                {item.qtd_comprada != null ? textoQtd(item.qtd_comprada, item) : ''}
                {cada}
              </span>
            )}
            {item.status === 'substituido' && (
              <span className="inline-flex items-center gap-1.5 self-start rounded-xl bg-laranja-clara px-3 py-1.5 font-semibold text-tinta tabular-nums">
                <ArrowLeftRight className="size-4 shrink-0" aria-hidden />
                {item.qtd_comprada != null ? textoQtd(item.qtd_comprada, item) : ''}
                {cada}
              </span>
            )}
            {item.status === 'nao' && (
              <span className="self-start rounded-xl bg-borda/60 px-3 py-1.5 font-semibold text-suave">Não levei: {item.motivo}</span>
            )}
            {item.marcado_por && <span className="text-sm text-suave">por {item.marcado_por}</span>}
          </div>
          <button
            type="button"
            onClick={() => aoAcao(item.id, 'alterar')}
            className="min-h-12 shrink-0 rounded-2xl px-4 font-semibold text-marca active:bg-marca-clara"
          >
            Alterar
          </button>
        </div>
      )}
    </article>
  )
})
