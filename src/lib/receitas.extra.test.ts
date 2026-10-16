// Testes extras (revisão do Módulo 2): casos de borda dos cálculos de custo e preço.
// Testes marcados com it.fails reproduzem bugs conhecidos de src/lib/receitas.ts /
// src/lib/precificacao.ts — quando forem corrigidos, o it.fails passa a falhar:
// troque por it(...) normal.
import { describe, expect, it } from 'vitest'
import { arredondarPreco, type ConfigPrecificacao } from './precificacao'
import {
  calcularCusto,
  explodirInsumos,
  percentuaisEfetivos,
  plural,
  precificar,
  rendimentoBase,
  textoRendimento,
  unidadeBaseReceita,
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
  { id: 'choc', nome: 'Chocolate', qtdCompra: 1, unidadeCompra: 'kg', precoCompra: 40 }, // R$ 0,04/g
  { id: 'leite', nome: 'Leite', qtdCompra: 1, unidadeCompra: 'l', precoCompra: 5 }, // R$ 0,005/ml
  { id: 'creme', nome: 'Creme de leite', qtdCompra: 200, unidadeCompra: 'g', precoCompra: 4 }, // R$ 0,02/g
  { id: 'centavo', nome: 'Insumo de 1 centavo/g', qtdCompra: 1, unidadeCompra: 'g', precoCompra: 0.01 },
]

function ctx(receitas: ReceitaCalculo[], valorHora = cfg.valorHora, lista: InsumoCalculo[] = insumos): Contexto {
  return {
    receitas: new Map(receitas.map((r) => [r.id, r])),
    insumos: new Map(lista.map((i) => [i.id, i])),
    valorHora,
  }
}

// ---- 3 níveis: ganache → recheio → bolo ------------------------------------------
// Ganache: rende 1 kg. 400 g choc (16) + 600 g creme (12) = 28; 30 min (10) → 38 → 0,038/g
const ganache = receita({
  id: 'ganache',
  nome: 'Ganache',
  rendimento_qtd: 1,
  rendimento_unidade: 'kg',
  tempo_preparo_min: 30,
  itens: [
    { tipo: 'insumo', id: 'choc', quantidade: 400 },
    { tipo: 'insumo', id: 'creme', quantidade: 600 },
  ],
})
// Recheio: rende 800 g. 500 g ganache (19) + 300 ml leite (1,5) = 20,5; 6 min (2) → 22,5 → 0,028125/g
const recheio = receita({
  id: 'recheio',
  nome: 'Recheio',
  rendimento_qtd: 800,
  rendimento_unidade: 'g',
  tempo_preparo_min: 6,
  itens: [
    { tipo: 'receita', id: 'ganache', quantidade: 500 },
    { tipo: 'insumo', id: 'leite', quantidade: 300 },
  ],
})
// Bolo: 20 fatias. 6 ovos (6) + 400 g recheio (11,25) = 17,25; 60 min (20) → 37,25
const boloRecheado = receita({
  id: 'bolo',
  nome: 'Bolo recheado',
  rendimento_qtd: 20,
  rendimento_unidade: 'un',
  rendimento_nome: 'fatia',
  tempo_preparo_min: 60,
  itens: [
    { tipo: 'insumo', id: 'ovo', quantidade: 6 },
    { tipo: 'receita', id: 'recheio', quantidade: 400 },
  ],
})

