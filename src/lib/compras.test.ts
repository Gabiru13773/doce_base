import { describe, expect, it } from 'vitest'
import {
  avaliarPreco,
  faixaPrecos,
  historicoDaCompra,
  insumoComprado,
  levou,
  mesclarPendentes,
  mudancasDeCusto,
  resumoCompra,
  totalItem,
  type CustoAtual,
  type FaixaPrecos,
  type ItemCompraCalc,
  type LinhaHistorico,
  type PrecoHistorico,
} from './compras'

let seq = 0
const item = (p: Partial<ItemCompraCalc>): ItemCompraCalc => ({
  id: `item-${++seq}`,
  insumo_id: 'farinha',
  nome: 'Farinha',
  qtd_pedida: 1,
  embalagem_qtd: 1,
  embalagem_unidade: 'kg',
  status: 'pendente',
  qtd_comprada: null,
  preco_pago: null,
  sub_insumo_id: null,
  fora_da_lista: false,
  ...p,
})

const preco = (p: Partial<PrecoHistorico>): PrecoHistorico => ({
  qtd_compra: 1,
  unidade_compra: 'kg',
  preco_compra: 5,
  registrado_em: '2026-10-01T10:00:00.000Z',
  ...p,
})

const linha = (p: Partial<LinhaHistorico>): LinhaHistorico => ({
  insumo_id: 'farinha',
  qtd_compra: 1,
  unidade_compra: 'kg',
  preco_compra: 5,
  item_id: `item-${++seq}`,
  ...p,
})

const custo = (p: Partial<CustoAtual>): CustoAtual => ({
  id: 'farinha',
  nome: 'Farinha',
  qtd_compra: 1,
  unidade_compra: 'kg',
  preco_compra: 5,
  ...p,
})

describe('levou', () => {
  it('comprado e substituído foram para o carrinho; pendente e não levei, não', () => {
    expect(levou({ status: 'comprado' })).toBe(true)
    expect(levou({ status: 'substituido' })).toBe(true)
    expect(levou({ status: 'pendente' })).toBe(false)
    expect(levou({ status: 'nao' })).toBe(false)
  })
})

describe('totalItem', () => {
  it('quantidade × preço da embalagem', () => {
    expect(totalItem({ status: 'comprado', qtd_comprada: 2, preco_pago: 6.5 })).toBe(13)
    expect(totalItem({ status: 'substituido', qtd_comprada: 1, preco_pago: 7.25 })).toBe(7.25)
  })
  it('arredonda para centavos (3 × 2,99 = 8,97, sem resto de ponto flutuante)', () => {
    expect(3 * 0.1).not.toBe(0.3) // 0.30000000000000004: por isso o arredondamento
    expect(totalItem({ status: 'comprado', qtd_comprada: 3, preco_pago: 2.99 })).toBe(8.97)
    expect(totalItem({ status: 'comprado', qtd_comprada: 3, preco_pago: 0.1 })).toBe(0.3)
    expect(totalItem({ status: 'comprado', qtd_comprada: 1.5, preco_pago: 0.67 })).toBe(1.01)
  })
  it('meio centavo arredonda para cima, como o numeric(12,2) do Postgres (0,5 × 2,01 = 1,005 → 1,01)', () => {
    // BUG: Math.round(1.005 * 100) / 100 dá 1 (1.005 * 100 = 100.49999…)
    expect(totalItem({ status: 'comprado', qtd_comprada: 0.5, preco_pago: 2.01 })).toBe(1.01)
  })
  it('sem preço ou sem quantidade → null', () => {
    expect(totalItem({ status: 'comprado', qtd_comprada: 2, preco_pago: null })).toBeNull()
    expect(totalItem({ status: 'comprado', qtd_comprada: null, preco_pago: 5 })).toBeNull()
  })
  it('preço zero (brinde) entra como 0, não como "sem preço"', () => {
    expect(totalItem({ status: 'comprado', qtd_comprada: 2, preco_pago: 0 })).toBe(0)
  })
  it('pendente e não levei não têm valor, mesmo com preço preenchido', () => {
    expect(totalItem({ status: 'pendente', qtd_comprada: 2, preco_pago: 5 })).toBeNull()
    expect(totalItem({ status: 'nao', qtd_comprada: 2, preco_pago: 5 })).toBeNull()
  })
})

