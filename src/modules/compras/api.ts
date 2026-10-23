import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { centavos, mesclarPendentes, type ItemCompraCalc, type PrecoHistorico } from '../../lib/compras'
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
    const doServidor = new Map(consulta.data.map((i) => [i.id, i]))
    // A marcação pendente não tem as datas do banco: usa as do servidor (ou vazio, se o item é novo).
    const daCompra = new Map(
      [...pendentes]
        .filter(([, p]) => p.item.compra_id === compraId)
        .map(([id, p]): [string, ItemCompra] => [
          id,
          { criado_em: doServidor.get(id)?.criado_em ?? '', atualizado_em: doServidor.get(id)?.atualizado_em ?? '', ...p.item },
        ]),
    )
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
    mutationFn: async (item: Pick<ItemCompra, 'id' | 'compra_id'>) => {
      fila.descartarItem(item.id) // senão a marcação guardada aqui recriaria o item
      await db.remover('compra_itens', item.id)
    },
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

// Mensagens (já traduzidas em src/lib/db.ts) de erros em que o banco recusou o valor:
// tentar de novo daria o mesmo erro.
const ERRO_DEFINITIVO = /fora do permitido|formato inválido|campos obrigatórios|grande demais|comprido demais|não existe mais|Informe a quantidade|Escolha o (produto|motivo)/i

function camposMarcacao(i: DadosItemCompra) {
  return {
    status: i.status,
    qtd_comprada: i.qtd_comprada,
    preco_pago: i.preco_pago,
    motivo: i.motivo,
    sub_insumo_id: i.sub_insumo_id,
    sub_nome: i.sub_nome,
    embalagem_qtd: i.embalagem_qtd,
    embalagem_unidade: i.embalagem_unidade,
    marcado_por: i.marcado_por,
  }
}

