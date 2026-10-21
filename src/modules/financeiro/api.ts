import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db, novoId } from '../../lib/db'
import { modoLocal } from '../../lib/supabase'
import { PLANO_PADRAO } from './planoPadrao'

// ---- Tipos (iguais às tabelas de supabase/migrations/0005_financeiro.sql) ----------------

export type TipoCategoria = 'entrada' | 'saida'
export type LinhaDre = 'receita_bruta' | 'deducoes' | 'impostos' | 'custos' | 'despesas_operacionais' | 'financeiras' | 'fora'

export const LINHAS_DRE: { valor: LinhaDre; rotulo: string }[] = [
  { valor: 'receita_bruta', rotulo: 'Receita bruta (vendas)' },
  { valor: 'deducoes', rotulo: 'Deduções (taxas, descontos)' },
  { valor: 'impostos', rotulo: 'Impostos sobre vendas' },
  { valor: 'custos', rotulo: 'Custos de produção' },
  { valor: 'despesas_operacionais', rotulo: 'Despesas do dia a dia' },
  { valor: 'financeiras', rotulo: 'Receitas e despesas financeiras' },
  { valor: 'fora', rotulo: 'Fora do resultado (empréstimos, aportes, equipamentos)' },
]

export interface CategoriaFin {
  id: string
  tipo: TipoCategoria
  grupo: string
  subgrupo: string
  nome: string
  linha_dre: LinhaDre
  ordem: number
  ativo: boolean
  criado_em: string
  atualizado_em: string
}

export type TipoConta = 'banco' | 'caixa' | 'carteira'

export const TIPOS_CONTA: { valor: TipoConta; rotulo: string }[] = [
  { valor: 'banco', rotulo: 'Conta no banco' },
  { valor: 'caixa', rotulo: 'Dinheiro (caixa)' },
  { valor: 'carteira', rotulo: 'Carteira digital (Mercado Pago, PicPay…)' },
]

export interface ContaFin {
  id: string
  nome: string
  tipo: TipoConta
  saldo_inicial: number
  /** Data do saldo inicial (AAAA-MM-DD): lançamentos antes dela não contam no saldo. */
  saldo_em: string
  ativo: boolean
  criado_em: string
  atualizado_em: string
}

export type TipoTitulo = 'pagar' | 'receber'

/** Conta a pagar ou a receber. Fica paga quando os lançamentos ligados a ela somam o valor. */
export interface Titulo {
  id: string
  tipo: TipoTitulo
  descricao: string
  pessoa: string | null
  categoria_id: string | null
  conta_id: string | null
  valor: number
  emissao: string
  vencimento: string
  grupo_id: string | null
  parcela: string | null
  nota_fiscal: string | null
  observacao: string | null
  criado_em: string
  atualizado_em: string
}

export type TipoLancamento = 'entrada' | 'saida' | 'transferencia'

