import { ClipboardCheck, Minus, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAviso } from '../../components/Aviso'
import { Botao, Carregando, Erro, Vazio } from '../../components/ui'
import type { ItemTipo } from '../../lib/estoque'
import { Voltar } from '../financeiro/componentes/Comum'
import { dataBr, mensagemDe } from '../financeiro/util'
import { useInsumos } from '../insumos/api'
import { useReceitas } from '../receitas/api'
import { ROTULO_ORIGEM, useMovimentos, useRemoverMovimento, useRestaurarMovimento, useSaldos, type Movimento } from './api'
import { FolhaMovimento, type ModoFolha } from './componentes/FolhaMovimento'
import { itemDeInsumo, itemDeReceita, textoEmbalagens, textoQtdItem, textoSaldo, textoVariacao, type ItemEstoque } from './componentes/itens'
import { DICA_NEGATIVO, SeloSituacao } from './componentes/SeloSituacao'

// Um item do estoque: quanto tem, contar / saída / entrada e o histórico de movimentos.
// Rotas: /estoque/insumo/:id e /estoque/preparado/:id.

export default function ItemEstoquePage({ tipo: tipoProp }: { tipo?: ItemTipo }) {
  const { id } = useParams()
  const { pathname } = useLocation()
  const tipo: ItemTipo = tipoProp ?? (pathname.includes('/estoque/preparado/') ? 'receita' : 'insumo')

  const insumos = useInsumos()
  const receitas = useReceitas()
  const saldos = useSaldos()
  const movimentos = useMovimentos()

  const item = useMemo<ItemEstoque | null>(() => {
    if (!id) return null
    if (tipo === 'insumo') {
      const i = insumos.data?.find((x) => x.id === id)
      return i ? itemDeInsumo(i, saldos.data?.insumos[id]) : null
    }
    const r = receitas.data?.find((x) => x.id === id)
    return r ? itemDeReceita(r, saldos.data?.receitas[id]) : null
  }, [id, tipo, insumos.data, receitas.data, saldos.data])

  const carregando = (tipo === 'insumo' ? insumos.isLoading : receitas.isLoading) || movimentos.isLoading
  const erro = (tipo === 'insumo' ? insumos.error : receitas.error) ?? movimentos.error

  if (carregando) return <Carregando />
  if (erro)
    return (
      <Erro
        mensagem={mensagemDe(erro)}
        tentarDeNovo={() => {
          insumos.refetch()
          receitas.refetch()
          movimentos.refetch()
        }}
      />
    )
  if (!item)
    return (
      <>
        <Voltar padrao="/estoque" />
        <Vazio
          titulo="Item não encontrado"
          texto="Ele pode ter sido apagado."
          acao={
            <Link to="/estoque" className="inline-flex min-h-12 items-center rounded-2xl bg-marca px-5 font-semibold text-white">
              Ver o estoque
            </Link>
          }
        />
      </>
    )

  return <Detalhe item={item} movimentos={movimentos.data ?? []} />
}

