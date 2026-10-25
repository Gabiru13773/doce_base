import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { ajusteContagem, calcularSaldos, milesimos, type ItemTipo, type OrigemMovimento, type Saldos } from '../../lib/estoque'
import { db } from '../../lib/db'
import { modoLocal } from '../../lib/supabase'

// Estoque (livro de movimentos) e Produção. Ver supabase/migrations/0007_estoque_producao.sql.

export interface Movimento {
  id: string
  data: string
  item_tipo: ItemTipo
  insumo_id: string | null
  receita_id: string | null
  /** positivo entra, negativo sai; na unidade base do item */
  quantidade: number
  origem: OrigemMovimento
  producao_id: string | null
  /** venda do PDV que deu esta baixa */
  venda_id?: string | null
  compra_id: string | null
  observacao: string | null
  feito_por: string | null
  criado_em: string
  atualizado_em: string
}

export type DadosMovimento = Omit<Movimento, 'criado_em' | 'atualizado_em'>

export interface Producao {
  id: string
  data: string
  receita_id: string
  lotes: number
  /** o que entrou no estoque, na unidade base do rendimento */
  rendimento: number
  custo_total: number | null
  observacao: string | null
  feito_por: string | null
  criado_em: string
  atualizado_em: string
}

export type DadosProducao = Omit<Producao, 'criado_em' | 'atualizado_em'>

export const ROTULO_ORIGEM: Record<OrigemMovimento, string> = {
  compra: 'Compra',
  producao: 'Produção',
  contagem: 'Contagem',
  perda: 'Perda',
  venda: 'Venda',
  uso: 'Uso',
  entrada: 'Entrada',
}

const CHAVES = {
  movimentos: ['estoque', 'movimentos'],
  producoes: ['estoque', 'producoes'],
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
const centavos = (n: number) => Math.round(n * 100) / 100

function normalizarMovimento(m: Movimento): Movimento {
  return { ...m, quantidade: Number(m.quantidade), producao_id: m.producao_id ?? null, compra_id: m.compra_id ?? null }
}

function normalizarProducao(p: Producao): Producao {
  return { ...p, lotes: Number(p.lotes), rendimento: Number(p.rendimento), custo_total: num(p.custo_total) }
}

/** Arredonda como o banco e tira as linhas que ficam zeradas (o banco recusa quantidade 0). */
function carimbar<T extends { quantidade: number }>(linhas: T[]) {
  const agora = new Date().toISOString()
  return linhas
    .map((l) => ({ ...l, quantidade: milesimos(l.quantidade), criado_em: agora, atualizado_em: agora }))
    .filter((l) => l.quantidade !== 0)
}

/** Mais recente primeiro: pela data e, no mesmo dia, pela hora em que foi registrado. */
function maisRecentePrimeiro(a: { data: string; criado_em: string }, b: { data: string; criado_em: string }) {
  return b.data.localeCompare(a.data) || (b.criado_em ?? '').localeCompare(a.criado_em ?? '')
}

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['estoque'] })
}

// ---- Movimentos e saldos ------------------------------------------------------------------

/** Todos os movimentos, os mais recentes primeiro. */
export function useMovimentos() {
  return useQuery({
    queryKey: CHAVES.movimentos,
    queryFn: async () =>
      (await db.listar<Movimento>('estoque_movimentos')).map(normalizarMovimento).sort(maisRecentePrimeiro),
  })
}

/** Saldo de cada insumo e preparado (objetos simples: id → quantidade na unidade base). */
export function useSaldos() {
  const consulta = useMovimentos()
  const saldos = useMemo<Saldos | undefined>(() => (consulta.data ? calcularSaldos(consulta.data) : undefined), [consulta.data])
  return { ...consulta, data: saldos }
}

/** Grava movimentos novos (contagem, perda, entrada manual…), tudo ou nada. Ids vêm de quem chama. */
export function useSalvarMovimentos() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (lista: DadosMovimento[]) =>
      db.salvarVarios<Movimento>('estoque_movimentos', carimbar(lista) as Movimento[]),
    onSuccess: () => invalidar(qc),
  })
}

/** Uma contagem: quanto foi contado (unidade base), com o id do movimento gerado uma vez na tela. */
export type DadosContagem = Omit<DadosMovimento, 'quantidade' | 'origem'> & { contado: number }

/**
 * Salva contagens. A diferença é calculada aqui, com os movimentos buscados agora da nuvem, e não
 * com o saldo da tela: ele pode estar atrasado (ex.: o outro celular acabou de finalizar uma compra)
 * e o ajuste sairia errado. Movimentos com o mesmo id (tentativa anterior) não entram no saldo.
 * Devolve o ajuste lançado em cada item (0 = conferia).
 */
