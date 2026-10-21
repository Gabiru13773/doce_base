import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useSyncExternalStore } from 'react'
import { mesclarPendentes, type ItemCompraCalc, type PrecoHistorico } from '../../lib/compras'
import { db, novoId } from '../../lib/db'
import { modoLocal } from '../../lib/supabase'
import type { UnidadeCompra } from '../../lib/unidades'
import type { DadosLancamento, DadosTitulo, Lancamento, Titulo } from '../financeiro/api'
import type { Insumo } from '../insumos/api'

// Compras: a lista é montada com os insumos cadastrados e feita no mercado pelos dois ao
// mesmo tempo. Cada item é uma linha própria no banco, então marcar um item não atrapalha o
// outro celular. As marcações vão para uma fila guardada no aparelho e sobem assim que der
// (mercado costuma ter sinal ruim); enquanto não sobem, a marcação daqui vale na tela.

export type StatusCompra = 'aberta' | 'finalizada'

export interface Compra {
  id: string
  nome: string
  local: string | null
  data: string
  status: StatusCompra
  total: number | null
  finalizada_em: string | null
  observacao: string | null
  criado_em: string
  atualizado_em: string
}

export interface ItemCompra extends ItemCompraCalc {
  compra_id: string
  motivo: string | null
  sub_nome: string | null
  marcado_por: string | null
  ordem: number
  criado_em: string
  atualizado_em: string
}

export type DadosCompra = Omit<Compra, 'id' | 'criado_em' | 'atualizado_em'> & { id?: string }
export type DadosItemCompra = Omit<ItemCompra, 'criado_em' | 'atualizado_em'>

export const MOTIVOS_NAO = ['Não tinha', 'Preço alto', 'Não encontrei', 'Ainda tenho em casa']
export const MOTIVOS_TROCA = ['Preço alto', 'Não tinha a marca', 'Embalagem melhor']

const CHAVE = ['compras']
const chaveItens = (compraId: string) => ['compras', 'itens', compraId]

// O Supabase devolve colunas "numeric" como texto.
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
const centavos = (n: number) => Math.round(n * 100) / 100

function normalizarCompra(c: Compra): Compra {
  return { ...c, total: num(c.total) }
}

function normalizarItem(i: ItemCompra): ItemCompra {
  return {
    ...i,
    qtd_pedida: Number(i.qtd_pedida),
    embalagem_qtd: Number(i.embalagem_qtd),
    qtd_comprada: num(i.qtd_comprada),
    preco_pago: num(i.preco_pago),
    ordem: Number(i.ordem) || 0,
    fora_da_lista: !!i.fora_da_lista,
  }
}

/** Copia a embalagem do insumo para um item novo da lista. */
export function itemDoInsumo(
  compraId: string,
  insumo: Pick<Insumo, 'id' | 'nome' | 'qtd_compra' | 'unidade_compra'>,
  qtd: number,
  ordem: number,
  foraDaLista = false,
): DadosItemCompra {
  return {
    id: novoId(),
    compra_id: compraId,
    insumo_id: insumo.id,
    nome: insumo.nome,
    qtd_pedida: qtd,
    embalagem_qtd: insumo.qtd_compra,
    embalagem_unidade: insumo.unidade_compra,
    status: 'pendente',
    qtd_comprada: null,
    preco_pago: null,
    motivo: null,
    sub_insumo_id: null,
    sub_nome: null,
    fora_da_lista: foraDaLista,
    marcado_por: null,
    ordem,
  }
}

// ---- Compras ------------------------------------------------------------------------------

/** Todas as compras, as mais recentes primeiro. */
export function useCompras() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: async () =>
      (await db.listar<Compra>('compras', undefined, { coluna: 'data', crescente: false })).map(normalizarCompra),
  })
}

export function useSalvarCompra() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ dados, novo }: { dados: DadosCompra; novo: boolean }) => {
      const agora = new Date().toISOString()
      return db.salvar<Compra>('compras', {
        ...dados,
        nome: dados.nome.trim(),
        local: dados.local?.trim() || null,
        observacao: dados.observacao?.trim() || null,
        ...(novo ? { criado_em: agora } : {}),
        atualizado_em: agora,
      } as Omit<Compra, 'id'>)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  })
}

/** Apaga uma compra (e os itens dela). */
export function useRemoverCompra() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      // No Supabase os itens saem juntos (on delete cascade); no modo local fazemos igual.
      if (modoLocal) for (const i of await db.listar<ItemCompra>('compra_itens', { compra_id: id })) await db.remover('compra_itens', i.id)
      await db.remover('compras', id)
      fila.descartarCompra(id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  })
}

// ---- Itens --------------------------------------------------------------------------------

/**
 * Itens de uma compra, já com as marcações deste aparelho que ainda não subiram.
 * `aoVivo`: busca de novo a cada 4 segundos (para ver o que o outro celular marcou).
 */
