import { describe, expect, it } from 'vitest'
import type { ItemCompraCalc } from './compras'
import {
  ajusteContagem,
  calcularSaldos,
  embalagensParaRepor,
  entradasDaCompra,
  milesimos,
  movimentosDaProducao,
  planoProducao,
  precisaComprar,
  situacaoEstoque,
  subReceitasDaProducao,
  type MovimentoCalc,
} from './estoque'
import { explodirInsumos, type ItemReceita, type ReceitaCalculo, type UnidadeRendimento } from './receitas'

// ---- Fixtures -------------------------------------------------------------------------

const mov = (p: Partial<MovimentoCalc>): MovimentoCalc => ({
  item_tipo: 'insumo',
  insumo_id: 'farinha',
  receita_id: null,
  quantidade: 0,
  ...p,
})

const receita = (id: string, qtd: number, unidade: UnidadeRendimento, itens: ItemReceita[]): ReceitaCalculo => ({
  id,
  nome: id,
  rendimento_qtd: qtd,
  rendimento_unidade: unidade,
  rendimento_nome: null,
  itens,
  tempo_preparo_min: 0,
  pct_custos_fixos: null,
  pct_taxas: null,
  pct_margem: null,
  pv_manual: null,
})

const ins = (id: string, quantidade: number): ItemReceita => ({ tipo: 'insumo', id, quantidade })
const sub = (id: string, quantidade: number): ItemReceita => ({ tipo: 'receita', id, quantidade })
const mapa = (...rs: ReceitaCalculo[]) => new Map(rs.map((r) => [r.id, r]))

// brigadeiro: 30 un; leite condensado, cacau e manteiga
const brigadeiro = receita('brigadeiro', 30, 'un', [ins('leite', 395), ins('cacau', 50), ins('manteiga', 20)])
// bolo (10 fatias) = 1000 g de massa + 500 g de recheio + 200 g de chocolate
const massa = receita('massa', 1.2, 'kg', [ins('farinha', 500), ins('ovos', 6), ins('acucar', 300)]) // 1200 g
const calda = receita('calda', 0.5, 'l', [ins('acucar', 200), ins('agua', 300)]) // 500 ml
const recheio = receita('recheio', 600, 'g', [ins('leite', 395), ins('creme', 200), sub('calda', 100)])
const bolo = receita('bolo', 10, 'un', [sub('massa', 1000), sub('recheio', 500), ins('chocolate', 200)])
const todas = mapa(brigadeiro, massa, calda, recheio, bolo)

let seq = 0
const item = (p: Partial<ItemCompraCalc>): ItemCompraCalc => ({
  id: `item-${++seq}`,
  insumo_id: 'farinha',
  nome: 'Farinha',
  qtd_pedida: 1,
  embalagem_qtd: 1,
  embalagem_unidade: 'kg',
  status: 'comprado',
  qtd_comprada: 1,
  preco_pago: 5,
  sub_insumo_id: null,
  fora_da_lista: false,
  ...p,
})

const insumosCad = [
  { id: 'farinha', unidade_compra: 'g' as const },
  { id: 'acucar', unidade_compra: 'kg' as const },
  { id: 'ovos', unidade_compra: 'dz' as const },
  { id: 'leite', unidade_compra: 'l' as const },
]

// ---- milesimos --------------------------------------------------------------------------

describe('milesimos', () => {
  it('arredonda para 3 casas como o banco, meio milésimo sobe', () => {
    expect(milesimos(1.0005)).toBe(1.001)
    expect(milesimos(0.1 + 0.2)).toBe(0.3)
    expect(milesimos(-1.0005)).toBe(-1.001)
    expect(milesimos(0.0004)).toBe(0)
  })
})

// ---- calcularSaldos -----------------------------------------------------------------------

