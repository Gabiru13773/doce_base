import { ArrowLeft, Minus, PencilLine, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type MouseEvent, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAviso } from '../../components/Aviso'
import { BarraAcao, Botao, Busca, Campo, Carregando, Cartao, Entrada, EntradaNumero, Erro, Pilulas, TituloPagina, Vazio } from '../../components/ui'
import { centavos } from '../../lib/compras'
import { novoId } from '../../lib/db'
import { somarDias } from '../../lib/financeiro'
import { lerNumero, moeda, numero, paraCampo } from '../../lib/format'
import { CANAIS_PEDIDO, TIPOS_ENTREGA, sinalSugerido, totaisPedido, type CanalPedido, type ItemPedido, type TipoEntrega } from '../../lib/pedidos'
import { CONFIG_PDV_PADRAO } from '../../lib/vendas'
import { lerMeuNome } from '../compras/api'
import { Folha } from '../compras/componentes/Folha'
import { simplificar } from '../compras/componentes/formato'
import { hoje } from '../financeiro/api'
import { useProdutos } from '../produtos/api'
import { useConfigPdv } from '../vendas/api'
import { nomeItem, useCardapio, type OpcaoProduto, type OpcaoVariacao } from '../vendas/componentes/carrinho'
import { FolhaPreco, FolhaVariacao } from '../vendas/componentes/FolhasPdv'
import { apagarFoto, useClientes, usePedidos, useSalvarPedido, type Cliente, type DadosPedido, type Pedido } from './api'
import { FotosPedido } from './componentes/FotosPedido'
import { SeletorCliente } from './componentes/SeletorCliente'

// Criar e editar pedido (encomenda): cliente, entrega, itens do cardápio ou avulsos, fotos de
// referência e o sinal sugerido. O pedido novo fica guardado como rascunho neste aparelho até
// ser salvo, para não perder o que foi digitado se a tela fechar no meio da conversa com a cliente.

const CHAVE_RASCUNHO = 'euforia:pedido-rascunho'

const classeTexto =
  'w-full rounded-xl border border-borda bg-superficie px-4 py-3 text-base outline-none focus:border-marca focus:ring-2 focus:ring-marca/20'

const classeLink = 'inline-flex min-h-12 items-center rounded-2xl px-5 font-semibold text-marca active:bg-marca-clara'

function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : 'tente novamente'
}

export default function PedidoFormPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const local = useLocation()
  const editando = !!id && id !== 'novo'
  const pedidos = usePedidos()
  const clientes = useClientes()
  const clienteParam = editando ? null : params.get('cliente')

  if (editando) {
    if (pedidos.error) return <Erro mensagem={mensagemDe(pedidos.error)} tentarDeNovo={() => pedidos.refetch()} />
    // Espera a versão atual do pedido (o cache salvo no aparelho pode estar velho).
    const atualizando = !pedidos.isFetchedAfterMount && pedidos.fetchStatus === 'fetching'
    if (pedidos.isPending || atualizando) return <Carregando />
    const pedido = (pedidos.data ?? []).find((p) => p.id === id)
    if (!pedido)
      return (
        <>
          <Voltar para="/vendas/pedidos" />
          <Vazio
            titulo="Pedido não encontrado"
            texto="Ele pode ter sido apagado."
            acao={
              <Link to="/vendas/pedidos" className={classeLink}>
                Ver os pedidos
              </Link>
            }
          />
        </>
      )
    if (pedido.status === 'entregue' || pedido.status === 'cancelado')
      return (
        <>
          <Voltar para={`/vendas/pedidos/${pedido.id}`} />
          <Vazio
            titulo={pedido.status === 'entregue' ? 'Este pedido já foi entregue' : 'Este pedido está cancelado'}
            texto={
              pedido.status === 'entregue'
                ? 'Pedido entregue não pode mais ser mudado. Se foi engano, desfaça a entrega na tela do pedido.'
                : 'Para mudar, reabra o pedido na tela dele.'
            }
            acao={
              <Link to={`/vendas/pedidos/${pedido.id}`} className={classeLink}>
                Ver o pedido
              </Link>
            }
          />
        </>
      )
    return <Formulario key={pedido.id} original={pedido} clientes={clientes.data ?? []} clienteInicial={null} />
  }

  // Veio de "Novo pedido" na ficha do cliente: espera a lista para já trazer o cliente.
  if (clienteParam && clientes.isPending) return <Carregando />
  const clienteInicial = clienteParam ? ((clientes.data ?? []).find((c) => c.id === clienteParam) ?? null) : null
  return <Formulario key={local.key} clientes={clientes.data ?? []} clienteInicial={clienteInicial} />
}

/** Link "Voltar"; se houver mudanças não salvas, pergunta antes de sair. */
function Voltar({ para, sujo = false }: { para: string; sujo?: boolean }) {
  return (
    <Link
      to={para}
      onClick={(e: MouseEvent) => {
        if (sujo && !window.confirm('Sair sem salvar?')) e.preventDefault()
      }}
      className="-ml-2 mb-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-suave active:bg-marca-clara"
    >
      <ArrowLeft className="size-5" aria-hidden />
      Voltar
    </Link>
  )
}