export function useItensCompra(compraId: string | undefined, aoVivo = false) {
  const consulta = useQuery({
    queryKey: chaveItens(compraId ?? ''),
    enabled: !!compraId,
    refetchInterval: aoVivo ? 4000 : false,
    queryFn: async () =>
      (await db.listar<ItemCompra>('compra_itens', { compra_id: compraId! }, { coluna: 'ordem' })).map(normalizarItem),
  })
  const pendentes = useSyncExternalStore(fila.assinar, fila.retrato)
  const itens = useMemo(() => {
    if (!consulta.data) return undefined
    const daCompra = new Map([...pendentes].filter(([, p]) => p.item.compra_id === compraId).map(([id, p]) => [id, p.item]))
    return mesclarPendentes(consulta.data, daCompra).sort((a, b) => a.ordem - b.ordem)
  }, [consulta.data, pendentes, compraId])
  return { ...consulta, data: itens }
}

/** Grava itens da lista (montar ou editar a lista), tudo ou nada. */
export function useSalvarItensCompra() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ novos, lista }: { novos: boolean; lista: DadosItemCompra[] }) => {
      const agora = new Date().toISOString()
      return db.salvarVarios<ItemCompra>(
        'compra_itens',
        lista.map((i) => ({ ...i, nome: i.nome.trim(), ...(novos ? { criado_em: agora } : {}), atualizado_em: agora }) as ItemCompra),
      )
    },
    onSuccess: (_r, { lista }) => {
      for (const id of new Set(lista.map((i) => i.compra_id))) qc.invalidateQueries({ queryKey: chaveItens(id) })
    },
  })
}

export function useRemoverItemCompra() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (item: Pick<ItemCompra, 'id' | 'compra_id'>) => db.remover('compra_itens', item.id),
    onSuccess: (_r, item) => qc.invalidateQueries({ queryKey: chaveItens(item.compra_id) }),
  })
}

// ---- Fila de marcações (Peguei / Trocar / Não levei) ----------------------------------------

interface Pendente {
  item: DadosItemCompra
  /** muda a cada marcação: só tira da fila se não foi marcado de novo enquanto subia */
  versao: number
}

const CHAVE_FILA = 'euforia:compra-fila'

function criarFila() {
  let pendentes = new Map<string, Pendente>()
  let ultimoErro: string | null = null
  let enviando = false
  let timer: number | undefined
  const ouvintes = new Set<() => void>()
  let aoEnviar: ((compraId: string) => void) | null = null

  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_FILA) ?? '[]') as Pendente[]
    pendentes = new Map(salvo.map((p) => [p.item.id, p]))
  } catch {
    /* fila vazia */
  }

  function gravar() {
    try {
      localStorage.setItem(CHAVE_FILA, JSON.stringify([...pendentes.values()]))
    } catch {
      /* sem espaço: segue só na memória */
    }
  }

  function avisar() {
    pendentes = new Map(pendentes) // retrato novo para o React perceber a mudança
    for (const o of ouvintes) o()
  }

  async function enviar() {
    if (enviando || pendentes.size === 0) return
    enviando = true
    try {
      for (const [id, p] of [...pendentes]) {
        try {
          await db.salvar<ItemCompra>('compra_itens', { ...p.item, atualizado_em: new Date().toISOString() } as ItemCompra)
          if (pendentes.get(id)?.versao === p.versao) pendentes.delete(id)
          ultimoErro = null
          aoEnviar?.(p.item.compra_id)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          // Sem internet ou sessão vencida: tenta de novo depois. Outro erro não se resolve
          // tentando de novo (ex.: o item foi apagado no outro celular): descarta e avisa.
          if (/conexão|sessão/i.test(msg)) {
            ultimoErro = msg
            break
          }
          if (pendentes.get(id)?.versao === p.versao) pendentes.delete(id)
          ultimoErro = `Uma marcação não foi salva: ${msg}`
        }
      }
    } finally {
      enviando = false
      gravar()
      avisar()
      agendar()
    }
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
    marcar(item: DadosItemCompra) {
      pendentes.set(item.id, { item, versao: (pendentes.get(item.id)?.versao ?? 0) + 1 })
      gravar()
      avisar()
      void enviar()
    },
    descartarCompra(compraId: string) {
      for (const [id, p] of pendentes) if (p.item.compra_id === compraId) pendentes.delete(id)
      gravar()
      avisar()
    },
    enviarAgora: () => enviar(),
    definirAoEnviar(f: (compraId: string) => void) {
      aoEnviar = f
    },
  }
}

const fila = criarFila()

/**
 * Marca um item (Peguei, Trocar, Não levei, Voltar para "Faltam", item fora da lista).
 * Mande o item inteiro, já alterado. Aparece na hora; sobe para a nuvem assim que der.
 */
export function useMarcarItem() {
  const qc = useQueryClient()
  fila.definirAoEnviar((compraId) => void qc.invalidateQueries({ queryKey: chaveItens(compraId) }))
  return (item: DadosItemCompra) => {
    const { criado_em: _c, atualizado_em: _a, ...dados } = item as ItemCompra
    fila.marcar({ ...dados, preco_pago: dados.preco_pago == null ? null : centavos(dados.preco_pago) })
  }
}

