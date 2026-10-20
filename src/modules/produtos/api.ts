import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db, novoId } from '../../lib/db'
import type { VariacaoCalculo } from '../../lib/produtos'
import type { ItemReceita } from '../../lib/receitas'

export type CategoriaProduto = 'bolo' | 'fatia' | 'doce' | 'torta' | 'kit' | 'outro'

export const CATEGORIAS_PRODUTO: { valor: CategoriaProduto; rotulo: string }[] = [
  { valor: 'bolo', rotulo: 'Bolos' },
  { valor: 'fatia', rotulo: 'Fatias' },
  { valor: 'doce', rotulo: 'Doces' },
  { valor: 'torta', rotulo: 'Tortas' },
  { valor: 'kit', rotulo: 'Kits' },
  { valor: 'outro', rotulo: 'Outros' },
]

/** Sugestões de nome para variações (a confeiteira pode digitar qualquer outro). */
export const SUGESTOES_VARIACAO = ['Prato MDF', 'Bandeja plástica', 'Caixa premium', 'Pote', 'Embalagem simples']

export interface Variacao extends VariacaoCalculo {
  /** Variação escondida (não aparece nos pedidos), sem perder o histórico. */
  ativo: boolean
}

export interface Produto {
  id: string
  nome: string
  categoria: CategoriaProduto
  descricao: string | null
  variacoes: Variacao[]
  ativo: boolean
  criado_em: string
  atualizado_em: string
}

export type DadosProduto = Omit<Produto, 'id' | 'ativo' | 'criado_em' | 'atualizado_em'> & { id?: string }

const CHAVE = ['produtos']

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))

function normalizarItens(itens: unknown): ItemReceita[] {
  return (Array.isArray(itens) ? itens : [])
    .filter((i: ItemReceita) => !!i && (i.tipo === 'insumo' || i.tipo === 'receita') && typeof i.id === 'string')
    .map((i: ItemReceita) => ({ tipo: i.tipo, id: i.id, quantidade: Number(i.quantidade) || 0 }))
}

function normalizar(p: Produto): Produto {
  return {
    ...p,
    variacoes: (Array.isArray(p.variacoes) ? p.variacoes : [])
      .filter((v) => !!v && typeof v.id === 'string')
      .map((v) => ({
        id: v.id,
        nome: String(v.nome ?? ''),
        itens: normalizarItens(v.itens),
        tempo_montagem_min: Number(v.tempo_montagem_min ?? 0) || 0,
        pct_custos_fixos: num(v.pct_custos_fixos),
        pct_taxas: num(v.pct_taxas),
        pct_margem: num(v.pct_margem),
        pv_manual: num(v.pv_manual),
        ativo: v.ativo !== false,
      })),
  }
}

/** Produtos ativos, em ordem alfabética. */
export function useProdutos() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: async () =>
      (await db.listar<Produto>('produtos', undefined, { coluna: 'nome' })).map(normalizar).filter((p) => p.ativo !== false),
  })
}

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: CHAVE })
}

const casas = (v: number | null, n: number) => (v === null ? null : Math.round(v * 10 ** n) / 10 ** n)

/** Limpa uma variação antes de gravar (mesmas casas decimais do banco das receitas). */
function limparVariacao(v: Variacao): Variacao {
  return {
    id: v.id || novoId(),
    nome: v.nome.trim(),
    itens: v.itens.filter((i) => i.quantidade > 0).map((i) => ({ ...i, quantidade: Math.round(i.quantidade * 1000) / 1000 })),
    tempo_montagem_min: Math.max(0, Math.round(v.tempo_montagem_min || 0)),
    pct_custos_fixos: casas(v.pct_custos_fixos, 2),
    pct_taxas: casas(v.pct_taxas, 2),
    pct_margem: casas(v.pct_margem, 2),
    pv_manual: v.pv_manual !== null && v.pv_manual > 0 ? Math.round(v.pv_manual * 100) / 100 : null,
    ativo: v.ativo !== false,
  }
}

export function useSalvarProduto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (dados: DadosProduto) => {
      const agora = new Date().toISOString()
      return db.salvar<Produto>('produtos', {
        ...dados,
        nome: dados.nome.trim(),
        descricao: dados.descricao?.trim() || null,
        variacoes: dados.variacoes.map(limparVariacao),
        ativo: true,
        ...(dados.id ? {} : { criado_em: agora }),
        atualizado_em: agora,
      } as Omit<Produto, 'id'>)
    },
    onSuccess: () => invalidar(qc),
  })
}

/** "Apagar" esconde o produto (ativo = false), para não quebrar pedidos antigos. */
export function useRemoverProduto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: Produto) => db.salvar<Produto>('produtos', { ...p, ativo: false, atualizado_em: new Date().toISOString() }),
    onSuccess: () => invalidar(qc),
  })
}

export function useRestaurarProduto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: Produto) => db.salvar<Produto>('produtos', { ...p, ativo: true, atualizado_em: new Date().toISOString() }),
    onSuccess: () => invalidar(qc),
  })
}

export function variacaoVazia(nome = ''): Variacao {
  return {
    id: novoId(),
    nome,
    itens: [],
    tempo_montagem_min: 0,
    pct_custos_fixos: null,
    pct_taxas: null,
    pct_margem: null,
    pv_manual: null,
    ativo: true,
  }
}

export function produtoVazio(): DadosProduto {
  return { nome: '', categoria: 'bolo', descricao: null, variacoes: [variacaoVazia('Padrão')] }
}

/** Cópia de uma variação com novo id (botão "Duplicar"). */
export function duplicarVariacao(v: Variacao): Variacao {
  return { ...v, id: novoId(), nome: `${v.nome} (cópia)`, itens: v.itens.map((i) => ({ ...i })) }
}

/** Cópia de um produto inteiro, para cadastrar outro parecido (sem id: vira um produto novo). */
export function duplicarProduto(p: Produto): DadosProduto {
  return {
    nome: `${p.nome} (cópia)`,
    categoria: p.categoria,
    descricao: p.descricao,
    variacoes: p.variacoes.map((v) => ({ ...v, id: novoId(), itens: v.itens.map((i) => ({ ...i })) })),
  }
}