describe('calcularSaldos', () => {
  it('soma os movimentos de cada insumo e de cada preparado separadamente', () => {
    const s = calcularSaldos([
      mov({ insumo_id: 'farinha', quantidade: 3000 }),
      mov({ insumo_id: 'farinha', quantidade: -500 }),
      mov({ insumo_id: 'acucar', quantidade: 1000 }),
      mov({ item_tipo: 'receita', insumo_id: null, receita_id: 'recheio', quantidade: 600 }),
      mov({ item_tipo: 'receita', insumo_id: null, receita_id: 'recheio', quantidade: -250 }),
    ])
    expect(s).toEqual({ insumos: { farinha: 2500, acucar: 1000 }, receitas: { recheio: 350 } })
  })

  it('mesmo id em insumo e em receita não se misturam', () => {
    const s = calcularSaldos([
      mov({ insumo_id: 'x', quantidade: 10 }),
      mov({ item_tipo: 'receita', insumo_id: null, receita_id: 'x', quantidade: 7 }),
    ])
    expect(s.insumos.x).toBe(10)
    expect(s.receitas.x).toBe(7)
  })

  it('arredonda o saldo para milésimos (sem sujeira de ponto flutuante)', () => {
    const s = calcularSaldos([mov({ quantidade: 0.1 }), mov({ quantidade: 0.2 }), mov({ quantidade: 1.0004 })])
    expect(s.insumos.farinha).toBe(1.3)
  })

  it('saldo que volta a zero fica 0, não -0 (senão a tela mostra "-0 g")', () => {
    const s = calcularSaldos([mov({ quantidade: 0.3 }), mov({ quantidade: -0.1 }), mov({ quantidade: -0.2 })])
    expect(s.insumos.farinha).toBe(0)
  })

  it('ignora linhas sem o id do tipo delas', () => {
    const s = calcularSaldos([
      mov({ insumo_id: null, quantidade: 5 }),
      mov({ item_tipo: 'insumo', insumo_id: null, receita_id: 'recheio', quantidade: 5 }),
      mov({ item_tipo: 'receita', insumo_id: 'farinha', receita_id: null, quantidade: 5 }),
      mov({ insumo_id: '', quantidade: 5 }),
    ])
    expect(s).toEqual({ insumos: {}, receitas: {} })
  })

  it('sem movimentos: tudo vazio', () => {
    expect(calcularSaldos([])).toEqual({ insumos: {}, receitas: {} })
  })

  it('resultado é objeto simples (sobrevive a JSON do cache salvo no aparelho)', () => {
    const s = calcularSaldos([mov({ quantidade: 5 })])
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })
})

// ---- situacaoEstoque / precisaComprar --------------------------------------------------------

describe('situacaoEstoque', () => {
  it('negativo quando saiu mais do que entrou, com ou sem mínimo', () => {
    expect(situacaoEstoque(-1, 100)).toBe('negativo')
    expect(situacaoEstoque(-0.001, null)).toBe('negativo')
  })

  it('zerado com ou sem mínimo', () => {
    expect(situacaoEstoque(0, 100)).toBe('zerado')
    expect(situacaoEstoque(0, null)).toBe('zerado')
    expect(situacaoEstoque(-0, 0)).toBe('zerado')
  })

  it('acabando abaixo do mínimo; igual ao mínimo já está ok', () => {
    expect(situacaoEstoque(99.999, 100)).toBe('acabando')
    expect(situacaoEstoque(100, 100)).toBe('ok')
    expect(situacaoEstoque(500, 100)).toBe('ok')
  })

  it('sem mínimo (null, undefined ou 0) e com saldo: sem_minimo', () => {
    expect(situacaoEstoque(10, null)).toBe('sem_minimo')
    expect(situacaoEstoque(10, undefined)).toBe('sem_minimo')
    expect(situacaoEstoque(10, 0)).toBe('sem_minimo')
  })
})

describe('precisaComprar', () => {
  it('com mínimo: abaixo dele (inclui zerado e negativo)', () => {
    expect(precisaComprar(0, 100)).toBe(true)
    expect(precisaComprar(-5, 100)).toBe(true)
    expect(precisaComprar(99, 100)).toBe(true)
    expect(precisaComprar(100, 100)).toBe(false)
    expect(precisaComprar(101, 100)).toBe(false)
  })

  it('sem mínimo (null/undefined/0): só quando está negativo', () => {
    expect(precisaComprar(0, null)).toBe(false)
    expect(precisaComprar(0, undefined)).toBe(false)
    expect(precisaComprar(0, 0)).toBe(false)
    expect(precisaComprar(-1, null)).toBe(true)
    expect(precisaComprar(-1, 0)).toBe(true)
    expect(precisaComprar(50, null)).toBe(false)
  })
})

