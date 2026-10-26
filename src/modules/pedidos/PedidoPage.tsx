import { AlertTriangle, CheckCircle2, MapPin, MessageCircle, Pencil, Phone, RotateCcw, Trash2, Undo2, XCircle } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAviso } from '../../components/Aviso'
import { BarraAcao, Botao, Carregando, Cartao, Erro, Vazio } from '../../components/ui'
import { novoId } from '../../lib/db'
import { moeda, numero } from '../../lib/format'
import { itemPagamentoPedido, linkWhatsapp, mensagemPedido, situacaoPagamento } from '../../lib/pedidos'
import { CONFIG_PDV_PADRAO, baixaEstoqueVenda, taxasVenda } from '../../lib/vendas'
import { lerMeuNome } from '../compras/api'
import type { DadosMovimento } from '../estoque/api'
import { hoje } from '../financeiro/api'
import { Voltar } from '../financeiro/componentes/Comum'
import { diaPorExtenso, mensagemDe } from '../financeiro/util'
import { useProdutos } from '../produtos/api'
import { useConfigPdv, useRegistrarVenda, useVendasDoPedido, type DadosVenda } from '../vendas/api'
import { FolhaCobrar, type ResultadoCobranca } from '../vendas/componentes/Cobrar'
import {
  useApagarPedido,
  useDesfazerEntrega,
  useEntregarPedido,
  useMarcarPronto,
  usePedidos,
  useReabrirPedido,
  type Pedido,
} from './api'
import { FolhaReceber } from './componentes/FolhaReceber'
import { FotosPedido } from './componentes/FotosPedido'
import { PagamentosPedido } from './componentes/PagamentosPedido'
import { SeloStatus, TipoEntregaRotulo, momento } from './componentes/PedidoEtiquetas'
import { FolhaCancelarPedido, FolhaConfirmarPedido } from './componentes/PedidoFolhas'

// Um pedido: tudo o que foi combinado, os pagamentos (cada um é uma venda do PDV, que entra no
// caixa do dia) e as ações (pronto, entregar, cancelar). Para entregar precisa estar quitado:
// se falta algo, recebe o restante primeiro e entrega em seguida.

const VOLTAR = '/vendas/pedidos'

const classeLink =
  'inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-borda bg-superficie px-4 font-semibold text-marca active:bg-marca-clara'
const classeLinkDesligado =
  'inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-borda bg-superficie px-4 font-semibold text-marca opacity-50'

export default function PedidoPage() {
  const { id } = useParams()
  const pedidos = usePedidos()
  const pedido = pedidos.data?.find((p) => p.id === id)

  if (!pedido) {
    if (pedidos.isError)
      return (
        <>
          <Voltar padrao={VOLTAR} />
          <Erro mensagem={mensagemDe(pedidos.error)} tentarDeNovo={() => void pedidos.refetch()} />
        </>
      )
    // Pode ter sido criado em outro aparelho há pouco: espera a lista nova antes de dizer que não existe.
    if (pedidos.isLoading || pedidos.isFetching) return <Carregando />
    return (
      <>
        <Voltar padrao={VOLTAR} />
        <Vazio
          titulo="Pedido não encontrado"
          texto="Ele pode ter sido apagado."
          acao={
            <Link to={VOLTAR} className="font-semibold text-marca underline">
              Ver pedidos
            </Link>
          }
        />
      </>
    )
  }
  return <TelaPedido key={pedido.id} pedido={pedido} />
}

type Etapa =
  | { tipo: 'valor' }
  | { tipo: 'cobrar'; valor: number; vendaId: string; entregarDepois: boolean }
  | { tipo: 'entregar' }
  | { tipo: 'desfazer' }
  | { tipo: 'cancelar' }
  | { tipo: 'apagar' }