// ---- Estado do formulário ------------------------------------------------------------

/** Item como aparece na tela (preço como texto: "12,50"). */
interface LinhaItem {
  id: string
  produto_id: string | null
  variacao_id: string | null
  nome: string
  qtd: number
  preco: string
  personalizacao: string
}

interface Campos {
  clienteId: string | null
  clienteNome: string
  telefone: string
  canal: CanalPedido
  data: string
  hora: string
  tipo: TipoEntrega
  endereco: string
  taxa: string
  itens: LinhaItem[]
  observacao: string
  fotos: string[]
  desconto: string
}

function camposVazios(cliente: Cliente | null): Campos {
  return {
    clienteId: cliente?.id ?? null,
    clienteNome: cliente?.nome ?? '',
    telefone: cliente?.telefone ?? '',
    canal: 'whatsapp',
    data: somarDias(hoje(), 1),
    hora: '',
    tipo: 'retirada',
    endereco: cliente?.endereco ?? '',
    taxa: '',
    itens: [],
    observacao: '',
    fotos: [],
    desconto: '',
  }
}

function camposDe(p: Pedido): Campos {
  return {
    clienteId: p.cliente_id,
    clienteNome: p.cliente_nome,
    telefone: p.telefone ?? '',
    canal: p.canal,
    data: p.entrega_data,
    hora: p.entrega_hora ?? '',
    tipo: p.entrega_tipo,
    endereco: p.endereco ?? '',
    taxa: p.taxa_entrega > 0 ? paraCampo(p.taxa_entrega) : '',
    itens: p.itens.map((i) => ({
      id: i.id,
      produto_id: i.produto_id,
      variacao_id: i.variacao_id,
      nome: i.nome,
      qtd: i.qtd,
      preco: paraCampo(i.preco),
      personalizacao: i.personalizacao ?? '',
    })),
    observacao: p.observacao ?? '',
    fotos: p.fotos,
    desconto: p.desconto > 0 ? paraCampo(p.desconto) : '',
  }
}

// ---- Rascunho (só pedido novo) ------------------------------------------------------------

interface Rascunho {
  id: string
  campos: Campos
}

const ehTexto = (v: unknown): v is string => typeof v === 'string'

function lerRascunho(): Rascunho | null {
  try {
    const r = JSON.parse(localStorage.getItem(CHAVE_RASCUNHO) ?? 'null') as { id?: unknown; campos?: Partial<Campos> } | null
    if (!r || !ehTexto(r.id) || !r.campos || typeof r.campos !== 'object') return null
    const c = r.campos
    const base = camposVazios(null)
    const itens = (Array.isArray(c.itens) ? c.itens : [])
      .filter((i) => i && ehTexto(i.id) && ehTexto(i.nome) && Number(i.qtd) > 0)
      .map((i) => ({
        id: i.id,
        produto_id: ehTexto(i.produto_id) ? i.produto_id : null,
        variacao_id: ehTexto(i.variacao_id) ? i.variacao_id : null,
        nome: i.nome,
        qtd: Number(i.qtd),
        preco: ehTexto(i.preco) ? i.preco : '',
        personalizacao: ehTexto(i.personalizacao) ? i.personalizacao : '',
      }))
    const campos: Campos = {
      clienteId: ehTexto(c.clienteId) ? c.clienteId : null,
      clienteNome: ehTexto(c.clienteNome) ? c.clienteNome : '',
      telefone: ehTexto(c.telefone) ? c.telefone : '',
      canal: CANAIS_PEDIDO.some((x) => x.valor === c.canal) ? (c.canal as CanalPedido) : base.canal,
      data: ehTexto(c.data) && /^\d{4}-\d{2}-\d{2}$/.test(c.data) ? c.data : base.data,
      hora: ehTexto(c.hora) ? c.hora : '',
      tipo: TIPOS_ENTREGA.some((x) => x.valor === c.tipo) ? (c.tipo as TipoEntrega) : base.tipo,
      endereco: ehTexto(c.endereco) ? c.endereco : '',
      taxa: ehTexto(c.taxa) ? c.taxa : '',
      itens,
      observacao: ehTexto(c.observacao) ? c.observacao : '',
      fotos: Array.isArray(c.fotos) ? c.fotos.filter(ehTexto) : [],
      desconto: ehTexto(c.desconto) ? c.desconto : '',
    }
    return { id: r.id, campos }
  } catch {
    return null
  }
}

function gravarRascunho(r: Rascunho) {
  try {
    localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(r))
  } catch {
    /* sem espaço (fotos no modo local?): o rascunho fica só na memória */
  }
}

function apagarRascunho() {
  try {
    localStorage.removeItem(CHAVE_RASCUNHO)
  } catch {
    /* nada a fazer */
  }
}

// ---- Validação ------------------------------------------------------------------------

