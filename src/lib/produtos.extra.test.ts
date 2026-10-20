// Testes extras (revisão do Módulo 3 — Produtos): casos de borda de custo, preço e baixa
// das variações.
import { describe, expect, it } from 'vitest'
import { duplicarProduto, duplicarVariacao, produtoVazio, variacaoVazia, type Produto } from '../modules/produtos/api'
import type { ConfigPrecificacao } from './precificacao'
import { baixaVariacao, custoVariacao, precificarVariacao, type VariacaoCalculo } from './produtos'
import type { Contexto, InsumoCalculo, ReceitaCalculo } from './receitas'

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

function variacao(p: Partial<VariacaoCalculo> & Pick<VariacaoCalculo, 'itens'>): VariacaoCalculo {
  return { id: 'v', nome: 'V', tempo_montagem_min: 0, pct_custos_fixos: null, pct_taxas: null, pct_margem: null, pv_manual: null, ...p }
}

const insumos: InsumoCalculo[] = [
  { id: 'base', nome: 'Base', qtdCompra: 1, unidadeCompra: 'un', precoCompra: 1 }, // R$ 1/un
  { id: 'caixa4', nome: 'Caixa p/ 4', qtdCompra: 10, unidadeCompra: 'un', precoCompra: 40 }, // R$ 4/un
  { id: 'pote', nome: 'Pote 1 kg', qtdCompra: 1, unidadeCompra: 'un', precoCompra: 3 },
]

function contexto(receitas: ReceitaCalculo[], valorHora = 20): Contexto {
  return { receitas: new Map(receitas.map((r) => [r.id, r])), insumos: new Map(insumos.map((i) => [i.id, i])), valorHora }
}

// Brigadeiro: rende 30 un, custo 60 (ingredientes) → R$ 2/un.
const brigadeiro = receita({
  id: 'brig',
  nome: 'Brigadeiro',
  rendimento_qtd: 30,
  rendimento_nome: 'brigadeiro',
  itens: [{ tipo: 'insumo', id: 'base', quantidade: 60 }],
})
// Bolo de pote em kg: rende 2 kg (base 2000 g), custo 50 → R$ 0,025/g.
const boloPote = receita({
  id: 'pote-kg',
  nome: 'Bolo de pote',
  rendimento_qtd: 2,
  rendimento_unidade: 'kg',
  itens: [{ tipo: 'insumo', id: 'base', quantidade: 50 }],
})

describe('custoVariacao — domínio', () => {
  it('caixa com 4 brigadeiros (receita rende 30 un)', () => {
    const v = variacao({
      itens: [
        { tipo: 'receita', id: 'brig', quantidade: 4 },
        { tipo: 'insumo', id: 'caixa4', quantidade: 1 },
      ],
    })
    const r = custoVariacao(v, contexto([brigadeiro]))
    expect(r.custoDireto).toBeCloseTo(4 * 2 + 4, 9)
    expect(r.problemas).toEqual([])
    expect(precificarVariacao(v, r.custoDireto, cfg).pvSugerido).toBeCloseTo(24, 9) // 12 ÷ 0,5
  })

  it('1 kg de bolo de pote (receita em kg, item em g)', () => {
    const v = variacao({
      itens: [
        { tipo: 'receita', id: 'pote-kg', quantidade: 1000 },
        { tipo: 'insumo', id: 'pote', quantidade: 1 },
      ],
    })
    const r = custoVariacao(v, contexto([boloPote]))
    expect(r.custoDireto).toBeCloseTo(25 + 3, 9)
    expect(r.linhas[0].unidade).toBe('g')
  })

  it('mão de obra da receita entra proporcional + montagem da variação', () => {
    const comTempo = { ...brigadeiro, tempo_preparo_min: 90 } // R$ 30 → total 90 → R$ 3/un
    const v = variacao({ itens: [{ tipo: 'receita', id: 'brig', quantidade: 4 }], tempo_montagem_min: 6 }) // R$ 2
    const r = custoVariacao(v, contexto([comTempo]))
    expect(r.custoIngredientes).toBeCloseTo(12, 9)
    expect(r.custoMaoDeObra).toBeCloseTo(2, 9)
    expect(r.custoDireto).toBeCloseTo(14, 9)
  })

  it('valor da hora 0 → sem mão de obra de montagem', () => {
    const v = variacao({ itens: [], tempo_montagem_min: 30 })
    expect(custoVariacao(v, contexto([], 0)).custoMaoDeObra).toBe(0)
  })
})