function TelaPedido({ pedido }: { pedido: Pedido }) {
  const avisar = useAviso()
  const navegar = useNavigate()
  const vendas = useVendasDoPedido(pedido.id)
  const config = useConfigPdv()
  const produtos = useProdutos()
  const registrar = useRegistrarVenda()
  const marcar = useMarcarPronto()
  const entregarM = useEntregarPedido()
  const desfazer = useDesfazerEntrega()
  const reabrir = useReabrirPedido()
  const apagar = useApagarPedido()

  const [etapa, setEtapa] = useState<Etapa | null>(null)
  const [erroVenda, setErroVenda] = useState<string | null>(null)
  const [erroAcao, setErroAcao] = useState<string | null>(null)

  const cfg = config.data ?? CONFIG_PDV_PADRAO
  const pagamentos = vendas.data ?? []
  const pagamentosCarregados = vendas.data !== undefined
  const situacao = situacaoPagamento(pedido.total, pagamentos)
  const nadaPago = situacao.pago <= 0
  const aberto = pedido.status === 'confirmado' || pedido.status === 'pronto'
  const atrasado = aberto && pedido.entrega_data < hoje()
  const temPagamento = pagamentos.some((v) => v.status === 'concluida')
  const whatsapp = linkWhatsapp(pedido.telefone, mensagemPedido(pedido, situacao.pago))
  const telefone = (pedido.telefone ?? '').replace(/[^\d+]/g, '')

  function fechar() {
    setEtapa(null)
    setErroVenda(null)
  }

  function cobrar(valor: number, entregarDepois: boolean) {
    setErroAcao(null)
    setErroVenda(null)
    // id gerado uma vez: confirmar de novo depois de um erro não duplica o pagamento
    setEtapa({ tipo: 'cobrar', valor, vendaId: novoId(), entregarDepois })
  }

  function concluirPagamento(e: Extract<Etapa, { tipo: 'cobrar' }>, r: ResultadoCobranca) {
    const data = hoje()
    const agora = new Date().toISOString()
    // Pagar tudo de uma vez não é "sinal"; o que quita depois de um sinal é o "restante".
    const tipo = e.valor >= situacao.falta ? (nadaPago ? 'pagamento' : 'restante') : nadaPago ? 'sinal' : 'pagamento'
    const venda: DadosVenda = {
      id: e.vendaId,
      data,
      canal: pedido.canal,
      cliente: pedido.cliente_nome,
      itens: [itemPagamentoPedido(pedido, e.valor, tipo)],
      pagamentos: r.pagamentos,
      subtotal: e.valor,
      desconto: 0,
      total: e.valor,
      troco: r.troco,
      taxas: taxasVenda(r.pagamentos, cfg),
      status: 'concluida',
      motivo_cancelamento: null,
      fechamento_id: null,
      pedido_id: pedido.id,
      feito_por: lerMeuNome() || null,
      observacao: r.observacao.trim() || null,
      criado_em: agora,
    }
    try {
      // sem baixa no estoque aqui: ela acontece na entrega
      registrar(venda, [])
    } catch (erro) {
      // conferência final (ver useRegistrarVenda): a folha continua aberta com a mensagem
      setErroVenda(mensagemDe(erro))
      return
    }
    fechar()
    const recebido = `Recebido ${moeda(e.valor)}${r.troco > 0 ? ` · troco ${moeda(r.troco)}` : ''}`
    if (e.entregarDepois) void entregar(recebido)
    else avisar({ texto: `${recebido} ✓` })
  }

  async function entregar(recebido?: string) {
    setErroAcao(null)
    if (!produtos.data) {
      setErroAcao(`${recebido ? `${recebido}. ` : ''}Os produtos ainda não carregaram para dar baixa no estoque. Tente entregar de novo.`)
      return
    }
    const data = hoje()
    const feitoPor = lerMeuNome() || null
    const itens = pedido.itens.flatMap((i) =>
      i.produto_id && i.variacao_id ? [{ produto_id: i.produto_id, variacao_id: i.variacao_id, qtd: i.qtd }] : [],
    )
    const movimentos: DadosMovimento[] = baixaEstoqueVenda(itens, produtos.data).map((b) => ({
      id: novoId(),
      data,
      item_tipo: b.item_tipo,
      insumo_id: b.insumo_id,
      receita_id: b.receita_id,
      quantidade: b.quantidade,
      origem: 'venda',
      producao_id: null,
      compra_id: null,
      venda_id: null,
      pedido_id: pedido.id,
      observacao: null,
      feito_por: feitoPor,
    }))
    try {
      await entregarM.mutateAsync({ pedido, movimentos })
      setEtapa(null)
      avisar({ texto: `${recebido ? `${recebido} · ` : ''}Pedido entregue ✓` })
    } catch (erro) {
      // na folha de confirmar, a mensagem aparece nela; depois do pagamento, aparece na tela
      if (recebido) setErroAcao(`${recebido}, mas a entrega não foi registrada: ${mensagemDe(erro)}`)
    }
  }

  function aoTocarEntregar() {
    setErroAcao(null)
    entregarM.reset()
    if (situacao.falta > 0) cobrar(situacao.falta, true)
    else setEtapa({ tipo: 'entregar' })
  }

  function alternarPronto() {
    setErroAcao(null)
    const pronto = pedido.status !== 'pronto'
    marcar.mutate(
      { pedido, pronto },
      {
        onSuccess: () => avisar({ texto: pronto ? 'Marcado como pronto ✓' : 'Voltou para confirmado' }),
        onError: (e) => setErroAcao(mensagemDe(e)),
      },
    )
  }

  function reabrirPedido() {
    setErroAcao(null)
    reabrir.mutate(pedido, {
      onSuccess: () => avisar({ texto: 'Pedido reaberto ✓' }),
      onError: (e) => setErroAcao(mensagemDe(e)),
    })
  }

  async function desfazerEntrega() {
    try {
      await desfazer.mutateAsync(pedido)
      setEtapa(null)
      avisar({ texto: 'Entrega desfeita. O pedido voltou para "Pronto".' })
    } catch {
      // aparece na folha
    }
  }

  async function apagarPedido() {
    try {
      await apagar.mutateAsync({ pedido, pagamentos })
      avisar({ texto: 'Pedido apagado' })
      navegar(VOLTAR, { replace: true })
    } catch {
      // aparece na folha
    }
  }

  const botaoReceber =
    aberto && situacao.falta > 0 ? (
      <Botao variante="secundario" className="w-full" onClick={() => setEtapa({ tipo: 'valor' })} disabled={!pagamentosCarregados}>
        {nadaPago ? 'Receber sinal' : 'Receber pagamento'}
      </Botao>
    ) : null

  return (
    <>
      <Voltar padrao={VOLTAR} />
      <div className={`flex flex-col gap-5 ${aberto || pedido.status === 'cancelado' ? 'pb-24' : 'pb-8'}`}>
        {/* Cabeçalho: cliente e contato */}
        <header className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold break-words">
                {pedido.cliente_id ? (
                  <Link to={`/vendas/clientes/${pedido.cliente_id}`} className="underline-offset-4 active:underline">
                    {pedido.cliente_nome}
                  </Link>
                ) : (
                  pedido.cliente_nome
                )}
              </h1>
              <p className="text-suave">
                {pedido.telefone || 'Sem telefone'} · {pedido.canal === 'balcao' ? 'Balcão' : 'WhatsApp/Insta'}
              </p>
            </div>
            <SeloStatus status={pedido.status} />
          </div>
          <div className="flex gap-3">
            {telefone ? (
              <a href={`tel:${telefone}`} className={classeLink}>
                <Phone className="size-5" aria-hidden />
                Ligar
              </a>
            ) : (
              <span className={classeLinkDesligado} aria-disabled="true">
                <Phone className="size-5" aria-hidden />
                Ligar
              </span>
            )}
            {whatsapp ? (
              <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={classeLink}>
                <MessageCircle className="size-5" aria-hidden />
                WhatsApp
              </a>
            ) : (
              <span className={classeLinkDesligado} aria-disabled="true" title="Sem telefone válido">
                <MessageCircle className="size-5" aria-hidden />
                WhatsApp
              </span>
            )}
          </div>
        </header>

        {erroAcao && (
          <p role="alert" className="rounded-2xl bg-perigo-claro px-4 py-3 font-medium text-perigo">
            {erroAcao}
          </p>
        )}

        {pedido.status === 'cancelado' && (
          <div className="rounded-2xl bg-perigo-claro px-4 py-3 text-perigo">
            <p className="flex items-center gap-2 font-bold">
              <XCircle className="size-5" aria-hidden />
              Pedido cancelado
            </p>
            {pedido.motivo_cancelamento && <p>Motivo: {pedido.motivo_cancelamento}</p>}
          </div>
        )}

        {/* Entrega e status */}
        <Cartao className="flex flex-col gap-2">
          {atrasado && (
            <p className="flex items-center gap-2 font-semibold text-perigo">
              <AlertTriangle className="size-5" aria-hidden />
              Atrasado: a data de entrega já passou
            </p>
          )}
          <p className="text-lg font-bold first-letter:uppercase">
            {diaPorExtenso(pedido.entrega_data, hoje())}
            {pedido.entrega_hora ? ` às ${pedido.entrega_hora}` : ''}
          </p>
          <p className="text-suave">
            <TipoEntregaRotulo tipo={pedido.entrega_tipo} />
          </p>
          {pedido.entrega_tipo !== 'retirada' && pedido.endereco && (
            <p className="flex items-start gap-1.5 break-words">
              <MapPin className="mt-0.5 size-4 shrink-0 text-suave" aria-hidden />
              {pedido.endereco}
            </p>
          )}
          {pedido.status === 'entregue' && pedido.entregue_em && (
            <p className="flex items-center gap-2 font-semibold text-ok">
              <CheckCircle2 className="size-5" aria-hidden />
              Entregue em {momento(pedido.entregue_em)}
            </p>
          )}
          {aberto && (
            <Botao variante="secundario" className="mt-1" onClick={alternarPronto} disabled={marcar.isPending}>
              {pedido.status === 'pronto' ? (
                <>
                  <Undo2 className="size-5" aria-hidden />
                  Voltar para confirmado
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-5" aria-hidden />
                  Marcar como pronto
                </>
              )}
            </Botao>
          )}
        </Cartao>

        {/* Itens */}
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">Itens</h2>
          <ul className="divide-y divide-borda rounded-2xl border border-borda bg-superficie">
            {pedido.itens.map((i) => (
              <li key={i.id} className="flex items-start gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold break-words">
                    {numero(i.qtd, 3)}x {i.nome}
                  </span>
                  {i.personalizacao && <span className="block break-words whitespace-pre-line text-[15px]">{i.personalizacao}</span>}
                  <span className="block text-sm text-suave">
                    {numero(i.qtd, 3)} × {moeda(i.preco)}
                    {!i.produto_id && ' · item avulso'}
                  </span>
                </span>
                <span className="shrink-0 font-semibold">{moeda(i.qtd * i.preco)}</span>
              </li>
            ))}
          </ul>
          <dl className="flex flex-col gap-1 px-1">
            {(pedido.desconto > 0 || pedido.taxa_entrega > 0) && <Linha rotulo="Itens">{moeda(pedido.subtotal)}</Linha>}
            {pedido.desconto > 0 && <Linha rotulo="Desconto">− {moeda(pedido.desconto)}</Linha>}
            {pedido.taxa_entrega > 0 && <Linha rotulo="Taxa de entrega">{moeda(pedido.taxa_entrega)}</Linha>}
            <Linha rotulo="Total" forte>
              {moeda(pedido.total)}
            </Linha>
          </dl>
        </section>

        {pedido.observacao && (
          <section className="flex flex-col gap-1">
            <h2 className="text-lg font-bold">Observação</h2>
            <p className="break-words whitespace-pre-line">{pedido.observacao}</p>
          </section>
        )}

        {pedido.fotos.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-bold">Fotos de referência</h2>
            <FotosPedido pedidoId={pedido.id} fotos={pedido.fotos} />
          </section>
        )}

        <PagamentosPedido
          vendas={vendas.data}
          carregando={vendas.isLoading}
          erro={vendas.error}
          tentarDeNovo={() => void vendas.refetch()}
          situacao={situacao}
          total={pedido.total}
          acao={botaoReceber}
        />

        {/* Outras ações */}
        <section className="flex flex-col gap-2">
          {aberto && (
            <>
              <Link to={`/vendas/pedidos/${pedido.id}/editar`} className={classeLink}>
                <Pencil className="size-5" aria-hidden />
                Editar pedido
              </Link>
              <Botao variante="perigo" onClick={() => setEtapa({ tipo: 'cancelar' })}>
                <XCircle className="size-5" aria-hidden />
                Cancelar pedido
              </Botao>
            </>
          )}
          {pedido.status === 'entregue' && (
            <Botao variante="secundario" onClick={() => setEtapa({ tipo: 'desfazer' })}>
              <Undo2 className="size-5" aria-hidden />
              Desfazer entrega
            </Botao>
          )}
          {pedido.status === 'cancelado' && pagamentosCarregados && !temPagamento && (
            <Botao variante="perigo" onClick={() => setEtapa({ tipo: 'apagar' })}>
              <Trash2 className="size-5" aria-hidden />
              Apagar pedido
            </Botao>
          )}
          {pedido.feito_por && <p className="text-center text-sm text-suave">Anotado por {pedido.feito_por}</p>}
        </section>
      </div>

      {aberto && (
        <BarraAcao>
          <Botao className="flex-1" onClick={aoTocarEntregar} disabled={!pagamentosCarregados || entregarM.isPending}>
            {entregarM.isPending ? 'Entregando…' : situacao.falta > 0 ? `Receber ${moeda(situacao.falta)} e entregar` : 'Entregar'}
          </Botao>
        </BarraAcao>
      )}
      {pedido.status === 'cancelado' && (
        <BarraAcao>
          <Botao variante="secundario" className="flex-1" onClick={reabrirPedido} disabled={reabrir.isPending}>
            <RotateCcw className="size-5" aria-hidden />
            {reabrir.isPending ? 'Reabrindo…' : 'Reabrir pedido'}
          </Botao>
        </BarraAcao>
      )}

      {etapa?.tipo === 'valor' && (
        <FolhaReceber
          total={pedido.total}
          pago={situacao.pago}
          falta={situacao.falta}
          pctSinal={cfg.pct_sinal}
          aoContinuar={(v) => cobrar(v, false)}
          aoFechar={fechar}
        />
      )}
      {etapa?.tipo === 'cobrar' && (
        <FolhaCobrar
          key={etapa.vendaId}
          total={etapa.valor}
          canal={pedido.canal}
          aoConfirmar={(r) => concluirPagamento(etapa, r)}
          aoFechar={fechar}
          erro={erroVenda}
        />
      )}
      {etapa?.tipo === 'entregar' && (
        <FolhaConfirmarPedido
          titulo="Entregar pedido"
          texto={`Confirma a entrega para ${pedido.cliente_nome}? O pagamento está quitado e os produtos do cardápio saem do estoque.`}
          botao="Entregar"
          pendente={entregarM.isPending}
          erro={entregarM.isError ? mensagemDe(entregarM.error) : null}
          aoConfirmar={() => void entregar()}
          aoFechar={fechar}
        />
      )}
      {etapa?.tipo === 'desfazer' && (
        <FolhaConfirmarPedido
          titulo="Desfazer entrega"
          texto='O pedido volta para "Pronto" e o que saiu do estoque volta. Os pagamentos continuam registrados.'
          botao="Desfazer entrega"
          pendente={desfazer.isPending}
          erro={desfazer.isError ? mensagemDe(desfazer.error) : null}
          aoConfirmar={() => void desfazerEntrega()}
          aoFechar={fechar}
        />
      )}
      {etapa?.tipo === 'apagar' && (
        <FolhaConfirmarPedido
          titulo="Apagar pedido"
          texto="O pedido some de vez, com as fotos. Não dá para desfazer."
          botao="Apagar"
          perigo
          pendente={apagar.isPending}
          erro={apagar.isError ? mensagemDe(apagar.error) : null}
          aoConfirmar={() => void apagarPedido()}
          aoFechar={fechar}
        />
      )}
      {etapa?.tipo === 'cancelar' && <FolhaCancelarPedido pedido={pedido} pago={situacao.pago} aoFechar={fechar} />}
    </>
  )
}

function Linha({ rotulo, forte = false, children }: { rotulo: string; forte?: boolean; children: ReactNode }) {
  return (
    <div className={`flex justify-between gap-3 ${forte ? 'text-lg font-bold' : 'text-suave'}`}>
      <dt>{rotulo}</dt>
      <dd>{children}</dd>
    </div>
  )
}