// ---- embalagensParaRepor ------------------------------------------------------------------

describe('embalagensParaRepor', () => {
  it('mínimo 2000 g, tem 500 g, pacote de 1 kg → 2 pacotes', () => {
    expect(embalagensParaRepor(500, 2000, { qtd: 1, unidade: 'kg' })).toBe(2)
  })

  it('falta um múltiplo exato da embalagem: não arredonda para cima à toa', () => {
    expect(embalagensParaRepor(0, 2000, { qtd: 1, unidade: 'kg' })).toBe(2)
    expect(embalagensParaRepor(1000, 2000, { qtd: 500, unidade: 'g' })).toBe(2)
    expect(embalagensParaRepor(0.7, 1, { qtd: 0.1, unidade: 'g' })).toBe(3)
  })

  it('saldo negativo: repõe o que falta até o mínimo', () => {
    expect(embalagensParaRepor(-500, 2000, { qtd: 1, unidade: 'kg' })).toBe(3)
  })

  it('negativo e sem mínimo: pelo menos 1 embalagem', () => {
    expect(embalagensParaRepor(-500, null, { qtd: 1, unidade: 'kg' })).toBe(1)
    expect(embalagensParaRepor(-2500, null, { qtd: 1, unidade: 'kg' })).toBe(3)
  })

  it('embalagem em dúzia: mínimo 30 ovos, tem 6 → 2 dúzias', () => {
    expect(embalagensParaRepor(6, 30, { qtd: 1, unidade: 'dz' })).toBe(2)
    expect(embalagensParaRepor(7, 30, { qtd: 1, unidade: 'dz' })).toBe(2)
    expect(embalagensParaRepor(5, 30, { qtd: 1, unidade: 'dz' })).toBe(3)
  })

  it('embalagem zerada ou inválida: sugere 1', () => {
    expect(embalagensParaRepor(0, 2000, { qtd: 0, unidade: 'kg' })).toBe(1)
    expect(embalagensParaRepor(0, 2000, { qtd: NaN, unidade: 'kg' })).toBe(1)
  })

  it('no mínimo ou acima dele: 0', () => {
    expect(embalagensParaRepor(2000, 2000, { qtd: 1, unidade: 'kg' })).toBe(0)
    expect(embalagensParaRepor(5000, 2000, { qtd: 1, unidade: 'kg' })).toBe(0)
    expect(embalagensParaRepor(0, null, { qtd: 1, unidade: 'kg' })).toBe(0)
  })

  it('falta bem pouco: ainda 1 embalagem', () => {
    expect(embalagensParaRepor(1999, 2000, { qtd: 1, unidade: 'kg' })).toBe(1)
  })
})

// ---- ajusteContagem -----------------------------------------------------------------------

describe('ajusteContagem', () => {
  it('lança a diferença entre o contado e o saldo', () => {
    expect(ajusteContagem(1000, 800)).toBe(-200)
    expect(ajusteContagem(1000, 1250)).toBe(250)
    expect(ajusteContagem(-300, 0)).toBe(300)
  })

  it('contou igual ao saldo: nada a lançar', () => {
    expect(ajusteContagem(1000, 1000)).toBe(0)
    expect(ajusteContagem(0.1 + 0.2, 0.3)).toBe(0)
  })

  it('arredonda em milésimos', () => {
    expect(ajusteContagem(0.3, 0.1)).toBe(-0.2)
  })

  it('contado inválido (NaN, negativo, infinito): nada a lançar', () => {
    expect(ajusteContagem(1000, NaN)).toBe(0)
    expect(ajusteContagem(1000, -1)).toBe(0)
    expect(ajusteContagem(1000, Infinity)).toBe(0)
  })
})

// ---- planoProducao ------------------------------------------------------------------------

