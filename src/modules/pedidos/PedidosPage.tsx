import { AlertTriangle, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Busca, Carregando, Erro, Pilulas, TituloPagina, Vazio } from '../../components/ui'
import { moeda } from '../../lib/format'
import { ROTULO_GRUPO, agruparAgenda } from '../../lib/pedidos'
import { hoje as hojeFin } from '../financeiro/api'
import { mensagemDe, simplificar } from '../financeiro/util'
import { usePedidos, type Pedido } from './api'
import { SeloStatus, TipoEntregaRotulo, momento, quandoEntrega, resumoItensPedido } from './componentes/PedidoEtiquetas'
import { PedidoProduzir } from './componentes/PedidoProduzir'

// Pedidos (encomendas): a agenda do que está em aberto, o que produzir, e o histórico de
// entregues e cancelados. A situação do pagamento fica na tela de cada pedido (aqui seria uma
// consulta por pedido).

type Aba = 'aberto' | 'entregues' | 'cancelados'

const ABAS: Aba[] = ['aberto', 'entregues', 'cancelados']

const classeBotaoLink =
  'inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-2xl bg-marca px-4 font-semibold text-white shadow-sm active:bg-marca-escura'

export default function PedidosPage() {
  const pedidos = usePedidos()
  const [params, setParams] = useSearchParams()
  const [busca, setBusca] = useState('')
  const dia = hojeFin()
  // A aba vai no endereço: ao voltar de um pedido, continua onde estava.
  const pedida = params.get('aba') as Aba | null
  const aba: Aba = pedida && ABAS.includes(pedida) ? pedida : 'aberto'

  function mudarAba(a: Aba) {
    const p = new URLSearchParams(params)
    if (a === 'aberto') p.delete('aba')
    else p.set('aba', a)
    setParams(p, { replace: true })
  }

  const lista = useMemo(() => pedidos.data ?? [], [pedidos.data])
  const abertos = useMemo(() => lista.filter((p) => p.status === 'confirmado' || p.status === 'pronto'), [lista])
  const termo = simplificar(busca)
  const filtrar = (ps: Pedido[]) =>
    termo ? ps.filter((p) => simplificar([p.cliente_nome, p.telefone ?? '', ...p.itens.map((i) => i.nome)].join(' ')).includes(termo)) : ps

  const agenda = agruparAgenda(filtrar(abertos), dia)
  const entregues = filtrar(lista.filter((p) => p.status === 'entregue')).sort((a, b) => (b.entregue_em ?? '').localeCompare(a.entregue_em ?? ''))
  const cancelados = filtrar(lista.filter((p) => p.status === 'cancelado')).sort((a, b) => b.atualizado_em.localeCompare(a.atualizado_em))

  const novo = (
    <Link to="/vendas/pedidos/novo" className={classeBotaoLink}>
      <Plus className="size-5" aria-hidden />
      Novo pedido
    </Link>
  )

  return (
    <>
      <TituloPagina titulo="Pedidos" acao={novo} />
      <div className="flex flex-col gap-4 pb-8">
        <Pilulas
          rotulo="Quais pedidos"
          valor={aba}
          aoMudar={mudarAba}
          opcoes={[
            { valor: 'aberto', rotulo: abertos.length > 0 ? `Em aberto (${abertos.length})` : 'Em aberto' },
            { valor: 'entregues', rotulo: 'Entregues' },
            { valor: 'cancelados', rotulo: 'Cancelados' },
          ]}
        />
        <Busca valor={busca} aoMudar={setBusca} placeholder="Buscar cliente ou item" />

        {pedidos.isError && !pedidos.data ? (
          <Erro mensagem={mensagemDe(pedidos.error)} tentarDeNovo={() => void pedidos.refetch()} />
        ) : pedidos.isLoading || !pedidos.data ? (
          <Carregando />
        ) : aba === 'aberto' ? (
          <>
            {abertos.length > 0 && !termo && <PedidoProduzir pedidos={abertos} hoje={dia} />}
            {agenda.length === 0 ? (
              termo ? (
                <Vazio titulo="Nada encontrado" texto="Nenhum pedido em aberto com esse nome." />
              ) : (
                <Vazio titulo="Nenhum pedido em aberto" texto="As encomendas anotadas aparecem aqui, por data de entrega." acao={novo} />
              )
            ) : (
              agenda.map(({ grupo, pedidos: ps }) => {
                const atrasado = grupo === 'atrasado'
                return (
                  <section key={grupo} className="flex flex-col gap-2">
                    <h2 className={`flex items-center gap-2 text-lg font-bold ${atrasado ? 'text-perigo' : ''}`}>
                      {atrasado && <AlertTriangle className="size-5" aria-hidden />}
                      {ROTULO_GRUPO[grupo]}
                      <span className={`text-base font-medium ${atrasado ? '' : 'text-suave'}`}>· {ps.length}</span>
                    </h2>
                    {atrasado && <p className="-mt-1 text-sm text-perigo">A data de entrega já passou. Entregue ou cancele.</p>}
                    <ul className="flex flex-col gap-2">
                      {ps.map((p) => (
                        <li key={p.id}>
                          <CartaoPedido pedido={p} atrasado={atrasado} />
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              })
            )}
          </>
        ) : (
          <Historico pedidos={aba === 'entregues' ? entregues : cancelados} aba={aba} buscando={!!termo} />
        )}
      </div>
    </>
  )
}

function Historico({ pedidos, aba, buscando }: { pedidos: Pedido[]; aba: 'entregues' | 'cancelados'; buscando: boolean }) {
  if (pedidos.length === 0)
    return buscando ? (
      <Vazio titulo="Nada encontrado" />
    ) : (
      <Vazio titulo={aba === 'entregues' ? 'Nenhum pedido entregue ainda' : 'Nenhum pedido cancelado'} />
    )
  return (
    <ul className="flex flex-col gap-2">
      {pedidos.map((p) => (
        <li key={p.id}>
          <CartaoPedido pedido={p} />
        </li>
      ))}
    </ul>
  )
}

function CartaoPedido({ pedido: p, atrasado = false }: { pedido: Pedido; atrasado?: boolean }) {
  const cancelado = p.status === 'cancelado'
  return (
    <Link
      to={`/vendas/pedidos/${p.id}`}
      className={`flex flex-col gap-1 rounded-2xl border bg-superficie px-4 py-3 active:bg-marca-clara ${
        atrasado ? 'border-2 border-perigo/50' : 'border-borda'
      }`}
    >
      <span className="flex items-start justify-between gap-3">
        <span className={`font-semibold ${atrasado ? 'text-perigo' : 'text-suave'}`}>
          {p.status === 'entregue' && p.entregue_em ? `Entregue ${momento(p.entregue_em)}` : quandoEntrega(p)}
        </span>
        <SeloStatus status={p.status} />
      </span>
      <span className={`text-lg leading-snug font-bold break-words ${cancelado ? 'line-through opacity-70' : ''}`}>{p.cliente_nome}</span>
      <span className="line-clamp-2 break-words text-[15px]">{resumoItensPedido(p.itens)}</span>
      <span className="mt-1 flex items-center justify-between gap-3 text-sm text-suave">
        <TipoEntregaRotulo tipo={p.entrega_tipo} />
        <span className="text-base font-bold text-tinta">{moeda(p.total)}</span>
      </span>
      {cancelado && p.motivo_cancelamento && (
        <span className="text-sm font-medium text-perigo">Motivo: {p.motivo_cancelamento}</span>
      )}
    </Link>
  )
}