describe('resumoCompra', () => {
  it('lista vazia', () => {
    expect(resumoCompra([])).toEqual({ total: 0, pendentes: 0, carrinho: 0, nao: 0, feitos: 0, itens: 0, semPreco: 0 })
  })
  it('conta pendentes, carrinho, não levei, feitos e sem preço; soma só o que tem preço', () => {
    const r = resumoCompra([
      item({ status: 'pendente', qtd_comprada: 9, preco_pago: 99 }),
      item({ status: 'pendente' }),
      item({ status: 'comprado', qtd_comprada: 3, preco_pago: 2.99 }),
      item({ status: 'substituido', qtd_comprada: 2, preco_pago: 6.5, sub_insumo_id: 'outro' }),
      item({ status: 'comprado', qtd_comprada: 1, preco_pago: null }),
      item({ status: 'comprado', qtd_comprada: 1, preco_pago: 0 }),
      item({ status: 'nao', qtd_comprada: 1, preco_pago: 10 }),
    ])
    expect(r).toEqual({ total: 21.97, pendentes: 2, carrinho: 4, nao: 1, feitos: 5, itens: 7, semPreco: 1 })
  })
  it('total sem resto de ponto flutuante ao somar vários itens', () => {
    const itens = Array.from({ length: 10 }, () => item({ status: 'comprado', qtd_comprada: 1, preco_pago: 0.1 }))
    expect(resumoCompra(itens).total).toBe(1)
    const r = resumoCompra([
      item({ status: 'comprado', qtd_comprada: 1, preco_pago: 0.1 }),
      item({ status: 'comprado', qtd_comprada: 1, preco_pago: 0.2 }),
    ])
    expect(r.total).toBe(0.3)
  })
})

describe('faixaPrecos', () => {
  it('converte para a embalagem pedida: 5 kg por R$ 25 com embalagem de 1 kg → R$ 5', () => {
    expect(faixaPrecos([preco({ qtd_compra: 5, unidade_compra: 'kg', preco_compra: 25 })], { qtd: 1, unidade: 'kg' })).toEqual({
      ultimo: 5,
      menor: 5,
      maior: 5,
      vezes: 1,
    })
  })
  it('junta embalagens de tamanhos e unidades compatíveis (g × kg, ml × l, un × dz)', () => {
    const f = faixaPrecos(
      [
        preco({ qtd_compra: 500, unidade_compra: 'g', preco_compra: 3, registrado_em: '2026-01-01T00:00:00.000Z' }), // 6/kg
        preco({ qtd_compra: 2, unidade_compra: 'kg', preco_compra: 9, registrado_em: '2026-02-01T00:00:00.000Z' }), // 4,50/kg
        preco({ qtd_compra: 1, unidade_compra: 'kg', preco_compra: 5.2, registrado_em: '2026-03-01T00:00:00.000Z' }),
      ],
      { qtd: 1, unidade: 'kg' },
    )
    expect(f).toEqual({ ultimo: 5.2, menor: 4.5, maior: 6, vezes: 3 })
    expect(faixaPrecos([preco({ qtd_compra: 1, unidade_compra: 'l', preco_compra: 8 })], { qtd: 200, unidade: 'ml' })?.ultimo).toBe(1.6)
    expect(faixaPrecos([preco({ qtd_compra: 30, unidade_compra: 'un', preco_compra: 24 })], { qtd: 1, unidade: 'dz' })?.ultimo).toBe(9.6)
  })
  it('leite condensado 395 g: mesma embalagem devolve o mesmo preço, sem perder centavo', () => {
    expect(faixaPrecos([preco({ qtd_compra: 395, unidade_compra: 'g', preco_compra: 6.49 })], { qtd: 395, unidade: 'g' })?.ultimo).toBe(6.49)
  })
  it('arredonda o preço convertido para centavos', () => {
    // 395 g por R$ 6,50 → 1 kg = 16,4556…
    expect(faixaPrecos([preco({ qtd_compra: 395, unidade_compra: 'g', preco_compra: 6.5 })], { qtd: 1, unidade: 'kg' })?.ultimo).toBe(16.46)
  })
  it('ignora unidades que não se convertem (histórico em kg para embalagem em un)', () => {
    const hist = [
      preco({ qtd_compra: 1, unidade_compra: 'kg', preco_compra: 5 }),
      preco({ qtd_compra: 100, unidade_compra: 'un', preco_compra: 20 }),
    ]
    expect(faixaPrecos(hist, { qtd: 50, unidade: 'un' })).toEqual({ ultimo: 10, menor: 10, maior: 10, vezes: 1 })
    expect(faixaPrecos([preco({ unidade_compra: 'kg' })], { qtd: 1, unidade: 'un' })).toBeNull()
    expect(faixaPrecos([preco({ unidade_compra: 'l' })], { qtd: 1, unidade: 'kg' })).toBeNull()
  })
  it('ignora preço zero (brinde)', () => {
    const hist = [
      preco({ preco_compra: 0, registrado_em: '2026-12-01T00:00:00.000Z' }),
      preco({ preco_compra: 6, registrado_em: '2026-01-01T00:00:00.000Z' }),
    ]
    expect(faixaPrecos(hist, { qtd: 1, unidade: 'kg' })).toEqual({ ultimo: 6, menor: 6, maior: 6, vezes: 1 })
    expect(faixaPrecos([preco({ preco_compra: 0 })], { qtd: 1, unidade: 'kg' })).toBeNull()
  })
  it('ignora registro com quantidade zero no histórico', () => {
    expect(faixaPrecos([preco({ qtd_compra: 0, preco_compra: 5 })], { qtd: 1, unidade: 'kg' })).toBeNull()
  })
  it('o último é o de registrado_em mais recente, não o último do array', () => {
    const hist = [
      preco({ preco_compra: 7, registrado_em: '2026-09-01T00:00:00.000Z' }),
      preco({ preco_compra: 4, registrado_em: '2026-03-01T00:00:00.000Z' }),
      preco({ preco_compra: 5, registrado_em: '2026-06-01T00:00:00.000Z' }),
    ]
    expect(faixaPrecos(hist, { qtd: 1, unidade: 'kg' })).toEqual({ ultimo: 7, menor: 4, maior: 7, vezes: 3 })
    expect(faixaPrecos([...hist].reverse(), { qtd: 1, unidade: 'kg' })?.ultimo).toBe(7)
  })
  it('sem histórico comparável → null', () => {
    expect(faixaPrecos([], { qtd: 1, unidade: 'kg' })).toBeNull()
  })
  it('embalagem com quantidade zero (ou inválida) → null', () => {
    const hist = [preco({})]
    expect(faixaPrecos(hist, { qtd: 0, unidade: 'kg' })).toBeNull()
    expect(faixaPrecos(hist, { qtd: -1, unidade: 'kg' })).toBeNull()
    expect(faixaPrecos(hist, { qtd: NaN, unidade: 'kg' })).toBeNull()
  })
})

