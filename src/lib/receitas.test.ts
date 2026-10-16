import { describe, expect, it } from 'vitest'
import type { ConfigPrecificacao } from './precificacao'
import {
  calcularCusto,
  criariaCiclo,
  explodirInsumos,
  plural,
  precificar,
  rendimentoBase,
  textoRendimento,
  usadaEm,
  type Contexto,
  type InsumoCalculo,
  type ReceitaCalculo,
} from './receitas'

const cfg: ConfigPrecificacao = { valorHora: 20, pctCustosFixos: 20, pctTaxas: 5, pctMargem: 25, arredondamento: 'nenhum' }

function receita(p: Partial<ReceitaCalculo> & Pick<ReceitaCalculo, 'id' | 'nome'>): ReceitaCalculo {
  return {
    rendimento_qtd: 1,
    rendimento_unidade: 'un',
    rendimento_nome: null,
    itens: [],
    tempo_preparo_min: 0,
    pct_custos_fixos: null,
    pct_taxas: null,
    pct_margem: null,
    pv_manual: null,
    ...p,
  }
}

const insumos: InsumoCalculo[] = [
  { id: 'ovo', nome: 'Ovo', qtdCompra: 1, unidadeCompra: 'dz', precoCompra: 12 }, // R$ 1/un
  { id: 'acucar', nome: 'Açúcar', qtdCompra: 1, unidadeCompra: 'kg', precoCompra: 5 }, // R$ 0,005/g
  { id: 'cenoura', nome: 'Cenoura', qtdCompra: 1, unidadeCompra: 'kg', precoCompra: 6 }, // R$ 0,006/g
  { id: 'choc', nome: 'Chocolate', qtdCompra: 1, unidadeCompra: 'kg', precoCompra: 40 }, // R$ 0,04/g
  { id: 'leite', nome: 'Leite', qtdCompra: 1, unidadeCompra: 'l', precoCompra: 5 }, // R$ 0,005/ml
]

// Calda de chocolate: rende 500 g. 200 g chocolate (8) + 300 ml leite (1,5) = 9,50; 15 min de preparo (5) → 14,50
const calda = receita({
  id: 'calda',
  nome: 'Calda de chocolate',
  rendimento_qtd: 500,
  rendimento_unidade: 'g',
  tempo_preparo_min: 15,
  itens: [
    { tipo: 'insumo', id: 'choc', quantidade: 200 },
    { tipo: 'insumo', id: 'leite', quantidade: 300 },
  ],
})

// Bolo de cenoura com calda: rende 10 fatias.
// 4 ovos (4) + 200 g açúcar (1) + 300 g cenoura (1,8) = 6,80
// + 250 g de calda (metade: 7,25) = 14,05; 45 min (15) → custo direto 29,05
const bolo = receita({
  id: 'bolo',
  nome: 'Bolo de cenoura com calda',
  rendimento_qtd: 10,
  rendimento_unidade: 'un',
  rendimento_nome: 'fatia',
  tempo_preparo_min: 45,
  itens: [
    { tipo: 'insumo', id: 'ovo', quantidade: 4 },
    { tipo: 'insumo', id: 'acucar', quantidade: 200 },
    { tipo: 'insumo', id: 'cenoura', quantidade: 300 },
    { tipo: 'receita', id: 'calda', quantidade: 250 },
  ],
})

function ctx(receitas: ReceitaCalculo[]): Contexto {
  return {
    receitas: new Map(receitas.map((r) => [r.id, r])),
    insumos: new Map(insumos.map((i) => [i.id, i])),
    valorHora: cfg.valorHora,
  }
}

describe('rendimento', () => {
  it('converte para a unidade base', () => {
    expect(rendimentoBase({ rendimento_qtd: 1.2, rendimento_unidade: 'kg' })).toBe(1200)
    expect(rendimentoBase({ rendimento_qtd: 10, rendimento_unidade: 'un' })).toBe(10)
  })
  it('texto com plural', () => {
    expect(textoRendimento(bolo)).toBe('10 fatias')
    expect(textoRendimento(calda)).toBe('500 g')
    expect(textoRendimento({ rendimento_qtd: 1, rendimento_unidade: 'un', rendimento_nome: 'bolo' })).toBe('1 bolo')
  })
  it('plural em português', () => {
    expect(plural('porção', 2)).toBe('porções')
    expect(plural('pastel', 3)).toBe('pastéis')
    expect(plural('flor', 2)).toBe('flores')
    expect(plural('brigadeiro', 30)).toBe('brigadeiros')
  })
})