describe('sub-receita dentro de sub-receita (3 níveis)', () => {
  const c = ctx([ganache, recheio, boloRecheado])

  it('custo de cada nível, com a mão de obra das sub-receitas proporcional', () => {
    expect(calcularCusto('ganache', c).custoPorBase).toBeCloseTo(0.038, 12)
    const r = calcularCusto('recheio', c)
    expect(r.custoIngredientes).toBeCloseTo(20.5, 10)
    expect(r.custoDireto).toBeCloseTo(22.5, 10)
    expect(r.custoPorBase).toBeCloseTo(0.028125, 12)
    const b = calcularCusto('bolo', c)
    expect(b.linhas.find((l) => l.item.id === 'recheio')?.custo).toBeCloseTo(11.25, 10)
    expect(b.custoIngredientes).toBeCloseTo(17.25, 10)
    expect(b.custoDireto).toBeCloseTo(37.25, 10)
    expect(b.problemas).toEqual([])
  })

  it('explodirInsumos desce os 3 níveis com a proporção certa', () => {
    const m = explodirInsumos('bolo', 1, c)
    // 400 g de recheio = metade do recheio → 250 g de ganache (¼ da ganache) e 150 ml de leite
    expect(m.get('ovo')).toBe(6)
    expect(m.get('leite')).toBeCloseTo(150, 10)
    expect(m.get('choc')).toBeCloseTo(100, 10)
    expect(m.get('creme')).toBeCloseTo(150, 10)
    expect(m.size).toBe(4)
  })

  it('custo dos insumos explodidos = custo de ingredientes sem mão de obra', () => {
    const semMO = ctx([ganache, recheio, boloRecheado], 0)
    const m = explodirInsumos('bolo', 1, semMO)
    let soma = 0
    for (const [id, q] of m) soma += (semMO.insumos.get(id)!.precoCompra / (id === 'ovo' ? 12 : id === 'leite' ? 1000 : id === 'creme' ? 200 : 1000)) * q
    expect(soma).toBeCloseTo(calcularCusto('bolo', semMO).custoDireto, 10)
  })

  it('multiplicador ½ reduz tudo pela metade (inclusive nos níveis de baixo)', () => {
    const m = explodirInsumos('bolo', 0.5, c)
    expect(m.get('ovo')).toBe(3)
    expect(m.get('choc')).toBeCloseTo(50, 10)
    expect(m.get('creme')).toBeCloseTo(75, 10)
    expect(m.get('leite')).toBeCloseTo(75, 10)
  })

  it('a mesma sub-receita em vários lugares (diamante) soma as duas quantidades', () => {
    // Torta usa ganache direto (200 g) e também via recheio (400 g → 250 g de ganache)
    const torta = receita({
      id: 'torta',
      nome: 'Torta',
      itens: [
        { tipo: 'receita', id: 'ganache', quantidade: 200 },
        { tipo: 'receita', id: 'recheio', quantidade: 400 },
      ],
    })
    const c2 = ctx([ganache, recheio, torta])
    expect(explodirInsumos('torta', 1, c2).get('choc')).toBeCloseTo(80 + 100, 10)
    expect(calcularCusto('torta', c2).custoDireto).toBeCloseTo(200 * 0.038 + 11.25, 10)
  })
})

describe('memo não contamina', () => {
  it('mesma sub-receita usada em duas receitas com quantidades diferentes', () => {
    const a = receita({ id: 'a', nome: 'A', itens: [{ tipo: 'receita', id: 'ganache', quantidade: 100 }] })
    const b = receita({ id: 'b', nome: 'B', itens: [{ tipo: 'receita', id: 'ganache', quantidade: 300 }] })
    const topo = receita({
      id: 'topo',
      nome: 'Topo',
      itens: [
        { tipo: 'receita', id: 'a', quantidade: 1 },
        { tipo: 'receita', id: 'b', quantidade: 1 },
      ],
    })
    const c = ctx([ganache, a, b, topo])
    expect(calcularCusto('a', c).custoDireto).toBeCloseTo(3.8, 10)
    expect(calcularCusto('b', c).custoDireto).toBeCloseTo(11.4, 10)
    const t = calcularCusto('topo', c)
    expect(t.linhas.map((l) => l.custo)).toEqual([expect.closeTo(3.8, 10), expect.closeTo(11.4, 10)])
    // chamadas repetidas dão o mesmo resultado (sem estado entre chamadas)
    expect(calcularCusto('a', c).custoDireto).toBeCloseTo(3.8, 10)
  })

  it('mudar o preço de um insumo entre duas chamadas reflete no custo (memo é por chamada)', () => {
    const lista = insumos.map((i) => ({ ...i }))
    const c = ctx([ganache, recheio, boloRecheado], 20, lista)
    const antes = calcularCusto('bolo', c).custoDireto
    c.insumos.set('choc', { ...c.insumos.get('choc')!, precoCompra: 80 })
    const depois = calcularCusto('bolo', c).custoDireto
    // +40 R$/kg × 100 g de chocolate no bolo = +4
    expect(depois - antes).toBeCloseTo(4, 10)
  })
})