export const FORMAS_PAGAMENTO = ['Pix', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Boleto', 'Transferência', 'iFood']

export interface Lancamento {
  id: string
  tipo: TipoLancamento
  data: string
  descricao: string
  pessoa: string | null
  categoria_id: string | null
  conta_id: string
  conta_destino_id: string | null
  valor: number
  forma_pagamento: string | null
  titulo_id: string | null
  ofx_fitid: string | null
  /** Conta de cujo extrato veio o ofx_fitid (numa transferência recebida, não é a conta_id). */
  ofx_conta_id: string | null
  observacao: string | null
  criado_em: string
  atualizado_em: string
}

export type DadosCategoria = Omit<CategoriaFin, 'id' | 'criado_em' | 'atualizado_em'> & { id?: string }
export type DadosConta = Omit<ContaFin, 'id' | 'criado_em' | 'atualizado_em'> & { id?: string }
export type DadosTitulo = Omit<Titulo, 'id' | 'criado_em' | 'atualizado_em'> & { id?: string }
export type DadosLancamento = Omit<Lancamento, 'id' | 'criado_em' | 'atualizado_em'> & { id?: string }

// ---- Normalização (o Supabase devolve numeric como texto) -------------------------------

const valor = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const centavos = (n: number) => Math.round(n * 100) / 100
const textoOuNull = (t: string | null | undefined) => (t ?? '').trim() || null

const CHAVES = {
  categorias: ['fin', 'categorias'],
  contas: ['fin', 'contas'],
  titulos: ['fin', 'titulos'],
  lancamentos: ['fin', 'lancamentos'],
}

function invalidar(qc: ReturnType<typeof useQueryClient>, ...chaves: (keyof typeof CHAVES)[]) {
  for (const c of chaves) qc.invalidateQueries({ queryKey: CHAVES[c] })
}

/**
 * Marca a hora da gravação; criado_em só vai em registros novos (na edição, o banco mantém o original).
 * `novo` vem de quem chama, porque os formulários já mandam o id dos registros novos (gerado uma
 * vez ao abrir: se a gravação for repetida, atualiza a mesma linha em vez de duplicar).
 */
function carimbo<T extends { id?: string }>(dados: T, novo = !dados.id) {
  const agora = new Date().toISOString()
  return { ...dados, ...(novo ? { criado_em: agora } : {}), atualizado_em: agora } as T & { criado_em: string; atualizado_em: string }
}

/**
 * Um lote para gravar de uma vez: ou todos novos, ou todos já existentes (nunca misturados).
 * Assim todas as linhas têm as mesmas colunas (criado_em só nos novos) e o Supabase grava o
 * lote numa requisição só, tudo ou nada. Importação e parcelas são só novos; edição, só existentes.
 */
export interface Lote<T> {
  novos: boolean
  lista: T[]
}

// ---- Categorias (plano de contas) ---------------------------------------------------------

/** Todas as categorias (inclusive as desativadas, para mostrar lançamentos antigos), em ordem. */
export function useCategoriasFin() {
  return useQuery({
    queryKey: CHAVES.categorias,
    queryFn: async () => {
      let linhas = await db.listar<CategoriaFin>('fin_categorias', undefined, { coluna: 'ordem' })
      // No modo local não há a carga inicial do banco: cria o plano padrão na primeira vez.
      if (modoLocal && linhas.length === 0) {
        const agora = new Date().toISOString()
        linhas = await db.salvarVarios<CategoriaFin>(
          'fin_categorias',
          PLANO_PADRAO.map((c) => ({ ...c, id: novoId(), ativo: true, criado_em: agora, atualizado_em: agora })),
        )
      }
      return linhas.map((c) => ({ ...c, ordem: Number(c.ordem) || 0 }))
    },
  })
}

export function useSalvarCategoriaFin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: DadosCategoria) =>
      db.salvar<CategoriaFin>('fin_categorias', carimbo({ ...d, grupo: d.grupo.trim(), subgrupo: d.subgrupo.trim(), nome: d.nome.trim() })),
    onSuccess: () => invalidar(qc, 'categorias'),
  })
}

// ---- Contas (bancos, caixa) ---------------------------------------------------------------

export function useContasFin() {
  return useQuery({
    queryKey: CHAVES.contas,
    queryFn: async () =>
      (await db.listar<ContaFin>('fin_contas', undefined, { coluna: 'nome' })).map((c) => ({ ...c, saldo_inicial: valor(c.saldo_inicial) })),
  })
}

export function useSalvarContaFin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: DadosConta) =>
      db.salvar<ContaFin>('fin_contas', carimbo({ ...d, nome: d.nome.trim(), saldo_inicial: centavos(d.saldo_inicial) })),
    onSuccess: () => invalidar(qc, 'contas'),
  })
}

// ---- Títulos (contas a pagar e a receber) -------------------------------------------------

export function useTitulos() {
  return useQuery({
    queryKey: CHAVES.titulos,
    queryFn: async () =>
      (await db.listar<Titulo>('fin_titulos', undefined, { coluna: 'vencimento' })).map((t) => ({ ...t, valor: valor(t.valor) })),
  })
}

function limparTitulo(d: DadosTitulo): DadosTitulo {
  return {
    ...d,
    descricao: d.descricao.trim(),
    pessoa: textoOuNull(d.pessoa),
    nota_fiscal: textoOuNull(d.nota_fiscal),
    observacao: textoOuNull(d.observacao),
    valor: centavos(d.valor),
  }
}

