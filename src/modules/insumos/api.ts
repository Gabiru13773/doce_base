import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from '../../lib/db'
import type { UnidadeCompra } from '../../lib/unidades'

export type CategoriaInsumo = 'ingrediente' | 'embalagem' | 'material' | 'corante' | 'outro'

export const CATEGORIAS: { valor: CategoriaInsumo; rotulo: string; emoji: string }[] = [
  { valor: 'ingrediente', rotulo: 'Ingrediente', emoji: '🥚' },
  { valor: 'embalagem', rotulo: 'Embalagem', emoji: '📦' },
  { valor: 'material', rotulo: 'Material', emoji: '🎀' },
  { valor: 'corante', rotulo: 'Corante', emoji: '🎨' },
  { valor: 'outro', rotulo: 'Outro', emoji: '•' },
]

export interface Insumo {
  id: string
  nome: string
  categoria: CategoriaInsumo
  unidade_compra: UnidadeCompra
  qtd_compra: number
  preco_compra: number
  marca: string | null
  fornecedor: string | null
  estoque_minimo: number | null
  observacao: string | null
  ativo: boolean
  criado_em: string
  atualizado_em: string
}

export interface PrecoInsumo {
  id: string
  insumo_id: string
  qtd_compra: number
  unidade_compra: UnidadeCompra
  preco_compra: number
  registrado_em: string
}

const CHAVE = ['insumos']

// O Supabase devolve colunas "numeric" como texto; convertemos para número.
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))

function normalizar(i: Insumo): Insumo {
  return {
    ...i,
    qtd_compra: Number(i.qtd_compra),
    preco_compra: Number(i.preco_compra),
    estoque_minimo: num(i.estoque_minimo),
  }
}

export function useInsumos() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: async () => (await db.listar<Insumo>('insumos', undefined, { coluna: 'nome' })).map(normalizar),
  })
}

export function useHistoricoPrecos(insumoId: string | undefined) {
  return useQuery({
    queryKey: ['precos_insumo', insumoId],
    enabled: !!insumoId,
    queryFn: async () =>
      (await db.listar<PrecoInsumo>('precos_insumo', { insumo_id: insumoId! }, { coluna: 'registrado_em', crescente: false })).map(
        (p) => ({ ...p, qtd_compra: Number(p.qtd_compra), preco_compra: Number(p.preco_compra) }),
      ),
  })
}

export type DadosInsumo = Omit<Insumo, 'id' | 'criado_em' | 'atualizado_em' | 'ativo'> & { id?: string }

export function useSalvarInsumo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (dados: DadosInsumo) => {
      const agora = new Date().toISOString()
      const anterior = dados.id ? qc.getQueryData<Insumo[]>(CHAVE)?.find((i) => i.id === dados.id) : undefined
      const salvo = await db.salvar<Insumo>('insumos', {
        ...dados,
        ativo: anterior?.ativo ?? true,
        criado_em: anterior?.criado_em ?? agora,
        atualizado_em: agora,
      })
      // Guarda a compra no histórico quando é novo ou quando preço/embalagem mudaram.
      const mudouPreco =
        !anterior ||
        Number(anterior.preco_compra) !== dados.preco_compra ||
        Number(anterior.qtd_compra) !== dados.qtd_compra ||
        anterior.unidade_compra !== dados.unidade_compra
      if (mudouPreco) {
        await db.salvar<PrecoInsumo>('precos_insumo', {
          insumo_id: salvo.id,
          qtd_compra: dados.qtd_compra,
          unidade_compra: dados.unidade_compra,
          preco_compra: dados.preco_compra,
          registrado_em: agora,
        })
      }
      return salvo
    },
    onSuccess: (salvo) => {
      qc.invalidateQueries({ queryKey: CHAVE })
      qc.invalidateQueries({ queryKey: ['precos_insumo', salvo.id] })
    },
  })
}

export function useRemoverInsumo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => db.remover('insumos', id),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  })
}

/** Restaura um insumo apagado (botão "Desfazer"). */
export function useRestaurarInsumo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (insumo: Insumo) => db.salvar<Insumo>('insumos', insumo),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  })
}
