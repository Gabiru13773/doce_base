import { numero } from '../../../lib/format'
import { plural, textoQuantidade, unidadeBaseReceita, type Contexto, type ReceitaCalculo } from '../../../lib/receitas'
import { unidadeBase } from '../../../lib/unidades'

// Textos curtos da produção: quantidades de preparados e insumos na unidade de cada um.

/** Quantidade de um preparado na unidade base dele: "20 fatias", "1,5 kg", "750 ml". */
export function textoPreparado(qtd: number, r: Pick<ReceitaCalculo, 'rendimento_unidade' | 'rendimento_nome'> | undefined): string {
  if (!r) return numero(qtd, 3)
  if (r.rendimento_unidade === 'un') return `${numero(qtd, 2)} ${plural(r.rendimento_nome || 'unidade', qtd)}`
  return textoQuantidade(qtd, unidadeBaseReceita(r))
}

/** "1 receita", "2 receitas", "0,5 receita". */
export function textoLotes(lotes: number): string {
  return `${numero(lotes, 3)} ${plural('receita', lotes)}`
}

/** Nome e formato de quantidade de um insumo ou preparado (inclui os apagados). */
export function descreverItem(tipo: 'insumo' | 'receita', id: string, ctx: Contexto | null): { nome: string; texto: (qtd: number) => string } {
  if (tipo === 'insumo') {
    const ins = ctx?.insumos.get(id)
    const base = ins ? unidadeBase(ins.unidadeCompra) : 'un'
    return { nome: ins?.nome ?? 'Insumo apagado', texto: (q) => textoQuantidade(q, base) }
  }
  const r = ctx?.receitas.get(id)
  return { nome: r?.nome ?? 'Receita apagada', texto: (q) => textoPreparado(q, r) }
}

/** "Hoje", "Ontem" ou a data (20/10/2026). */
export function rotuloDia(data: string, hoje: string, dataBr: (d: string) => string): string {
  if (data === hoje) return 'Hoje'
  const [a, m, d] = hoje.split('-').map(Number)
  const o = new Date(a, m - 1, d - 1)
  const ontem = `${o.getFullYear()}-${String(o.getMonth() + 1).padStart(2, '0')}-${String(o.getDate()).padStart(2, '0')}`
  return data === ontem ? 'Ontem' : dataBr(data)
}
