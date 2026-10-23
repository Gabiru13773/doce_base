import { situacaoEstoque, type ItemTipo, type SituacaoEstoque } from '../../../lib/estoque'
import { numero } from '../../../lib/format'
import { plural, textoQuantidade, unidadeBaseReceita } from '../../../lib/receitas'
import { paraBase, UNIDADES_COMPRA, unidadeBase, type UnidadeBase, type UnidadeCompra } from '../../../lib/unidades'
import type { CategoriaInsumo, Insumo } from '../../insumos/api'
import type { Receita } from '../../receitas/api'
import type { Movimento } from '../api'

// Um item do estoque (insumo ou preparado) já com saldo e textos amigáveis.

export interface ItemEstoque {
  tipo: ItemTipo
  id: string
  nome: string
  base: UnidadeBase
  /** Preparado medido em unidades: nome da unidade (fatia, brigadeiro…). */
  nomeUnidade: string | null
  minimo: number | null
  saldo: number
  situacao: SituacaoEstoque
  /** Embalagem de compra do insumo (para "≈ 2,5 pacotes de 1 kg"). */
  embalagem: { qtd: number; unidade: UnidadeCompra } | null
  /** Unidade em que a pessoa costuma pensar nesse item (kg, L, un…). */
  unidadePadrao: UnidadeCompra
  categoria: CategoriaInsumo | null
}

export function itemDeInsumo(i: Insumo, saldo: number | undefined): ItemEstoque {
  const minimo = i.estoque_minimo != null && i.estoque_minimo > 0 ? i.estoque_minimo : null
  return {
    tipo: 'insumo',
    id: i.id,
    nome: i.nome,
    base: unidadeBase(i.unidade_compra),
    nomeUnidade: null,
    minimo,
    saldo: saldo ?? 0,
    situacao: situacaoEstoque(saldo, minimo),
    embalagem: { qtd: i.qtd_compra, unidade: i.unidade_compra },
    unidadePadrao: i.unidade_compra,
    categoria: i.categoria,
  }
}

export function itemDeReceita(r: Receita, saldo: number | undefined): ItemEstoque {
  const minimo = r.estoque_minimo != null && r.estoque_minimo > 0 ? r.estoque_minimo : null
  const emUnidades = r.rendimento_unidade === 'un'
  return {
    tipo: 'receita',
    id: r.id,
    nome: r.nome,
    base: unidadeBaseReceita(r),
    nomeUnidade: emUnidades ? (r.rendimento_nome || 'unidade').trim().toLowerCase() : null,
    minimo,
    saldo: saldo ?? 0,
    situacao: situacaoEstoque(saldo, minimo),
    embalagem: null,
    // As unidades do rendimento têm os mesmos nomes das de compra (un, g, kg, ml, l).
    unidadePadrao: r.rendimento_unidade,
    categoria: null,
  }
}

export function caminhoItem(item: Pick<ItemEstoque, 'tipo' | 'id'>): string {
  return `/estoque/${item.tipo === 'insumo' ? 'insumo' : 'preparado'}/${item.id}`
}

/** Quantidade sem sinal, em texto amigável: "1,5 kg", "300 g", "12 fatias", "4 un". */
export function textoQtdItem(qtd: number, item: Pick<ItemEstoque, 'base' | 'nomeUnidade'>): string {
  const q = Math.abs(qtd)
  if (item.nomeUnidade) return `${numero(q, 2)} ${plural(item.nomeUnidade, q)}`
  return textoQuantidade(q, item.base)
}

/** Saldo com sinal de menos quando negativo. */
export function textoSaldo(item: Pick<ItemEstoque, 'saldo' | 'base' | 'nomeUnidade'>): string {
  return `${item.saldo < 0 ? '− ' : ''}${textoQtdItem(item.saldo, item)}`
}

/** "+ 200 g" / "− 1,5 kg" */
export function textoVariacao(qtd: number, item: Pick<ItemEstoque, 'base' | 'nomeUnidade'>): string {
  return `${qtd < 0 ? '−' : '+'} ${textoQtdItem(qtd, item)}`
}

const ROTULO_CURTO: Record<UnidadeCompra, string> = { g: 'g', kg: 'kg', ml: 'ml', l: 'L', un: 'un', dz: 'dz' }

/** "≈ 2,5 pacotes de 1 kg" (só para insumos com embalagem de mais de uma unidade base). */
export function textoEmbalagens(item: Pick<ItemEstoque, 'saldo' | 'embalagem'>): string | null {
  const emb = item.embalagem
  if (!emb || !(item.saldo > 0)) return null
  const porEmbalagem = paraBase(emb.qtd, emb.unidade)
  if (!(porEmbalagem > 1)) return null
  const n = item.saldo / porEmbalagem
  return `≈ ${numero(n, 1)} ${n >= 2 ? 'pacotes' : 'pacote'} de ${numero(emb.qtd, 3)} ${ROTULO_CURTO[emb.unidade]}`
}

export interface OpcaoUnidade {
  valor: UnidadeCompra
  rotulo: string
  fator: number
}

/** Rótulo curto de uma unidade para este item (no preparado em unidades: "fatias"). */
export function rotuloUnidade(u: UnidadeCompra, item: Pick<ItemEstoque, 'nomeUnidade'>): string {
  if (u === 'un' && item.nomeUnidade) return plural(item.nomeUnidade, 2)
  return ROTULO_CURTO[u]
}

/** Unidades em que dá para informar a quantidade deste item (mesma base). */
export function unidadesDoItem(item: Pick<ItemEstoque, 'base' | 'nomeUnidade'>): OpcaoUnidade[] {
  return UNIDADES_COMPRA.filter((u) => u.base === item.base && !(item.nomeUnidade && u.valor === 'dz')).map((u) => ({
    valor: u.valor,
    rotulo: rotuloUnidade(u.valor, item),
    fator: u.fator,
  }))
}

/** Data de hoje (AAAA-MM-DD) no fuso do aparelho. */
export function hojeLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Saldo sem um movimento já gravado com este id (numa nova tentativa depois de uma falha que,
 * no fim, gravou: a contagem é recalculada sem ela e o mesmo id é sobrescrito).
 */
export function saldoSem(saldo: number, id: string, movimentos: Movimento[] | undefined): number {
  const ja = movimentos?.find((m) => m.id === id)
  return ja ? saldo - ja.quantidade : saldo
}