/** Número opcional (vazio = 0); null quando não é um número ≥ 0. */
function valorOpcional(s: string): number | null {
  if (!s.trim()) return 0
  const n = lerNumero(s)
  return Number.isFinite(n) && n >= 0 ? centavos(n) : null
}

function precoDoItem(s: string): number | null {
  if (!s.trim()) return null
  const n = lerNumero(s)
  return Number.isFinite(n) && n >= 0 ? centavos(n) : null
}

interface Erros {
  cliente?: string
  data?: string
  itens?: string
  taxa?: string
  desconto?: string
  /** por id do item */
  precos: Record<string, string>
  nomes: Record<string, string>
}

function validar(c: Campos, subtotal: number): Erros {
  const e: Erros = { precos: {}, nomes: {} }
  if (!c.clienteNome.trim()) e.cliente = 'Escolha o cliente'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.data)) e.data = 'Escolha o dia da entrega'
  if (c.itens.length === 0) e.itens = 'Adicione pelo menos 1 item'
  for (const i of c.itens) {
    if (precoDoItem(i.preco) === null) e.precos[i.id] = i.preco.trim() ? 'Digite só números, como 12,50' : 'Digite o preço'
    if (!i.nome.trim()) e.nomes[i.id] = 'Escreva o que é'
  }
  if (c.tipo !== 'retirada' && valorOpcional(c.taxa) === null) e.taxa = 'Digite só números, como 10 ou 7,50'
  const d = valorOpcional(c.desconto)
  if (d === null) e.desconto = 'Digite só números, como 5 ou 2,50'
  else if (d > subtotal) e.desconto = `O desconto não pode passar de ${moeda(subtotal)} (o valor dos itens)`
  return e
}

const temErros = (e: Erros) =>
  !!(e.cliente || e.data || e.itens || e.taxa || e.desconto) || Object.keys(e.precos).length > 0 || Object.keys(e.nomes).length > 0

// ---- Formulário ------------------------------------------------------------------------

type FolhaAberta = 'cardapio' | 'avulso' | null

