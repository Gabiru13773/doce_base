import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { db } from '../../lib/db'
import type { Contexto, InsumoCalculo, ItemReceita, ReceitaCalculo, UnidadeRendimento } from '../../lib/receitas'
import { useConfigPrecificacao } from '../config/api'
import { useInsumos, type Insumo } from '../insumos/api'

export type CategoriaReceita = 'bolo' | 'doce' | 'torta' | 'massa' | 'recheio' | 'cobertura' | 'calda' | 'outro'

export const CATEGORIAS_RECEITA: { valor: CategoriaReceita; rotulo: string }[] = [
  { valor: 'bolo', rotulo: 'Bolo' },
  { valor: 'doce', rotulo: 'Doce' },
  { valor: 'torta', rotulo: 'Torta' },
  { valor: 'massa', rotulo: 'Massa' },
  { valor: 'recheio', rotulo: 'Recheio' },
  { valor: 'cobertura', rotulo: 'Cobertura' },
  { valor: 'calda', rotulo: 'Calda' },
  { valor: 'outro', rotulo: 'Outro' },
]

/** Opções de unidade de rendimento, na ordem em que aparecem para a confeiteira. */
export const UNIDADES_RENDIMENTO: { valor: UnidadeRendimento; rotulo: string }[] = [
  { valor: 'un', rotulo: 'unidades (fatias, doces…)' },
  { valor: 'kg', rotulo: 'kg' },
  { valor: 'g', rotulo: 'g' },
  { valor: 'l', rotulo: 'litros' },
  { valor: 'ml', rotulo: 'ml' },
]

/** Sugestões para o nome da unidade quando o rendimento é em unidades (no singular). */
export const SUGESTOES_NOME_UNIDADE = ['fatia', 'unidade', 'porção', 'brigadeiro', 'docinho', 'bolo', 'pedaço', 'pote']

export interface Receita extends ReceitaCalculo {
  categoria: CategoriaReceita
  tempo_forno_min: number | null
  tempo_descanso_min: number | null
  temperatura_forno: number | null
  passos: string[]
  utensilios: string | null
  pontos_atencao: string | null
  validade: string | null
  /** Estoque mínimo do preparado pronto, na unidade base do rendimento (g, ml ou un). */
  estoque_minimo?: number | null
  ativo: boolean
  criado_em: string
  atualizado_em: string
}

export type DadosReceita = Omit<Receita, 'id' | 'ativo' | 'criado_em' | 'atualizado_em'> & { id?: string }

const CHAVE = ['receitas']

// O Supabase devolve "numeric" como texto; convertemos para número.
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))

function normalizar(r: Receita): Receita {
  return {
    ...r,
    rendimento_qtd: Number(r.rendimento_qtd),
    tempo_preparo_min: Number(r.tempo_preparo_min ?? 0),
    tempo_forno_min: num(r.tempo_forno_min),
    tempo_descanso_min: num(r.tempo_descanso_min),
    temperatura_forno: num(r.temperatura_forno),
    pct_custos_fixos: num(r.pct_custos_fixos),
    pct_taxas: num(r.pct_taxas),
    pct_margem: num(r.pct_margem),
    pv_manual: num(r.pv_manual),
    estoque_minimo: num(r.estoque_minimo),
    // Descarta itens malformados (dados antigos ou do modo local) para não virar NaN no preço.
    itens: (Array.isArray(r.itens) ? r.itens : [])
      .filter((i: ItemReceita) => !!i && (i.tipo === 'insumo' || i.tipo === 'receita') && typeof i.id === 'string')
      .map((i: ItemReceita) => ({ tipo: i.tipo, id: i.id, quantidade: Number(i.quantidade) || 0 })),
    passos: Array.isArray(r.passos) ? r.passos.filter((p: unknown): p is string => typeof p === 'string') : [],
  }
}

/** Receitas ativas, em ordem alfabética. */
export function useReceitas() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: async () =>
      (await db.listar<Receita>('receitas', undefined, { coluna: 'nome' })).map(normalizar).filter((r) => r.ativo !== false),
  })
}

/**
 * Tudo o que os cálculos precisam (receitas, insumos e valor da hora), já montado.
 * Inclui insumos e receitas apagados (inativos) para o custo continuar certo
 * em receitas antigas que ainda os usam.
 */