describe('calcularCusto', () => {
  it('receita simples com mão de obra', () => {
    const r = calcularCusto('calda', ctx([calda]))
    expect(r.custoIngredientes).toBeCloseTo(9.5, 9)
    expect(r.custoMaoDeObra).toBeCloseTo(5, 9)
    expect(r.custoDireto).toBeCloseTo(14.5, 9)
    expect(r.custoPorBase).toBeCloseTo(0.029, 9)
    expect(r.problemas).toEqual([])
  })
  it('sub-receita entra proporcional, com a mão de obra dela', () => {
    const r = calcularCusto('bolo', ctx([calda, bolo]))
    expect(r.custoIngredientes).toBeCloseTo(6.8 + 7.25, 9)
    expect(r.custoDireto).toBeCloseTo(29.05, 9)
    expect(r.linhas.find((l) => l.item.id === 'calda')?.custo).toBeCloseTo(7.25, 9)
  })
  it('insumo apagado vira problema, sem quebrar', () => {
    const r = calcularCusto('x', ctx([receita({ id: 'x', nome: 'X', itens: [{ tipo: 'insumo', id: 'sumiu', quantidade: 10 }] })]))
    expect(r.custoDireto).toBe(0)
    expect(r.problemas.length).toBe(1)
  })
  it('ciclo é detectado e não trava', () => {
    const a = receita({ id: 'a', nome: 'A', itens: [{ tipo: 'receita', id: 'b', quantidade: 1 }] })
    const b = receita({ id: 'b', nome: 'B', itens: [{ tipo: 'receita', id: 'a', quantidade: 1 }] })
    const r = calcularCusto('a', ctx([a, b]))
    expect(r.problemas.length).toBeGreaterThan(0)
  })
})

describe('precificar', () => {
  it('preço por fatia pelo markup divisor', () => {
    const p = precificar(bolo, 29.05, cfg)
    expect(p.unidade).toBe('fatia')
    expect(p.qtdVenda).toBe(10)
    expect(p.custoPorUnidade).toBeCloseTo(2.905, 9)
    expect(p.pvSugerido).toBeCloseTo(5.81, 9) // 2,905 ÷ 0,5
    expect(p.pvTotal).toBeCloseTo(58.1, 9)
    expect(p.pctMargemReal).toBeCloseTo(25, 6)
  })
  it('arredonda para ,90', () => {
    expect(precificar(bolo, 29.05, { ...cfg, arredondamento: 'centavos90' }).pvSugerido).toBe(5.9)
  })
  it('receita em peso é precificada por kg', () => {
    const p = precificar(calda, 14.5, cfg)
    expect(p.unidade).toBe('kg')
    expect(p.qtdVenda).toBe(0.5)
    expect(p.custoPorUnidade).toBeCloseTo(29, 9)
    expect(p.pvSugerido).toBeCloseTo(58, 9)
  })
  it('preço manual mostra a margem real e avisa se ficar abaixo do custo', () => {
    const p = precificar({ ...bolo, pv_manual: 2.5 }, 29.05, cfg)
    expect(p.manual).toBe(true)
    expect(p.pvFinal).toBe(2.5)
    expect(p.abaixoDoCusto).toBe(true)
    expect(p.pctMargemReal).toBeLessThan(0)
  })
  it('ajustes da receita substituem os gerais', () => {
    const p = precificar({ ...bolo, pct_margem: 45 }, 29.05, cfg) // 1 − 0,7 = 0,3
    expect(p.pvSugerido).toBe(9.68) // 2,905 ÷ 0,3 = 9,683… → centavos
    expect(p.pcts.pctMargem).toBe(45)
  })
  it('percentuais impossíveis não geram preço', () => {
    expect(precificar({ ...bolo, pct_margem: 80 }, 29.05, cfg).pvSugerido).toBeNull()
  })
})

describe('produção', () => {
  it('1 bolo baixa os insumos dele e os da calda (proporcional)', () => {
    const m = explodirInsumos('bolo', 1, ctx([calda, bolo]))
    expect(m.get('ovo')).toBe(4)
    expect(m.get('acucar')).toBe(200)
    expect(m.get('choc')).toBeCloseTo(100, 9) // metade da calda
    expect(m.get('leite')).toBeCloseTo(150, 9)
  })
  it('2 receitas dobram tudo', () => {
    expect(explodirInsumos('bolo', 2, ctx([calda, bolo])).get('ovo')).toBe(8)
  })
  it('usadaEm e criariaCiclo', () => {
    const c = ctx([calda, bolo])
    expect(usadaEm('calda', c.receitas.values()).map((r) => r.id)).toEqual(['bolo'])
    expect(criariaCiclo('calda', 'bolo', c.receitas)).toBe(true)
    expect(criariaCiclo('bolo', 'calda', c.receitas)).toBe(false)
  })
})

describe('textoQuantidade', () => {
  it('troca para kg/L a partir de 1000', async () => {
    const { textoQuantidade } = await import('./receitas')
    expect(textoQuantidade(300, 'g')).toBe('300 g')
    expect(textoQuantidade(1500, 'g')).toBe('1,5 kg')
    expect(textoQuantidade(2000, 'ml')).toBe('2 L')
    expect(textoQuantidade(4, 'un')).toBe('4 un')
  })
})
