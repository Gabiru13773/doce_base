import { describe, expect, it } from 'vitest'
import type { ItemReceita } from './receitas'
import {
  CANAIS,
  CONFIG_PDV_PADRAO,
  FORMAS,
  baixaEstoqueVenda,
  descontoPct,
  dinheiroEsperado,
  faltaPagar,
  formasDoCanal,
  juntarPagamentos,
  pctTaxa,
  planoFechamento,
  precoNoCanal,
  resumoDia,
  taxasVenda,
  totaisVenda,
  troco,
  type ConfigPdv,
  type Pagamento,
  type VendaCalc,
} from './vendas'

// ---- Fixtures -------------------------------------------------------------------------

const config = (p: Partial<ConfigPdv> = {}): ConfigPdv => ({ ...CONFIG_PDV_PADRAO, ...p })

const venda = (p: Partial<VendaCalc>): VendaCalc => ({
  canal: 'balcao',
  pagamentos: [],
  total: 0,
  desconto: 0,
  troco: 0,
  taxas: 0,
  status: 'concluida',
  ...p,
})

const pg = (forma: Pagamento['forma'], valor: number): Pagamento => ({ forma, valor })

const variacao = (id: string, itens: ItemReceita[]) => ({ id, itens })

// Bolo de pote: 1 fatia do bolo pronto + 1 pote + 1 tampa. Kit: 2 fatias + 1 caixa.
const produtos = [
  {
    id: 'bolo-pote',
    variacoes: [
      variacao('pote', [
        { tipo: 'receita', id: 'bolo-choc', quantidade: 1 },
        { tipo: 'insumo', id: 'pote-250', quantidade: 1 },
        { tipo: 'insumo', id: 'tampa', quantidade: 1 },
      ]),
      variacao('kit', [
        { tipo: 'receita', id: 'bolo-choc', quantidade: 2 },
        { tipo: 'insumo', id: 'caixa', quantidade: 1 },
      ]),
    ],
  },
  {
    id: 'brigadeiro',
    variacoes: [
      variacao('un', [
        { tipo: 'receita', id: 'massa-brig', quantidade: 15 }, // g
        { tipo: 'insumo', id: 'forminha', quantidade: 1 },
        { tipo: 'insumo', id: 'zerado', quantidade: 0 },
      ]),
    ],
  },
]

// ---- Listas fixas ---------------------------------------------------------------------

describe('canais e formas', () => {
  it('lista os três canais e as cinco formas', () => {
    expect(CANAIS.map((c) => c.valor)).toEqual(['balcao', 'whatsapp', 'ifood'])
    expect(FORMAS.map((f) => f.valor).sort()).toEqual(['credito', 'debito', 'dinheiro', 'ifood', 'pix'])
  })

  it('no iFood só aceita "pago no iFood"; nos outros canais, as formas da loja', () => {
    expect(formasDoCanal('ifood')).toEqual(['ifood'])
    expect(formasDoCanal('balcao')).toEqual(['pix', 'dinheiro', 'debito', 'credito'])
    expect(formasDoCanal('whatsapp')).not.toContain('ifood')
  })
})

// ---- Preço por canal ------------------------------------------------------------------