describe('planoProducao', () => {
  it('receita simples ×2: entra o rendimento dobrado e sai o dobro de cada insumo', () => {
    expect(planoProducao('brigadeiro', 2, todas)).toEqual({
      entrada: 60,
      insumos: { leite: 790, cacau: 100, manteiga: 40 },
      receitas: {},
    })
  })

  it('meio lote', () => {
    expect(planoProducao('brigadeiro', 0.5, todas)).toEqual({
      entrada: 15,
      insumos: { leite: 197.5, cacau: 25, manteiga: 10 },
      receitas: {},
    })
  })

  it('desce nas sub-receitas na proporção (inclusive sub-receita dentro de sub-receita)', () => {
    const p = planoProducao('bolo', 1, todas)
    expect(p.entrada).toBe(10)
    expect(p.receitas).toEqual({})
    expect(p.insumos).toEqual({
      // massa: 1000 de 1200 g
      farinha: 416.667,
      ovos: 5,
      // 250 da massa + 33,333 da calda (100 ml de 500, dentro de 500 g de 600 do recheio)
      acucar: 283.333,
      // recheio: 500 de 600 g
      leite: 329.167,
      creme: 166.667,
      agua: 50,
      chocolate: 200,
    })
  })

  it('rendimento em kg: entrada em g', () => {
    expect(planoProducao('massa', 2, todas).entrada).toBe(2400)
  })

  it('sub-receita usada pronta do estoque: sai o preparado e os insumos dela não descem', () => {
    const p = planoProducao('bolo', 1, todas, new Set(['recheio']))
    expect(p.receitas).toEqual({ recheio: 500 })
    expect(p.insumos).toEqual({ farinha: 416.667, ovos: 5, acucar: 250, chocolate: 200 })
    expect(p.insumos.leite).toBeUndefined()
    expect(p.insumos.agua).toBeUndefined()
  })

  it('sub-receita de 2º nível do estoque: sai proporcional, o resto do recheio desce', () => {
    const p = planoProducao('bolo', 2, todas, new Set(['calda']))
    expect(p.receitas).toEqual({ calda: 166.667 })
    expect(p.insumos.leite).toBe(658.333)
    expect(p.insumos.agua).toBeUndefined()
    expect(p.insumos.acucar).toBe(500)
  })

  it('ciclo entre receitas não trava (para no ponto em que repete)', () => {
    const a = receita('a', 100, 'g', [ins('x', 10), sub('b', 50)])
    const b = receita('b', 100, 'g', [ins('y', 20), sub('a', 50)])
    const auto = receita('auto', 100, 'g', [ins('z', 5), sub('auto', 100)])
    const rs = mapa(a, b, auto)
    expect(planoProducao('a', 1, rs)).toEqual({ entrada: 100, insumos: { x: 10, y: 10 }, receitas: {} })
    expect(planoProducao('auto', 1, rs)).toEqual({ entrada: 100, insumos: { z: 5 }, receitas: {} })
  })

  it('lotes 0, negativo ou NaN: nada se movimenta', () => {
    const vazio = { entrada: 0, insumos: {}, receitas: {} }
    expect(planoProducao('brigadeiro', 0, todas)).toEqual(vazio)
    expect(planoProducao('brigadeiro', -1, todas)).toEqual(vazio)
    expect(planoProducao('brigadeiro', NaN, todas)).toEqual(vazio)
  })

  it('receita que não existe: plano vazio', () => {
    expect(planoProducao('nao-existe', 1, todas)).toEqual({ entrada: 0, insumos: {}, receitas: {} })
  })

  it('sub-receita sem rendimento não desce (como explodirInsumos), mas pode sair do estoque', () => {
    const semRend = receita('semRend', 0, 'g', [ins('k', 100)])
    const r = receita('r', 1, 'un', [sub('semRend', 50), ins('j', 1)])
    const rs = mapa(semRend, r)
    expect(planoProducao('r', 1, rs).insumos).toEqual({ j: 1 })
    expect(planoProducao('r', 1, rs, new Set(['semRend'])).receitas).toEqual({ semRend: 50 })
  })

  it('itens com quantidade 0 ou negativa ficam de fora', () => {
    const r = receita('r', 1, 'un', [ins('a', 0), ins('b', -5), ins('c', 3), sub('massa', 0)])
    expect(planoProducao('r', 1, mapa(r, massa)).insumos).toEqual({ c: 3 })
  })

  it('sem nada do estoque, os insumos batem com explodirInsumos', () => {
    for (const [id, lotes] of [
      ['bolo', 1],
      ['bolo', 3],
      ['bolo', 0.5],
      ['recheio', 1.75],
      ['brigadeiro', 2],
    ] as const) {
      const esperado = Object.fromEntries([...explodirInsumos(id, lotes, { receitas: todas })].map(([k, v]) => [k, milesimos(v)]))
      expect(planoProducao(id, lotes, todas).insumos).toEqual(esperado)
      expect(planoProducao(id, lotes, todas, new Set()).insumos).toEqual(esperado)
    }
  })

  it('resultado é objeto simples (sobrevive a JSON)', () => {
    const p = planoProducao('bolo', 1, todas, new Set(['recheio']))
    expect(JSON.parse(JSON.stringify(p))).toEqual(p)
  })
})