describe('unidades de rendimento', () => {
  it('receita com rendimento em kg usada em outra em gramas', () => {
    expect(unidadeBaseReceita(ganache)).toBe('g')
    expect(rendimentoBase(ganache)).toBe(1000)
    const r = receita({ id: 'r', nome: 'R', itens: [{ tipo: 'receita', id: 'ganache', quantidade: 250 }] })
    expect(calcularCusto('r', ctx([ganache, r])).custoDireto).toBeCloseTo(9.5, 10)
  })

  it('rendimento em litros: base em ml, preço por litro', () => {
    // Calda: rende 1,5 L. 1 L de leite (5) + 300 g açúcar (1,5) = 6,5; 15 min (5) → 11,5
    const calda = receita({
      id: 'calda',
      nome: 'Calda',
      rendimento_qtd: 1.5,
      rendimento_unidade: 'l',
      tempo_preparo_min: 15,
      itens: [
        { tipo: 'insumo', id: 'leite', quantidade: 1000 },
        { tipo: 'insumo', id: 'acucar', quantidade: 300 },
      ],
    })
    expect(unidadeBaseReceita(calda)).toBe('ml')
    expect(rendimentoBase(calda)).toBe(1500)
    const c = calcularCusto('calda', ctx([calda]))
    expect(c.custoDireto).toBeCloseTo(11.5, 10)
    expect(c.custoPorBase).toBeCloseTo(11.5 / 1500, 12)
    const p = precificar(calda, c.custoDireto, cfg)
    expect(p.unidade).toBe('litro')
    expect(p.qtdVenda).toBe(1.5)
    expect(p.custoPorUnidade).toBeCloseTo(11.5 / 1.5, 10)
    expect(p.pvSugerido).toBe(15.33) // 7,666… ÷ 0,5 = 15,333…
    expect(textoRendimento(calda)).toBe('1,5 L')
  })

  it('rendimento em ml e em g (sem fator)', () => {
    expect(rendimentoBase({ rendimento_qtd: 750, rendimento_unidade: 'ml' })).toBe(750)
    expect(rendimentoBase({ rendimento_qtd: 1.2, rendimento_unidade: 'kg' })).toBe(1200)
    expect(rendimentoBase({ rendimento_qtd: 0.333, rendimento_unidade: 'kg' })).toBeCloseTo(333, 9)
  })

  it('textoRendimento com 1,5 kg e com 1.234,5 g', () => {
    expect(textoRendimento({ rendimento_qtd: 1.5, rendimento_unidade: 'kg', rendimento_nome: null })).toBe('1,5 kg')
    expect(textoRendimento({ rendimento_qtd: 1234.5, rendimento_unidade: 'g', rendimento_nome: null })).toBe('1.234,5 g')
  })
})