describe('avaliarPreco', () => {
  const faixa: FaixaPrecos = { ultimo: 5, menor: 4.5, maior: 6, vezes: 3 }
  it('abaixo do menor, acima do maior, na faixa', () => {
    expect(avaliarPreco(4.49, faixa)).toBe('menor_de_todos')
    expect(avaliarPreco(6.01, faixa)).toBe('acima_do_maior')
    expect(avaliarPreco(5, faixa)).toBe('na_faixa')
  })
  it('igual ao menor ou ao maior fica na faixa', () => {
    expect(avaliarPreco(4.5, faixa)).toBe('na_faixa')
    expect(avaliarPreco(6, faixa)).toBe('na_faixa')
  })
  it('um preço só (o do cadastro): ainda não dá aviso de menor/maior', () => {
    const uma: FaixaPrecos = { ultimo: 5, menor: 5, maior: 5, vezes: 1 }
    expect(avaliarPreco(5, uma)).toBeNull()
    expect(avaliarPreco(4.99, uma)).toBeNull()
    expect(avaliarPreco(5.01, uma)).toBeNull()
  })
  it('sem preço, preço zero ou sem faixa → null', () => {
    expect(avaliarPreco(null, faixa)).toBeNull()
    expect(avaliarPreco(0, faixa)).toBeNull()
    expect(avaliarPreco(-1, faixa)).toBeNull()
    expect(avaliarPreco(NaN, faixa)).toBeNull()
    expect(avaliarPreco(5, null)).toBeNull()
  })
})

describe('insumoComprado', () => {
  it('comprado → o insumo pedido; substituído → o que levou no lugar', () => {
    expect(insumoComprado({ status: 'comprado', insumo_id: 'a', sub_insumo_id: 'b' })).toBe('a')
    expect(insumoComprado({ status: 'substituido', insumo_id: 'a', sub_insumo_id: 'b' })).toBe('b')
  })
  it('substituído por algo sem cadastro → null (não usa o pedido)', () => {
    expect(insumoComprado({ status: 'substituido', insumo_id: 'a', sub_insumo_id: null })).toBeNull()
  })
  it('pendente e não levei → null', () => {
    expect(insumoComprado({ status: 'pendente', insumo_id: 'a', sub_insumo_id: null })).toBeNull()
    expect(insumoComprado({ status: 'nao', insumo_id: 'a', sub_insumo_id: 'b' })).toBeNull()
  })
  it('comprado de insumo excluído (insumo_id null) → null', () => {
    expect(insumoComprado({ status: 'comprado', insumo_id: null, sub_insumo_id: null })).toBeNull()
  })
})

