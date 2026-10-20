import { describe, expect, it } from 'vitest'
import type { ConfigPrecificacao } from './precificacao'
import { baixaVariacao, custoVariacao, precificarVariacao, type VariacaoCalculo } from './produtos'
import type { Contexto, InsumoCalculo, ReceitaCalculo } from './receitas'

const cfg: ConfigPrecificacao = { valorHora: 20, pctCustosFixos: 20, pctTaxas: 5, pctMargem: 25, arredondamento: 'nenhum' }

// Bolo que rende 10 fatias com custo direto 30 (só ingredientes, sem mão de obra) → R$ 3 por fatia.
const bolo: ReceitaCalculo = {
  id: 'bolo',
  nome: 'Bolo de aniversário',
  rendimento_qtd: 10,
  rendimento_unidade: 'un',
  rendimento_nome: 'fatia',
  itens: [{ tipo: 'insumo', id: 'massa', quantidade: 1000 }],
  tempo_preparo_min: 0,
  pct_custos_fixos: null,
  pct_taxas: null,
  pct_margem: null,
  pv_manual: null,
}

const insumos: InsumoCalculo[] = [
  { id: 'massa', nome: 'Massa pronta', qtdCompra: 1, unidadeCompra: 'kg', precoCompra: 30 }, // R$ 0,03/g
  { id: 'mdf', nome: 'Prato MDF', qtdCompra: 10, unidadeCompra: 'un', precoCompra: 80 }, // R$ 8/un
  { id: 'bandeja', nome: 'Bandeja plástica', qtdCompra: 50, unidadeCompra: 'un', precoCompra: 100 }, // R$ 2/un
  { id: 'caixa', nome: 'Caixa', qtdCompra: 1, unidadeCompra: 'un', precoCompra: 4 },
  { id: 'pote', nome: 'Pote', qtdCompra: 100, unidadeCompra: 'un', precoCompra: 50 }, // R$ 0,50/un
]

const ctx: Contexto = {
  receitas: new Map([[bolo.id, bolo]]),
  insumos: new Map(insumos.map((i) => [i.id, i])),
  valorHora: 20,
}

function variacao(p: Partial<VariacaoCalculo> & Pick<VariacaoCalculo, 'itens'>): VariacaoCalculo {
  return { id: 'v', nome: 'V', tempo_montagem_min: 0, pct_custos_fixos: null, pct_taxas: null, pct_margem: null, pv_manual: null, ...p }
}

const mdf = variacao({
  nome: 'Prato MDF',
  itens: [
    { tipo: 'receita', id: 'bolo', quantidade: 10 }, // bolo inteiro
    { tipo: 'insumo', id: 'mdf', quantidade: 1 },
    { tipo: 'insumo', id: 'caixa', quantidade: 1 },
  ],
})
const bandeja = variacao({
  nome: 'Bandeja plástica',
  itens: [
    { tipo: 'receita', id: 'bolo', quantidade: 10 },
    { tipo: 'insumo', id: 'bandeja', quantidade: 1 },
  ],
})

describe('custoVariacao', () => {
  it('mesmo bolo com prato MDF e com bandeja dá custos diferentes', () => {
    expect(custoVariacao(mdf, ctx).custoDireto).toBeCloseTo(30 + 8 + 4, 9)
    expect(custoVariacao(bandeja, ctx).custoDireto).toBeCloseTo(30 + 2, 9)
  })
  it('fatia no pote: 1 fatia + pote + montagem', () => {
    const fatia = variacao({
      itens: [
        { tipo: 'receita', id: 'bolo', quantidade: 1 },
        { tipo: 'insumo', id: 'pote', quantidade: 1 },
      ],
      tempo_montagem_min: 3, // R$ 1
    })
    const r = custoVariacao(fatia, ctx)
    expect(r.custoIngredientes).toBeCloseTo(3.5, 9)
    expect(r.custoMaoDeObra).toBeCloseTo(1, 9)
    expect(r.custoDireto).toBeCloseTo(4.5, 9)
  })
  it('receita ou insumo apagado vira problema', () => {
    const r = custoVariacao(variacao({ itens: [{ tipo: 'receita', id: 'sumiu', quantidade: 1 }] }), ctx)
    expect(r.problemas.length).toBe(1)
    expect(r.custoDireto).toBe(0)
  })
  it('não altera o contexto recebido', () => {
    custoVariacao(mdf, ctx)
    expect(ctx.receitas.size).toBe(1)
  })
})

describe('precificarVariacao', () => {
  it('preço por unidade do produto pelo markup divisor', () => {
    const p = precificarVariacao(mdf, 42, cfg)
    expect(p.qtdVenda).toBe(1)
    expect(p.pvSugerido).toBeCloseTo(84, 9) // 42 ÷ 0,5
    expect(p.pctMargemReal).toBeCloseTo(25, 6)
  })
  it('PV manual e ajustes da variação', () => {
    expect(precificarVariacao({ ...mdf, pv_manual: 40 }, 42, cfg).abaixoDoCusto).toBe(true)
    expect(precificarVariacao({ ...mdf, pct_margem: 35 }, 42, cfg).pvSugerido).toBeCloseTo(105, 9) // 42 ÷ 0,4
  })
})

describe('baixaVariacao', () => {
  it('vender 2 fatias no pote tira 2 fatias e 2 potes (sem descer nos insumos do bolo)', () => {
    const b = baixaVariacao(
      {
        itens: [
          { tipo: 'receita', id: 'bolo', quantidade: 1 },
          { tipo: 'insumo', id: 'pote', quantidade: 1 },
        ],
      },
      2,
    )
    expect(b.receitas.get('bolo')).toBe(2)
    expect(b.insumos.get('pote')).toBe(2)
    expect(b.insumos.has('massa')).toBe(false)
  })
})
