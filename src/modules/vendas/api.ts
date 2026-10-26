import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { log } from '../../lib/log'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { centavos } from '../../lib/compras'
import { db } from '../../lib/db'
import { modoLocal } from '../../lib/supabase'
import { milesimos } from '../../lib/estoque'
import {
  CONFIG_PDV_PADRAO,
  faltaPagar,
  pagamentosComTaxa,
  totaisVenda,
  type Canal,
  type ConfigPdv,
  type ItemVenda,
  type Pagamento,
} from '../../lib/vendas'
import type { DadosMovimento, Movimento } from '../estoque/api'
import type { DadosLancamento, DadosTitulo, Lancamento, Titulo } from '../financeiro/api'

// PDV. Ver supabase/migrations/0008_pdv.sql.
// A venda vai para uma fila guardada no aparelho e sobe assim que der: no balcão não dá para
// esperar a internet. Cada venda é uma linha (itens e pagamentos dentro, em JSON), e a baixa no
// estoque vai junto (movimentos com venda_id).

export interface Venda {
  id: string
  data: string
  canal: Canal
  cliente: string | null
  itens: ItemVenda[]
  pagamentos: Pagamento[]
  subtotal: number
  desconto: number
  total: number
  troco: number
  taxas: number
  status: 'concluida' | 'cancelada'
  motivo_cancelamento: string | null
  fechamento_id: string | null
  /** pagamento (sinal ou restante) de um pedido; ver src/modules/pedidos/api.ts */
  pedido_id?: string | null
  feito_por: string | null
  observacao: string | null
  criado_em: string
  atualizado_em: string
  /** só na tela: venda deste aparelho que ainda não subiu para a nuvem */
  pendente?: boolean
}

export type DadosVenda = Omit<Venda, 'atualizado_em' | 'pendente'>

export interface Fechamento {
  id: string
  data: string
  totais: Record<string, unknown>
  fundo_troco: number | null
  dinheiro_contado: number | null
  observacao: string | null
  feito_por: string | null
  criado_em: string
  atualizado_em: string
}

const CHAVES = {
  vendas: ['vendas'],
  doDia: (data: string) => ['vendas', 'dia', data],
  doPedido: (pedidoId: string) => ['vendas', 'pedido', pedidoId],
  config: ['pdv_config'],
  fechamentos: ['vendas', 'fechamentos'],
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))

function normalizarVenda(v: Venda): Venda {
  return {
    ...v,
    itens: (Array.isArray(v.itens) ? v.itens : []).map((i) => ({ ...i, qtd: Number(i.qtd), preco: Number(i.preco) })),
    pagamentos: (Array.isArray(v.pagamentos) ? v.pagamentos : []).map((p) => ({ ...p, valor: Number(p.valor) })),
    subtotal: Number(v.subtotal),
    desconto: Number(v.desconto ?? 0),
    total: Number(v.total),
    troco: Number(v.troco ?? 0),
    taxas: Number(v.taxas ?? 0),
    fechamento_id: v.fechamento_id ?? null,
    pedido_id: v.pedido_id ?? null,
  }
}

function normalizarFechamento(f: Fechamento): Fechamento {
  return { ...f, fundo_troco: num(f.fundo_troco), dinheiro_contado: num(f.dinheiro_contado), totais: f.totais ?? {} }
}

// ---- Configuração ---------------------------------------------------------------------------

interface LinhaConfigPdv extends ConfigPdv {
  id: string
}

export function useConfigPdv() {
  return useQuery({
    queryKey: CHAVES.config,
    queryFn: async (): Promise<ConfigPdv> => {
      const l = await db.buscar<LinhaConfigPdv>('pdv_config', 'padrao')
      if (!l) return CONFIG_PDV_PADRAO
      return {
        taxa_debito: Number(l.taxa_debito),
        taxa_credito: Number(l.taxa_credito),
        taxa_pix: Number(l.taxa_pix),
        comissao_ifood: Number(l.comissao_ifood),
        acrescimo_ifood: Number(l.acrescimo_ifood),
        prazo_debito: Number(l.prazo_debito),
        prazo_credito: Number(l.prazo_credito),
        prazo_ifood: Number(l.prazo_ifood),
        conta_caixa_id: l.conta_caixa_id ?? null,
        conta_banco_id: l.conta_banco_id ?? null,
        fundo_troco: Number(l.fundo_troco ?? 0),
        pct_sinal: l.pct_sinal == null ? CONFIG_PDV_PADRAO.pct_sinal : Number(l.pct_sinal),
      }
    },
  })
}