export function useSalvarContagem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (contagens: DadosContagem[]) => {
      const ids = new Set(contagens.map((c) => c.id))
      const atuais = await db.listar<Movimento>('estoque_movimentos')
      const saldos = calcularSaldos(atuais.map(normalizarMovimento).filter((m) => !ids.has(m.id)))
      const ajustes: Record<string, number> = {}
      const linhas: DadosMovimento[] = []
      for (const { contado, ...c } of contagens) {
        const saldo = (c.item_tipo === 'insumo' ? saldos.insumos[c.insumo_id ?? ''] : saldos.receitas[c.receita_id ?? '']) ?? 0
        const quantidade = ajusteContagem(saldo, contado)
        ajustes[c.id] = quantidade
        if (quantidade !== 0) linhas.push({ ...c, quantidade, origem: 'contagem' })
        // Conferia, mas uma tentativa anterior já tinha gravado um ajuste com este id: tira.
        else if (atuais.some((m) => m.id === c.id)) await db.remover('estoque_movimentos', c.id)
      }
      if (linhas.length > 0) await db.salvarVarios<Movimento>('estoque_movimentos', carimbar(linhas) as Movimento[])
      return ajustes
    },
    onSettled: () => invalidar(qc),
  })
}

export function useRemoverMovimento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => db.remover('estoque_movimentos', id),
    onSuccess: () => invalidar(qc),
  })
}

/** Volta um movimento apagado (botão Desfazer), com o mesmo id. */
export function useRestaurarMovimento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (m: Movimento) => db.salvarVarios<Movimento>('estoque_movimentos', [m]),
    onSuccess: () => invalidar(qc),
  })
}

// ---- Produção ------------------------------------------------------------------------------

export function useProducoes() {
  return useQuery({
    queryKey: CHAVES.producoes,
    queryFn: async () => (await db.listar<Producao>('producoes')).map(normalizarProducao).sort(maisRecentePrimeiro),
  })
}

/**
 * Registra uma produção e os movimentos dela (entra o preparado, saem os insumos e os preparados
 * usados). Ids gerados uma vez na tela: tentar de novo não duplica. Numa nova tentativa com outro
 * plano, apaga os movimentos de uma tentativa anterior que não valem mais.
 */
export function useRegistrarProducao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ producao, movimentos }: { producao: DadosProducao; movimentos: DadosMovimento[] }) => {
      if (!(milesimos(producao.lotes) > 0) || !(milesimos(producao.rendimento) > 0))
        throw new Error('A quantidade de receitas e o rendimento precisam ser maiores que zero.')
      const agora = new Date().toISOString()
      const jaExistia = !!(await db.buscar<Producao>('producoes', producao.id))
      await db.salvarVarios<Producao>('producoes', [
        {
          ...producao,
          lotes: milesimos(producao.lotes),
          rendimento: milesimos(producao.rendimento),
          custo_total: producao.custo_total == null ? null : centavos(producao.custo_total),
          observacao: producao.observacao?.trim() || null,
          criado_em: agora,
          atualizado_em: agora,
        },
      ])
      try {
        const linhas = carimbar(movimentos.map((m) => ({ ...m, producao_id: producao.id, data: producao.data })))
        // Tira o que uma tentativa anterior gravou e não vale mais (inclusive linhas que agora zeraram).
        const ids = new Set(linhas.map((m) => m.id))
        for (const m of await db.listar<Movimento>('estoque_movimentos', { producao_id: producao.id }))
          if (!ids.has(m.id)) await db.remover('estoque_movimentos', m.id)
        if (linhas.length > 0) await db.salvarVarios<Movimento>('estoque_movimentos', linhas as Movimento[])
      } catch (e) {
        // Sem os movimentos a produção ficaria no histórico sem mexer no estoque: desfaz.
        if (!jaExistia) await db.remover('producoes', producao.id).catch(() => {})
        throw e
      }
    },
    onSettled: () => invalidar(qc),
  })
}

/**
 * Desfaz uma produção: apaga ela e os movimentos dela (no Supabase saem juntos, on delete cascade).
 * Devolve o que foi apagado, para o botão Desfazer recriar igual.
 */
export function useApagarProducao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (producao: Producao) => {
      const movimentos = await db.listar<Movimento>('estoque_movimentos', { producao_id: producao.id })
      if (modoLocal) for (const m of movimentos) await db.remover('estoque_movimentos', m.id)
      await db.remover('producoes', producao.id)
      return { producao, movimentos: movimentos.map(normalizarMovimento) }
    },
    onSuccess: () => invalidar(qc),
  })
}

/** Recria uma produção apagada (botão Desfazer), com os mesmos ids. */
export function useRestaurarProducao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ producao, movimentos }: { producao: Producao; movimentos: Movimento[] }) => {
      await db.salvarVarios<Producao>('producoes', [producao])
      try {
        if (movimentos.length > 0) await db.salvarVarios<Movimento>('estoque_movimentos', movimentos)
      } catch (e) {
        await db.remover('producoes', producao.id).catch(() => {})
        throw e
      }
    },
    onSettled: () => invalidar(qc),
  })
}
