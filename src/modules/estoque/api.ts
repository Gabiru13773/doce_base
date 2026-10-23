import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { calcularSaldos, milesimos, type ItemTipo, type OrigemMovimento, type Saldos } from '../../lib/estoque'
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

function carimbar<T extends { quantidade?: number }>(linhas: T[]) {
  const agora = new Date().toISOString()
  return linhas.map((l) => ({
    ...l,
    ...(l.quantidade !== undefined ? { quantidade: milesimos(l.quantidade) } : {}),
    criado_em: agora,
    atualizado_em: agora,
  }))
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
      (await db.listar<Movimento>('estoque_movimentos', undefined, { coluna: 'data', crescente: false })).map(normalizarMovimento),
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
      db.salvarVarios<Movimento>('estoque_movimentos', carimbar(lista.filter((m) => m.quantidade !== 0)) as Movimento[]),
    onSuccess: () => invalidar(qc),
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
    queryFn: async () => (await db.listar<Producao>('producoes', undefined, { coluna: 'data', crescente: false })).map(normalizarProducao),
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
      const agora = new Date().toISOString()
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
      const ids = new Set(movimentos.map((m) => m.id))
      for (const m of await db.listar<Movimento>('estoque_movimentos', { producao_id: producao.id }))
        if (!ids.has(m.id)) await db.remover('estoque_movimentos', m.id)
      const linhas = movimentos.filter((m) => m.quantidade !== 0).map((m) => ({ ...m, producao_id: producao.id, data: producao.data }))
      if (linhas.length > 0) await db.salvarVarios<Movimento>('estoque_movimentos', carimbar(linhas) as Movimento[])
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
      if (movimentos.length > 0) await db.salvarVarios<Movimento>('estoque_movimentos', movimentos)
    },
    onSettled: () => invalidar(qc),
  })
}