export function useSalvarConfigPdv() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (c: ConfigPdv) =>
      db.salvar<LinhaConfigPdv>('pdv_config', { ...c, id: 'padrao', atualizado_em: new Date().toISOString() } as LinhaConfigPdv),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVES.config }),
  })
}

// ---- Fila de vendas (funciona sem internet) ----------------------------------------------------

interface VendaPendente {
  venda: DadosVenda
  movimentos: DadosMovimento[]
  /** a venda já está na nuvem (falta só a baixa no estoque) */
  vendaSalva?: boolean
}

const CHAVE_FILA = 'euforia:vendas-fila'
const CHAVE_PERDIDAS = 'euforia:vendas-perdidas'

// Erros em que o banco recusou o valor: tentar de novo daria o mesmo erro (ver src/lib/db.ts).
const ERRO_DEFINITIVO = /fora do permitido|formato inválido|campos obrigatórios|grande demais|comprido demais|não existe mais|ligado a um registro/i

const reais = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`

function criarFila() {
  // O Map nunca é alterado no lugar: cada mudança cria um novo (é o "retrato" que o React lê).
  let pendentes = new Map<string, VendaPendente>()
  /** erro passageiro (internet, sessão): some quando um envio dá certo */
  let ultimoErro: string | null = null
  /** vendas descartadas pelo banco: ficam avisando até alguém dispensar */
  let perdidas: string[] = []
  let envio: Promise<void> | null = null
  let timer: number | undefined
  const ouvintes = new Set<() => void>()
  let aoEnviar: ((data: string) => Promise<unknown>) | null = null

  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_FILA) ?? '[]') as VendaPendente[]
    pendentes = new Map(salvo.map((p) => [p.venda.id, p]))
    perdidas = JSON.parse(localStorage.getItem(CHAVE_PERDIDAS) ?? '[]') as string[]
  } catch {
    /* fila vazia */
  }

  function trocar(novo: Map<string, VendaPendente>) {
    pendentes = novo
    try {
      localStorage.setItem(CHAVE_FILA, JSON.stringify([...pendentes.values()]))
      localStorage.setItem(CHAVE_PERDIDAS, JSON.stringify(perdidas))
    } catch {
      /* sem espaço: segue só na memória */
    }
    for (const o of ouvintes) o()
  }

  function tirar(id: string) {
    if (!pendentes.has(id)) return
    const novo = new Map(pendentes)
    novo.delete(id)
    trocar(novo)
  }

  function marcarSalva(id: string) {
    const p = pendentes.get(id)
    if (!p || p.vendaSalva) return
    trocar(new Map(pendentes).set(id, { ...p, vendaSalva: true }))
  }

  async function enviarTudo() {
    for (const [id, p] of [...pendentes]) {
      const agora = new Date().toISOString()
      let etapa: 'venda' | 'estoque' = 'venda'
      try {
        // Só cria a venda: se ela já existe (tentativa anterior), não regrava por cima — o outro
        // celular pode ter cancelado ou fechado o caixa nesse meio-tempo.
        if (!p.vendaSalva && !(await db.buscar<Venda>('vendas', id))) {
          await db.salvarVarios<Venda>('vendas', [{ ...p.venda, atualizado_em: agora } as Venda])
        }
        marcarSalva(id)
        etapa = 'estoque'
        // Cancelada (Desfazer) enquanto subia: não dá baixa no estoque.
        if (pendentes.has(id) && p.movimentos.length > 0) {
          await db.salvarVarios<Movimento>(
            'estoque_movimentos',
            p.movimentos.map((m) => ({ ...m, criado_em: p.venda.criado_em, atualizado_em: agora })) as Movimento[],
          )
        }
        ultimoErro = null
        log.info('fila-vendas', `Venda enviada (${reais(p.venda.total)})`, { venda: id, pedido: p.venda.pedido_id ?? null })
        // Busca a lista de novo antes de tirar da fila (senão a venda some da tela por um instante).
        await aoEnviar?.(p.venda.data)?.catch(() => {})
        tirar(id)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (etapa === 'venda' && p.venda.pedido_id && /não existe mais|ligado a um registro/i.test(msg)) {
          // O pedido foi apagado em outro aparelho, mas o dinheiro entrou: guarda a venda sem o pedido.
          log.warn('fila-vendas', 'Pedido apagado em outro aparelho: a venda sobe sem o pedido', { venda: id, pedido: p.venda.pedido_id })
          trocar(new Map(pendentes).set(id, { ...p, venda: { ...p.venda, pedido_id: null } }))
          continue
        }
        if (!ERRO_DEFINITIVO.test(msg)) {
          ultimoErro = msg
          log.warn('fila-vendas', `Envio adiado (${pendentes.size} na fila): ${msg}`, { venda: id, etapa })
          break
        }
        log.error('fila-vendas', `Venda recusada pelo banco (etapa ${etapa}): ${msg}`, { venda: id, total: p.venda.total })
        perdidas = [
          ...perdidas,
          etapa === 'venda'
            ? `A venda de ${reais(p.venda.total)} (${p.venda.data.split('-').reverse().join('/')}) não foi salva: ${msg}`
            : `A venda de ${reais(p.venda.total)} foi salva, mas a baixa no estoque não: ${msg}`,
        ]
        tirar(id)
      }
    }
  }

  async function enviar(): Promise<void> {
    if (envio) {
      await envio
      if (pendentes.size === 0) return
      if (envio) return envio
    }
    if (pendentes.size === 0) return
    envio = enviarTudo().finally(() => {
      envio = null
      trocar(new Map(pendentes))
      agendar()
    })
    return envio
  }

  function agendar() {
    window.clearTimeout(timer)
    if (pendentes.size > 0) timer = window.setTimeout(() => void enviar(), 5000)
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => void enviar())
    if (pendentes.size > 0) agendar()
  }

  return {
    assinar(o: () => void) {
      ouvintes.add(o)
      return () => ouvintes.delete(o)
    },
    retrato: () => pendentes,
    erro: () => ultimoErro,
    perdidas: () => perdidas,
    dispensarPerdidas() {
      perdidas = []
      trocar(new Map(pendentes))
    },
    adicionar(p: VendaPendente) {
      ultimoErro = null
      log.info('fila-vendas', `Venda registrada (${reais(p.venda.total)}), na fila para enviar`, {
        venda: p.venda.id,
        canal: p.venda.canal,
        itens: p.venda.itens.length,
        baixas: p.movimentos.length,
        pedido: p.venda.pedido_id ?? null,
      })
      trocar(new Map(pendentes).set(p.venda.id, p))
      void enviar()
    },
    /**
     * Tira da fila (Desfazer logo depois de vender). Devolve se a venda pode já estar na nuvem
     * (aí quem chama também cancela lá).
     */
    descartar(id: string): { estava: boolean; talvezNaNuvem: boolean } {
      const p = pendentes.get(id)
      if (!p) return { estava: false, talvezNaNuvem: true }
      tirar(id)
      return { estava: true, talvezNaNuvem: !!p.vendaSalva || envio !== null }
    },
    enviarAgora: () => enviar(),
    aguardando: (data?: string) => [...pendentes.values()].filter((p) => !data || p.venda.data === data).length,
    definirAoEnviar(f: (data: string) => Promise<unknown>) {
      aoEnviar = f
    },
  }
}

const fila = criarFila()

/** Liga a fila ao cache da tela: quando uma venda sobe, a lista do dia é buscada de novo. */
function useLigarFila() {
  const qc = useQueryClient()
  useEffect(
    () =>
      fila.definirAoEnviar((data) =>
        // a baixa no estoque também acabou de subir ("restam N" na tela de vender)
        Promise.all([
          qc.invalidateQueries({ queryKey: CHAVES.doDia(data) }),
          qc.invalidateQueries({ queryKey: ['vendas', 'pedido'] }),
          qc.invalidateQueries({ queryKey: ['estoque'] }),
        ]),
      ),
    [qc],
  )
}

/** Vendas deste aparelho que ainda não subiram, o último erro e as vendas que o banco recusou. */
export function useFilaVendas() {
  useLigarFila()
  const pendentes = useSyncExternalStore(fila.assinar, fila.retrato)
  return {
    aguardando: pendentes.size,
    erro: fila.erro(),
    perdidas: fila.perdidas(),
    dispensarPerdidas: fila.dispensarPerdidas,
    enviarAgora: fila.enviarAgora,
  }
}

/**
 * Registra uma venda: aparece na hora e sobe para a nuvem assim que der.
 * `movimentos`: a baixa no estoque (com venda_id), ids gerados por quem chama.
 * Confere a venda antes (o banco recusaria e ela se perderia depois de a cliente ir embora):
 * lança um erro com a mensagem para mostrar na tela.
 */
export function useRegistrarVenda() {
  const qc = useQueryClient()
  useLigarFila()
  const config = useConfigPdv()
  return (venda: DadosVenda, movimentos: DadosMovimento[]) => {
    const itens = venda.itens.filter((i) => i.qtd > 0)
    if (itens.length === 0) throw new Error('A venda não tem itens.')
    if (itens.some((i) => !(i.preco >= 0))) throw new Error('Algum item está sem preço.')
    const t = totaisVenda(itens, venda.desconto)
    if (!(venda.desconto >= 0) || centavos(venda.desconto) > t.subtotal) throw new Error('O desconto não pode ser maior que a venda.')
    const pagamentos = pagamentosComTaxa(venda.pagamentos, config.data ?? CONFIG_PDV_PADRAO)
    if (pagamentos.length === 0) throw new Error('Escolha a forma de pagamento.')
    const falta = faltaPagar(t.total, pagamentos)
    if (falta !== 0)
      throw new Error(falta > 0 ? `Ainda falta receber ${reais(falta)}.` : `Os pagamentos passam do total em ${reais(-falta)}.`)
    fila.adicionar({
      venda: {
        ...venda,
        itens,
        pagamentos,
        subtotal: t.subtotal,
        desconto: t.desconto,
        total: t.total,
        troco: Math.max(0, centavos(venda.troco)),
        taxas: centavos(pagamentos.reduce((s, p) => s + p.taxa, 0)),
        cliente: venda.cliente?.trim() || null,
        observacao: venda.observacao?.trim() || null,
      },
      movimentos: movimentos
        .map((m) => ({ ...m, quantidade: milesimos(m.quantidade), venda_id: venda.id }) as DadosMovimento)
        .filter((m) => m.quantidade !== 0),
    })
    void qc.invalidateQueries({ queryKey: ['estoque'] })
  }
}

// ---- Consultas ------------------------------------------------------------------------------

/** Vendas de um dia (AAAA-MM-DD), com as deste aparelho que ainda não subiram; as mais recentes primeiro. */
export function useVendasDoDia(data: string) {
  useLigarFila()
  const consulta = useQuery({
    queryKey: CHAVES.doDia(data),
    queryFn: async () => (await db.listar<Venda>('vendas', { data })).map(normalizarVenda),
  })
  const pendentes = useSyncExternalStore(fila.assinar, fila.retrato)
  const vendas = useMemo(() => {
    const locais = [...pendentes.values()].filter((p) => p.venda.data === data)
    // Sem a lista da nuvem (sem internet na primeira vez), mostra ao menos as deste aparelho.
    if (!consulta.data && locais.length === 0) return undefined
    const daNuvem = consulta.data ?? []
    const ids = new Set(daNuvem.map((v) => v.id))
    const soLocais = locais
      .filter((p) => !ids.has(p.venda.id))
      .map((p) => ({ ...normalizarVenda({ ...p.venda, atualizado_em: p.venda.criado_em } as Venda), pendente: true }))
    return [...daNuvem, ...soLocais].sort((a, b) => b.criado_em.localeCompare(a.criado_em))
  }, [consulta.data, pendentes, data])
  return { ...consulta, data: vendas }
}

/**
 * Pagamentos de um pedido (vendas com pedido_id), com os deste aparelho que ainda não subiram;
 * os mais antigos primeiro.
 */
export function useVendasDoPedido(pedidoId: string | undefined) {
  useLigarFila()
  const consulta = useQuery({
    queryKey: CHAVES.doPedido(pedidoId ?? ''),
    queryFn: async () => (await db.listar<Venda>('vendas', { pedido_id: pedidoId! })).map(normalizarVenda),
    enabled: !!pedidoId,
  })
  const pendentes = useSyncExternalStore(fila.assinar, fila.retrato)
  const vendas = useMemo(() => {
    if (!pedidoId) return undefined
    const locais = [...pendentes.values()].filter((p) => p.venda.pedido_id === pedidoId)
    if (!consulta.data && locais.length === 0) return undefined
    const daNuvem = consulta.data ?? []
    const ids = new Set(daNuvem.map((v) => v.id))
    const soLocais = locais
      .filter((p) => !ids.has(p.venda.id))
      .map((p) => ({ ...normalizarVenda({ ...p.venda, atualizado_em: p.venda.criado_em } as Venda), pendente: true }))
    return [...daNuvem, ...soLocais].sort((a, b) => a.criado_em.localeCompare(b.criado_em))
  }, [consulta.data, pendentes, pedidoId])
  return { ...consulta, data: vendas }
}

/** Cancela uma venda (ela continua registrada, com o motivo) e devolve o que saiu do estoque. */
export function useCancelarVenda() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ venda, motivo }: { venda: Venda; motivo: string }) => {
      if (venda.fechamento_id) throw new Error('Este dia já foi fechado. Desfaça o fechamento do caixa para cancelar a venda.')
      // Ainda na fila deste aparelho: some antes de subir (se já pode ter subido, cancela lá também).
      const { estava, talvezNaNuvem } = fila.descartar(venda.id)
      if (estava && !talvezNaNuvem) return
      const atual = await db.buscar<Venda>('vendas', venda.id)
      if (!atual) {
        if (estava) return
        throw new Error('Venda não encontrada.')
      }
      if (atual.fechamento_id) throw new Error('Este dia já foi fechado. Desfaça o fechamento do caixa para cancelar a venda.')
      // Primeiro devolve o estoque, depois marca como cancelada: se algo falhar no meio, a venda
      // continua "concluída" e dá para cancelar de novo.
      for (const m of await db.listar<Movimento>('estoque_movimentos', { venda_id: venda.id })) await db.remover('estoque_movimentos', m.id)
      await db.atualizar<Venda>('vendas', venda.id, {
        status: 'cancelada',
        motivo_cancelamento: motivo.trim() || 'Cancelada',
        atualizado_em: new Date().toISOString(),
      })
    },
    onSettled: (_r, _e, { venda }) => {
      qc.invalidateQueries({ queryKey: CHAVES.doDia(venda.data) })
      if (venda.pedido_id) qc.invalidateQueries({ queryKey: CHAVES.doPedido(venda.pedido_id) })
      qc.invalidateQueries({ queryKey: ['estoque'] })
    },
  })
}

// ---- Fechamento do caixa ---------------------------------------------------------------------

export function useFechamentos() {
  return useQuery({
    queryKey: CHAVES.fechamentos,
    queryFn: async () =>
      (await db.listar<Fechamento>('caixa_fechamentos', undefined, { coluna: 'data', crescente: false })).map(normalizarFechamento),
  })
}

export interface DadosFechamentoCaixa {
  fechamento: Omit<Fechamento, 'criado_em' | 'atualizado_em'>
  /** vendas concluídas do dia que entram neste fechamento */
  vendas: Venda[]
  /** ids gerados uma vez na tela (tentar de novo não duplica) */
  lancamentos: (DadosLancamento & { id: string })[]
  titulos: (DadosTitulo & { id: string; forma_pdv: 'pix' | 'debito' | 'credito' | 'ifood' })[]
}

/**
 * Fecha o caixa do dia: guarda o resumo, lança o dinheiro no caixa e as contas a receber (Pix,
 * cartão, iFood) no Financeiro, e marca as vendas como fechadas. Numa nova tentativa, apaga o que
 * uma tentativa anterior gravou e não vale mais.
 */
export function useFecharCaixa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (d: DadosFechamentoCaixa) => {
      await fila.enviarAgora()
      if (fila.aguardando(d.fechamento.data) > 0)
        throw new Error('Ainda há vendas deste dia neste aparelho para enviar. Confira a internet e tente de novo.')
      const agora = new Date().toISOString()
      // Um fechamento por dia: se uma tentativa anterior (ou o outro celular) já criou o deste dia,
      // usa o mesmo (o banco recusaria um segundo).
      const existente = (await db.listar<Fechamento>('caixa_fechamentos', { data: d.fechamento.data }))[0]
      const id = existente?.id ?? d.fechamento.id
      // Confere com a nuvem as vendas do dia: chegou venda nova (outro celular) ou alguma foi
      // cancelada desde que a tela abriu? Aí os totais da tela estão errados.
      const naNuvem = (await db.listar<Venda>('vendas', { data: d.fechamento.data }))
        .map(normalizarVenda)
        .filter((v) => v.status === 'concluida' && (!v.fechamento_id || v.fechamento_id === id))
      const daTela = new Set(d.vendas.map((v) => v.id))
      if (naNuvem.length !== daTela.size || naNuvem.some((v) => !daTela.has(v.id)))
        throw new Error('As vendas do dia mudaram (venda nova ou cancelada em outro aparelho). Confira os totais e feche de novo.')
      const f = { ...d.fechamento, id }
      await db.salvarVarios<Fechamento>('caixa_fechamentos', [
        {
          ...f,
          fundo_troco: f.fundo_troco == null ? null : centavos(f.fundo_troco),
          dinheiro_contado: f.dinheiro_contado == null ? null : centavos(f.dinheiro_contado),
          criado_em: existente?.criado_em ?? agora,
          atualizado_em: agora,
        },
      ])
      const lancIds = new Set(d.lancamentos.map((l) => l.id))
      for (const l of await db.listar<Lancamento>('fin_lancamentos', { fechamento_id: id })) if (!lancIds.has(l.id)) await db.remover('fin_lancamentos', l.id)
      const titIds = new Set(d.titulos.map((t) => t.id))
      for (const t of await db.listar<Titulo>('fin_titulos', { fechamento_id: id })) if (!titIds.has(t.id)) await db.remover('fin_titulos', t.id)
      if (d.titulos.length > 0)
        await db.salvarVarios<Titulo>(
          'fin_titulos',
          d.titulos.map((t) => ({ ...t, valor: centavos(t.valor), fechamento_id: id, criado_em: agora, atualizado_em: agora })) as Titulo[],
        )
      if (d.lancamentos.length > 0)
        await db.salvarVarios<Lancamento>(
          'fin_lancamentos',
          d.lancamentos.map((l) => ({ ...l, valor: centavos(l.valor), fechamento_id: id, criado_em: agora, atualizado_em: agora })) as Lancamento[],
        )
      for (const v of naNuvem) {
        if (v.fechamento_id === id) continue
        if (!(await db.atualizar<Venda>('vendas', v.id, { fechamento_id: id, atualizado_em: agora })))
          throw new Error('Uma venda do dia não foi encontrada. Atualize a tela e feche de novo.')
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: CHAVES.vendas })
      qc.invalidateQueries({ queryKey: ['fin'] })
    },
  })
}

/**
 * Desfaz um fechamento: apaga o que ele lançou no Financeiro e reabre as vendas do dia.
 * Não deixa se alguma conta a receber dele já teve baixa (ex.: o extrato já foi importado).
 */
export function useDesfazerFechamento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (f: Fechamento) => {
      const titulos = await db.listar<Titulo>('fin_titulos', { fechamento_id: f.id })
      for (const t of titulos) {
        if ((await db.listar<Lancamento>('fin_lancamentos', { titulo_id: t.id })).length > 0)
          throw new Error(`"${t.descricao}" já recebeu baixa no Financeiro. Desfaça a baixa antes de reabrir o caixa.`)
      }
      // No Supabase lançamentos e contas saem juntos (on delete cascade) e as vendas voltam a ficar
      // abertas (on delete set null); no modo local fazemos igual.
      if (modoLocal) {
        for (const t of titulos) await db.remover('fin_titulos', t.id)
        for (const l of await db.listar<Lancamento>('fin_lancamentos', { fechamento_id: f.id })) await db.remover('fin_lancamentos', l.id)
        for (const v of await db.listar<Venda>('vendas', { fechamento_id: f.id })) await db.atualizar<Venda>('vendas', v.id, { fechamento_id: null })
      }
      await db.remover('caixa_fechamentos', f.id)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: CHAVES.vendas })
      qc.invalidateQueries({ queryKey: ['fin'] })
    },
  })
}
