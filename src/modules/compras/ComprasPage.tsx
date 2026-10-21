import { ChevronRight, ShoppingCart } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useMemo } from 'react'
import { Botao, Carregando, Erro, TituloPagina, Vazio } from '../../components/ui'
import { resumoCompra } from '../../lib/compras'
import { moeda } from '../../lib/format'
import { dataBr, mensagemDe, nomeMes } from '../financeiro/util'
import { useCompras, useItensCompra, type Compra } from './api'

/**
 * Área Compras. "Comprar" (/compras): as compras em andamento, para continuar no mercado.
 * "Histórico" (/compras/historico): as finalizadas, com o total gasto por mês.
 */
export default function ComprasPage({ historico = false }: { historico?: boolean }) {
  const navegar = useNavigate()
  const { data: compras, isLoading, isError, error, refetch } = useCompras()

  const abertas = (compras ?? []).filter((c) => c.status === 'aberta')
  const finalizadas = (compras ?? []).filter((c) => c.status === 'finalizada')
  const porMes = useMemo(() => {
    const meses = new Map<string, Compra[]>()
    for (const c of finalizadas) meses.set(c.data.slice(0, 7), [...(meses.get(c.data.slice(0, 7)) ?? []), c])
    return [...meses]
  }, [finalizadas])

  if (isLoading) return <Carregando />
  if (isError) return <Erro mensagem={mensagemDe(error)} tentarDeNovo={() => refetch()} />

  if (historico) {
    return (
      <>
        <TituloPagina titulo="Histórico" subtitulo="Compras finalizadas" />
        {finalizadas.length === 0 ? (
          <Vazio
            titulo="Nenhuma compra finalizada"
            texto="Quando vocês finalizarem uma compra, ela aparece aqui com o total pago."
          />
        ) : (
          <div className="flex flex-col gap-6">
            {porMes.map(([mes, lista]) => (
              <section key={mes} className="flex flex-col gap-2">
                <h2 className="flex items-baseline justify-between gap-3 text-lg font-bold">
                  <span className="first-letter:uppercase">{nomeMes(mes)}</span>
                  <span className="text-base font-semibold text-suave">{moeda(lista.reduce((t, c) => t + (c.total ?? 0), 0))}</span>
                </h2>
                <ul className="divide-y divide-borda overflow-hidden rounded-2xl border border-borda bg-superficie">
                  {lista.map((c) => (
                    <li key={c.id}>
                      <Link to={`/compras/${c.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-marca-clara">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">{c.nome}</p>
                          <p className="truncate text-sm text-suave">{[dataBr(c.data), c.local].filter(Boolean).join(' · ')}</p>
                        </div>
                        <p className="shrink-0 font-bold">{c.total != null ? moeda(c.total) : '—'}</p>
                        <ChevronRight className="size-5 shrink-0 text-suave" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <TituloPagina titulo="Comprar" subtitulo="Lista do mercado, feita a dois" />
      {abertas.length === 0 ? (
        <Vazio
          titulo="Nenhuma compra em andamento"
          texto="Monte a lista com os seus insumos e façam a compra juntos, cada um no seu celular. O app guarda o preço pago de cada item: na próxima vez, você vê o último, o menor e o maior preço."
          acao={<Botao onClick={() => navegar('/compras/nova')}>Montar uma lista</Botao>}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {abertas.map((c) => (
            <li key={c.id}>
              <CartaoAberta compra={c} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** Compra aberta: busca os itens só dela para mostrar o andamento e o total até agora. */
function CartaoAberta({ compra: c }: { compra: Compra }) {
  const { data: itens } = useItensCompra(c.id)
  const resumo = itens ? resumoCompra(itens) : null
  const pct = resumo && resumo.itens > 0 ? Math.round((resumo.feitos / resumo.itens) * 100) : 0

  return (
    <Link
      to={`/compras/${c.id}`}
      className="flex min-h-16 flex-col gap-2 rounded-2xl border border-borda bg-superficie px-4 py-3 shadow-sm active:bg-marca-clara"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-marca-clara text-marca">
          <ShoppingCart className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{c.nome}</p>
          <p className="truncate text-sm text-suave">{[dataBr(c.data), c.local].filter(Boolean).join(' · ')}</p>
        </div>
        {resumo && resumo.total > 0 && <p className="shrink-0 font-bold text-marca">{moeda(resumo.total)}</p>}
        <ChevronRight className="size-5 shrink-0 text-suave" aria-hidden />
      </div>
      {resumo && (
        <div className="flex flex-col gap-1">
          <div className="h-2 overflow-hidden rounded-full bg-creme" aria-hidden>
            <div className="h-full rounded-full bg-marca transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-sm text-suave">
            {resumo.itens === 0
              ? 'Lista vazia'
              : `${resumo.feitos} de ${resumo.itens} ${resumo.itens === 1 ? 'item' : 'itens'}`}
          </p>
        </div>
      )}
    </Link>
  )
}