function criarFila() {
  // O Map nunca é alterado no lugar: cada mudança cria um novo (é o "retrato" que o React lê).
  let pendentes = new Map<string, Pendente>()
  let ultimoErro: string | null = null
  let envio: Promise<void> | null = null
  let timer: number | undefined
  const ouvintes = new Set<() => void>()
  let aoEnviar: ((compraId: string, salvo: ItemCompra | null) => void) | null = null

  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_FILA) ?? '[]') as Pendente[]
    pendentes = new Map(salvo.map((p) => [p.item.id, p]))
  } catch {
    /* fila vazia */
  }

  function trocar(novo: Map<string, Pendente>) {
    pendentes = novo
    try {
      localStorage.setItem(CHAVE_FILA, JSON.stringify([...pendentes.values()]))
    } catch {
      /* sem espaço: segue só na memória */
    }
    for (const o of ouvintes) o()
  }

  /** Tira da fila, a não ser que tenha sido marcado de novo enquanto subia. */
  function concluir(id: string, versao: number) {
    if (pendentes.get(id)?.versao !== versao) return
    const novo = new Map(pendentes)
    novo.delete(id)
    trocar(novo)
  }

  async function enviarTudo() {
    for (const [id, p] of [...pendentes]) {
      try {
        const agora = new Date().toISOString()
        // Só os campos da marcação: não desfaz o que o outro celular mudou no item (quantidade
        // pedida, ordem…) e não recria um item que foi apagado lá.
        let salvo = await db.atualizar<ItemCompra>('compra_itens', id, { ...camposMarcacao(p.item), atualizado_em: agora })
        // Item fora da lista que ainda não existe na nuvem: cria inteiro.
        if (!salvo && p.item.fora_da_lista) salvo = await db.salvar<ItemCompra>('compra_itens', { ...p.item, atualizado_em: agora } as ItemCompra)
        if (!salvo) ultimoErro = `"${p.item.nome}" foi tirado da lista em outro aparelho; a marcação foi descartada.`
        else ultimoErro = null
        aoEnviar?.(p.item.compra_id, salvo)
        concluir(id, p.versao)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        // Erro que não se resolve tentando de novo (valor recusado pelo banco): descarta e avisa.
        // Qualquer outro (internet, sessão, servidor fora do ar) fica na fila para a próxima tentativa.
        if (!ERRO_DEFINITIVO.test(msg)) {
          ultimoErro = msg
          break
        }
        ultimoErro = `Uma marcação não foi salva (${p.item.nome}): ${msg}`
        concluir(id, p.versao)
      }
    }
  }

  /** Envia o que está na fila. Se já está enviando, espera e envia de novo o que sobrou. */
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
    marcar(item: DadosItemCompra) {
      ultimoErro = null
      const novo = new Map(pendentes)
      novo.set(item.id, { item, versao: (pendentes.get(item.id)?.versao ?? 0) + 1 })
      trocar(novo)
      void enviar()
    },
    descartarCompra(compraId: string) {
      trocar(new Map([...pendentes].filter(([, p]) => p.item.compra_id !== compraId)))
    },
    enviarAgora: () => enviar(),
    aguardando: (compraId: string) => [...pendentes.values()].filter((p) => p.item.compra_id === compraId).length,
    descartarItem(id: string) {
      if (!pendentes.has(id)) return
      const novo = new Map(pendentes)
      novo.delete(id)
      trocar(novo)
    },
    definirAoEnviar(f: (compraId: string, salvo: ItemCompra | null) => void) {
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
  // Quando uma marcação sobe, busca a lista de novo (cancela uma busca antiga que esteja no meio).
  // Quando uma marcação sobe, a linha salva entra na lista na hora (sem "piscar" o estado antigo
  // até a próxima busca) e a lista é buscada de novo.
  useEffect(
    () =>
      fila.definirAoEnviar((compraId, salvo) => {
        if (salvo) {
          const linha = normalizarItem(salvo)
          qc.setQueryData<ItemCompra[]>(chaveItens(compraId), (atual) =>
            atual && (atual.some((i) => i.id === linha.id) ? atual.map((i) => (i.id === linha.id ? linha : i)) : [...atual, linha]),
          )
        }
        void qc.invalidateQueries({ queryKey: chaveItens(compraId) })
      }),
    [qc],
  )
  return (item: DadosItemCompra) => {
    const { criado_em: _c, atualizado_em: _a, ...dados } = item as ItemCompra
    fila.marcar({
      ...dados,
      // mesmas casas do banco (quantidade 3, preço 2)
      qtd_comprada: dados.qtd_comprada == null ? null : Math.round(dados.qtd_comprada * 1000) / 1000 || null,
      preco_pago: dados.preco_pago == null ? null : centavos(dados.preco_pago),
    })
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
      // Objeto simples (e não Map): o cache salvo no aparelho vira JSON e um Map voltaria vazio e quebrado.
      const mapa: Record<string, PrecoGuardado[]> = {}
      for (const l of linhas) {
        const p = {
          ...l,
          qtd_compra: Number(l.qtd_compra),
          preco_compra: Number(l.preco_compra),
          unidade_compra: l.unidade_compra as UnidadeCompra,
          compra_id: l.compra_id ?? null,
          local: l.local ?? null,
        }
        ;(mapa[l.insumo_id] ??= []).push(p)
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
  /** entradas no estoque (uma por insumo, quantidade na unidade base). Ids gerados uma vez na tela. */
  estoque?: { id: string; insumo_id: string; quantidade: number }[]
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
      // As marcações deste aparelho precisam estar na nuvem antes (o total e os preços vêm delas).
      await fila.enviarAgora()
      if (fila.aguardando(d.compra.id) > 0) throw new Error('Algumas marcações ainda não foram enviadas. Confira a internet e tente de novo.')
      const agora = new Date().toISOString()
      const local = d.compra.local?.trim() || null
      // Nova tentativa: tira do histórico o que uma tentativa anterior desta compra gravou e não vale mais.
      const historicoIds = new Set(d.historico.map((h) => h.id))
      for (const h of await db.listar<PrecoGuardado>('precos_insumo', { compra_id: d.compra.id }))
        if (!historicoIds.has(h.id)) await db.remover('precos_insumo', h.id)
      if (d.historico.length > 0) {
        await db.salvarVarios('precos_insumo', d.historico.map((h) => ({ ...h, registrado_em: agora, compra_id: d.compra.id, local })))
      }
      // Só os campos do custo: não desfaz o que mudou no insumo em outro aparelho (nome, marca…).
      for (const i of d.insumos) {
        await db.atualizar<Insumo>('insumos', i.id, {
          qtd_compra: Math.round(i.qtd_compra * 1000) / 1000,
          unidade_compra: i.unidade_compra,
          preco_compra: centavos(i.preco_compra),
          atualizado_em: agora,
        })
      }
      // Numa nova tentativa a forma de pagamento pode ter mudado (ex.: era "a pagar" em 3 vezes,
      // agora "paguei agora"): apaga o que uma tentativa anterior desta compra gravou e não vale mais.
      const titulosIds = new Set(d.titulos.map((t) => t.id))
      for (const t of await db.listar<Titulo>('fin_titulos', { compra_id: d.compra.id })) if (!titulosIds.has(t.id)) await db.remover('fin_titulos', t.id)
      const lancIds = new Set(d.lancamentos.map((l) => l.id))
      for (const l of await db.listar<Lancamento>('fin_lancamentos', { compra_id: d.compra.id })) if (!lancIds.has(l.id)) await db.remover('fin_lancamentos', l.id)
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
      // Estoque: apaga entradas de uma tentativa anterior que não valem mais e grava as de agora.
      const estoque = d.estoque ?? []
      const estoqueIds = new Set(estoque.map((e) => e.id))
      for (const m of await db.listar<{ id: string }>('estoque_movimentos', { compra_id: d.compra.id }))
        if (!estoqueIds.has(m.id)) await db.remover('estoque_movimentos', m.id)
      const entradas = estoque.filter((e) => Math.round(e.quantidade * 1000) !== 0)
      if (entradas.length > 0) {
        await db.salvarVarios(
          'estoque_movimentos',
          entradas.map((e) => ({
            id: e.id,
            data: d.compra.data,
            item_tipo: 'insumo',
            insumo_id: e.insumo_id,
            receita_id: null,
            quantidade: Math.round(e.quantidade * 1000) / 1000,
            origem: 'compra',
            producao_id: null,
            compra_id: d.compra.id,
            observacao: null,
            feito_por: null,
            criado_em: agora,
            atualizado_em: agora,
          })),
        )
      }
      const { criado_em: _c, ...compra } = d.compra
      // Linha inteira: um upsert parcial falharia no Supabase (nome é obrigatório no insert).
      return db.salvar<Compra>('compras', {
        ...compra,
        status: 'finalizada',
        total: centavos(d.total),
        finalizada_em: agora,
        atualizado_em: agora,
      } as Compra)
    },
    onSettled: () => {
      for (const k of [CHAVE, ['insumos'], ['precos_insumo'], ['fin'], ['estoque']]) qc.invalidateQueries({ queryKey: k })
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