describe('precoNoCanal', () => {
  it('no balcão e no WhatsApp usa o preço do balcão, mesmo com preço iFood e acréscimo', () => {
    expect(precoNoCanal(12.5, 15, 'balcao', 20)).toBe(12.5)
    expect(precoNoCanal(12.5, 15, 'whatsapp', 20)).toBe(12.5)
  })

  it('no balcão com preço vazio devolve vazio', () => {
    expect(precoNoCanal(null, 15, 'balcao', 20)).toBeNull()
  })

  it('no iFood usa o preço iFood da variação quando tem (arredondado no centavo)', () => {
    expect(precoNoCanal(10, 14.9, 'ifood', 30)).toBe(14.9)
    expect(precoNoCanal(10, 14.899999, 'ifood', 0)).toBe(14.9)
    // preço iFood mesmo sem preço de balcão
    expect(precoNoCanal(null, 14.9, 'ifood', 30)).toBe(14.9)
  })

  it('preço iFood zerado ou negativo é ignorado (vale o do balcão com acréscimo)', () => {
    expect(precoNoCanal(10, 0, 'ifood', 15)).toBe(11.5)
    expect(precoNoCanal(10, -3, 'ifood', 15)).toBe(11.5)
  })

  it('sem preço iFood: balcão + acréscimo, arredondado para cima no R$ 0,10', () => {
    expect(precoNoCanal(10, null, 'ifood', 15)).toBe(11.5) // exato: não sobe
    expect(precoNoCanal(9.99, null, 'ifood', 10)).toBe(11) // 10,989 → 11,00
    expect(precoNoCanal(10, undefined, 'ifood', 12)).toBe(11.2) // exato
    expect(precoNoCanal(10, null, 'ifood', 12.5)).toBe(11.3) // 11,25 → 11,30
    expect(precoNoCanal(7.5, null, 'ifood', 33)).toBe(10) // 9,975 → 9,98 → 10,00
    expect(precoNoCanal(4.2, null, 'ifood', 10)).toBe(4.7) // 4,62 → 4,70
  })

  it('não sobe para o 0,10 seguinte por erro de ponto flutuante', () => {
    // 1,10 × 1,1 = 1,2100000000000002 no JS
    expect(precoNoCanal(1.1, null, 'ifood', 10)).toBe(1.3) // 1,21 → 1,30
    expect(precoNoCanal(3, null, 'ifood', 10)).toBe(3.3) // 3,3000000000000003 → 3,30
    expect(precoNoCanal(20, null, 'ifood', 15)).toBe(23)
  })

  it('acréscimo zero, negativo ou inválido: preço do balcão sem arredondar', () => {
    expect(precoNoCanal(9.99, null, 'ifood', 0)).toBe(9.99)
    expect(precoNoCanal(9.99, null, 'ifood', -10)).toBe(9.99)
    expect(precoNoCanal(9.99, null, 'ifood', Number.NaN)).toBe(9.99)
  })

  it('sem preço do balcão nem preço iFood: vazio', () => {
    expect(precoNoCanal(null, null, 'ifood', 15)).toBeNull()
    expect(precoNoCanal(null, undefined, 'ifood', 0)).toBeNull()
  })
})

// ---- Totais -----------------------------------------------------------------------------