export function useContextoCalculo() {
  const receitas = useQuery({
    queryKey: [...CHAVE, 'todas'],
    queryFn: async () => (await db.listar<Receita>('receitas')).map(normalizar),
  })
  const insumos = useQuery({
    queryKey: ['insumos', 'todos'],
    queryFn: () => db.listar<Insumo>('insumos'),
  })
  const config = useConfigPrecificacao()
  const ativos = useInsumos()

  const contexto = useMemo<Contexto | null>(() => {
    if (!receitas.data || !insumos.data || !config.data) return null
    return {
      receitas: new Map(receitas.data.map((r) => [r.id, r])),
      insumos: new Map(insumos.data.map((i) => [i.id, paraCalculo(i)])),
      valorHora: config.data.valorHora,
    }
  }, [receitas.data, insumos.data, config.data])

  return {
    contexto,
    config: config.data ?? null,
    /** Receitas ativas (para listas e seletores). */
    receitasAtivas: (receitas.data ?? []).filter((r) => r.ativo !== false),
    /** Insumos ativos (para listas e seletores). */
    insumosAtivos: ativos.data ?? [],
    carregando: receitas.isPending || insumos.isPending || config.isPending || ativos.isPending,
    /**
     * Ainda buscando a versão atual das receitas (o cache salvo no aparelho pode estar atrasado).
     * Formulários de edição esperam: começariam com os valores antigos e, ao salvar, gravariam
     * esses valores de volta. Sem internet (busca pausada), não espera.
     */
    atualizando: !receitas.isFetchedAfterMount && receitas.fetchStatus === 'fetching',
    erro: receitas.error ?? insumos.error ?? config.error ?? ativos.error ?? null,
    tentarDeNovo: () => {
      receitas.refetch()
      insumos.refetch()
      config.refetch()
      ativos.refetch()
    },
  }
}

export function paraCalculo(i: Insumo): InsumoCalculo {
  return {
    id: i.id,
    nome: i.nome,
    qtdCompra: Number(i.qtd_compra),
    unidadeCompra: i.unidade_compra,
    precoCompra: Number(i.preco_compra),
  }
}

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: CHAVE })
}

export function useSalvarReceita() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (dados: DadosReceita) => {
      const agora = new Date().toISOString()
      // Limpa itens sem quantidade e passos vazios, e usa as mesmas casas decimais do banco
      // (tempos e temperatura são inteiros; % com 2 casas) para os dois modos calcularem igual.
      const inteiro = (v: number | null) => (v === null ? null : Math.round(v))
      const casas = (v: number | null, n: number) => (v === null ? null : Math.round(v * 10 ** n) / 10 ** n)
      const limpo = {
        ...dados,
        rendimento_qtd: Math.round(dados.rendimento_qtd * 1000) / 1000,
        tempo_preparo_min: Math.round(dados.tempo_preparo_min || 0),
        tempo_forno_min: inteiro(dados.tempo_forno_min),
        tempo_descanso_min: inteiro(dados.tempo_descanso_min),
        temperatura_forno: inteiro(dados.temperatura_forno),
        pct_custos_fixos: casas(dados.pct_custos_fixos, 2),
        pct_taxas: casas(dados.pct_taxas, 2),
        pct_margem: casas(dados.pct_margem, 2),
        nome: dados.nome.trim(),
        rendimento_nome: dados.rendimento_unidade === 'un' ? dados.rendimento_nome?.trim() || null : null,
        itens: dados.itens.filter((i) => i.quantidade > 0).map((i) => ({ ...i, quantidade: Math.round(i.quantidade * 1000) / 1000 })),
        passos: dados.passos.map((p) => p.trim()).filter(Boolean),
        pv_manual: dados.pv_manual !== null && Math.round(dados.pv_manual * 100) > 0 ? Math.round(dados.pv_manual * 100) / 100 : null,
      }
      return db.salvar<Receita>('receitas', {
        ...limpo,
        ativo: true,
        ...(dados.id ? {} : { criado_em: agora }),
        atualizado_em: agora,
      } as Omit<Receita, 'id'>)
    },
    onSuccess: () => invalidar(qc),
  })
}

/** "Apagar" esconde a receita (ativo = false): receitas que a usam continuam calculando. */
export function useRemoverReceita() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (r: Receita) => db.salvar<Receita>('receitas', { ...r, ativo: false, atualizado_em: new Date().toISOString() }),
    onSuccess: () => invalidar(qc),
  })
}

export function useRestaurarReceita() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (r: Receita) => db.salvar<Receita>('receitas', { ...r, ativo: true, atualizado_em: new Date().toISOString() }),
    onSuccess: () => invalidar(qc),
  })
}

/** Receita em branco para o formulário de cadastro. */
export function receitaVazia(): DadosReceita {
  return {
    nome: '',
    categoria: 'bolo',
    rendimento_qtd: 0,
    rendimento_unidade: 'un',
    rendimento_nome: 'fatia',
    itens: [],
    tempo_preparo_min: 0,
    tempo_forno_min: null,
    tempo_descanso_min: null,
    temperatura_forno: null,
    passos: [],
    utensilios: null,
    pontos_atencao: null,
    validade: null,
    pct_custos_fixos: null,
    pct_taxas: null,
    pct_margem: null,
    pv_manual: null,
  }
}