// ---- subReceitasDaProducao ----------------------------------------------------------------

describe('subReceitasDaProducao', () => {
  it('lista as sub-receitas com a quantidade e o nível na árvore', () => {
    expect(subReceitasDaProducao('bolo', 1, todas)).toEqual([
      { id: 'massa', quantidade: 1000, nivel: 1 },
      { id: 'recheio', quantidade: 500, nivel: 1 },
      { id: 'calda', quantidade: 83.333, nivel: 2 },
    ])
  })

  it('multiplica pelos lotes', () => {
    expect(subReceitasDaProducao('bolo', 2, todas)).toEqual([
      { id: 'massa', quantidade: 2000, nivel: 1 },
      { id: 'recheio', quantidade: 1000, nivel: 1 },
      { id: 'calda', quantidade: 166.667, nivel: 2 },
    ])
  })

  it('sub-receita que sai pronta do estoque esconde as de dentro dela', () => {
    expect(subReceitasDaProducao('bolo', 1, todas, new Set(['recheio']))).toEqual([
      { id: 'massa', quantidade: 1000, nivel: 1 },
      { id: 'recheio', quantidade: 500, nivel: 1 },
    ])
  })

  it('a própria sub-receita do estoque continua na lista (para poder desmarcar)', () => {
    const lista = subReceitasDaProducao('bolo', 1, todas, new Set(['calda']))
    expect(lista.map((s) => s.id)).toEqual(['massa', 'recheio', 'calda'])
  })

  it('a mesma sub-receita usada em dois lugares soma numa linha', () => {
    // torta: 100 ml de calda direto + 600 g de recheio (que leva 100 ml de calda)
    const torta = receita('torta', 8, 'un', [sub('calda', 100), sub('recheio', 600)])
    const rs = mapa(torta, recheio, calda)
    expect(subReceitasDaProducao('torta', 1, rs)).toEqual([
      { id: 'calda', quantidade: 200, nivel: 1 },
      { id: 'recheio', quantidade: 600, nivel: 1 },
    ])
    // com o recheio pronto, só conta a calda direta
    expect(subReceitasDaProducao('torta', 1, rs, new Set(['recheio']))).toEqual([
      { id: 'calda', quantidade: 100, nivel: 1 },
      { id: 'recheio', quantidade: 600, nivel: 1 },
    ])
  })

  it('a soma de subReceitasDaProducao bate com o que planoProducao tira do estoque', () => {
    const torta = receita('torta', 8, 'un', [sub('calda', 100), sub('recheio', 600)])
    const rs = mapa(torta, recheio, calda)
    const lista = subReceitasDaProducao('torta', 1.5, rs)
    const calda15 = lista.find((s) => s.id === 'calda')!.quantidade
    expect(planoProducao('torta', 1.5, rs, new Set(['calda'])).receitas.calda).toBe(calda15)
  })

  it('receita sem sub-receitas, lotes 0 ou ciclo: não trava', () => {
    expect(subReceitasDaProducao('brigadeiro', 1, todas)).toEqual([])
    expect(subReceitasDaProducao('bolo', 0, todas)).toEqual([])
    const a = receita('a', 100, 'g', [sub('b', 50)])
    const b = receita('b', 100, 'g', [sub('a', 50)])
    expect(subReceitasDaProducao('a', 1, mapa(a, b))).toEqual([
      { id: 'b', quantidade: 50, nivel: 1 },
      { id: 'a', quantidade: 25, nivel: 2 },
    ])
  })

  it('sub-receita apagada (fora do mapa) não aparece', () => {
    const r = receita('r', 1, 'un', [sub('sumiu', 100), sub('massa', 600)])
    expect(subReceitasDaProducao('r', 1, mapa(r, massa))).toEqual([{ id: 'massa', quantidade: 600, nivel: 1 }])
  })
})