describe('totaisVenda', () => {
  it('soma os itens no centavo (3 × 3,33 = 9,99)', () => {
    expect(totaisVenda([{ qtd: 3, preco: 3.33 }])).toEqual({ subtotal: 9.99, desconto: 0, total: 9.99, itens: 3 })
  })

  it('0,10 + 0,20 dá 0,30 (sem resto de ponto flutuante)', () => {
    const t = totaisVenda([
      { qtd: 1, preco: 0.1 },
      { qtd: 1, preco: 0.2 },
    ])
    expect(t.subtotal).toBe(0.3)
    expect(t.total).toBe(0.3)
  })

  it('aplica o desconto e o total = subtotal − desconto exatamente', () => {
    const t = totaisVenda([{ qtd: 1, preco: 0.3 }], 0.1)
    expect(t).toEqual({ subtotal: 0.3, desconto: 0.1, total: 0.2, itens: 1 })
    expect(t.total).toBe(Math.round((t.subtotal - t.desconto) * 100) / 100)
  })

  it('desconto maior que o subtotal fica limitado ao subtotal (total 0)', () => {
    expect(totaisVenda([{ qtd: 2, preco: 5 }], 50)).toEqual({ subtotal: 10, desconto: 10, total: 0, itens: 2 })
  })

  it('desconto negativo ou inválido vira zero', () => {
    expect(totaisVenda([{ qtd: 1, preco: 10 }], -5)).toMatchObject({ desconto: 0, total: 10 })
    expect(totaisVenda([{ qtd: 1, preco: 10 }], Number.NaN)).toMatchObject({ desconto: 0, total: 10 })
  })

  it('desconto com mais de 2 casas é arredondado no centavo', () => {
    expect(totaisVenda([{ qtd: 1, preco: 10 }], 1.005)).toMatchObject({ desconto: 1.01, total: 8.99 })
  })

  it('itens com quantidade zero, negativa ou preço negativo ficam de fora', () => {
    const t = totaisVenda([
      { qtd: 0, preco: 10 },
      { qtd: -1, preco: 10 },
      { qtd: 2, preco: -1 },
      { qtd: 1, preco: 4 },
    ])
    expect(t.subtotal).toBe(4)
    // quantidade de itens não conta os de qtd ≤ 0 (o de preço negativo ainda conta)
    expect(t.itens).toBe(3)
  })

  it('preço zero (brinde) entra na contagem de itens sem mudar o total', () => {
    expect(totaisVenda([{ qtd: 1, preco: 0 }, { qtd: 1, preco: 5 }])).toEqual({ subtotal: 5, desconto: 0, total: 5, itens: 2 })
  })

  it('quantidade fracionada (venda a quilo)', () => {
    expect(totaisVenda([{ qtd: 0.35, preco: 89.9 }])).toMatchObject({ subtotal: 31.47, itens: 0.35 }) // 31,465 → 31,47
  })

  it('sem itens: tudo zero', () => {
    expect(totaisVenda([])).toEqual({ subtotal: 0, desconto: 0, total: 0, itens: 0 })
  })
})

describe('descontoPct', () => {
  it('converte % do subtotal em reais, no centavo', () => {
    expect(descontoPct(100, 10)).toBe(10)
    expect(descontoPct(33.33, 10)).toBe(3.33)
    expect(descontoPct(10.05, 10)).toBe(1.01) // 1,005 → 1,01
  })

  it('acima de 100% fica em 100%', () => {
    expect(descontoPct(42, 150)).toBe(42)
  })

  it('zero, negativo ou inválido: sem desconto', () => {
    expect(descontoPct(42, 0)).toBe(0)
    expect(descontoPct(42, -5)).toBe(0)
    expect(descontoPct(42, Number.NaN)).toBe(0)
  })
})

describe('faltaPagar', () => {
  it('quanto ainda falta', () => {
    expect(faltaPagar(30, [pg('pix', 10), pg('dinheiro', 5.5)])).toBe(14.5)
  })

  it('pago certinho: zero (sem resto de ponto flutuante)', () => {
    expect(faltaPagar(0.3, [pg('pix', 0.1), pg('dinheiro', 0.2)])).toBe(0)
  })

  it('pagou a mais: negativo', () => {
    expect(faltaPagar(18, [pg('dinheiro', 20)])).toBe(-2)
  })

  it('ignora pagamentos zerados ou negativos', () => {
    expect(faltaPagar(10, [pg('pix', -5), pg('debito', 0), pg('credito', 4)])).toBe(6)
  })

  it('sem pagamentos: falta o total', () => {
    expect(faltaPagar(12.34, [])).toBe(12.34)
  })
})

describe('troco', () => {
  it('recebido − parte em dinheiro', () => {
    expect(troco(50, 37.5)).toBe(12.5)
    expect(troco(20, 19.9)).toBe(0.1)
  })

  it('recebido igual ou menor que a parte em dinheiro: sem troco', () => {
    expect(troco(10, 10)).toBe(0)
    expect(troco(5, 10)).toBe(0)
  })

  it('recebido zero, negativo ou inválido: sem troco', () => {
    expect(troco(0, 10)).toBe(0)
    expect(troco(-10, 5)).toBe(0)
    expect(troco(Number.NaN, 5)).toBe(0)
  })

  it('parte em dinheiro negativa ou inválida: sem troco', () => {
    expect(troco(10, -1)).toBe(0)
    expect(troco(10, Number.NaN)).toBe(0)
  })

  it('parte em dinheiro zero: devolve tudo', () => {
    expect(troco(10, 0)).toBe(10)
  })
})

