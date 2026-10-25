import { AlertTriangle, ChevronUp, CloudUpload, Menu, PackageOpen, ShoppingBag } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { AvisoVendasPerdidas } from './componentes/AvisoVendasPerdidas'
import { Link } from 'react-router-dom'
import { useAviso } from '../../components/Aviso'
import { Botao, Busca, Carregando, Erro, Vazio } from '../../components/ui'
import { novoId } from '../../lib/db'
import { moeda } from '../../lib/format'
import { CANAIS, CONFIG_PDV_PADRAO, baixaEstoqueVenda, descontoPct, taxasVenda, totaisVenda, type Canal } from '../../lib/vendas'
import { lerMeuNome } from '../compras/api'
import { Folha } from '../compras/componentes/Folha'
import { simplificar } from '../compras/componentes/formato'
import type { DadosMovimento } from '../estoque/api'
import { useSaldos } from '../estoque/api'
import { hoje } from '../financeiro/api'
import { CATEGORIAS_PRODUTO, useProdutos, type CategoriaProduto } from '../produtos/api'
import { useCancelarVenda, useConfigPdv, useFilaVendas, useRegistrarVenda, type DadosVenda, type Venda } from './api'
import { ItensCarrinho, TotaisCarrinho } from './componentes/Carrinho'
import {
  CARRINHO_VAZIO,
  gravarCarrinho,
  lerCarrinho,
  nomeItem,
  precoDaOpcao,
  reprecificar,
  restam,
  useCardapio,
  type Carrinho,
  type ItemCarrinho,
  type OpcaoProduto,
  type OpcaoVariacao,
} from './componentes/carrinho'
import { FolhaCobrar, type ResultadoCobranca } from './componentes/Cobrar'
import { FolhaDesconto, FolhaPreco, FolhaTrocarCanal, FolhaVariacao } from './componentes/FolhasPdv'

// Vender no balcão: toca no produto, ajusta o carrinho e cobra. A venda é guardada no aparelho
// na hora e sobe para a nuvem quando der (funciona sem internet).

type FolhaAberta =
  | { tipo: 'variacao'; opcao: OpcaoProduto }
  | { tipo: 'preco'; opcao: OpcaoProduto; variacao: OpcaoVariacao; semPreco: boolean; inicial: number | null }
  | { tipo: 'desconto'; voltarAoCarrinho?: boolean }
  | { tipo: 'canal'; canal: Canal }
  | { tipo: 'carrinho' }
  | { tipo: 'cobrar'; vendaId: string }
  | null

type Filtro = 'todos' | CategoriaProduto

const linkBotao =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-marca px-5 font-semibold text-white active:bg-marca-escura'