/** Quantas marcações desta compra ainda não subiram, e o último erro (se houver). */
export function useFilaCompra(compraId: string | undefined) {
  const pendentes = useSyncExternalStore(fila.assinar, fila.retrato)
  const aguardando = [...pendentes.values()].filter((p) => p.item.compra_id === compraId).length
  return { aguardando, erro: fila.erro(), enviarAgora: fila.enviarAgora }
}

// ---- Histórico de preços ------------------------------------------------------------------

export type PrecoGuardado = PrecoHistorico & { id: string; insumo_id: string; compra_id: string | null; local: string | null }

/** Histórico de preços de todos os insumos, agrupado por insumo (para mostrar último/menor/maior). */
export function useHistoricoPorInsumo() {
  return useQuery({
    queryKey: ['precos_insumo', 'todos'],
    queryFn: async () => {
      const linhas = await db.listar<PrecoGuardado>('precos_insumo', undefined, { coluna: 'registrado_em' })
      const mapa = new Map<string, PrecoGuardado[]>()
      for (const l of linhas) {
        const p = {
          ...l,
          qtd_compra: Number(l.qtd_compra),
          preco_compra: Number(l.preco_compra),
          unidade_compra: l.unidade_compra as UnidadeCompra,
          compra_id: l.compra_id ?? null,
          local: l.local ?? null,
        }
        mapa.set(l.insumo_id, [...(mapa.get(l.insumo_id) ?? []), p])
      }
      return mapa
    },
  })
}

// ---- Finalizar ----------------------------------------------------------------------------

export interface DadosFinalizacao {
  compra: Compra
  /** total pago na nota */
  total: number
  /** linhas do histórico de preços, com id gerado uma vez na tela (tentar de novo não duplica) */
  historico: { id: string; insumo_id: string; qtd_compra: number; unidade_compra: UnidadeCompra; preco_compra: number }[]
  /** insumos com o custo novo (registro inteiro, já alterado) */
  insumos: Insumo[]
  /** pago na hora: lançamento(s) de saída; a pagar: conta(s) a pagar. Ids gerados uma vez na tela. */
  lancamentos: (DadosLancamento & { id: string })[]
  titulos: (DadosTitulo & { id: string })[]
}

/**
 * Finaliza a compra: guarda os preços no histórico, atualiza o custo dos insumos escolhidos,
 * lança no Financeiro e marca a compra como finalizada (por último: se algo falhar no meio,
 * a compra continua aberta e dá para tentar de novo sem duplicar nada, porque os ids são fixos).
 */
export function useFinalizarCompra() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (d: DadosFinalizacao) => {
      await fila.enviarAgora()
      const agora = new Date().toISOString()
      const local = d.compra.local?.trim() || null
      if (d.historico.length > 0) {
        await db.salvarVarios('precos_insumo', d.historico.map((h) => ({ ...h, registrado_em: agora, compra_id: d.compra.id, local })))
      }
      if (d.insumos.length > 0) {
        await db.salvarVarios<Insumo>(
          'insumos',
          d.insumos.map(({ criado_em: _c, ...i }) => ({
            ...i,
            qtd_compra: Math.round(i.qtd_compra * 1000) / 1000,
            preco_compra: centavos(i.preco_compra),
            atualizado_em: agora,
          })) as Insumo[],
        )
      }
      if (d.titulos.length > 0) {
        await db.salvarVarios<Titulo>(
          'fin_titulos',
          d.titulos.map((t) => ({ ...t, valor: centavos(t.valor), compra_id: d.compra.id, criado_em: agora, atualizado_em: agora })),
        )
      }
      if (d.lancamentos.length > 0) {
        await db.salvarVarios<Lancamento>(
          'fin_lancamentos',
          d.lancamentos.map((l) => ({ ...l, valor: centavos(l.valor), compra_id: d.compra.id, criado_em: agora, atualizado_em: agora })),
        )
      }
      return db.salvar<Compra>('compras', {
        id: d.compra.id,
        status: 'finalizada',
        total: centavos(d.total),
        finalizada_em: agora,
        atualizado_em: agora,
      } as Compra)
    },
    onSettled: () => {
      for (const k of [CHAVE, ['insumos'], ['precos_insumo'], ['fin']]) qc.invalidateQueries({ queryKey: k })
    },
  })
}

// ---- Quem está marcando -------------------------------------------------------------------

const CHAVE_NOME = 'euforia:meu-nome'

/** Nome que aparece nos itens marcados ("por Ana"). Guardado só neste aparelho. */
export function lerMeuNome(): string {
  try {
    return localStorage.getItem(CHAVE_NOME) ?? ''
  } catch {
    return ''
  }
}

export function gravarMeuNome(nome: string) {
  try {
    localStorage.setItem(CHAVE_NOME, nome.trim())
  } catch {
    /* sem armazenamento: pergunta de novo da próxima vez */
  }
}