function Detalhe({ item, movimentos }: { item: ItemEstoque; movimentos: Movimento[] }) {
  const avisar = useAviso()
  const remover = useRemoverMovimento()
  const restaurar = useRestaurarMovimento()
  const [folha, setFolha] = useState<ModoFolha | null>(null)

  const doItem = useMemo(
    () =>
      movimentos
        .filter((m) => (item.tipo === 'insumo' ? m.insumo_id === item.id : m.receita_id === item.id))
        .sort((a, b) => (a.data === b.data ? b.criado_em.localeCompare(a.criado_em) : b.data.localeCompare(a.data))),
    [movimentos, item.tipo, item.id],
  )

  async function apagar(m: Movimento) {
    try {
      await remover.mutateAsync(m.id)
      avisar({ texto: `Lançamento apagado (${ROTULO_ORIGEM[m.origem].toLowerCase()})`, desfazer: () => restaurar.mutate(m) })
    } catch (e) {
      avisar({ texto: `Não deu para apagar: ${mensagemDe(e)}` })
    }
  }

  const pacotes = textoEmbalagens(item)
  const editar = item.tipo === 'insumo' ? `/insumos/${item.id}` : `/receitas/${item.id}`

  return (
    <>
      <Voltar padrao="/estoque" />

      <header className="mb-4">
        <p className="text-sm font-medium text-suave">{item.tipo === 'insumo' ? 'Insumo' : 'Preparado'}</p>
        <h1 className="text-2xl font-bold break-words">{item.nome}</h1>
      </header>

      <section className="mb-4 rounded-2xl border border-borda bg-superficie p-4" aria-label="Quanto tem">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-suave">Tem agora</p>
            <p className={`text-4xl font-bold ${item.saldo < 0 ? 'text-perigo' : item.saldo === 0 ? 'text-suave' : 'text-tinta'}`}>{textoSaldo(item)}</p>
            {pacotes && <p className="text-suave">{pacotes}</p>}
          </div>
          <SeloSituacao situacao={item.situacao} className="mt-1" />
        </div>
        <p className="mt-3 border-t border-borda pt-3 text-suave">
          {item.minimo != null ? (
            <>
              Mínimo: <strong className="text-tinta">{textoQtdItem(item.minimo, item)}</strong>
            </>
          ) : (
            <>
              Sem mínimo definido.{' '}
              <Link to={editar} className="font-semibold text-marca underline">
                Definir
              </Link>
            </>
          )}
        </p>
        {item.situacao === 'negativo' && <p className="mt-2 rounded-xl bg-laranja-clara px-3 py-2 text-tinta">{DICA_NEGATIVO}</p>}
      </section>

      <div className="mb-6 grid grid-cols-3 gap-2">
        <Botao variante="secundario" className="flex-col gap-1 px-2 py-2" onClick={() => setFolha('contar')}>
          <ClipboardCheck className="size-6" aria-hidden />
          Contar
        </Botao>
        <Botao variante="secundario" className="flex-col gap-1 px-2 py-2" onClick={() => setFolha('saida')}>
          <Minus className="size-6" aria-hidden />
          Saída
        </Botao>
        <Botao variante="secundario" className="flex-col gap-1 px-2 py-2" onClick={() => setFolha('entrada')}>
          <Plus className="size-6" aria-hidden />
          Entrada
        </Botao>
      </div>

      <h2 className="mb-2 text-lg font-bold">Histórico</h2>
      {doItem.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-borda bg-superficie px-4 py-6 text-center text-suave">
          Nada registrado ainda. Comece tocando em <strong>Contar</strong>.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-borda rounded-2xl border border-borda bg-superficie">
          {doItem.map((m) => (
            <LinhaMovimento key={m.id} m={m} item={item} aoApagar={() => apagar(m)} apagando={remover.isPending && remover.variables === m.id} />
          ))}
        </ul>
      )}

      <Link
        to={editar}
        className="mt-6 flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 font-semibold text-marca active:bg-marca-clara"
      >
        <Pencil className="size-5" aria-hidden />
        {item.tipo === 'insumo' ? 'Editar insumo' : 'Editar receita'}
      </Link>

      {folha && <FolhaMovimento key={folha} modo={folha} item={item} movimentos={movimentos} aoFechar={() => setFolha(null)} />}
    </>
  )
}

function LinhaMovimento({ m, item, aoApagar, apagando }: { m: Movimento; item: ItemEstoque; aoApagar: () => void; apagando: boolean }) {
  // Baixa de uma venda do PDV ou da entrega de um pedido: sai do estoque junto com elas (cancelando
  // a venda ou desfazendo a entrega, ela volta). Por isso não se apaga aqui.
  const manual = !m.producao_id && !m.compra_id && !m.venda_id && !m.pedido_id
  const rotulo = m.pedido_id ? 'Pedido entregue' : ROTULO_ORIGEM[m.origem]
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {rotulo} <span className="font-normal text-suave">· {dataBr(m.data)}</span>
        </p>
        {m.observacao && <p className="break-words text-suave">{m.observacao}</p>}
        {m.feito_por && <p className="text-sm text-suave">por {m.feito_por}</p>}
        {m.producao_id && (
          <Link to="/producao" className="inline-flex min-h-11 items-center font-semibold text-marca underline">
            ver produção
          </Link>
        )}
        {m.compra_id && (
          <Link to={`/compras/${m.compra_id}`} className="inline-flex min-h-11 items-center font-semibold text-marca underline">
            ver compra
          </Link>
        )}
        {m.pedido_id && (
          <Link to={`/vendas/pedidos/${m.pedido_id}`} className="inline-flex min-h-11 items-center font-semibold text-marca underline">
            ver pedido
          </Link>
        )}
        {m.venda_id && (
          <Link to={`/vendas/dia?data=${m.data}`} className="inline-flex min-h-11 items-center font-semibold text-marca underline">
            ver vendas do dia
          </Link>
        )}
      </div>
      <p className={`shrink-0 pt-0.5 font-bold ${m.quantidade < 0 ? 'text-perigo' : 'text-ok'}`}>{textoVariacao(m.quantidade, item)}</p>
      {manual && (
        <button
          type="button"
          onClick={aoApagar}
          disabled={apagando}
          aria-label={`Apagar ${rotulo.toLowerCase()} de ${dataBr(m.data)}`}
          className="-my-1 -mr-2 flex size-12 shrink-0 items-center justify-center rounded-xl text-suave active:bg-perigo-claro active:text-perigo disabled:opacity-50"
        >
          <Trash2 className="size-5" aria-hidden />
        </button>
      )}
    </li>
  )
}