// ---- Taxas ------------------------------------------------------------------------------

describe('pctTaxa e taxasVenda', () => {
  const c = config({ taxa_debito: 1.99, taxa_credito: 4.99, taxa_pix: 0.99, comissao_ifood: 23 })

  it('% de cada forma; dinheiro não tem taxa', () => {
    expect(pctTaxa('debito', c)).toBe(1.99)
    expect(pctTaxa('credito', c)).toBe(4.99)
    expect(pctTaxa('pix', c)).toBe(0.99)
    expect(pctTaxa('ifood', c)).toBe(23)
    expect(pctTaxa('dinheiro', c)).toBe(0)
  })

  it('arredonda cada pagamento no centavo e soma', () => {
    // débito 10 × 1,99% = 0,199 → 0,20; crédito 10 × 4,99% = 0,499 → 0,50
    expect(taxasVenda([pg('debito', 10), pg('credito', 10)], c)).toBe(0.7)
  })

  it('arredondar por pagamento difere de arredondar a soma', () => {
    // 3 × débito 1,00: 0,0199 → 0,02 cada = 0,06 (a soma 3,00 × 1,99% daria 0,06 também: 0,0597)
    expect(taxasVenda([pg('debito', 1), pg('debito', 1), pg('debito', 1)], c)).toBe(0.06)
    // 2 × débito 0,25: 0,004975 → 0,00 cada; somado (0,50) daria 0,01
    expect(taxasVenda([pg('debito', 0.25), pg('debito', 0.25)], c)).toBe(0)
  })

  it('meio centavo sobe (crédito 50 × 4,99% = 2,495 → 2,50)', () => {
    expect(taxasVenda([pg('credito', 50)], c)).toBe(2.5)
  })

  it('comissão do iFood', () => {
    expect(taxasVenda([pg('ifood', 45.9)], c)).toBe(10.56) // 10,557
  })

  it('dinheiro e valores zerados/negativos não geram taxa', () => {
    expect(taxasVenda([pg('dinheiro', 100), pg('credito', 0), pg('debito', -10)], c)).toBe(0)
  })

  it('sem pagamentos: zero', () => {
    expect(taxasVenda([], c)).toBe(0)
  })
})

describe('juntarPagamentos', () => {
  it('soma pagamentos da mesma forma (na ordem em que apareceram) e tira os zerados', () => {
    expect(juntarPagamentos([pg('pix', 10), pg('dinheiro', 0), pg('pix', 5.5), pg('credito', -1), pg('debito', 3)])).toEqual([
      pg('pix', 15.5),
      pg('debito', 3),
    ])
  })

  it('arredonda a soma no centavo', () => {
    expect(juntarPagamentos([pg('pix', 0.1), pg('pix', 0.2)])).toEqual([pg('pix', 0.3)])
  })

  it('tudo zerado: lista vazia', () => {
    expect(juntarPagamentos([pg('pix', 0)])).toEqual([])
    expect(juntarPagamentos([])).toEqual([])
  })
})

// ---- Estoque ----------------------------------------------------------------------------