function Formulario({ original, clientes, clienteInicial }: { original?: Pedido; clientes: Cliente[]; clienteInicial: Cliente | null }) {
  const navegar = useNavigate()
  const avisar = useAviso()
  const salvar = useSalvarPedido()
  const configPdv = useConfigPdv()
  const pctSinal = configPdv.data?.pct_sinal ?? CONFIG_PDV_PADRAO.pct_sinal

  const [vazio] = useState(() => camposVazios(clienteInicial))
  const [inicio] = useState(() => {
    if (original) return { id: original.id, campos: camposDe(original), recuperado: false, outroCliente: false }
    const r = lerRascunho()
    if (!r) return { id: novoId(), campos: vazio, recuperado: false, outroCliente: false }
    // Rascunho sem cliente (ou do mesmo): já entra com o cliente que veio no link.
    if (clienteInicial && (!r.campos.clienteId || r.campos.clienteId === clienteInicial.id)) {
      const campos = {
        ...r.campos,
        clienteId: clienteInicial.id,
        clienteNome: clienteInicial.nome,
        telefone: r.campos.telefone || (clienteInicial.telefone ?? ''),
        endereco: r.campos.endereco || (clienteInicial.endereco ?? ''),
      }
      return { id: r.id, campos, recuperado: true, outroCliente: false }
    }
    return { id: r.id, campos: r.campos, recuperado: true, outroCliente: !!clienteInicial }
  })
  const [pedidoId, setPedidoId] = useState(inicio.id)
  const [c, setC] = useState<Campos>(inicio.campos)
  const [recuperado, setRecuperado] = useState(inicio.recuperado)
  const [escolhido, setEscolhido] = useState<Cliente | null>(null)
  const [folha, setFolha] = useState<FolhaAberta>(null)
  const [tentou, setTentou] = useState(false)
  const salvou = useRef(false)
  // Todas as fotos que passaram pela lista: as que saírem são apagadas do armazenamento ao salvar.
  const vistas = useRef(new Set(inicio.campos.fotos))
  const caixaErro = useRef<HTMLDivElement>(null)
  const idObs = useId()
  const idEndereco = useId()

  const sujo = useMemo(() => JSON.stringify(c) !== JSON.stringify(inicio.campos), [c, inicio])
  const temConteudo = useMemo(() => JSON.stringify(c) !== JSON.stringify(vazio), [c, vazio])

  // Rascunho do pedido novo: grava a cada mudança; some quando volta ao vazio ou é salvo.
  useEffect(() => {
    if (original || salvou.current) return
    if (temConteudo) gravarRascunho({ id: pedidoId, campos: c })
    else apagarRascunho()
  }, [original, c, pedidoId, temConteudo])

  // Erro ao salvar: leva a mensagem para a vista (ela fica no fim da tela).
  useEffect(() => {
    if (salvar.isError) caixaErro.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [salvar.isError, salvar.failureCount])

  const clienteAtual: Cliente | null = !c.clienteNome
    ? null
    : (clientes.find((x) => x.id === c.clienteId) ??
      (escolhido && escolhido.id === c.clienteId ? escolhido : null) ?? {
        id: c.clienteId ?? '',
        nome: c.clienteNome,
        telefone: null,
        instagram: null,
        endereco: null,
        observacao: null,
        criado_em: '',
        atualizado_em: '',
      })

  const precos = c.itens.map((i) => ({ qtd: i.qtd, preco: precoDoItem(i.preco) ?? 0 }))
  const comEntrega = c.tipo !== 'retirada'
  const totais = totaisPedido(precos, valorOpcional(c.desconto) ?? 0, comEntrega ? (valorOpcional(c.taxa) ?? 0) : 0)
  const sinal = sinalSugerido(totais.total, pctSinal)
  const erros = validar(c, totais.subtotal)
  const temErro = temErros(erros)
  const mostrar: Erros = tentou ? erros : { precos: {}, nomes: {} }
  const dataPassada = /^\d{4}-\d{2}-\d{2}$/.test(c.data) && c.data < hoje() && c.data !== original?.entrega_data

  function mudar<K extends keyof Campos>(campo: K, valor: Campos[K]) {
    setC((a) => ({ ...a, [campo]: valor }))
  }

  function escolherCliente(cl: Cliente) {
    setEscolhido(cl)
    setC((a) => {
      // Troca o endereço só se ainda era o do cliente anterior (ou estava vazio).
      const anterior = clientes.find((x) => x.id === a.clienteId) ?? (escolhido?.id === a.clienteId ? escolhido : null)
      const manterEndereco = a.endereco.trim() && a.endereco !== (anterior?.endereco ?? '')
      return {
        ...a,
        clienteId: cl.id,
        clienteNome: cl.nome,
        telefone: cl.telefone ?? '',
        endereco: manterEndereco ? a.endereco : (cl.endereco ?? ''),
      }
    })
  }

  function mudarTipo(tipo: TipoEntrega) {
    setC((a) => ({ ...a, tipo, endereco: tipo !== 'retirada' && !a.endereco.trim() ? (clienteAtual?.endereco ?? '') : a.endereco }))
  }

  function mudarFotos(fotos: string[]) {
    for (const f of fotos) vistas.current.add(f)
    mudar('fotos', fotos)
  }

  // ---- Itens ----

  function adicionarItem(item: Omit<LinhaItem, 'id'>) {
    // id próprio por linha: o mesmo bolo pode entrar duas vezes com recheios diferentes
    setC((a) => ({ ...a, itens: [...a.itens, { ...item, id: novoId() }] }))
    setFolha(null)
    avisar({ texto: `${item.nome} no pedido ✓` })
  }

  function mudarItem<K extends keyof LinhaItem>(itemId: string, campo: K, valor: LinhaItem[K]) {
    setC((a) => ({ ...a, itens: a.itens.map((i) => (i.id === itemId ? { ...i, [campo]: valor } : i)) }))
  }

  function removerItem(item: LinhaItem) {
    const indice = c.itens.findIndex((i) => i.id === item.id)
    setC((a) => ({ ...a, itens: a.itens.filter((i) => i.id !== item.id) }))
    avisar({
      texto: `${item.nome} tirado do pedido`,
      desfazer: () =>
        setC((a) => {
          if (a.itens.some((i) => i.id === item.id)) return a
          const itens = [...a.itens]
          itens.splice(Math.min(indice, itens.length), 0, item)
          return { ...a, itens }
        }),
    })
  }

  // ---- Rascunho ----

  function descartarRascunho() {
    const antes = { id: pedidoId, campos: c }
    setC(vazio)
    setPedidoId(novoId())
    setRecuperado(false)
    setTentou(false)
    salvar.reset()
    window.scrollTo({ top: 0, behavior: 'smooth' })
    avisar({
      texto: 'Rascunho descartado',
      desfazer: () => {
        setPedidoId(antes.id)
        setC(antes.campos)
      },
    })
  }

  // ---- Salvar ----

  async function aoSalvar(e?: FormEvent) {
    e?.preventDefault()
    setTentou(true)
    if (temErro || salvar.isPending) {
      setTimeout(() => {
        const alvo = document.querySelector<HTMLElement>('[aria-invalid="true"], [data-erro="true"]')
        alvo?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        if (alvo?.matches('input, textarea')) alvo.focus({ preventScroll: true })
      }, 50)
      return
    }
    const comEntregaSalvar = c.tipo !== 'retirada'
    const itens: ItemPedido[] = c.itens.map((i) => ({
      id: i.id,
      produto_id: i.produto_id,
      variacao_id: i.variacao_id,
      nome: i.nome.trim(),
      qtd: i.qtd,
      preco: precoDoItem(i.preco) ?? 0,
      personalizacao: i.personalizacao.trim() || null,
    }))
    const dados: DadosPedido = {
      id: pedidoId,
      cliente_id: c.clienteId,
      cliente_nome: c.clienteNome.trim(),
      telefone: c.telefone.trim() || null,
      canal: c.canal,
      entrega_data: c.data,
      entrega_hora: c.hora ? c.hora.slice(0, 5) : null,
      entrega_tipo: c.tipo,
      endereco: comEntregaSalvar ? c.endereco.trim() || null : null,
      taxa_entrega: comEntregaSalvar ? (valorOpcional(c.taxa) ?? 0) : 0,
      itens,
      observacao: c.observacao.trim() || null,
      fotos: c.fotos,
      desconto: valorOpcional(c.desconto) ?? 0,
      feito_por: original ? original.feito_por : lerMeuNome() || null,
      status: original?.status,
      atualizado_em_lido: original?.atualizado_em,
    }
    try {
      const salvo = await salvar.mutateAsync(dados)
      salvou.current = true
      if (!original) apagarRascunho()
      // Fotos tiradas da lista só saem do armazenamento depois que o pedido foi salvo sem elas.
      for (const f of vistas.current) if (!c.fotos.includes(f)) void apagarFoto(f).catch(() => {})
      avisar({ texto: original ? 'Pedido salvo ✓' : 'Pedido criado ✓' })
      navegar(`/vendas/pedidos/${salvo.id}`, { replace: true })
    } catch {
      // O erro aparece na tela pelo estado da mutação.
    }
  }

  return (
    <div>
      <Voltar para={original ? `/vendas/pedidos/${original.id}` : '/vendas/pedidos'} sujo={!!original && sujo} />
      <TituloPagina
        titulo={original ? `Pedido de ${original.cliente_nome}` : 'Novo pedido'}
        subtitulo={original ? 'Mudar o pedido' : 'Encomenda para um dia marcado'}
      />

      <div className="flex flex-col gap-8">
        {recuperado && (
          <Cartao className="flex flex-col gap-2 border-alerta/30 bg-alerta-claro">
            <p className="font-semibold">Continuando o pedido que você tinha começado</p>
            {inicio.outroCliente && clienteInicial && (
              <p className="text-tinta">
                Ele é de {c.clienteNome || 'outro cliente'}. Para fazer um pedido para {clienteInicial.nome}, descarte o rascunho.
              </p>
            )}
            <Botao variante="perigo" className="self-start" onClick={descartarRascunho}>
              Descartar rascunho
            </Botao>
          </Cartao>
        )}

        {/* ---- Cliente ---- */}
        <section className="flex flex-col gap-3" data-erro={mostrar.cliente ? 'true' : undefined}>
          <h2 className="text-xl font-bold">Cliente</h2>
          <SeletorCliente
            cliente={clienteAtual}
            aoEscolher={(cl) => {
              if (inicio.outroCliente) setRecuperado(false)
              escolherCliente(cl)
            }}
          />
          {mostrar.cliente && <p className="text-sm font-medium text-perigo">{mostrar.cliente}</p>}
          {clienteAtual && (
            <Entrada
              rotulo="Telefone deste pedido"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={c.telefone}
              onChange={(e) => mudar('telefone', e.target.value)}
              placeholder="(11) 91234-5678"
              ajuda="Para mandar o resumo pelo WhatsApp. Mudar aqui não muda o cadastro."
            />
          )}
          <div className="flex flex-col gap-1.5">
            <p className="font-semibold">Pedido chegou por</p>
            <Pilulas rotulo="Pedido chegou por" valor={c.canal} aoMudar={(v) => mudar('canal', v)} opcoes={CANAIS_PEDIDO} />
          </div>
        </section>

        {/* ---- Entrega ---- */}
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-bold">Entrega</h2>
          <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
            <Entrada
              rotulo="Dia"
              type="date"
              required
              value={c.data}
              onChange={(e) => mudar('data', e.target.value)}
              erro={mostrar.data}
              ajuda={dataPassada ? 'Esse dia já passou' : undefined}
            />
            <Entrada rotulo="Hora (opcional)" type="time" value={c.hora} onChange={(e) => mudar('hora', e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="font-semibold">Como vai</p>
            <Pilulas rotulo="Como vai" valor={c.tipo} aoMudar={mudarTipo} opcoes={TIPOS_ENTREGA} />
          </div>
          {comEntrega && (
            <>
              <Campo rotulo="Endereço" id={idEndereco} ajuda={clienteAtual?.endereco ? 'Veio do cadastro do cliente' : 'Rua, número, bairro'}>
                <textarea
                  id={idEndereco}
                  rows={2}
                  maxLength={300}
                  value={c.endereco}
                  onChange={(e) => mudar('endereco', e.target.value)}
                  className={classeTexto}
                />
              </Campo>
              <EntradaNumero
                rotulo="Taxa de entrega"
                prefixo="R$"
                placeholder="0,00"
                value={c.taxa}
                onChange={(e) => mudar('taxa', e.target.value)}
                erro={mostrar.taxa}
              />
            </>
          )}
        </section>

        {/* ---- Itens ---- */}
        <section className="flex flex-col gap-3" data-erro={mostrar.itens ? 'true' : undefined}>
          <h2 className="text-xl font-bold">Itens</h2>
          {c.itens.length === 0 ? (
            <p className={`rounded-2xl border border-dashed px-4 py-6 text-center ${mostrar.itens ? 'border-perigo text-perigo' : 'border-borda text-suave'}`}>
              {mostrar.itens ?? 'Nenhum item ainda. Escolha do cardápio ou adicione um item avulso.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {c.itens.map((i) => (
                <li key={i.id}>
                  <CartaoItem
                    item={i}
                    erroPreco={mostrar.precos[i.id]}
                    erroNome={mostrar.nomes[i.id]}
                    aoMudar={(campo, valor) => mudarItem(i.id, campo, valor)}
                    aoRemover={() => removerItem(i)}
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Botao variante="secundario" className="px-3" onClick={() => setFolha('cardapio')}>
              <ShoppingBag className="size-5 shrink-0" aria-hidden />
              Do cardápio
            </Botao>
            <Botao variante="secundario" className="px-3" onClick={() => setFolha('avulso')}>
              <PencilLine className="size-5 shrink-0" aria-hidden />
              Item avulso
            </Botao>
          </div>
        </section>

        {/* ---- Observação e fotos ---- */}
        <section className="flex flex-col gap-4">
          <Campo rotulo="Observação (opcional)" id={idObs} ajuda="Vale para o pedido todo: alergia, embalagem para presente, quem vai buscar…">
            <textarea
              id={idObs}
              rows={3}
              maxLength={1000}
              value={c.observacao}
              onChange={(e) => mudar('observacao', e.target.value)}
              className={classeTexto}
            />
          </Campo>
          <div className="flex flex-col gap-2">
            <p className="font-semibold">Fotos de referência (opcional)</p>
            <FotosPedido pedidoId={pedidoId} fotos={c.fotos} aoMudar={mudarFotos} />
          </div>
        </section>

        {/* ---- Valores ---- */}
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-bold">Valores</h2>
          <EntradaNumero
            rotulo="Desconto (opcional)"
            prefixo="R$"
            placeholder="0,00"
            value={c.desconto}
            onChange={(e) => mudar('desconto', e.target.value)}
            erro={mostrar.desconto}
          />
          <Cartao className="flex flex-col gap-2">
            <Linha rotulo="Itens" valor={moeda(totais.subtotal)} />
            {totais.desconto > 0 && <Linha rotulo="Desconto" valor={`−${moeda(totais.desconto)}`} />}
            {comEntrega && <Linha rotulo="Entrega" valor={moeda(totais.taxaEntrega)} />}
            <div className="flex items-baseline justify-between gap-3 border-t border-borda pt-2">
              <span className="text-lg font-bold">Total</span>
              <span className="text-2xl font-bold tabular-nums text-marca-escura">{moeda(totais.total)}</span>
            </div>
            {sinal > 0 && (
              <p className="rounded-xl bg-marca-clara px-3 py-2 text-marca-escura">
                Sinal sugerido: <strong className="tabular-nums">{moeda(sinal)}</strong> ({numero(pctSinal, 1)}%)
              </p>
            )}
          </Cartao>
        </section>
      </div>

      <div ref={caixaErro} className="mt-6 flex flex-col gap-3">
        {tentou && temErro && <p className="text-sm font-medium text-perigo">Falta arrumar alguns campos antes de salvar.</p>}
        {salvar.isError && <Erro mensagem={mensagemDe(salvar.error)} />}
      </div>

      {!original && temConteudo && !recuperado && (
        <div className="pt-6">
          <Botao variante="texto" className="w-full text-perigo" onClick={descartarRascunho}>
            Descartar rascunho
          </Botao>
        </div>
      )}

      <BarraAcao>
        <div className="flex min-w-0 flex-1 flex-col justify-center text-sm leading-snug">
          <span className="truncate text-suave">
            {c.itens.length} {c.itens.length === 1 ? 'item' : 'itens'}
          </span>
          <span className="truncate font-bold text-marca-escura">Total {moeda(totais.total)}</span>
        </div>
        <Botao className="shrink-0 px-6" onClick={() => void aoSalvar()} disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar pedido'}
        </Botao>
      </BarraAcao>

      {folha === 'cardapio' && <FolhaCardapio aoAdicionar={adicionarItem} aoFechar={() => setFolha(null)} />}
      {folha === 'avulso' && <FolhaAvulso aoAdicionar={adicionarItem} aoFechar={() => setFolha(null)} />}
    </div>
  )
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-suave">{rotulo}</span>
      <span className="font-semibold tabular-nums">{valor}</span>
    </div>
  )
}

// ---- Peças -----------------------------------------------------------------------------

function CartaoItem({
  item,
  erroPreco,
  erroNome,
  aoMudar,
  aoRemover,
}: {
  item: LinhaItem
  erroPreco?: string
  erroNome?: string
  aoMudar: <K extends keyof LinhaItem>(campo: K, valor: LinhaItem[K]) => void
  aoRemover: () => void
}) {
  const idPers = useId()
  const avulso = !item.produto_id
  const preco = precoDoItem(item.preco)
  const botaoQtd =
    'flex size-12 shrink-0 items-center justify-center rounded-xl border border-borda bg-superficie text-marca active:bg-marca-clara disabled:opacity-40'

  return (
    <Cartao className="flex flex-col gap-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {avulso ? (
            <Entrada rotulo="Item avulso" value={item.nome} onChange={(e) => aoMudar('nome', e.target.value)} erro={erroNome} autoCapitalize="sentences" />
          ) : (
            <p className="pt-2 text-lg leading-snug font-semibold break-words">{item.nome}</p>
          )}
        </div>
        <button
          type="button"
          onClick={aoRemover}
          aria-label={`Tirar ${item.nome || 'este item'} do pedido`}
          className="flex size-12 shrink-0 items-center justify-center rounded-xl text-perigo active:bg-perigo-claro"
        >
          <Trash2 className="size-5" aria-hidden />
        </button>
      </div>

      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="font-semibold">Qtd.</span>
          <div className="flex items-center gap-1" role="group" aria-label="Quantidade">
            <button type="button" className={botaoQtd} onClick={() => aoMudar('qtd', item.qtd - 1)} disabled={item.qtd <= 1} aria-label="Menos 1">
              <Minus className="size-5" aria-hidden />
            </button>
            <span className="min-w-8 text-center text-lg font-bold tabular-nums" aria-live="polite">
              {numero(item.qtd)}
            </span>
            <button type="button" className={botaoQtd} onClick={() => aoMudar('qtd', item.qtd + 1)} aria-label="Mais 1">
              <Plus className="size-5" aria-hidden />
            </button>
          </div>
        </div>
        <EntradaNumero
          rotulo="Preço de 1"
          prefixo="R$"
          placeholder="0,00"
          value={item.preco}
          onChange={(e) => aoMudar('preco', e.target.value)}
          erro={erroPreco}
          ajuda={preco !== null && item.qtd > 1 ? `${numero(item.qtd)} × = ${moeda(centavos(item.qtd * preco))}` : undefined}
        />
      </div>

      <Campo rotulo="Personalização (opcional)" id={idPers} ajuda="Sabor, recheio, tema, texto do bolo…">
        <textarea
          id={idPers}
          rows={2}
          maxLength={500}
          value={item.personalizacao}
          onChange={(e) => aoMudar('personalizacao', e.target.value)}
          placeholder="Ex.: Massa de chocolate, recheio ninho com morango, tema Frozen"
          className={classeTexto}
        />
      </Campo>
    </Cartao>
  )
}

type Sub = { tipo: 'variacao'; opcao: OpcaoProduto } | { tipo: 'preco'; opcao: OpcaoProduto; variacao: OpcaoVariacao } | null

/** Escolher do cardápio: produto → variação (se tiver várias) → preço (se não tiver). */
function FolhaCardapio({ aoAdicionar, aoFechar }: { aoAdicionar: (i: Omit<LinhaItem, 'id'>) => void; aoFechar: () => void }) {
  const produtos = useProdutos()
  const { cardapio, carregando, erro, tentarDeNovo } = useCardapio(produtos.data)
  const [busca, setBusca] = useState('')
  const [sub, setSub] = useState<Sub>(null)

  const visiveis = useMemo(() => {
    const termo = simplificar(busca)
    if (!termo) return cardapio
    return cardapio.filter((p) => simplificar(p.produto.nome).includes(termo) || p.variacoes.some((v) => simplificar(v.variacao.nome).includes(termo)))
  }, [cardapio, busca])

  function adicionar(opcao: OpcaoProduto, o: OpcaoVariacao, preco: number) {
    aoAdicionar({
      produto_id: opcao.produto.id,
      variacao_id: o.variacao.id,
      nome: nomeItem(opcao.produto, o.variacao),
      qtd: 1,
      preco: paraCampo(preco),
      personalizacao: '',
    })
  }

  function escolherVariacao(opcao: OpcaoProduto, o: OpcaoVariacao) {
    if (o.precoBalcao === null) setSub({ tipo: 'preco', opcao, variacao: o })
    else adicionar(opcao, o, o.precoBalcao)
  }

  function tocar(opcao: OpcaoProduto) {
    if (opcao.variacoes.length > 1) setSub({ tipo: 'variacao', opcao })
    else escolherVariacao(opcao, opcao.variacoes[0])
  }

  let conteudo
  if (produtos.isPending || carregando) conteudo = <Carregando />
  else if (produtos.error) conteudo = <Erro mensagem={produtos.error.message} tentarDeNovo={() => produtos.refetch()} />
  else if (cardapio.length === 0)
    conteudo = <Vazio titulo="Nenhum produto cadastrado" texto="Use “Item avulso” ou cadastre os produtos em Produtos." />
  else if (visiveis.length === 0) conteudo = <Vazio titulo="Nada encontrado" texto="Confira o nome ou use “Item avulso”." />
  else
    conteudo = (
      <>
        {erro && (
          <p className="rounded-2xl bg-alerta-claro p-3 text-sm text-alerta">
            Não deu para calcular os preços sugeridos agora; aparecem só os preços digitados nos produtos.{' '}
            <button type="button" className="font-semibold underline" onClick={tentarDeNovo}>
              Tentar de novo
            </button>
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {visiveis.map((p) => {
            const comPreco = p.variacoes.map((v) => v.precoBalcao).filter((v): v is number => v !== null)
            const menor = comPreco.length > 0 ? Math.min(...comPreco) : null
            const varias = p.variacoes.length > 1
            const textoPreco = menor === null ? 'sem preço' : varias && new Set(comPreco).size > 1 ? `a partir de ${moeda(menor)}` : moeda(menor)
            const unica = !varias ? p.variacoes[0].variacao.nome.trim() : ''
            return (
              <li key={p.produto.id}>
                <button
                  type="button"
                  onClick={() => tocar(p)}
                  className="flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border border-borda bg-superficie px-4 py-3 text-left active:bg-marca-clara"
                >
                  <span className="min-w-0">
                    <span className="block text-lg leading-snug font-semibold break-words">{p.produto.nome}</span>
                    {varias ? (
                      <span className="block text-sm text-suave">{p.variacoes.length} opções</span>
                    ) : (
                      unica && unica !== 'Padrão' && <span className="block truncate text-sm text-suave">{unica}</span>
                    )}
                  </span>
                  <span className={`shrink-0 font-bold ${menor === null ? 'text-alerta' : 'text-marca'}`}>{textoPreco}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </>
    )

  return (
    <>
      <Folha
        titulo="Do cardápio"
        subtitulo="Preço de balcão; dá para mudar depois"
        aoFechar={aoFechar}
        telaCheia
        cabecalhoExtra={<Busca valor={busca} aoMudar={setBusca} placeholder="Buscar produto" />}
      >
        {conteudo}
      </Folha>
      {sub?.tipo === 'variacao' && (
        <FolhaVariacao
          opcao={sub.opcao}
          preco={(o) => o.precoBalcao}
          restam={() => null}
          aoEscolher={(o) => escolherVariacao(sub.opcao, o)}
          aoFechar={() => setSub(null)}
        />
      )}
      {sub?.tipo === 'preco' && (
        <FolhaPreco
          nome={nomeItem(sub.opcao.produto, sub.variacao.variacao)}
          inicial={null}
          semPreco
          produtoId={sub.opcao.produto.id}
          aoConfirmar={(preco) => adicionar(sub.opcao, sub.variacao, preco)}
          aoFechar={() => setSub(null)}
        />
      )}
    </>
  )
}

/** Item fora do cardápio: descrição e preço combinados com a cliente. */
function FolhaAvulso({ aoAdicionar, aoFechar }: { aoAdicionar: (i: Omit<LinhaItem, 'id'>) => void; aoFechar: () => void }) {
  const idForm = useId()
  const [nome, setNome] = useState('')
  const [qtd, setQtd] = useState('1')
  const [preco, setPreco] = useState('')
  const [tentou, setTentou] = useState(false)

  const q = lerNumero(qtd)
  const qtdOk = Number.isInteger(q) && q > 0
  const p = precoDoItem(preco)
  const erros = {
    nome: !nome.trim() ? 'Escreva o que é' : undefined,
    qtd: !qtdOk ? 'Digite quantos (1, 2, 3…)' : undefined,
    preco: p === null ? (preco.trim() ? 'Digite só números, como 12,50' : 'Digite o preço de 1 unidade') : undefined,
  }
  const ok = !erros.nome && !erros.qtd && !erros.preco

  function enviar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (!ok || p === null) return
    aoAdicionar({ produto_id: null, variacao_id: null, nome: nome.trim(), qtd: q, preco: paraCampo(p), personalizacao: '' })
  }

  return (
    <Folha
      titulo="Item avulso"
      subtitulo="Algo fora do cardápio, com preço combinado"
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao variante="secundario" className="flex-1" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao type="submit" form={idForm} className="flex-[2]">
            Adicionar
          </Botao>
        </>
      }
    >
      <form id={idForm} onSubmit={enviar} noValidate className="flex flex-col gap-4">
        <Entrada
          rotulo="Descrição"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          erro={tentou ? erros.nome : undefined}
          placeholder="Ex.: Bolo 2 andares tema safari"
          autoCapitalize="sentences"
          autoComplete="off"
        />
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3">
          <EntradaNumero rotulo="Qtd." inputMode="numeric" value={qtd} onChange={(e) => setQtd(e.target.value)} erro={tentou ? erros.qtd : undefined} />
          <EntradaNumero
            rotulo="Preço de 1"
            prefixo="R$"
            placeholder="0,00"
            value={preco}
            onChange={(e) => setPreco(e.target.value)}
            erro={tentou ? erros.preco : undefined}
          />
        </div>
        {qtdOk && p !== null && q > 1 && <p className="text-suave">Total do item: {moeda(centavos(q * p))}</p>}
      </form>
    </Folha>
  )
}