describe('precificar: casos de borda', () => {
  const bolo = receita({ id: 'b', nome: 'B', rendimento_qtd: 10, rendimento_unidade: 'un', rendimento_nome: 'fatia' })

  it('override parcial: só a margem da receita, fixos e taxas das configurações', () => {
    const r = { ...bolo, pct_margem: 15 }
    expect(percentuaisEfetivos(r, cfg)).toEqual({ pctCustosFixos: 20, pctTaxas: 5, pctMargem: 15 })
    const p = precificar(r, 30, cfg) // 3 ÷ (1 − 0,40) = 5
    expect(p.pvSugerido).toBeCloseTo(5, 10)
    expect(p.pctMargemReal).toBeCloseTo(15, 9)
  })

  it('override com 0% vale (não cai no padrão)', () => {
    const p = precificar({ ...bolo, pct_custos_fixos: 0, pct_taxas: 0, pct_margem: 0 }, 30, cfg)
    expect(p.pcts).toEqual({ pctCustosFixos: 0, pctTaxas: 0, pctMargem: 0 })
    expect(p.pvSugerido).toBeCloseTo(3, 10)
    expect(p.lucroPorUnidade).toBeCloseTo(0, 10)
  })

  it('percentuais somando exatamente 100% → sem preço sugerido', () => {
    const p = precificar({ ...bolo, pct_margem: 75 }, 30, cfg)
    expect(p.pvSugerido).toBeNull()
    expect(p.pvFinal).toBeNull()
    expect(p.pvTotal).toBe(0)
    expect(p.abaixoDoCusto).toBe(false)
  })

  it('pv_manual = 0 é tratado como preço manual (manual true, abaixo do custo)', () => {
    const p = precificar({ ...bolo, pv_manual: 0 }, 30, cfg)
    expect(p.manual).toBe(true)
    expect(p.pvFinal).toBe(0)
    expect(p.abaixoDoCusto).toBe(true)
  })

  // BUG: vender a R$ 0 dá prejuízo de todo o custo, mas o lucro aparece como 0.
  // margemReal() devolve { lucro: 0 } quando pv <= 0.
  it.fails('pv_manual = 0: lucro deveria ser −custo (hoje aparece 0)', () => {
    const p = precificar({ ...bolo, pv_manual: 0 }, 30, cfg)
    expect(p.lucroPorUnidade).toBeCloseTo(-3, 10)
    expect(p.lucroTotal).toBeCloseTo(-30, 10)
  })

  it('preço manual acima do sugerido mostra a margem real maior', () => {
    const p = precificar({ ...bolo, pv_manual: 10 }, 30, cfg)
    // lucro = 10 − 3 − 10×25% = 4,5 → 45%
    expect(p.lucroPorUnidade).toBeCloseTo(4.5, 10)
    expect(p.pctMargemReal).toBeCloseTo(45, 9)
    expect(p.lucroTotal).toBeCloseTo(45, 9)
    expect(p.pvTotal).toBeCloseTo(100, 9)
    expect(p.abaixoDoCusto).toBe(false)
  })

  it("'centavos90' com preço que cai exatamente em ,90 não sobe para o real seguinte", () => {
    // custo 29,50 em 10 fatias → 2,95 ÷ 0,5 = 5,90
    expect(precificar(bolo, 29.5, { ...cfg, arredondamento: 'centavos90' }).pvSugerido).toBe(5.9)
    // custo 6,45 por fatia → 12,90
    expect(precificar(bolo, 64.5, { ...cfg, arredondamento: 'centavos90' }).pvSugerido).toBe(12.9)
  })

  it("'centavos90': para qualquer valor em centavos de 0 a 2.000 reais, termina em ,90, nunca abaixo e sobe < R$ 1", () => {
    for (let c = 1; c <= 200000; c++) {
      const v = c / 100
      const r = arredondarPreco(v, 'centavos90')
      expect(r >= v && r - v < 1).toBe(true)
      expect(Math.round(r * 100) % 100).toBe(90)
      if (c % 100 === 90 && r !== v) throw new Error(`${v} virou ${r}`)
    }
  })

  it("'meio_real' e 'real' com valores exatos não sobem", () => {
    for (let c = 0; c <= 20000; c += 50) expect(arredondarPreco(c / 100, 'meio_real')).toBe(c / 100)
    for (let c = 0; c <= 20000; c += 100) expect(arredondarPreco(c / 100, 'real')).toBe(c / 100)
  })

  it('ponto flutuante: 0,1 + 0,2 não vira 0,31 nem sobe um real', () => {
    expect(0.1 + 0.2).not.toBe(0.3) // o problema existe…
    expect(arredondarPreco(0.1 + 0.2, 'nenhum')).toBe(0.3) // …e é corrigido
    expect(arredondarPreco(0.1 + 0.2, 'real')).toBe(1)
    expect(arredondarPreco(5.8 + 0.1, 'centavos90')).toBe(5.9) // 5,8999999…
    expect(arredondarPreco(0.7 + 0.2 + 12, 'centavos90')).toBe(12.9)
    expect(arredondarPreco(1.1 + 2.2 + 1.2, 'meio_real')).toBe(4.5) // 4,5000000001
    // custo vindo da soma de linhas: 10 g × 0,01 + 20 g × 0,01
    const r = receita({
      id: 'f',
      nome: 'F',
      itens: [
        { tipo: 'insumo', id: 'centavo', quantidade: 0.1 },
        { tipo: 'insumo', id: 'centavo', quantidade: 0.2 },
      ],
    })
    expect(calcularCusto('f', ctx([r])).custoDireto).toBeCloseTo(0.003, 12)
  })

  it('arredondamento padrão não reduz preço que só tem ruído de float (59,999999… → 60)', () => {
    expect(arredondarPreco(59.99999999, 'real')).toBe(60)
    expect(arredondarPreco(60.00000001, 'real')).toBe(60)
    expect(arredondarPreco(60.00000001, 'centavos90')).toBe(60.9)
  })
})