describe('baixaEstoqueVenda', () => {
  it('receitas prontas e insumos saem com quantidade negativa', () => {
    expect(baixaEstoqueVenda([{ produto_id: 'bolo-pote', variacao_id: 'pote', qtd: 2 }], produtos)).toEqual([
      { item_tipo: 'receita', receita_id: 'bolo-choc', insumo_id: null, quantidade: -2 },
      { item_tipo: 'insumo', insumo_id: 'pote-250', receita_id: null, quantidade: -2 },
      { item_tipo: 'insumo', insumo_id: 'tampa', receita_id: null, quantidade: -2 },
    ])
  })

  it('dois itens da mesma variação somam numa linha só', () => {
    const b = baixaEstoqueVenda(
      [
        { produto_id: 'bolo-pote', variacao_id: 'pote', qtd: 1 },
        { produto_id: 'bolo-pote', variacao_id: 'pote', qtd: 3 },
      ],
      produtos,
    )
    expect(b).toHaveLength(3)
    expect(b.find((l) => l.insumo_id === 'pote-250')?.quantidade).toBe(-4)
    expect(b.find((l) => l.receita_id === 'bolo-choc')?.quantidade).toBe(-4)
  })

  it('variações diferentes que usam a mesma receita somam', () => {
    const b = baixaEstoqueVenda(
      [
        { produto_id: 'bolo-pote', variacao_id: 'pote', qtd: 1 },
        { produto_id: 'bolo-pote', variacao_id: 'kit', qtd: 2 },
      ],
      produtos,
    )
    expect(b.find((l) => l.receita_id === 'bolo-choc')?.quantidade).toBe(-5) // 1 + 2×2
    expect(b.find((l) => l.insumo_id === 'caixa')?.quantidade).toBe(-2)
    expect(b.find((l) => l.insumo_id === 'tampa')?.quantidade).toBe(-1)
  })

  it('cada linha tem só o id do seu tipo', () => {
    for (const l of baixaEstoqueVenda([{ produto_id: 'bolo-pote', variacao_id: 'pote', qtd: 1 }], produtos)) {
      if (l.item_tipo === 'receita') expect([l.receita_id, l.insumo_id]).toEqual(['bolo-choc', null])
      else expect(l.receita_id).toBeNull()
      expect(l.quantidade).toBeLessThan(0)
    }
  })

  it('produto ou variação que não existe mais fica de fora', () => {
    expect(
      baixaEstoqueVenda(
        [
          { produto_id: 'sumiu', variacao_id: 'pote', qtd: 1 },
          { produto_id: 'bolo-pote', variacao_id: 'sumiu', qtd: 1 },
        ],
        produtos,
      ),
    ).toEqual([])
    expect(baixaEstoqueVenda([{ produto_id: 'bolo-pote', variacao_id: 'pote', qtd: 1 }], [])).toEqual([])
  })

  it('quantidade zero ou negativa não baixa nada', () => {
    expect(
      baixaEstoqueVenda(
        [
          { produto_id: 'bolo-pote', variacao_id: 'pote', qtd: 0 },
          { produto_id: 'bolo-pote', variacao_id: 'pote', qtd: -2 },
        ],
        produtos,
      ),
    ).toEqual([])
  })

  it('item da variação com quantidade zero não gera linha', () => {
    const b = baixaEstoqueVenda([{ produto_id: 'brigadeiro', variacao_id: 'un', qtd: 10 }], produtos)
    expect(b.map((l) => l.receita_id ?? l.insumo_id)).toEqual(['massa-brig', 'forminha'])
    expect(b[0].quantidade).toBe(-150)
  })

  it('quantidade fracionada, arredondada no milésimo', () => {
    const b = baixaEstoqueVenda([{ produto_id: 'brigadeiro', variacao_id: 'un', qtd: 0.3333 }], produtos)
    expect(b.find((l) => l.receita_id === 'massa-brig')?.quantidade).toBe(-5) // 4,9995 → 5,000
    expect(b.find((l) => l.insumo_id === 'forminha')?.quantidade).toBe(-0.333)
    // 0,1 + 0,2 de bolo: 0,30000000000000004 → 0,3
    const c = baixaEstoqueVenda(
      [
        { produto_id: 'bolo-pote', variacao_id: 'pote', qtd: 0.1 },
        { produto_id: 'bolo-pote', variacao_id: 'pote', qtd: 0.2 },
      ],
      produtos,
    )
    expect(c.find((l) => l.receita_id === 'bolo-choc')?.quantidade).toBe(-0.3)
  })

  it('baixa que arredonda para zero no milésimo não gera linha (o banco recusa quantidade 0)', () => {
    expect(baixaEstoqueVenda([{ produto_id: 'bolo-pote', variacao_id: 'pote', qtd: 0.0004 }], produtos)).toEqual([])
  })
})