export default function PdvPage() {
  const produtos = useProdutos()
  const configPdv = useConfigPdv()
  const config = configPdv.data ?? CONFIG_PDV_PADRAO
  const { cardapio, carregando, erro, tentarDeNovo } = useCardapio(produtos.data)
  const saldos = useSaldos()
  const registrar = useRegistrarVenda()
  const cancelar = useCancelarVenda()
  const avisar = useAviso()

  const [carrinho, setCarrinho] = useState<Carrinho>(lerCarrinho)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [folha, setFolha] = useState<FolhaAberta>(null)
  const [erroVenda, setErroVenda] = useState<string | null>(null)
  const [ultimoTroco, setUltimoTroco] = useState<{ chave: number; troco: number; total: number } | null>(null)

  useEffect(() => gravarCarrinho(carrinho), [carrinho])

  // O aviso grande de troco some sozinho depois de alguns segundos.
  useEffect(() => {
    if (!ultimoTroco) return
    const t = window.setTimeout(() => setUltimoTroco(null), 10000)
    return () => window.clearTimeout(t)
  }, [ultimoTroco])

  const { canal } = carrinho
  const acrescimo = config.acrescimo_ifood
  const subtotal = totaisVenda(carrinho.itens).subtotal
  const descontoReais = carrinho.desconto.tipo === 'pct' ? descontoPct(subtotal, carrinho.desconto.valor) : carrinho.desconto.valor
  const totais = totaisVenda(carrinho.itens, descontoReais)
  const qtdNoCarrinho = (variacaoId: string) => carrinho.itens.find((i) => i.variacao_id === variacaoId)?.qtd ?? 0
  const restamDe = (o: OpcaoVariacao) => restam(o, saldos.data?.receitas, qtdNoCarrinho(o.variacao.id))
  const precoDe = (o: OpcaoVariacao) => precoDaOpcao(o, canal, acrescimo)

  const opcoesFiltro = useMemo(() => {
    const usadas = new Set(cardapio.map((p) => p.categoria))
    return [
      { valor: 'todos' as Filtro, rotulo: 'Todos' },
      ...CATEGORIAS_PRODUTO.filter((c) => usadas.has(c.valor)).map((c) => ({ valor: c.valor as Filtro, rotulo: c.rotulo })),
    ]
  }, [cardapio])
  const filtroEfetivo: Filtro = opcoesFiltro.some((o) => o.valor === filtro) ? filtro : 'todos'

  const visiveis = useMemo(() => {
    const termo = simplificar(busca)
    return cardapio.filter(
      (p) =>
        (filtroEfetivo === 'todos' || p.categoria === filtroEfetivo) &&
        (!termo || simplificar(p.produto.nome).includes(termo) || p.variacoes.some((v) => simplificar(v.variacao.nome).includes(termo))),
    )
  }, [cardapio, busca, filtroEfetivo])

  const nenhumComPreco = cardapio.length > 0 && cardapio.every((p) => p.variacoes.every((v) => v.precoBalcao === null && v.pvIfood === null))

  // ---- Carrinho ----

  function mudarItens(f: (itens: ItemCarrinho[]) => ItemCarrinho[]) {
    setCarrinho((c) => {
      const itens = f(c.itens)
      return { ...c, itens, desconto: itens.length === 0 ? CARRINHO_VAZIO.desconto : c.desconto }
    })
  }

  function adicionar(opcao: OpcaoProduto, o: OpcaoVariacao, precoDigitado?: number) {
    const preco = precoDigitado ?? precoDe(o)
    if (preco === null) {
      setFolha({ tipo: 'preco', opcao, variacao: o, semPreco: true, inicial: null })
      return
    }
    setFolha(null)
    mudarItens((itens) => {
      const atual = itens.find((i) => i.variacao_id === o.variacao.id)
      if (atual)
        return itens.map((i) =>
          i.variacao_id === o.variacao.id ? { ...i, qtd: i.qtd + 1, ...(precoDigitado !== undefined ? { preco, manual: true } : {}) } : i,
        )
      return [
        ...itens,
        { produto_id: opcao.produto.id, variacao_id: o.variacao.id, nome: nomeItem(opcao.produto, o.variacao), qtd: 1, preco, manual: precoDigitado !== undefined },
      ]
    })
  }

  function tocarProduto(opcao: OpcaoProduto) {
    if (opcao.variacoes.length > 1) setFolha({ tipo: 'variacao', opcao })
    else adicionar(opcao, opcao.variacoes[0])
  }

  function mudarQtd(variacaoId: string, delta: number) {
    mudarItens((itens) => itens.map((i) => (i.variacao_id === variacaoId ? { ...i, qtd: i.qtd + delta } : i)).filter((i) => i.qtd > 0))
  }

  function editarPreco(item: ItemCarrinho) {
    const opcao = cardapio.find((p) => p.produto.id === item.produto_id)
    const variacao = opcao?.variacoes.find((v) => v.variacao.id === item.variacao_id)
    if (opcao && variacao) setFolha({ tipo: 'preco', opcao, variacao, semPreco: false, inicial: item.preco })
    else avisar({ texto: 'Este produto não está mais à venda. Tire do carrinho, se quiser.' })
  }

  function mudarPreco(variacaoId: string, preco: number) {
    mudarItens((itens) => itens.map((i) => (i.variacao_id === variacaoId ? { ...i, preco, manual: true } : i)))
    setFolha(null)
  }

  function trocarCanal(novo: Canal) {
    if (novo === canal) return
    if (carrinho.itens.length > 0) setFolha({ tipo: 'canal', canal: novo })
    else setCarrinho((c) => ({ ...c, canal: novo }))
  }

  function limpar() {
    const antes = carrinho
    setCarrinho((c) => ({ ...CARRINHO_VAZIO, canal: c.canal }))
    setFolha(null)
    avisar({ texto: 'Carrinho limpo', desfazer: () => setCarrinho(antes) })
  }

  function abrirCobrar() {
    if (carrinho.itens.length === 0) return
    setFolha({ tipo: 'cobrar', vendaId: novoId() })
  }

  // ---- Venda ----

  function concluir(vendaId: string, r: ResultadoCobranca) {
    const data = hoje()
    const agora = new Date().toISOString()
    const feitoPor = lerMeuNome() || null
    const itens = carrinho.itens.map(({ produto_id, variacao_id, nome, qtd, preco }) => ({ produto_id, variacao_id, nome, qtd, preco }))
    const venda: DadosVenda = {
      id: vendaId,
      data,
      canal,
      cliente: r.cliente.trim() || null,
      itens,
      pagamentos: r.pagamentos,
      subtotal: totais.subtotal,
      desconto: totais.desconto,
      total: totais.total,
      troco: r.troco,
      taxas: taxasVenda(r.pagamentos, config),
      status: 'concluida',
      motivo_cancelamento: null,
      fechamento_id: null,
      feito_por: feitoPor,
      observacao: r.observacao.trim() || null,
      criado_em: agora,
    }
    const movimentos: DadosMovimento[] = baixaEstoqueVenda(itens, produtos.data ?? []).map((b) => ({
      id: novoId(),
      data,
      item_tipo: b.item_tipo,
      insumo_id: b.insumo_id,
      receita_id: b.receita_id,
      quantidade: b.quantidade,
      origem: 'venda',
      producao_id: null,
      compra_id: null,
      venda_id: vendaId,
      observacao: null,
      feito_por: feitoPor,
    }))
    try {
      registrar(venda, movimentos)
    } catch (e) {
      // conferência final (ver useRegistrarVenda): a folha continua aberta com a mensagem
      setErroVenda(e instanceof Error ? e.message : String(e))
      return
    }
    setErroVenda(null)

    const antes = carrinho
    setCarrinho((c) => ({ ...CARRINHO_VAZIO, canal: c.canal }))
    setFolha(null)
    setUltimoTroco(r.troco > 0 ? { chave: Date.now(), troco: r.troco, total: venda.total } : null)
    avisar({
      texto: `Venda de ${moeda(venda.total)} registrada${r.troco > 0 ? ` · troco ${moeda(r.troco)}` : ''} ✓`,
      desfazer: () => {
        setUltimoTroco(null)
        cancelar.mutate(
          { venda: { ...venda, atualizado_em: agora } as Venda, motivo: 'Desfeita logo após a venda' },
          {
            onSuccess: () => {
              setCarrinho(antes)
              avisar({ texto: 'Venda desfeita. Os itens voltaram para o carrinho.' })
            },
            onError: (e) => avisar({ texto: `Não deu para desfazer: ${e.message} Cancele em "Vendas do dia".` }),
          },
        )
      },
    })
  }

  // ---- Tela ----

  const cabecalho = (
    <header className="mb-3 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Link
          to="/vendas/dia"
          className="-ml-2 inline-flex min-h-12 items-center gap-1.5 rounded-xl px-2 font-semibold text-suave active:bg-marca-clara md:hidden"
          aria-label="Sair da tela de vender: ver as vendas do dia e o menu"
        >
          <Menu className="size-6" aria-hidden />
          Menu
        </Link>
        <h1 className="flex-1 text-2xl font-bold max-md:sr-only">Vender</h1>
        <StatusFila />
      </div>
      <AvisoVendasPerdidas />
      <div role="radiogroup" aria-label="Canal da venda" className="grid grid-cols-3 gap-1 rounded-2xl bg-marca-clara p-1 lg:max-w-xl">
        {CANAIS.map((c) => {
          const ativo = c.valor === canal
          return (
            <button
              key={c.valor}
              type="button"
              role="radio"
              aria-checked={ativo}
              onClick={() => trocarCanal(c.valor)}
              className={`min-h-12 rounded-xl px-1 text-[15px] font-semibold ${ativo ? 'bg-marca text-white shadow-sm' : 'text-marca-escura active:bg-superficie'}`}
            >
              {c.valor === 'whatsapp' ? 'WhatsApp' : c.rotulo}
            </button>
          )
        })}
      </div>
    </header>
  )

  let conteudo
  if (produtos.isPending || carregando) conteudo = <Carregando />
  else if (produtos.error) conteudo = <Erro mensagem={produtos.error.message} tentarDeNovo={() => produtos.refetch()} />
  else if (cardapio.length === 0)
    conteudo = (
      <Vazio
        titulo="Nenhum produto para vender"
        texto="Cadastre os produtos (com as variações e o preço) para eles aparecerem aqui."
        acao={
          <Link to="/produtos/novo" className={linkBotao}>
            Cadastrar produto
          </Link>
        }
      />
    )
  else
    conteudo = (
      <div className="flex flex-col gap-3">
        {erro && (
          <p className="rounded-2xl bg-alerta-claro p-3 text-sm text-alerta">
            Não deu para calcular os preços sugeridos agora; aparecem só os preços digitados nos produtos.{' '}
            <button type="button" className="font-semibold underline" onClick={tentarDeNovo}>
              Tentar de novo
            </button>
          </p>
        )}
        {nenhumComPreco && (
          <p className="rounded-2xl bg-alerta-claro p-3 text-sm text-alerta">
            Os produtos ainda não têm preço: você digita o preço na hora de vender. Para não precisar,{' '}
            <Link to="/produtos" className="font-semibold underline">
              defina os preços em Produtos
            </Link>
            .
          </p>
        )}
        <Busca valor={busca} aoMudar={setBusca} placeholder="Buscar produto" />
        {opcoesFiltro.length > 2 && (
          <div role="radiogroup" aria-label="Categoria" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0">
            {opcoesFiltro.map((o) => {
              const ativo = o.valor === filtroEfetivo
              return (
                <button
                  key={o.valor}
                  type="button"
                  role="radio"
                  aria-checked={ativo}
                  onClick={() => setFiltro(o.valor)}
                  className={`min-h-11 shrink-0 rounded-full border px-4 text-[15px] font-medium ${
                    ativo ? 'border-marca bg-marca text-white' : 'border-borda bg-superficie text-tinta active:bg-marca-clara'
                  }`}
                >
                  {o.rotulo}
                </button>
              )
            })}
          </div>
        )}
        {visiveis.length === 0 ? (
          <Vazio titulo="Nada encontrado" texto="Confira o nome ou escolha outra categoria." />
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {visiveis.map((p) => (
              <li key={p.produto.id}>
                <BotaoProduto opcao={p} preco={precoDe} restam={restamDe} noCarrinho={p.variacoes.reduce((s, v) => s + qtdNoCarrinho(v.variacao.id), 0)} aoTocar={() => tocarProduto(p)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    )

  const vazio = carrinho.itens.length === 0

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-6">
      <div className="min-w-0">
        {cabecalho}
        {ultimoTroco && (
          <div key={ultimoTroco.chave} className="mb-3 flex items-center justify-between gap-3 rounded-2xl bg-ok px-4 py-3 text-white lg:hidden" role="status">
            <span className="font-semibold">Troco</span>
            <span className="text-3xl font-bold tabular-nums">{moeda(ultimoTroco.troco)}</span>
          </div>
        )}
        {conteudo}
      </div>

      {/* Carrinho ao lado (tablet deitado e computador) */}
      <aside className="sticky top-6 hidden max-h-[calc(100dvh-3rem)] flex-col rounded-2xl border border-borda bg-superficie lg:flex" aria-label="Carrinho">
        <div className="flex items-center justify-between gap-3 border-b border-borda px-4 py-3">
          <h2 className="text-xl font-bold">Carrinho</h2>
          {!vazio && (
            <button type="button" onClick={limpar} className="min-h-11 rounded-xl px-2 font-semibold text-perigo active:bg-perigo-claro">
              Limpar
            </button>
          )}
        </div>
        {ultimoTroco && (
          <div key={ultimoTroco.chave} className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-2xl bg-ok px-4 py-3 text-white" role="status">
            <span className="font-semibold">Troco</span>
            <span className="text-3xl font-bold tabular-nums">{moeda(ultimoTroco.troco)}</span>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <ItensCarrinho itens={carrinho.itens} aoMudarQtd={mudarQtd} aoEditarPreco={editarPreco} />
        </div>
        <div className="flex flex-col gap-3 border-t border-borda p-4">
          <TotaisCarrinho totais={totais} desconto={carrinho.desconto} aoDesconto={() => setFolha({ tipo: 'desconto' })} />
          <Botao className="min-h-16 text-xl" disabled={vazio} onClick={abrirCobrar}>
            {vazio ? 'Cobrar' : `Cobrar ${moeda(totais.total)}`}
          </Botao>
        </div>
      </aside>

      {/* Carrinho embaixo (celular e tablet em pé) */}
      <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-borda bg-creme/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:left-60 lg:hidden">
        <div className="mx-auto flex max-w-2xl items-stretch gap-2">
          <button
            type="button"
            onClick={() => setFolha({ tipo: 'carrinho' })}
            disabled={vazio}
            className="flex min-h-14 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-borda bg-superficie px-3 text-left active:bg-marca-clara disabled:opacity-60"
            aria-label={vazio ? 'Carrinho vazio' : `Ver o carrinho: ${totais.itens} itens`}
          >
            <span className="relative shrink-0">
              <ShoppingBag className="size-6 text-marca" aria-hidden />
              {!vazio && (
                <span className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full bg-marca text-xs font-bold text-white">
                  {totais.itens > 99 ? '99+' : totais.itens}
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{vazio ? 'Carrinho vazio' : 'Ver carrinho'}</span>
            {!vazio && <ChevronUp className="size-5 shrink-0 text-suave" aria-hidden />}
          </button>
          <Botao className="min-h-14 shrink-0 px-4 text-lg whitespace-nowrap" disabled={vazio} onClick={abrirCobrar}>
            {vazio ? 'Cobrar' : `Cobrar ${moeda(totais.total)}`}
          </Botao>
        </div>
      </div>

      {folha?.tipo === 'variacao' && (
        <FolhaVariacao opcao={folha.opcao} preco={precoDe} restam={restamDe} aoEscolher={(o) => adicionar(folha.opcao, o)} aoFechar={() => setFolha(null)} />
      )}
      {folha?.tipo === 'preco' && (
        <FolhaPreco
          nome={nomeItem(folha.opcao.produto, folha.variacao.variacao)}
          inicial={folha.inicial}
          semPreco={folha.semPreco}
          produtoId={folha.opcao.produto.id}
          aoConfirmar={(preco) => (folha.semPreco ? adicionar(folha.opcao, folha.variacao, preco) : mudarPreco(folha.variacao.variacao.id, preco))}
          aoFechar={() => setFolha(null)}
        />
      )}
      {folha?.tipo === 'desconto' && (
        <FolhaDesconto
          subtotal={totais.subtotal}
          inicial={carrinho.desconto}
          aoConfirmar={(d) => {
            setCarrinho((c) => ({ ...c, desconto: d }))
            setFolha(folha.voltarAoCarrinho ? { tipo: 'carrinho' } : null)
          }}
          aoFechar={() => setFolha(folha.voltarAoCarrinho ? { tipo: 'carrinho' } : null)}
        />
      )}
      {folha?.tipo === 'canal' && (
        <FolhaTrocarCanal
          canal={folha.canal}
          aoConfirmar={() => {
            setCarrinho((c) => reprecificar(c, folha.canal, cardapio, acrescimo))
            setFolha(null)
          }}
          aoFechar={() => setFolha(null)}
        />
      )}
      {folha?.tipo === 'carrinho' && (
        <Folha
          titulo="Carrinho"
          subtitulo={CANAIS.find((c) => c.valor === canal)?.rotulo}
          aoFechar={() => setFolha(null)}
          rodape={
            <div className="flex w-full flex-col gap-3">
              <TotaisCarrinho
                totais={totais}
                desconto={carrinho.desconto}
                aoDesconto={() => setFolha({ tipo: 'desconto', voltarAoCarrinho: true })}
              />
              <div className="flex gap-3">
                <Botao variante="perigo" className="flex-1" onClick={limpar} disabled={vazio}>
                  Limpar
                </Botao>
                <Botao className="min-h-14 flex-[2] text-lg" disabled={vazio} onClick={abrirCobrar}>
                  {`Cobrar ${moeda(totais.total)}`}
                </Botao>
              </div>
            </div>
          }
        >
          <ItensCarrinho itens={carrinho.itens} aoMudarQtd={mudarQtd} aoEditarPreco={editarPreco} />
        </Folha>
      )}
      {folha?.tipo === 'cobrar' && (
        <FolhaCobrar
          total={totais.total}
          canal={canal}
          erro={erroVenda}
          aoConfirmar={(r) => concluir(folha.vendaId, r)}
          aoFechar={() => {
            setErroVenda(null)
            setFolha(null)
          }}
        />
      )}
    </div>
  )
}

function BotaoProduto({
  opcao,
  preco,
  restam,
  noCarrinho,
  aoTocar,
}: {
  opcao: OpcaoProduto
  preco: (o: OpcaoVariacao) => number | null
  restam: (o: OpcaoVariacao) => number | null
  noCarrinho: number
  aoTocar: () => void
}) {
  const precos = opcao.variacoes.map(preco)
  const comPreco = precos.filter((p): p is number => p !== null)
  const varias = opcao.variacoes.length > 1
  const menor = comPreco.length > 0 ? Math.min(...comPreco) : null
  const textoPreco = menor === null ? 'sem preço' : varias && new Set(comPreco).size > 1 ? `a partir de ${moeda(menor)}` : moeda(menor)
  const r = varias ? null : restam(opcao.variacoes[0])
  const unica = !varias ? opcao.variacoes[0].variacao.nome.trim() : ''

  return (
    <button
      type="button"
      onClick={aoTocar}
      className={`relative flex h-full min-h-28 w-full flex-col justify-between gap-2 rounded-2xl border-2 bg-superficie p-3 text-left transition-colors active:scale-[0.98] active:bg-marca-clara ${
        noCarrinho > 0 ? 'border-marca' : 'border-borda'
      }`}
      aria-label={`${opcao.produto.nome}${unica && unica !== 'Padrão' ? ` ${unica}` : ''}, ${textoPreco}${noCarrinho > 0 ? `, ${noCarrinho} no carrinho` : ''}`}
    >
      {noCarrinho > 0 && (
        <span className="absolute -top-2 -right-2 flex min-w-7 items-center justify-center rounded-full bg-marca px-1.5 py-0.5 text-sm font-bold text-white shadow-sm" aria-hidden>
          {noCarrinho}
        </span>
      )}
      <span className="flex flex-col">
        <span className="line-clamp-3 text-[17px] leading-snug font-semibold break-words">{opcao.produto.nome}</span>
        {unica && unica !== 'Padrão' && <span className="truncate text-sm text-suave">{unica}</span>}
        {varias && <span className="text-sm text-suave">{opcao.variacoes.length} opções</span>}
      </span>
      <span className="flex flex-wrap items-end justify-between gap-x-2">
        <span className={`font-bold ${menor === null ? 'text-alerta' : 'text-lg text-marca'}`}>{textoPreco}</span>
        {r !== null && (
          <span className={`text-xs font-medium ${r === 0 ? 'text-perigo' : 'text-suave'}`}>{r === 0 ? 'acabou' : `restam ${r}`}</span>
        )}
      </span>
    </button>
  )
}

/** Vendas deste aparelho que ainda não subiram para a nuvem. */
function StatusFila() {
  const { aguardando, erro, enviarAgora } = useFilaVendas()
  const [detalhe, setDetalhe] = useState(false)
  if (aguardando === 0 && !erro) return null
  const texto = aguardando > 0 ? `${aguardando} ${aguardando === 1 ? 'venda' : 'vendas'} por enviar` : 'Problema ao enviar'
  return (
    <>
      <button
        type="button"
        onClick={() => setDetalhe(true)}
        className={`ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold ${
          erro ? 'bg-perigo-claro text-perigo' : 'bg-alerta-claro text-alerta'
        }`}
      >
        {erro ? <AlertTriangle className="size-4" aria-hidden /> : <CloudUpload className="size-4" aria-hidden />}
        {texto}
      </button>
      {detalhe && (
        <Folha
          titulo={texto}
          aoFechar={() => setDetalhe(false)}
          rodape={
            aguardando > 0 ? (
              <Botao className="flex-1" onClick={() => void enviarAgora()}>
                Enviar agora
              </Botao>
            ) : undefined
          }
        >
          {aguardando > 0 && (
            <p className="flex gap-2">
              <PackageOpen className="size-5 shrink-0 text-suave" aria-hidden />
              As vendas estão guardadas neste aparelho e sobem sozinhas quando a internet voltar. Não feche o app de vez nem limpe os dados do navegador.
            </p>
          )}
          {erro && <p className="rounded-2xl bg-perigo-claro p-3 text-perigo">{erro}</p>}
        </Folha>
      )}
    </>
  )
}