describe('receitas vazias, zeros e itens inativos', () => {
  it('receita sem itens: custo só da mão de obra', () => {
    const r = receita({ id: 'r', nome: 'R', tempo_preparo_min: 30, rendimento_qtd: 10 })
    const c = calcularCusto('r', ctx([r]))
    expect(c.custoIngredientes).toBe(0)
    expect(c.custoDireto).toBeCloseTo(10, 10)
    expect(c.linhas).toEqual([])
    expect(c.problemas).toEqual([])
    expect(explodirInsumos('r', 1, ctx([r])).size).toBe(0)
  })

  it('receita sem itens e sem tempo: custo 0, "arredondamentos" exatos dão 0', () => {
    const r = receita({ id: 'r', nome: 'R' })
    expect(calcularCusto('r', ctx([r])).custoDireto).toBe(0)
    expect(precificar(r, 0, cfg).pvSugerido).toBe(0)
    expect(precificar(r, 0, { ...cfg, arredondamento: 'real' }).pvSugerido).toBe(0)
  })

  // BUG: custo 0 com arredondamento ',90' sugere R$ 0,90 (preço inventado para receita vazia).
  it.fails("receita sem custo não deveria sugerir R$ 0,90 com 'centavos90'", () => {
    const r = receita({ id: 'r', nome: 'R' })
    const p = precificar(r, 0, { ...cfg, arredondamento: 'centavos90' })
    expect(p.pvSugerido === null || p.pvSugerido === 0).toBe(true)
  })

  it('itens com quantidade 0 custam 0 e não aparecem na produção com valor', () => {
    const r = receita({
      id: 'r',
      nome: 'R',
      itens: [
        { tipo: 'insumo', id: 'choc', quantidade: 0 },
        { tipo: 'receita', id: 'ganache', quantidade: 0 },
      ],
    })
    const c = calcularCusto('r', ctx([ganache, r]))
    expect(c.custoDireto).toBe(0)
    expect(c.problemas).toEqual([])
    const m = explodirInsumos('r', 1, ctx([ganache, r]))
    expect(m.get('choc') ?? 0).toBe(0)
    expect(m.get('creme') ?? 0).toBe(0)
  })

  it('insumo inativo continua com custo (o contexto inclui inativos)', () => {
    // InsumoCalculo não tem "ativo": o filtro é responsabilidade de quem monta o contexto.
    // useContextoCalculo usa db.listar('insumos') sem filtro, então inativos entram.
    const inativo = { id: 'velho', nome: 'Corante antigo', qtdCompra: 10, unidadeCompra: 'g' as const, precoCompra: 3, ativo: false }
    const r = receita({ id: 'r', nome: 'R', itens: [{ tipo: 'insumo', id: 'velho', quantidade: 2 }] })
    const c = calcularCusto('r', ctx([r], 20, [...insumos, inativo]))
    expect(c.custoDireto).toBeCloseTo(0.6, 10)
    expect(c.problemas).toEqual([])
  })

  it('sub-receita com rendimento 0 (dado inválido) não gera NaN/Infinity', () => {
    const sub = receita({ id: 's', nome: 'S', rendimento_qtd: 0, itens: [{ tipo: 'insumo', id: 'choc', quantidade: 100 }] })
    const r = receita({ id: 'r', nome: 'R', itens: [{ tipo: 'receita', id: 's', quantidade: 1 }] })
    const c = calcularCusto('r', ctx([sub, r]))
    expect(Number.isFinite(c.custoDireto)).toBe(true)
    expect(Number.isFinite(precificar(sub, 4, cfg).custoPorUnidade)).toBe(true)
    expect(explodirInsumos('r', 1, ctx([sub, r])).size).toBe(0)
  })

  // RISCO: rendimento 0 numa sub-receita zera o custo dela em silêncio (custoPorBase = 0),
  // sem problema na lista. O banco impede (rendimento_qtd > 0), mas o modo local não.
  it.fails('sub-receita com rendimento 0 deveria aparecer como problema', () => {
    const sub = receita({ id: 's', nome: 'S', rendimento_qtd: 0, itens: [{ tipo: 'insumo', id: 'choc', quantidade: 100 }] })
    const r = receita({ id: 'r', nome: 'R', itens: [{ tipo: 'receita', id: 's', quantidade: 1 }] })
    expect(calcularCusto('r', ctx([sub, r])).problemas.length).toBeGreaterThan(0)
  })

  it('ciclo de 3 receitas: não trava e marca problema; produção ignora o ciclo', () => {
    const a = receita({ id: 'a', nome: 'A', itens: [{ tipo: 'receita', id: 'b', quantidade: 1 }] })
    const b = receita({ id: 'b', nome: 'B', itens: [{ tipo: 'receita', id: 'c', quantidade: 1 }] })
    const c = receita({ id: 'c', nome: 'C', itens: [{ tipo: 'receita', id: 'a', quantidade: 1 }, { tipo: 'insumo', id: 'ovo', quantidade: 1 }] })
    const cx = ctx([a, b, c])
    expect(calcularCusto('a', cx).problemas.length).toBeGreaterThan(0)
    expect(explodirInsumos('a', 1, cx).get('ovo')).toBe(1)
  })
})

