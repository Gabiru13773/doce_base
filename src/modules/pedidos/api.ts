import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { centavos } from '../../lib/compras'
import { db, novoId } from '../../lib/db'
import { milesimos } from '../../lib/estoque'
import { totaisPedido, type CanalPedido, type ItemPedido, type StatusPedido, type TipoEntrega } from '../../lib/pedidos'
import { modoLocal, supabase } from '../../lib/supabase'
import type { DadosMovimento, Movimento } from '../estoque/api'
import type { Venda } from '../vendas/api'

// Clientes e Pedidos (encomendas). Ver supabase/migrations/0009_pedidos.sql.
// Os pagamentos do pedido (sinal, restante) são vendas do PDV com pedido_id (useVendasDoPedido em
// src/modules/vendas/api.ts): entram no fechamento do caixa do dia em que foram recebidos.
// A baixa no estoque é feita na entrega (movimentos com pedido_id).

export interface Cliente {
  id: string
  nome: string
  telefone: string | null
  instagram: string | null
  endereco: string | null
  observacao: string | null
  criado_em: string
  atualizado_em: string
}

export type DadosCliente = Omit<Cliente, 'id' | 'criado_em' | 'atualizado_em'> & { id?: string }

export interface Pedido {
  id: string
  cliente_id: string | null
  cliente_nome: string
  telefone: string | null
  canal: CanalPedido
  entrega_data: string
  entrega_hora: string | null
  entrega_tipo: TipoEntrega
  endereco: string | null
  taxa_entrega: number
  itens: ItemPedido[]
  observacao: string | null
  /** caminhos no Storage (bucket "pedidos"); no modo local, a própria imagem (data:…) */
  fotos: string[]
  subtotal: number
  desconto: number
  total: number
  status: StatusPedido
  motivo_cancelamento: string | null
  entregue_em: string | null
  feito_por: string | null
  criado_em: string
  atualizado_em: string
}

/** O que a tela de pedido manda gravar (totais são recalculados aqui). */
export type DadosPedido = Omit<Pedido, 'subtotal' | 'total' | 'status' | 'motivo_cancelamento' | 'entregue_em' | 'criado_em' | 'atualizado_em'> & {
  status?: StatusPedido
  /** atualizado_em do pedido quando a tela de edição carregou: se mudou, outro aparelho mexeu nele */
  atualizado_em_lido?: string
}

const CHAVES = {
  clientes: ['clientes'],
  pedidos: ['pedidos'],
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v))
const texto = (v: string | null | undefined) => v?.trim() || null

function normalizarPedido(p: Pedido): Pedido {
  return {
    ...p,
    itens: (Array.isArray(p.itens) ? p.itens : []).map((i) => ({
      ...i,
      id: i.id || novoId(),
      produto_id: i.produto_id || null,
      variacao_id: i.variacao_id || null,
      qtd: Number(i.qtd),
      preco: Number(i.preco),
      personalizacao: i.personalizacao ?? null,
    })),
    fotos: Array.isArray(p.fotos) ? p.fotos.filter((f) => typeof f === 'string') : [],
    taxa_entrega: num(p.taxa_entrega),
    subtotal: num(p.subtotal),
    desconto: num(p.desconto),
    total: num(p.total),
    entrega_hora: p.entrega_hora || null,
    entregue_em: p.entregue_em ?? null,
  }
}

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  // exact: não renova os links das fotos (['pedidos', 'foto', …]) a cada mudança
  qc.invalidateQueries({ queryKey: CHAVES.pedidos, exact: true })
  qc.invalidateQueries({ queryKey: CHAVES.clientes })
}

// ---- Clientes ------------------------------------------------------------------------------------

/** Clientes em ordem alfabética. */
export function useClientes() {
  return useQuery({
    queryKey: CHAVES.clientes,
    queryFn: () => db.listar<Cliente>('clientes', undefined, { coluna: 'nome' }),
  })
}