describe('historicoDaCompra', () => {
  it('uma linha por item levado com preço, com a embalagem comprada e o id do item', () => {
    const comprado = item({ id: 'i1', status: 'comprado', qtd_comprada: 3, preco_pago: 6.49, embalagem_qtd: 395, embalagem_unidade: 'g', insumo_id: 'leite' })
    const trocado = item({ id: 'i2', status: 'substituido', qtd_comprada: 1, preco_pago: 22, insumo_id: 'farinha', sub_insumo_id: 'farinha-b', embalagem_qtd: 5, embalagem_unidade: 'kg' })
    expect(historicoDaCompra([comprado, trocado])).toEqual([
      { insumo_id: 'leite', qtd_compra: 395, unidade_compra: 'g', preco_compra: 6.49, item_id: 'i1' },
      { insumo_id: 'farinha-b', qtd_compra: 5, unidade_compra: 'kg', preco_compra: 22, item_id: 'i2' },
    ])
  })
  it('pula substituído sem insumo cadastrado, item sem preço, pendente, não levei e insumo excluído', () => {
    expect(
      historicoDaCompra([
        item({ status: 'substituido', qtd_comprada: 1, preco_pago: 5, sub_insumo_id: null }),
        item({ status: 'comprado', qtd_comprada: 1, preco_pago: null }),
        item({ status: 'pendente', qtd_comprada: 1, preco_pago: 5 }),
        item({ status: 'nao', qtd_comprada: 1, preco_pago: 5 }),
        item({ status: 'comprado', qtd_comprada: 1, preco_pago: 5, insumo_id: null }),
        item({ status: 'comprado', qtd_comprada: 1, preco_pago: 5, embalagem_qtd: 0 }),
      ]),
    ).toEqual([])
  })
  it('arredonda o preço para centavos', () => {
    expect(historicoDaCompra([item({ status: 'comprado', qtd_comprada: 1, preco_pago: 4.999999 })])[0].preco_compra).toBe(5)
  })
  it('lista vazia → nenhuma linha', () => {
    expect(historicoDaCompra([])).toEqual([])
  })
})