describe('plural', () => {
  it('palavras simples', () => {
    expect(plural('fatia', 2)).toBe('fatias')
    expect(plural('docinho', 2)).toBe('docinhos')
    expect(plural('pote', 2)).toBe('potes')
    expect(plural('fatia', 1)).toBe('fatia')
    expect(plural('kg', 3)).toBe('kg')
    expect(plural('  fatia  ', 2)).toBe('fatias')
  })

  it('textoRendimento em unidades', () => {
    expect(textoRendimento({ rendimento_qtd: 30, rendimento_unidade: 'un', rendimento_nome: 'brigadeiro' })).toBe('30 brigadeiros')
    expect(textoRendimento({ rendimento_qtd: 12, rendimento_unidade: 'un', rendimento_nome: null })).toBe('12 unidades')
  })

  // Decisão para nomes compostos: pluralizar só a primeira palavra
  // ("pão de mel" → "pães de mel", "bolo no pote" → "bolos no pote", "fatia de torta" → "fatias de torta").
  // Erra em "bolo pequeno" → "bolos pequeno", mas é melhor que pluralizar a última palavra
  // ("pão de méis", "bolo de potes"), que erra no caso mais comum (substantivo + "de" + complemento).
  it.fails('nomes compostos: pluraliza só a primeira palavra (hoje vira "pão de méis")', () => {
    expect(plural('pão de mel', 20)).toBe('pães de mel')
    expect(plural('bolo no pote', 6)).toBe('bolos no pote')
    expect(plural('fatia de torta', 8)).toBe('fatias de torta')
  })

  // BUG: palavras terminadas em -m e o irregular "pão".
  it.fails('pudim → pudins, bombom → bombons, pão → pães', () => {
    expect(plural('pudim', 2)).toBe('pudins')
    expect(plural('bombom', 2)).toBe('bombons')
    expect(plural('pão', 2)).toBe('pães')
  })

  // Concordância: em pt-BR o plural começa em 2 ("1,5 kg", "1,5 fatia" é o usual) e zero vai no plural.
  // Cosmético; documentado como sugestão.
  it.fails('1,5 → singular; 0 → plural', () => {
    expect(textoRendimento({ rendimento_qtd: 1.5, rendimento_unidade: 'un', rendimento_nome: 'fatia' })).toBe('1,5 fatia')
    expect(textoRendimento({ rendimento_qtd: 0, rendimento_unidade: 'un', rendimento_nome: 'fatia' })).toBe('0 fatias')
  })
})