describe('custoVariacao — bordas', () => {
  it('receita com rendimento 0 vira problema (custo 0, sem NaN/Infinity)', () => {
    const sem = receita({ id: 'r0', nome: 'Sem rendimento', rendimento_qtd: 0, itens: [{ tipo: 'insumo', id: 'base', quantidade: 10 }] })
    const r = custoVariacao(variacao({ itens: [{ tipo: 'receita', id: 'r0', quantidade: 2 }] }), contexto([sem]))
    expect(r.custoDireto).toBe(0)
    expect(r.problemas).toEqual(['Sem rendimento: Rendimento não informado'])
  })

  it('receitas em ciclo (dados antigos) viram problema, sem laço infinito', () => {
    const a = receita({ id: 'a', nome: 'A', itens: [{ tipo: 'receita', id: 'b', quantidade: 1 }] })
    const b = receita({ id: 'b', nome: 'B', itens: [{ tipo: 'receita', id: 'a', quantidade: 1 }] })
    const r = custoVariacao(
      variacao({
        itens: [
          { tipo: 'receita', id: 'a', quantidade: 1 },
          { tipo: 'receita', id: 'b', quantidade: 1 },
        ],
      }),
      contexto([a, b]),
    )
    expect(r.problemas.length).toBeGreaterThan(0)
    expect(Number.isFinite(r.custoDireto)).toBe(true)
  })

  it('item que aponta para o id sintético "__variacao__" vira problema de ciclo, sem quebrar', () => {
    const r = custoVariacao(variacao({ nome: 'Caixa', itens: [{ tipo: 'receita', id: '__variacao__', quantidade: 1 }] }), contexto([]))
    expect(r.problemas.length).toBe(1)
    expect(r.custoDireto).toBe(0)
  })

  it('variações diferentes não se contaminam (memo é por chamada)', () => {
    const ctx = contexto([brigadeiro])
    const v1 = variacao({ itens: [{ tipo: 'receita', id: 'brig', quantidade: 4 }] })
    const v2 = variacao({ itens: [{ tipo: 'receita', id: 'brig', quantidade: 9 }] })
    expect(custoVariacao(v1, ctx).custoDireto).toBeCloseTo(8, 9)
    expect(custoVariacao(v2, ctx).custoDireto).toBeCloseTo(18, 9)
  })

  it('problema numa sub-receita (insumo apagado) sobe para a variação', () => {
    const quebrada = receita({ id: 'q', nome: 'Quebrada', rendimento_qtd: 10, itens: [{ tipo: 'insumo', id: 'sumiu', quantidade: 1 }] })
    const r = custoVariacao(variacao({ itens: [{ tipo: 'receita', id: 'q', quantidade: 1 }] }), contexto([quebrada]))
    expect(r.problemas).toEqual(['Quebrada: Um insumo desta receita foi apagado'])
  })
})

describe('precificarVariacao — bordas', () => {
  const v = variacao({ itens: [] })
  it('pv_manual 0 ou negativo é ignorado (usa o sugerido)', () => {
    expect(precificarVariacao({ ...v, pv_manual: 0 }, 10, cfg).manual).toBe(false)
    expect(precificarVariacao({ ...v, pv_manual: -5 }, 10, cfg).pvFinal).toBeCloseTo(20, 9)
  })
  it('percentuais somando 100% ou mais → sem preço sugerido', () => {
    const p = precificarVariacao({ ...v, pct_margem: 75 }, 10, cfg) // 20 + 5 + 75
    expect(p.pvSugerido).toBeNull()
    expect(p.pvFinal).toBeNull()
    expect(p.abaixoDoCusto).toBe(false)
  })
  it('com % impossíveis, o preço manual ainda vale', () => {
    const p = precificarVariacao({ ...v, pct_margem: 80, pv_manual: 30 }, 10, cfg)
    expect(p.pvFinal).toBe(30)
    expect(p.lucroPorUnidade).toBeCloseTo(30 - 10 - 30 * 0.25, 9)
  })
  it('% vazios usam as configurações gerais (NÃO os ajustes da receita usada)', () => {
    // Comportamento atual, documentado: precificarVariacao nem recebe as receitas, então uma
    // margem própria do brigadeiro (ex.: 40%) não passa para a caixa — vale a geral (25%).
    const p = precificarVariacao(variacao({ itens: [{ tipo: 'receita', id: 'brig', quantidade: 4 }] }), 8, cfg)
    expect(p.pcts.pctMargem).toBe(25)
  })
  it('% negativo (o banco aceita na variação) leva a preço abaixo do custo', () => {
    // Consequência do check ausente em produto_variacoes_validas (ver revisão).
    const p = precificarVariacao({ ...v, pct_margem: -50, pct_custos_fixos: 0, pct_taxas: 0 }, 10, cfg)
    expect(p.pvSugerido).toBeCloseTo(6.67, 9) // 10 ÷ 1,5, arredondado ao centavo
    expect(p.abaixoDoCusto).toBe(true)
  })
})