describe('mudancasDeCusto', () => {
  it('sem mudança (mesmo preço e mesma embalagem) não lista', () => {
    expect(mudancasDeCusto([linha({})], [custo({})])).toEqual([])
  })
  it('preço novo vira o custo, com a variação por g/ml/un', () => {
    expect(mudancasDeCusto([linha({ preco_compra: 6 })], [custo({ preco_compra: 5 })])).toEqual([
      {
        insumo_id: 'farinha',
        nome: 'Farinha',
        antes: { qtd: 1, unidade: 'kg', preco: 5 },
        depois: { qtd: 1, unidade: 'kg', preco: 6 },
        variacaoPct: 20,
      },
    ])
  })
  it('variação negativa quando ficou mais barato', () => {
    expect(mudancasDeCusto([linha({ preco_compra: 4 })], [custo({ preco_compra: 5 })])[0].variacaoPct).toBe(-20)
  })
  it('variação arredondada a uma casa', () => {
    // 5 → 5,33: +6,6 %
    expect(mudancasDeCusto([linha({ preco_compra: 5.33 })], [custo({ preco_compra: 5 })])[0].variacaoPct).toBe(6.6)
  })
  it('troca de embalagem: compara pelo custo por g (5 kg por R$ 22 contra 1 kg por R$ 5)', () => {
    const [m] = mudancasDeCusto([linha({ qtd_compra: 5, preco_compra: 22 })], [custo({ qtd_compra: 1, preco_compra: 5 })])
    expect(m.antes).toEqual({ qtd: 1, unidade: 'kg', preco: 5 })
    expect(m.depois).toEqual({ qtd: 5, unidade: 'kg', preco: 22 })
    expect(m.variacaoPct).toBe(-12)
  })
  it('mesma quantidade em outra unidade (1 kg → 1000 g, mesmo preço) lista com variação 0', () => {
    const [m] = mudancasDeCusto([linha({ qtd_compra: 1000, unidade_compra: 'g', preco_compra: 5 })], [custo({})])
    expect(m.depois).toEqual({ qtd: 1000, unidade: 'g', preco: 5 })
    expect(m.variacaoPct).toBe(0)
  })
  it('mesmo insumo em dois itens: vale o mais caro por g/ml/un, em qualquer ordem', () => {
    const barato = linha({ qtd_compra: 5, preco_compra: 20 }) // 4/kg
    const caro = linha({ qtd_compra: 1, preco_compra: 6 }) // 6/kg
    for (const linhas of [
      [barato, caro],
      [caro, barato],
    ]) {
      const ms = mudancasDeCusto(linhas, [custo({ preco_compra: 5 })])
      expect(ms).toHaveLength(1)
      expect(ms[0].depois).toEqual({ qtd: 1, unidade: 'kg', preco: 6 })
      expect(ms[0].variacaoPct).toBe(20)
    }
  })
  it('mesmo insumo duas vezes, o mais caro igual ao custo atual → não lista', () => {
    expect(mudancasDeCusto([linha({ preco_compra: 4 }), linha({ preco_compra: 5 })], [custo({ preco_compra: 5 })])).toEqual([])
  })
  it('unidades que não se comparam (kg → un) não mudam o custo (estragaria as receitas)', () => {
    expect(mudancasDeCusto([linha({ qtd_compra: 10, unidade_compra: 'un', preco_compra: 8 })], [custo({})])).toEqual([])
  })
  it('custo atual zero: variação 0 (não divide por zero)', () => {
    const [m] = mudancasDeCusto([linha({ preco_compra: 5 })], [custo({ preco_compra: 0 })])
    expect(m.variacaoPct).toBe(0)
    expect(Number.isFinite(m.variacaoPct)).toBe(true)
  })
  it('insumo desconhecido (excluído ou inativo) fica de fora', () => {
    expect(mudancasDeCusto([linha({ insumo_id: 'sumiu', preco_compra: 9 })], [custo({})])).toEqual([])
  })
  it('ordena por nome em pt-BR (acentos e maiúsculas juntos)', () => {
    const insumos = [
      custo({ id: 'z', nome: 'Zimbro' }),
      custo({ id: 'a2', nome: 'açúcar' }),
      custo({ id: 'b', nome: 'Baunilha' }),
      custo({ id: 'a1', nome: 'Amido' }),
    ]
    const linhas = ['z', 'a2', 'b', 'a1'].map((id) => linha({ insumo_id: id, preco_compra: 7 }))
    expect(mudancasDeCusto(linhas, insumos).map((m) => m.nome)).toEqual(['açúcar', 'Amido', 'Baunilha', 'Zimbro'])
  })
  it('brinde (preço 0) não zera o custo do insumo', () => {
    // BUG: historicoDaCompra aceita preco_pago 0 e mudancasDeCusto propõe custo R$ 0 (variação −100 %),
    // embora faixaPrecos trate preço 0 como brinde e o ignore.
    const linhas = historicoDaCompra([item({ status: 'comprado', qtd_comprada: 1, preco_pago: 0 })])
    expect(mudancasDeCusto(linhas, [custo({ preco_compra: 5 })])).toEqual([])
  })
})

describe('mesclarPendentes', () => {
  type I = { id: string; status: string }
  it('a marcação deste aparelho manda sobre a do servidor, mantendo a ordem do servidor', () => {
    const servidor: I[] = [
      { id: 'a', status: 'pendente' },
      { id: 'b', status: 'pendente' },
      { id: 'c', status: 'nao' },
    ]
    const pend = new Map<string, I>([['b', { id: 'b', status: 'comprado' }]])
    expect(mesclarPendentes(servidor, pend)).toEqual([
      { id: 'a', status: 'pendente' },
      { id: 'b', status: 'comprado' },
      { id: 'c', status: 'nao' },
    ])
  })
  it('item que só existe aqui (fora da lista, ainda não subiu) entra no fim', () => {
    const servidor: I[] = [{ id: 'a', status: 'pendente' }]
    const pend = new Map<string, I>([
      ['novo', { id: 'novo', status: 'comprado' }],
      ['a', { id: 'a', status: 'nao' }],
    ])
    expect(mesclarPendentes(servidor, pend)).toEqual([
      { id: 'a', status: 'nao' },
      { id: 'novo', status: 'comprado' },
    ])
  })
  it('sem pendentes devolve o servidor; sem servidor devolve os pendentes', () => {
    const servidor: I[] = [{ id: 'a', status: 'pendente' }]
    expect(mesclarPendentes(servidor, new Map())).toEqual(servidor)
    expect(mesclarPendentes([], new Map([['x', { id: 'x', status: 'comprado' }]]))).toEqual([{ id: 'x', status: 'comprado' }])
  })
  it('não altera os arrays recebidos', () => {
    const servidor: I[] = [{ id: 'a', status: 'pendente' }]
    const res = mesclarPendentes(servidor, new Map([['n', { id: 'n', status: 'comprado' }]]))
    expect(servidor).toHaveLength(1)
    expect(res).not.toBe(servidor)
  })
})