// ---- movimentosDaProducao -----------------------------------------------------------------

describe('movimentosDaProducao', () => {
  it('entra o preparado (+) e saem insumos e preparados usados (−)', () => {
    const plano = planoProducao('bolo', 1, todas, new Set(['recheio']))
    const linhas = movimentosDaProducao('bolo', 10, plano)
    expect(linhas).toEqual([
      { item_tipo: 'receita', receita_id: 'bolo', insumo_id: null, quantidade: 10, origem: 'producao' },
      { item_tipo: 'receita', receita_id: 'recheio', insumo_id: null, quantidade: -500, origem: 'producao' },
      { item_tipo: 'insumo', insumo_id: 'farinha', receita_id: null, quantidade: -416.667, origem: 'producao' },
      { item_tipo: 'insumo', insumo_id: 'ovos', receita_id: null, quantidade: -5, origem: 'producao' },
      { item_tipo: 'insumo', insumo_id: 'acucar', receita_id: null, quantidade: -250, origem: 'producao' },
      { item_tipo: 'insumo', insumo_id: 'chocolate', receita_id: null, quantidade: -200, origem: 'producao' },
    ])
  })

  it('usa o rendimento real informado (não o previsto)', () => {
    const plano = planoProducao('brigadeiro', 1, todas)
    const linhas = movimentosDaProducao('brigadeiro', 27, plano)
    expect(linhas[0]).toMatchObject({ receita_id: 'brigadeiro', quantidade: 27 })
  })

  it('cada linha respeita a regra do banco (insumo só com insumo_id, receita só com receita_id)', () => {
    const linhas = movimentosDaProducao('bolo', 10, planoProducao('bolo', 1, todas, new Set(['recheio'])))
    for (const l of linhas) {
      if (l.item_tipo === 'insumo') expect(l.insumo_id && l.receita_id === null).toBeTruthy()
      else expect(l.receita_id && l.insumo_id === null).toBeTruthy()
    }
  })

  it('o saldo depois da produção: preparado sobe, insumos descem', () => {
    const linhas = movimentosDaProducao('brigadeiro', 60, planoProducao('brigadeiro', 2, todas))
    const s = calcularSaldos([mov({ insumo_id: 'leite', quantidade: 1000 }), ...linhas])
    expect(s.insumos).toEqual({ leite: 210, cacau: -100, manteiga: -40 })
    expect(s.receitas).toEqual({ brigadeiro: 60 })
  })

  it('rendimento 0 ou negativo: não entra o preparado', () => {
    const plano = planoProducao('brigadeiro', 1, todas)
    expect(movimentosDaProducao('brigadeiro', 0, plano).some((l) => l.receita_id === 'brigadeiro')).toBe(false)
    expect(movimentosDaProducao('brigadeiro', -3, plano).some((l) => l.receita_id === 'brigadeiro')).toBe(false)
  })

  it('nunca gera linha com quantidade 0 (o banco recusa): rendimento que arredonda para 0', () => {
    const linhas = movimentosDaProducao('brigadeiro', 0.0004, { entrada: 0, insumos: {}, receitas: {} })
    expect(linhas.every((l) => l.quantidade !== 0)).toBe(true)
  })

  it('plano vazio: nenhuma saída', () => {
    expect(movimentosDaProducao('x', 5, { entrada: 5, insumos: {}, receitas: {} })).toHaveLength(1)
  })
})

// ---- entradasDaCompra ---------------------------------------------------------------------