// ---- Resumo do dia ----------------------------------------------------------------------

describe('resumoDia', () => {
  const c = config({ taxa_debito: 2, taxa_credito: 5, taxa_pix: 0, comissao_ifood: 20 })

  const vendas: VendaCalc[] = [
    venda({ canal: 'balcao', total: 30, desconto: 2, pagamentos: [pg('dinheiro', 20), pg('pix', 10)] }),
    venda({ canal: 'whatsapp', total: 15.5, pagamentos: [pg('debito', 15.5)] }),
    venda({ canal: 'ifood', total: 45.9, pagamentos: [pg('ifood', 45.9)] }),
    venda({ canal: 'balcao', total: 10.01, pagamentos: [pg('credito', 10.01)] }),
    venda({ canal: 'balcao', total: 99, desconto: 9, status: 'cancelada', pagamentos: [pg('dinheiro', 99)] }),
  ]

  it('conta vendas e canceladas; canceladas ficam fora dos valores', () => {
    const r = resumoDia(vendas, c)
    expect(r.vendas).toBe(4)
    expect(r.canceladas).toBe(1)
    expect(r.total).toBe(101.41)
    expect(r.descontos).toBe(2)
  })

  it('totais por forma e por canal', () => {
    const r = resumoDia(vendas, c)
    expect(r.porForma).toEqual({ dinheiro: 20, pix: 10, debito: 15.5, credito: 10.01, ifood: 45.9 })
    expect(r.porCanal).toEqual({ balcao: 40.01, whatsapp: 15.5, ifood: 45.9 })
  })

  it('taxas por forma (arredondadas por pagamento) e o total delas', () => {
    const r = resumoDia(vendas, c)
    // débito 15,50 × 2% = 0,31; crédito 10,01 × 5% = 0,5005 → 0,50; iFood 45,90 × 20% = 9,18
    expect(r.taxasPorForma).toEqual({ dinheiro: 0, pix: 0, debito: 0.31, credito: 0.5, ifood: 9.18 })
    expect(r.taxas).toBe(9.99)
  })

  it('taxas por forma somam pagamento a pagamento (igual a taxasVenda de cada venda)', () => {
    const vs = [
      venda({ total: 0.25, pagamentos: [pg('debito', 0.25)] }),
      venda({ total: 0.25, pagamentos: [pg('debito', 0.25)] }),
    ]
    const r = resumoDia(vs, c)
    // 0,25 × 2% = 0,005 → 0,01 cada → 0,02 (não 0,01 da soma 0,50)
    expect(r.taxasPorForma.debito).toBe(0.02)
    expect(r.taxas).toBe(vs.reduce((s, v) => s + taxasVenda(v.pagamentos, c), 0))
  })

  it('ticket médio = total ÷ vendas concluídas, no centavo', () => {
    expect(resumoDia(vendas, c).ticketMedio).toBe(25.35) // 101,41 / 4 = 25,3525
    expect(resumoDia([venda({ total: 10 }), venda({ total: 10 }), venda({ total: 13.33 })], c).ticketMedio).toBe(11.11)
  })

  it('ignora pagamentos zerados ou negativos', () => {
    const r = resumoDia([venda({ total: 5, pagamentos: [pg('pix', 5), pg('credito', 0), pg('debito', -2)] })], c)
    expect(r.porForma).toMatchObject({ pix: 5, credito: 0, debito: 0 })
    expect(r.taxas).toBe(0)
  })

  it('soma muitas vendas sem resto de ponto flutuante', () => {
    const r = resumoDia(
      Array.from({ length: 10 }, () => venda({ total: 0.1, pagamentos: [pg('pix', 0.1)] })),
      c,
    )
    expect(r.total).toBe(1)
    expect(r.porForma.pix).toBe(1)
    expect(r.porCanal.balcao).toBe(1)
  })

  it('dia sem vendas (ou só canceladas): tudo zero e ticket médio zero', () => {
    const r = resumoDia([venda({ total: 10, status: 'cancelada' })], c)
    expect(r).toMatchObject({ vendas: 0, canceladas: 1, total: 0, descontos: 0, taxas: 0, ticketMedio: 0 })
    expect(Object.values(r.porForma).every((x) => x === 0)).toBe(true)
    expect(Object.values(r.porCanal).every((x) => x === 0)).toBe(true)
  })

  // BUG: a venda grava as taxas da hora em que foi feita (vendas.taxas), mas o resumo/fechamento
  // recalcula tudo com a configuração ATUAL. Se a taxa da maquininha mudou durante o dia, o
  // fechamento lança contas a receber com um líquido diferente do registrado em cada venda.
  it('usa as taxas gravadas em cada venda (não a configuração do momento do fechamento)', () => {
    const v = venda({ total: 100, taxas: 2, pagamentos: [pg('debito', 100)] }) // vendida com débito a 2%
    const r = resumoDia([v], config({ taxa_debito: 3 })) // taxa mudou para 3% depois
    expect(r.taxas).toBe(2)
    expect(r.taxasPorForma.debito).toBe(2)
  })
})

