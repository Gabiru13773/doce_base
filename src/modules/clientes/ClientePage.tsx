import { ArrowLeft, AtSign, ChevronRight, MapPin, MessageCircle, Pencil, Phone, Plus, StickyNote } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BarraAcao, Carregando, Cartao, Erro, TituloPagina, Vazio } from '../../components/ui'
import { itensMaisPedidos, resumoCliente, usuarioInstagram } from '../../lib/clientes'
import { moeda, numero } from '../../lib/format'
import { STATUS_PEDIDO, linkWhatsapp, type ItemPedido, type StatusPedido } from '../../lib/pedidos'
import { dataBr, mensagemDe } from '../financeiro/util'
import { useClientes, usePedidos, type Cliente, type Pedido } from '../pedidos/api'

// Ficha do cliente: contato, números (pedidos, quanto gastou), o que mais pede e o histórico.

const classeAcao =
  'inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-borda bg-superficie px-4 font-semibold text-marca active:bg-marca-clara'

const COR_STATUS: Record<StatusPedido, string> = {
  confirmado: 'bg-marca-clara text-marca',
  pronto: 'bg-alerta-claro text-alerta',
  entregue: 'bg-ok-claro text-ok',
  cancelado: 'bg-perigo-claro text-perigo',
}

function SeloStatus({ status }: { status: StatusPedido }) {
  const rotulo = STATUS_PEDIDO.find((s) => s.valor === status)?.rotulo ?? status
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${COR_STATUS[status]}`}>{rotulo}</span>
}

/** "2× Bolo de cenoura, 25× Brigadeiro" */
function resumoItens(itens: ItemPedido[]): string {
  return itens.map((i) => `${numero(i.qtd, 3)}× ${i.nome}`).join(', ')
}

export default function ClientePage() {
  const { id } = useParams()
  const clientes = useClientes()
  const pedidos = usePedidos()

  const doCliente = useMemo(
    () =>
      (pedidos.data ?? [])
        .filter((p) => p.cliente_id === id)
        .sort((a, b) => b.entrega_data.localeCompare(a.entrega_data) || b.criado_em.localeCompare(a.criado_em)),
    [pedidos.data, id],
  )

  const consultas = [clientes, pedidos]
  const comErro = consultas.find((c) => c.isError)
  if (comErro) return <Erro mensagem={mensagemDe(comErro.error)} tentarDeNovo={() => consultas.forEach((c) => void c.refetch())} />
  if (consultas.some((c) => c.isPending)) return <Carregando />

  const cliente = (clientes.data ?? []).find((c) => c.id === id)
  if (!cliente) {
    return (
      <>
        <Voltar />
        <Vazio
          titulo="Cliente não encontrado"
          texto="Ele pode ter sido apagado."
          acao={
            <Link to="/vendas/clientes" className="inline-flex min-h-12 items-center rounded-2xl px-5 font-semibold text-marca active:bg-marca-clara">
              Ver todos os clientes
            </Link>
          }
        />
      </>
    )
  }

  return <Ficha cliente={cliente} pedidos={doCliente} />
}

function Voltar() {
  return (
    <Link to="/vendas/clientes" className="-ml-2 mb-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-suave active:bg-marca-clara">
      <ArrowLeft className="size-5" aria-hidden />
      Clientes
    </Link>
  )
}

function Ficha({ cliente: c, pedidos }: { cliente: Cliente; pedidos: Pedido[] }) {
  const resumo = resumoCliente(pedidos)
  const favoritos = itensMaisPedidos(pedidos)
  const primeiroNome = c.nome.trim().split(/\s+/)[0] ?? ''
  const whats = linkWhatsapp(c.telefone, `Olá, ${primeiroNome}!`)
  const insta = usuarioInstagram(c.instagram)
  const tel = (c.telefone ?? '').replace(/[^\d+]/g, '')

  return (
    <div className="flex flex-col gap-5 pb-24">
      <div>
        <Voltar />
        <TituloPagina
          titulo={c.nome}
          subtitulo={c.telefone ?? undefined}
          acao={
            <Link
              to={`/vendas/clientes/${c.id}/editar`}
              className="inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-2xl border border-borda bg-superficie px-4 font-semibold text-marca active:bg-marca-clara"
            >
              <Pencil className="size-4" aria-hidden />
              Editar
            </Link>
          }
        />
      </div>

      {(tel || whats) && (
        <div className="flex gap-3">
          {tel && (
            <a href={`tel:${tel}`} className={classeAcao}>
              <Phone className="size-5" aria-hidden />
              Ligar
            </a>
          )}
          {whats && (
            <a href={whats} target="_blank" rel="noreferrer" className={classeAcao}>
              <MessageCircle className="size-5" aria-hidden />
              WhatsApp
            </a>
          )}
        </div>
      )}

      {(insta || c.endereco || c.observacao) && (
        <Cartao className="flex flex-col gap-3">
          {insta && (
            <a
              href={`https://instagram.com/${encodeURIComponent(insta)}`}
              target="_blank"
              rel="noreferrer"
              className="-mx-2 flex min-h-11 items-center gap-3 rounded-xl px-2 font-semibold text-marca active:bg-marca-clara"
            >
              <AtSign className="size-5 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{insta}</span>
            </a>
          )}
          {c.endereco && (
            <p className="flex items-start gap-3">
              <MapPin className="mt-0.5 size-5 shrink-0 text-suave" aria-hidden />
              <span className="min-w-0 break-words whitespace-pre-line">{c.endereco}</span>
            </p>
          )}
          {c.observacao && (
            <p className="flex items-start gap-3 rounded-xl bg-alerta-claro p-3">
              <StickyNote className="mt-0.5 size-5 shrink-0 text-alerta" aria-hidden />
              <span className="min-w-0 break-words whitespace-pre-line">{c.observacao}</span>
            </p>
          )}
        </Cartao>
      )}

      <dl className="grid grid-cols-2 gap-3">
        <Numero rotulo="Pedidos" valor={String(resumo.pedidos)} />
        <Numero rotulo="Total gasto" valor={moeda(resumo.totalGasto)} ajuda="pedidos entregues" />
        <Numero rotulo="Ticket médio" valor={resumo.entregues > 0 ? moeda(resumo.ticketMedio) : '—'} />
        <Numero rotulo="Último pedido" valor={resumo.ultimoPedido ? dataBr(resumo.ultimoPedido) : '—'} />
      </dl>

      {favoritos.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">O que mais pede</h2>
          <ol className="divide-y divide-borda overflow-hidden rounded-2xl border border-borda bg-superficie">
            {favoritos.map((f, i) => (
              <li key={f.chave} className="flex min-h-12 items-center gap-3 px-4 py-2.5">
                <span className="w-5 shrink-0 font-bold text-suave">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate">{f.nome}</span>
                <span className="shrink-0 font-semibold tabular-nums">{numero(f.qtd, 3)}×</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-bold">Pedidos</h2>
        {pedidos.length === 0 ? (
          <Vazio titulo="Nenhum pedido ainda" texto={`Os pedidos de ${primeiroNome} vão aparecer aqui.`} />
        ) : (
          <ul className="divide-y divide-borda overflow-hidden rounded-2xl border border-borda bg-superficie">
            {pedidos.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/vendas/pedidos/${p.id}`}
                  className={`flex min-h-16 items-center gap-3 px-4 py-3 active:bg-marca-clara ${p.status === 'cancelado' ? 'opacity-60' : ''}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold">{dataBr(p.entrega_data)}</span>
                      <SeloStatus status={p.status} />
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-sm text-suave">{resumoItens(p.itens) || 'Sem itens'}</span>
                  </span>
                  <span className="shrink-0 font-bold tabular-nums">{moeda(p.total)}</span>
                  <ChevronRight className="size-5 shrink-0 text-suave" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <BarraAcao>
        <Link
          to={`/vendas/pedidos/novo?cliente=${encodeURIComponent(c.id)}`}
          className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-marca px-5 font-semibold text-white shadow-sm active:bg-marca-escura"
        >
          <Plus className="size-5" aria-hidden />
          Novo pedido
        </Link>
      </BarraAcao>
    </div>
  )
}

function Numero({ rotulo, valor, ajuda }: { rotulo: string; valor: string; ajuda?: string }) {
  return (
    <div className="rounded-2xl border border-borda bg-superficie p-4">
      <dt className="text-sm text-suave">{rotulo}</dt>
      <dd className="mt-0.5 text-xl font-bold tabular-nums">{valor}</dd>
      {ajuda && <dd className="text-xs text-suave">{ajuda}</dd>}
    </div>
  )
}