/** Salva um título ou vários de uma vez (parcelas/recorrência), tudo ou nada. */
export function useSalvarTitulos() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ novos, lista }: Lote<DadosTitulo>) =>
      db.salvarVarios<Titulo>('fin_titulos', lista.map((d) => carimbo(limparTitulo(d), novos))),
    onSuccess: () => invalidar(qc, 'titulos'),
  })
}

/**
 * Volta um título apagado (botão Desfazer), com o mesmo id, e liga de novo a ele os pagamentos
 * que ele tinha (ao apagar, o vínculo some). Tudo dentro da mutação, e não num onSuccess do
 * mutate(): esse não roda se a tela já foi fechada, e o aviso com Desfazer aparece depois de sair dela.
 */
export function useRestaurarTitulo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ titulo, baixas }: { titulo: Titulo; baixas: Lancamento[] }) => {
      await db.salvarVarios<Titulo>('fin_titulos', [titulo])
      if (baixas.length > 0) {
        await db.salvarVarios<Lancamento>('fin_lancamentos', baixas.map((l) => ({ ...l, titulo_id: titulo.id })))
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['fin'] }),
  })
}

/** Apaga um título. Lançamentos de baixa ligados a ele continuam (o vínculo some). */
export function useRemoverTitulo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await db.remover('fin_titulos', id)
      // No Supabase o vínculo some sozinho (on delete set null); no modo local fazemos igual.
      if (modoLocal) {
        const ligados = await db.listar<Lancamento>('fin_lancamentos', { titulo_id: id })
        await db.salvarVarios<Lancamento>('fin_lancamentos', ligados.map((l) => ({ ...l, titulo_id: null })))
      }
    },
    onSuccess: () => invalidar(qc, 'titulos', 'lancamentos'),
  })
}

// ---- Lançamentos (o que entrou e saiu de verdade) -----------------------------------------

export function useLancamentos() {
  return useQuery({
    queryKey: CHAVES.lancamentos,
    queryFn: async () =>
      (await db.listar<Lancamento>('fin_lancamentos', undefined, { coluna: 'data', crescente: false })).map((l) => ({
        ...l,
        valor: valor(l.valor),
        ofx_conta_id: l.ofx_conta_id ?? null, // lançamentos antigos (modo local) não têm a coluna
      })),
  })
}

function limparLancamento(d: DadosLancamento): DadosLancamento {
  const transferencia = d.tipo === 'transferencia'
  return {
    ...d,
    descricao: d.descricao.trim(),
    pessoa: textoOuNull(d.pessoa),
    forma_pagamento: textoOuNull(d.forma_pagamento),
    observacao: textoOuNull(d.observacao),
    valor: centavos(d.valor),
    conta_destino_id: transferencia ? d.conta_destino_id : null,
    categoria_id: transferencia ? null : d.categoria_id,
    titulo_id: transferencia ? null : d.titulo_id,
  }
}

/**
 * Salva um lançamento ou vários de uma vez (importação do extrato), tudo ou nada.
 * "Dar baixa" num título = salvar um lançamento com titulo_id.
 */
export function useSalvarLancamentos() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ novos, lista }: Lote<DadosLancamento>) =>
      db.salvarVarios<Lancamento>('fin_lancamentos', lista.map((d) => carimbo(limparLancamento(d), novos))),
    onSuccess: () => invalidar(qc, 'lancamentos'),
  })
}

export function useRemoverLancamento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => db.remover('fin_lancamentos', id),
    onSuccess: () => invalidar(qc, 'lancamentos'),
  })
}

/** Volta um lançamento apagado (botão Desfazer), com o mesmo id. */
export function useRestaurarLancamento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (l: Lancamento) => db.salvarVarios<Lancamento>('fin_lancamentos', [l]),
    onSuccess: () => invalidar(qc, 'lancamentos'),
  })
}

/** Data de hoje no formato do banco (AAAA-MM-DD), no fuso do aparelho. */
export function hoje(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