describe('entradasDaCompra', () => {
  it('comprado: quantidade × embalagem na unidade base (3 × 1 kg = 3000 g)', () => {
    expect(entradasDaCompra([item({ qtd_comprada: 3, embalagem_qtd: 1, embalagem_unidade: 'kg' })], insumosCad)).toEqual([
      { insumo_id: 'farinha', quantidade: 3000 },
    ])
  })

  it('insumo cadastrado em kg comprado em g: entra em g', () => {
    expect(
      entradasDaCompra([item({ insumo_id: 'acucar', qtd_comprada: 2, embalagem_qtd: 500, embalagem_unidade: 'g' })], insumosCad),
    ).toEqual([{ insumo_id: 'acucar', quantidade: 1000 }])
  })

  it('substituído: entra no insumo que levou no lugar', () => {
    expect(
      entradasDaCompra(
        [item({ status: 'substituido', insumo_id: 'farinha', sub_insumo_id: 'acucar', qtd_comprada: 1, embalagem_qtd: 1, embalagem_unidade: 'kg' })],
        insumosCad,
      ),
    ).toEqual([{ insumo_id: 'acucar', quantidade: 1000 }])
  })

  it('substituído sem o insumo escolhido: fica de fora', () => {
    expect(entradasDaCompra([item({ status: 'substituido', sub_insumo_id: null })], insumosCad)).toEqual([])
  })

  it('não levou ou pendente: fica de fora', () => {
    expect(entradasDaCompra([item({ status: 'nao' }), item({ status: 'pendente' })], insumosCad)).toEqual([])
  })

  it('embalagem em outro tipo de unidade que o insumo: fica de fora', () => {
    expect(entradasDaCompra([item({ insumo_id: 'ovos', embalagem_unidade: 'kg' })], insumosCad)).toEqual([])
    expect(entradasDaCompra([item({ insumo_id: 'farinha', embalagem_unidade: 'l' })], insumosCad)).toEqual([])
  })

  it('dúzia entra em unidades', () => {
    expect(entradasDaCompra([item({ insumo_id: 'ovos', qtd_comprada: 2, embalagem_qtd: 1, embalagem_unidade: 'dz' })], insumosCad)).toEqual([
      { insumo_id: 'ovos', quantidade: 24 },
    ])
  })

  it('dois itens do mesmo insumo somam numa linha só (inclusive via substituição)', () => {
    expect(
      entradasDaCompra(
        [
          item({ insumo_id: 'farinha', qtd_comprada: 2, embalagem_qtd: 1, embalagem_unidade: 'kg' }),
          item({ insumo_id: 'farinha', qtd_comprada: 1, embalagem_qtd: 500, embalagem_unidade: 'g' }),
          item({ status: 'substituido', insumo_id: 'acucar', sub_insumo_id: 'farinha', qtd_comprada: 1, embalagem_qtd: 5, embalagem_unidade: 'kg' }),
        ],
        insumosCad,
      ),
    ).toEqual([{ insumo_id: 'farinha', quantidade: 7500 }])
  })

  it('item fora da lista de insumos (sem insumo_id) ou insumo não informado na lista: fica de fora', () => {
    expect(entradasDaCompra([item({ insumo_id: null, fora_da_lista: true })], insumosCad)).toEqual([])
    expect(entradasDaCompra([item({ insumo_id: 'sumiu' })], insumosCad)).toEqual([])
  })

  it('quantidade levada nula, zero ou embalagem zero: fica de fora', () => {
    expect(
      entradasDaCompra(
        [item({ qtd_comprada: null }), item({ qtd_comprada: 0 }), item({ embalagem_qtd: 0 }), item({ qtd_comprada: -1 })],
        insumosCad,
      ),
    ).toEqual([])
  })

  it('arredonda em milésimos e tira o que ficaria 0', () => {
    expect(entradasDaCompra([item({ qtd_comprada: 3, embalagem_qtd: 0.1, embalagem_unidade: 'g' })], insumosCad)).toEqual([
      { insumo_id: 'farinha', quantidade: 0.3 },
    ])
    expect(entradasDaCompra([item({ qtd_comprada: 1, embalagem_qtd: 0.0004, embalagem_unidade: 'g' })], insumosCad)).toEqual([])
  })

  it('litro em insumo de litro: entra em ml', () => {
    expect(entradasDaCompra([item({ insumo_id: 'leite', qtd_comprada: 2, embalagem_qtd: 1, embalagem_unidade: 'l' })], insumosCad)).toEqual([
      { insumo_id: 'leite', quantidade: 2000 },
    ])
  })
})
