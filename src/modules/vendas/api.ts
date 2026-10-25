import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { centavos } from '../../lib/compras'
import { db } from '../../lib/db'
import { modoLocal } from '../../lib/supabase'
import { CONFIG_PDV_PADRAO, type Canal, type ConfigPdv, type ItemVenda, type Pagamento } from '../../lib/vendas'
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
  feito_por: string | null
  observacao: string | null
  criado_em: string
  atualizado_em: string
}

export type DadosVenda = Omit<Venda, 'atualizado_em'>

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
}

const CHAVE_FILA = 'euforia:vendas-fila'

// Erros em que o banco recusou o valor: tentar de novo daria o mesmo erro (ver src/lib/db.ts).
const ERRO_DEFINITIVO = /fora do permitido|formato inválido|campos obrigatórios|grande demais|comprido demais|não existe mais/i

function criarFila() {
  // O Map nunca é alterado no lugar: cada mudança cria um novo (é o "retrato" que o React lê).
  let pendentes = new Map<string, VendaPendente>()
  let ultimoErro: string | null = null
  let envio: Promise<void> | null = null
  let timer: number | undefined
  const ouvintes = new Set<() => void>()
  let aoEnviar: ((data: string) => void) | null = null

  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_FILA) ?? '[]') as VendaPendente[]
    pendentes = new Map(salvo.map((p) => [p.venda.id, p]))
  } catch {
    /* fila vazia */
  }

  function trocar(novo: Map<string, VendaPendente>) {
    pendentes = novo
    try {
      localStorage.setItem(CHAVE_FILA, JSON.stringify([...pendentes.values()]))
    } catch {
      /* sem espaço: segue só na memória */
    }
    for (const o of ouvintes) o()
  }

  function tirar(id: string, p: VendaPendente) {
    if (pendentes.get(id) !== p) return
    const novo = new Map(pendentes)
    novo.delete(id)
    trocar(novo)
  }

  async function enviarTudo() {
    for (const [id, p] of [...pendentes]) {
      try {
        const agora = new Date().toISOString()
        await db.salvarVarios<Venda>('vendas', [{ ...p.venda, atualizado_em: agora } as Venda])
        if (p.movimentos.length > 0)
          await db.salvarVarios<Movimento>(
            'estoque_movimentos',
            p.movimentos.map((m) => ({ ...m, criado_em: p.venda.criado_em, atualizado_em: agora })) as Movimento[],
          )
        ultimoErro = null
        tirar(id, p)
        aoEnviar?.(p.venda.data)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (!ERRO_DEFINITIVO.test(msg)) {
          ultimoErro = msg
          break
        }
        ultimoErro = `Uma venda não foi salva (${p.venda.total.toFixed(2).replace('.', ',')}): ${msg}`
        tirar(id, p)
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
    adicionar(p: VendaPendente) {
      ultimoErro = null
      const novo = new Map(pendentes)
      novo.set(p.venda.id, p)
      trocar(novo)
      void enviar()
    },
    /** Tira da fila uma venda que ainda não subiu (Desfazer logo depois de vender). */
    descartar(id: string): boolean {
      if (!pendentes.has(id)) return false
      const novo = new Map(pendentes)
      novo.delete(id)
      trocar(novo)
      return true
    },
    enviarAgora: () => enviar(),
    aguardando: () => pendentes.size,
    definirAoEnviar(f: (data: string) => void) {
      aoEnviar = f
    },
  }
}

const fila = criarFila()

/** Quantas vendas deste aparelho ainda não subiram, e o último erro. */
export function useFilaVendas() {
  const pendentes = useSyncExternalStore(fila.assinar, fila.retrato)
  return { aguardando: pendentes.size, erro: fila.erro(), enviarAgora: fila.enviarAgora }
}

/**
 * Registra uma venda: aparece na hora e sobe para a nuvem assim que der.
 * `movimentos`: a baixa no estoque (com venda_id), ids gerados por quem chama.
 */
export function useRegistrarVenda() {
  const qc = useQueryClient()
  useEffect(() => fila.definirAoEnviar((data) => void qc.invalidateQueries({ queryKey: CHAVES.doDia(data) })), [qc])
  return (venda: DadosVenda, movimentos: DadosMovimento[]) => {
    fila.adicionar({
      venda: {
        ...venda,
        subtotal: centavos(venda.subtotal),
        desconto: centavos(venda.desconto),
        total: centavos(venda.subtotal - venda.desconto),
        troco: centavos(venda.troco),
        taxas: centavos(venda.taxas),
        cliente: venda.cliente?.trim() || null,
        observacao: venda.observacao?.trim() || null,
      },
      movimentos: movimentos.filter((m) => m.quantidade !== 0).map((m) => ({ ...m, venda_id: venda.id }) as DadosMovimento),
    })
    void qc.invalidateQueries({ queryKey: ['estoque'] })
  }
}

// ---- Consultas ------------------------------------------------------------------------------

/** Vendas de um dia (AAAA-MM-DD), com as deste aparelho que ainda não subiram; as mais recentes primeiro. */
export function useVendasDoDia(data: string) {
  const consulta = useQuery({
    queryKey: CHAVES.doDia(data),
    queryFn: async () => (await db.listar<Venda>('vendas', { data })).map(normalizarVenda),
  })
  const pendentes = useSyncExternalStore(fila.assinar, fila.retrato)
  const vendas = useMemo(() => {
    if (!consulta.data) return undefined
    const ids = new Set(consulta.data.map((v) => v.id))
    const locais = [...pendentes.values()]
      .filter((p) => p.venda.data === data && !ids.has(p.venda.id))
      .map((p) => normalizarVenda({ ...p.venda, atualizado_em: p.venda.criado_em } as Venda))
    return [...consulta.data, ...locais].sort((a, b) => b.criado_em.localeCompare(a.criado_em))
  }, [consulta.data, pendentes, data])
  return { ...consulta, data: vendas }
}

/** Cancela uma venda (ela continua registrada, com o motivo) e devolve o que saiu do estoque. */
export function useCancelarVenda() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ venda, motivo }: { venda: Venda; motivo: string }) => {
      if (venda.fechamento_id) throw new Error('Este dia já foi fechado. Desfaça o fechamento do caixa para cancelar a venda.')
      // Ainda na fila deste aparelho: some antes de subir.
      if (fila.descartar(venda.id)) return
      const salva = await db.atualizar<Venda>('vendas', venda.id, {
        status: 'cancelada',
        motivo_cancelamento: motivo.trim(),
        atualizado_em: new Date().toISOString(),
      })
      if (!salva) throw new Error('Venda não encontrada.')
      for (const m of await db.listar<Movimento>('estoque_movimentos', { venda_id: venda.id })) await db.remover('estoque_movimentos', m.id)
    },
    onSettled: (_r, _e, { venda }) => {
      qc.invalidateQueries({ queryKey: CHAVES.doDia(venda.data) })
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
      if (fila.aguardando() > 0) throw new Error('Ainda há vendas deste aparelho para enviar. Confira a internet e tente de novo.')
      const agora = new Date().toISOString()
      const f = d.fechamento
      await db.salvarVarios<Fechamento>('caixa_fechamentos', [
        { ...f, fundo_troco: f.fundo_troco == null ? null : centavos(f.fundo_troco), dinheiro_contado: f.dinheiro_contado == null ? null : centavos(f.dinheiro_contado), criado_em: agora, atualizado_em: agora },
      ])
      const lancIds = new Set(d.lancamentos.map((l) => l.id))
      for (const l of await db.listar<Lancamento>('fin_lancamentos', { fechamento_id: f.id })) if (!lancIds.has(l.id)) await db.remover('fin_lancamentos', l.id)
      const titIds = new Set(d.titulos.map((t) => t.id))
      for (const t of await db.listar<Titulo>('fin_titulos', { fechamento_id: f.id })) if (!titIds.has(t.id)) await db.remover('fin_titulos', t.id)
      if (d.titulos.length > 0)
        await db.salvarVarios<Titulo>(
          'fin_titulos',
          d.titulos.map((t) => ({ ...t, valor: centavos(t.valor), fechamento_id: f.id, criado_em: agora, atualizado_em: agora })) as Titulo[],
        )
      if (d.lancamentos.length > 0)
        await db.salvarVarios<Lancamento>(
          'fin_lancamentos',
          d.lancamentos.map((l) => ({ ...l, valor: centavos(l.valor), fechamento_id: f.id, criado_em: agora, atualizado_em: agora })) as Lancamento[],
        )
      for (const v of d.vendas) await db.atualizar<Venda>('vendas', v.id, { fechamento_id: f.id, atualizado_em: agora })
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