export function useSalvarCliente() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (c: DadosCliente) => {
      const nome = c.nome.trim()
      if (!nome) throw new Error('Informe o nome do cliente.')
      const agora = new Date().toISOString()
      // o formulário gera o id antes de salvar: novo é o que ainda não está no banco
      const novo = !c.id || !(await db.buscar<Cliente>('clientes', c.id))
      return db.salvar<Cliente>('clientes', {
        ...c,
        nome,
        telefone: texto(c.telefone),
        instagram: texto(c.instagram)?.replace(/^@+/, '') ?? null,
        endereco: texto(c.endereco),
        observacao: texto(c.observacao),
        ...(novo ? { criado_em: agora } : {}),
        atualizado_em: agora,
      } as Omit<Cliente, 'id'>)
    },
    onSuccess: () => invalidar(qc),
  })
}

/** Apaga o cliente, só se ele não tem pedidos (o histórico ficaria sem dono). */
export function useRemoverCliente() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (c: Cliente) => {
      if ((await db.listar<Pedido>('pedidos', { cliente_id: c.id })).length > 0)
        throw new Error('Este cliente tem pedidos. Não dá para apagar (o histórico ficaria sem dono).')
      await db.remover('clientes', c.id)
    },
    onSuccess: () => invalidar(qc),
  })
}

export function useRestaurarCliente() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (c: Cliente) => db.salvarVarios<Cliente>('clientes', [c]),
    onSuccess: () => invalidar(qc),
  })
}

// ---- Pedidos -------------------------------------------------------------------------------------

/** Todos os pedidos, por data de entrega (mais recentes primeiro). */
export function usePedidos() {
  return useQuery({
    queryKey: CHAVES.pedidos,
    queryFn: async () =>
      (await db.listar<Pedido>('pedidos', undefined, { coluna: 'entrega_data', crescente: false })).map(normalizarPedido),
  })
}

/** Grava o pedido (novo ou edição). Lança erro com mensagem para a tela. */
export function useSalvarPedido() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ atualizado_em_lido, ...d }: DadosPedido) => {
      const itens = d.itens
        .filter((i) => i.qtd > 0)
        .map((i) => ({
          id: i.id || novoId(),
          produto_id: i.produto_id || null,
          variacao_id: i.variacao_id || null,
          nome: i.nome.trim(),
          qtd: i.qtd,
          preco: centavos(i.preco),
          personalizacao: texto(i.personalizacao),
        }))
      if (!d.cliente_nome.trim()) throw new Error('Escolha o cliente.')
      if (!d.entrega_data) throw new Error('Informe a data de entrega.')
      if (itens.length === 0) throw new Error('O pedido não tem itens.')
      if (itens.some((i) => !i.nome)) throw new Error('Algum item está sem descrição.')
      if (itens.some((i) => !(i.preco >= 0))) throw new Error('Algum item está sem preço.')
      const t = totaisPedido(itens, d.desconto, d.entrega_tipo === 'retirada' ? 0 : d.taxa_entrega)
      if (centavos(d.desconto || 0) > t.subtotal) throw new Error('O desconto não pode ser maior que os itens.')
      const agora = new Date().toISOString()
      const atual = await db.buscar<Pedido>('pedidos', d.id)
      if (atual && (atual.status === 'entregue' || atual.status === 'cancelado'))
        throw new Error(`Este pedido já foi ${atual.status === 'entregue' ? 'entregue' : 'cancelado'} (em outro aparelho?). Atualize a tela.`)
      if (atual && atualizado_em_lido && atual.atualizado_em !== atualizado_em_lido)
        throw new Error('Este pedido foi alterado em outro aparelho enquanto você editava. Abra de novo para ver a versão atual.')
      const linha = {
        ...d,
        cliente_nome: d.cliente_nome.trim(),
        telefone: texto(d.telefone),
        entrega_hora: d.entrega_hora?.slice(0, 5) || null,
        endereco: d.entrega_tipo === 'retirada' ? null : texto(d.endereco),
        observacao: texto(d.observacao),
        itens,
        subtotal: t.subtotal,
        desconto: t.desconto,
        taxa_entrega: t.taxaEntrega,
        total: t.total,
        status: atual?.status ?? d.status ?? 'confirmado',
        motivo_cancelamento: null,
        entregue_em: null,
        criado_em: atual?.criado_em ?? agora,
        atualizado_em: agora,
      }
      // Linha completa sempre: o upsert do Supabase cobra as colunas obrigatórias.
      const [salvo] = await db.salvarVarios<Pedido>('pedidos', [linha as Pedido])
      return normalizarPedido(salvo)
    },
    onSuccess: () => invalidar(qc),
  })
}