describe('baixaVariacao — bordas', () => {
  it('soma itens repetidos (mesma receita/insumo duas vezes)', () => {
    const b = baixaVariacao(
      {
        itens: [
          { tipo: 'receita', id: 'brig', quantidade: 4 },
          { tipo: 'receita', id: 'brig', quantidade: 2 },
          { tipo: 'insumo', id: 'caixa4', quantidade: 1 },
          { tipo: 'insumo', id: 'caixa4', quantidade: 1 },
        ],
      },
      3,
    )
    expect(b.receitas.get('brig')).toBe(18)
    expect(b.insumos.get('caixa4')).toBe(6)
  })

  it('mesmo id como receita e como insumo fica em mapas separados', () => {
    const b = baixaVariacao(
      {
        itens: [
          { tipo: 'receita', id: 'x', quantidade: 1 },
          { tipo: 'insumo', id: 'x', quantidade: 2 },
        ],
      },
      1,
    )
    expect(b.receitas.get('x')).toBe(1)
    expect(b.insumos.get('x')).toBe(2)
  })

  it('quantidade 0 não tira nada', () => {
    const b = baixaVariacao({ itens: [{ tipo: 'insumo', id: 'caixa4', quantidade: 1 }] }, 0)
    expect(b.insumos.get('caixa4') ?? 0).toBe(0)
  })

  // BUG (baixo): quantidade negativa ou NaN não é rejeitada — uma baixa negativa
  // DEVOLVERIA itens ao estoque; NaN corromperia o saldo. Ver revisão.
  it('quantidade negativa ou NaN não gera baixa negativa/NaN', () => {
    const v = { itens: [{ tipo: 'insumo' as const, id: 'caixa4', quantidade: 1 }] }
    for (const q of [-2, Number.NaN]) {
      const b = baixaVariacao(v, q)
      const valor = b.insumos.get('caixa4') ?? 0
      expect(Number.isFinite(valor) && valor >= 0).toBe(true)
    }
  })

  // BUG (baixo): item com quantidade negativa/NaN (estado do formulário) também passa direto.
  it('item com quantidade negativa/NaN não gera baixa negativa/NaN', () => {
    const b = baixaVariacao(
      {
        itens: [
          { tipo: 'insumo', id: 'a', quantidade: -1 },
          { tipo: 'insumo', id: 'b', quantidade: Number.NaN },
        ],
      },
      1,
    )
    for (const valor of b.insumos.values()) expect(Number.isFinite(valor) && valor >= 0).toBe(true)
  })
})

describe('helpers do api.ts', () => {
  it('produto vazio já nasce com 1 variação (o banco exige ≥ 1)', () => {
    const p = produtoVazio()
    expect(p.variacoes.length).toBe(1)
    expect(p.variacoes[0].nome).toBe('Padrão')
    expect(p.variacoes[0].id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('duplicarVariacao: id novo e itens copiados (não compartilhados)', () => {
    const v = { ...variacaoVazia('MDF'), itens: [{ tipo: 'insumo' as const, id: 'caixa4', quantidade: 1 }] }
    const d = duplicarVariacao(v)
    expect(d.id).not.toBe(v.id)
    expect(d.nome).toBe('MDF (cópia)')
    d.itens[0].quantidade = 99
    expect(v.itens[0].quantidade).toBe(1)
  })

  it('duplicarProduto: sem id, ids de variação novos e únicos', () => {
    const p: Produto = {
      id: 'p1',
      nome: 'Bolo',
      categoria: 'bolo',
      descricao: null,
      variacoes: [variacaoVazia('A'), variacaoVazia('B')],
      ativo: true,
      criado_em: '2026-01-01T00:00:00Z',
      atualizado_em: '2026-01-01T00:00:00Z',
    }
    const d = duplicarProduto(p)
    expect(d.id).toBeUndefined()
    const ids = d.variacoes.map((v) => v.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids.some((id) => p.variacoes.some((v) => v.id === id))).toBe(false)
    expect('criado_em' in d).toBe(false)
  })
})