describe('dinheiroEsperado', () => {
  it('fundo de troco + vendas em dinheiro', () => {
    expect(dinheiroEsperado({ porForma: { dinheiro: 120.3, pix: 50, debito: 0, credito: 0, ifood: 0 } }, 100)).toBe(220.3)
  })

  it('fundo zero, negativo ou inválido conta como zero', () => {
    const porForma = { dinheiro: 0.3, pix: 0, debito: 0, credito: 0, ifood: 0 }
    expect(dinheiroEsperado({ porForma }, 0)).toBe(0.3)
    expect(dinheiroEsperado({ porForma }, -50)).toBe(0.3)
    expect(dinheiroEsperado({ porForma }, Number.NaN)).toBe(0.3)
  })

  it('arredonda no centavo', () => {
    expect(dinheiroEsperado({ porForma: { dinheiro: 0.2, pix: 0, debito: 0, credito: 0, ifood: 0 } }, 0.1)).toBe(0.3)
  })
})

// ---- Fechamento -------------------------------------------------------------------------

describe('planoFechamento', () => {
  const c = config({
    taxa_debito: 2,
    taxa_credito: 5,
    taxa_pix: 0,
    comissao_ifood: 20,
    prazo_debito: 1,
    prazo_credito: 30,
    prazo_ifood: 7,
  })
  const resumo = resumoDia(
    [
      venda({ total: 30, pagamentos: [pg('dinheiro', 20), pg('pix', 10)] }),
      venda({ total: 15.5, pagamentos: [pg('debito', 15.5)] }),
      venda({ canal: 'ifood', total: 45.9, pagamentos: [pg('ifood', 45.9)] }),
      venda({ total: 10.01, pagamentos: [pg('credito', 10.01)] }),
    ],
    c,
  )

  it('dinheiro entra no caixa no próprio dia', () => {
    const p = planoFechamento(resumo, c, '2026-10-25')
    expect(p.lancamentos).toEqual([{ forma: 'dinheiro', valor: 20, data: '2026-10-25', conta: 'caixa', descricao: 'Vendas em dinheiro 25/10' }])
  })

  it('Pix, cartões e iFood viram contas a receber pelo líquido, com o vencimento do prazo', () => {
    const p = planoFechamento(resumo, c, '2026-10-25')
    expect(p.titulos).toEqual([
      { forma: 'pix', valor: 10, bruto: 10, taxa: 0, vencimento: '2026-10-25', descricao: 'Pix — vendas 25/10' },
      { forma: 'debito', valor: 15.19, bruto: 15.5, taxa: 0.31, vencimento: '2026-10-26', descricao: 'Cartão de débito — vendas 25/10' },
      { forma: 'credito', valor: 9.51, bruto: 10.01, taxa: 0.5, vencimento: '2026-11-24', descricao: 'Cartão de crédito — vendas 25/10' },
      { forma: 'ifood', valor: 36.72, bruto: 45.9, taxa: 9.18, vencimento: '2026-11-01', descricao: 'iFood — vendas 25/10' },
    ])
  })

  it('líquido + taxa = bruto em cada conta a receber', () => {
    for (const t of planoFechamento(resumo, c, '2026-10-25').titulos) expect(Math.round((t.valor + t.taxa) * 100) / 100).toBe(t.bruto)
  })

  it('formas sem venda não geram lançamento nem conta', () => {
    const r = resumoDia([venda({ total: 8, pagamentos: [pg('pix', 8)] })], c)
    const p = planoFechamento(r, c, '2026-10-25')
    expect(p.lancamentos).toEqual([])
    expect(p.titulos.map((t) => t.forma)).toEqual(['pix'])
  })

  it('dia sem vendas: plano vazio', () => {
    expect(planoFechamento(resumoDia([], c), c, '2026-10-25')).toEqual({ lancamentos: [], titulos: [] })
  })

  it('taxa de 100%: nada a receber, não gera conta (o banco recusa valor 0)', () => {
    const c100 = config({ comissao_ifood: 100 })
    const r = resumoDia([venda({ canal: 'ifood', total: 50, pagamentos: [pg('ifood', 50)] })], c100)
    expect(planoFechamento(r, c100, '2026-10-25').titulos).toEqual([])
  })

  it('vencimento atravessa fim de mês e de ano', () => {
    const r = resumoDia([venda({ total: 10, pagamentos: [pg('debito', 10), pg('credito', 10)] })], c)
    const p = planoFechamento(r, c, '2026-12-31')
    expect(p.titulos.find((t) => t.forma === 'debito')?.vencimento).toBe('2027-01-01')
    expect(p.titulos.find((t) => t.forma === 'credito')?.vencimento).toBe('2027-01-30')
    expect(p.lancamentos[0]?.descricao).toBeUndefined() // sem dinheiro
    expect(planoFechamento(r, c, '2026-01-31').titulos.find((t) => t.forma === 'debito')?.vencimento).toBe('2026-02-01')
    expect(planoFechamento(r, c, '2028-02-28').titulos.find((t) => t.forma === 'debito')?.vencimento).toBe('2028-02-29')
  })

  it('prazo zero, negativo, fracionado ou inválido', () => {
    const r = resumoDia([venda({ total: 10, pagamentos: [pg('debito', 10)] })], c)
    const venc = (prazo_debito: number) => planoFechamento(r, config({ ...c, prazo_debito }), '2026-10-30').titulos[0].vencimento
    expect(venc(0)).toBe('2026-10-30')
    expect(venc(-5)).toBe('2026-10-30')
    expect(venc(1.6)).toBe('2026-11-01')
    expect(venc(Number.NaN)).toBe('2026-10-30')
  })

  it('pix com taxa também desconta no líquido e cai no mesmo dia', () => {
    const cp = config({ taxa_pix: 0.99 })
    const r = resumoDia([venda({ total: 100, pagamentos: [pg('pix', 100)] })], cp)
    expect(planoFechamento(r, cp, '2026-10-25').titulos).toEqual([
      { forma: 'pix', valor: 99.01, bruto: 100, taxa: 0.99, vencimento: '2026-10-25', descricao: 'Pix — vendas 25/10' },
    ])
  })
})