/** Confirmado ⇄ Pronto. */
export function useMarcarPronto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ pedido, pronto }: { pedido: Pedido; pronto: boolean }) => {
      const atual = await db.buscar<Pedido>('pedidos', pedido.id)
      if (!atual) throw new Error('Pedido não encontrado.')
      if (atual.status === 'entregue' || atual.status === 'cancelado') throw new Error('Este pedido já foi fechado. Atualize a tela.')
      await db.atualizar<Pedido>('pedidos', pedido.id, { status: pronto ? 'pronto' : 'confirmado', atualizado_em: new Date().toISOString() })
    },
    onSettled: () => invalidar(qc),
  })
}

/**
 * Entrega o pedido: baixa no estoque (movimentos com pedido_id, ids gerados por quem chama) e
 * status "entregue". Quem chama confere antes se está pago (o restante é recebido pelo PDV).
 */
export function useEntregarPedido() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ pedido, movimentos }: { pedido: Pedido; movimentos: DadosMovimento[] }) => {
      const atual = await db.buscar<Pedido>('pedidos', pedido.id)
      if (!atual) throw new Error('Pedido não encontrado.')
      if (atual.status === 'cancelado') throw new Error('Este pedido foi cancelado.')
      if (atual.status === 'entregue') return
      const agora = new Date().toISOString()
      // Nova tentativa: apaga a baixa de uma tentativa anterior que não terminou.
      for (const m of await db.listar<Movimento>('estoque_movimentos', { pedido_id: pedido.id })) await db.remover('estoque_movimentos', m.id)
      const linhas = movimentos
        .map((m) => ({ ...m, quantidade: milesimos(m.quantidade), pedido_id: pedido.id, criado_em: agora, atualizado_em: agora }))
        .filter((m) => m.quantidade !== 0)
      if (linhas.length > 0) await db.salvarVarios<Movimento>('estoque_movimentos', linhas as Movimento[])
      await db.atualizar<Pedido>('pedidos', pedido.id, { status: 'entregue', entregue_em: agora, atualizado_em: agora })
      // Entregue ao mesmo tempo no outro celular? Fica a baixa de quem gravou por último.
      const depois = await db.buscar<Pedido>('pedidos', pedido.id)
      if (depois?.entregue_em && new Date(depois.entregue_em).getTime() !== new Date(agora).getTime()) {
        const meus = new Set(linhas.map((m) => m.id))
        for (const m of await db.listar<Movimento>('estoque_movimentos', { pedido_id: pedido.id })) if (meus.has(m.id)) await db.remover('estoque_movimentos', m.id)
      }
    },
    onSettled: () => {
      invalidar(qc)
      qc.invalidateQueries({ queryKey: ['estoque'] })
    },
  })
}

/** Volta um pedido entregue para "pronto" e devolve o que saiu do estoque. */
export function useDesfazerEntrega() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (pedido: Pedido) => {
      for (const m of await db.listar<Movimento>('estoque_movimentos', { pedido_id: pedido.id })) await db.remover('estoque_movimentos', m.id)
      await db.atualizar<Pedido>('pedidos', pedido.id, { status: 'pronto', entregue_em: null, atualizado_em: new Date().toISOString() })
    },
    onSettled: () => {
      invalidar(qc)
      qc.invalidateQueries({ queryKey: ['estoque'] })
    },
  })
}

/**
 * Cancela o pedido (fica registrado, com o motivo). Os pagamentos já recebidos continuam no
 * caixa: se o sinal foi devolvido, quem chama cancela a venda dele (useCancelarVenda).
 */
export function useCancelarPedido() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ pedido, motivo }: { pedido: Pedido; motivo: string }) => {
      const atual = await db.buscar<Pedido>('pedidos', pedido.id)
      if (!atual) throw new Error('Pedido não encontrado.')
      if (atual.status === 'entregue') throw new Error('Este pedido já foi entregue. Desfaça a entrega antes de cancelar.')
      await db.atualizar<Pedido>('pedidos', pedido.id, {
        status: 'cancelado',
        motivo_cancelamento: motivo.trim() || 'Cancelado',
        atualizado_em: new Date().toISOString(),
      })
    },
    onSettled: () => invalidar(qc),
  })
}

/** Reabre um pedido cancelado (volta para "confirmado"). */
export function useReabrirPedido() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pedido: Pedido) =>
      db.atualizar<Pedido>('pedidos', pedido.id, { status: 'confirmado', motivo_cancelamento: null, atualizado_em: new Date().toISOString() }),
    onSettled: () => invalidar(qc),
  })
}

/**
 * Apaga o pedido de vez (só se nunca recebeu pagamento: o dinheiro do caixa ficaria sem pedido).
 * `pagamentos`: as vendas do pedido (useVendasDoPedido).
 */
export function useApagarPedido() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ pedido, pagamentos }: { pedido: Pedido; pagamentos: Venda[] }) => {
      const naNuvem = await db.listar<Venda>('vendas', { pedido_id: pedido.id })
      if ([...naNuvem, ...pagamentos].some((v) => v.status === 'concluida'))
        throw new Error('Este pedido já recebeu pagamento. Cancele o pedido em vez de apagar.')
      // No Supabase o banco faz isso sozinho (on delete cascade / set null); no modo local fazemos igual.
      if (modoLocal) {
        for (const m of await db.listar<Movimento>('estoque_movimentos', { pedido_id: pedido.id })) await db.remover('estoque_movimentos', m.id)
        for (const v of naNuvem) await db.atualizar<Venda>('vendas', v.id, { pedido_id: null })
      }
      await db.remover('pedidos', pedido.id)
      for (const f of pedido.fotos) await apagarFoto(f).catch(() => {})
    },
    onSettled: () => {
      invalidar(qc)
      qc.invalidateQueries({ queryKey: ['estoque'] })
    },
  })
}

// ---- Fotos de referência --------------------------------------------------------------------------

const BUCKET = 'pedidos'

/** Reduz a foto (lado maior até 1280 px, JPEG) para subir rápido no 4G e não lotar o armazenamento. */
export async function reduzirFoto(arquivo: File, lado = 1280, qualidade = 0.8): Promise<Blob> {
  const url = URL.createObjectURL(arquivo)
  try {
    const img = await new Promise<HTMLImageElement>((ok, falha) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = () => falha(new Error('Não deu para abrir esta imagem.'))
      i.src = url
    })
    const escala = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * escala))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * escala))
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((ok, falha) =>
      canvas.toBlob((b) => (b ? ok(b) : falha(new Error('Não deu para preparar a foto.'))), 'image/jpeg', qualidade),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Sobe uma foto de referência do pedido. Devolve o que guardar em `pedido.fotos`. */
export async function enviarFoto(pedidoId: string, arquivo: File): Promise<string> {
  // no modo local a foto vai dentro do pedido (localStorage): menor ainda
  const blob = await reduzirFoto(arquivo, supabase ? 1280 : 640, supabase ? 0.8 : 0.6)
  if (!supabase) {
    return await new Promise<string>((ok, falha) => {
      const r = new FileReader()
      r.onload = () => ok(String(r.result))
      r.onerror = () => falha(new Error('Não deu para ler a foto.'))
      r.readAsDataURL(blob)
    })
  }
  const caminho = `${pedidoId}/${novoId()}.jpg`
  const { error } = await supabase.storage.from(BUCKET).upload(caminho, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw new Error(/fetch|network/i.test(error.message) ? 'Sem conexão com a internet. Tente de novo.' : `Não deu para enviar a foto: ${error.message}`)
  return caminho
}

/** Endereço para mostrar a foto (link temporário de 1 hora no Supabase). */
export async function urlFoto(foto: string): Promise<string> {
  if (foto.startsWith('data:') || !supabase) return foto
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(foto, 3600)
  if (error || !data) throw new Error('Não deu para abrir a foto.')
  return data.signedUrl
}

export function useUrlFoto(foto: string) {
  // no modo local a foto já é a imagem (e os pedidos não vão para o cache do aparelho, ver main.tsx)
  return useQuery({ queryKey: ['pedidos', 'foto', foto], queryFn: () => urlFoto(foto), staleTime: 50 * 60 * 1000, gcTime: 50 * 60 * 1000 })
}

export async function apagarFoto(foto: string): Promise<void> {
  if (foto.startsWith('data:') || !supabase) return
  await supabase.storage.from(BUCKET).remove([foto])
}
