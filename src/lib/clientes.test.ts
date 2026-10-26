import { describe, expect, it } from 'vitest'
import { itensMaisPedidos, ordenarClientes, resumoCliente, resumosPorCliente, usuarioInstagram, type PedidoCliente } from './clientes'

// ---- Fixtures -------------------------------------------------------------------------

const pedido = (p: Partial<PedidoCliente>): PedidoCliente => ({
  cliente_id: 'ana',
  entrega_data: '2026-10-20',
  status: 'entregue',
  total: 0,
  itens: [],
  ...p,
})

const item = (nome: string, qtd: number, variacao_id: string | null = null) => ({ nome, qtd, variacao_id })

describe('resumoCliente', () => {
  it('conta pedidos não cancelados e soma só os entregues', () => {
    const r = resumoCliente([
      pedido({ total: 100, entrega_data: '2026-10-01' }),
      pedido({ total: 50.1, entrega_data: '2026-10-05' }),
      pedido({ status: 'confirmado', total: 200, entrega_data: '2026-10-30' }),
      pedido({ status: 'cancelado', total: 999, entrega_data: '2026-12-01' }),
    ])
    expect(r.pedidos).toBe(3)
    expect(r.entregues).toBe(2)
    expect(r.totalGasto).toBe(150.1)
    expect(r.ticketMedio).toBe(75.05)
    // o cancelado (mais recente) não conta como último pedido
    expect(r.ultimoPedido).toBe('2026-10-30')
  })

  it('sem pedidos: tudo zerado e sem último pedido', () => {
    expect(resumoCliente([])).toEqual({ pedidos: 0, totalGasto: 0, entregues: 0, ticketMedio: 0, ultimoPedido: null })
  })

  it('só pedidos em aberto: ticket médio zero (nada entregue ainda)', () => {
    const r = resumoCliente([pedido({ status: 'pronto', total: 80 })])
    expect(r.pedidos).toBe(1)
    expect(r.totalGasto).toBe(0)
    expect(r.ticketMedio).toBe(0)
  })

  it('arredonda o ticket médio em centavos', () => {
    const r = resumoCliente([pedido({ total: 10 }), pedido({ total: 10 }), pedido({ total: 10.01 })])
    expect(r.totalGasto).toBe(30.01)
    expect(r.ticketMedio).toBe(10)
  })
})

describe('resumosPorCliente', () => {
  it('agrupa por cliente e ignora pedidos sem cliente', () => {
    const r = resumosPorCliente([
      pedido({ cliente_id: 'ana', total: 10 }),
      pedido({ cliente_id: 'bia', total: 20 }),
      pedido({ cliente_id: 'ana', total: 5 }),
      pedido({ cliente_id: null, total: 1000 }),
    ])
    expect(Object.keys(r).sort()).toEqual(['ana', 'bia'])
    expect(r.ana.totalGasto).toBe(15)
    expect(r.bia.pedidos).toBe(1)
  })
})

describe('itensMaisPedidos', () => {
  it('soma por variação e por nome (avulso), sem os cancelados, top 3', () => {
    const r = itensMaisPedidos([
      pedido({ itens: [item('Brigadeiro', 25, 'brig'), item('Bolo de cenoura', 1, 'cenoura')] }),
      pedido({ status: 'confirmado', itens: [item('Brigadeiro', 50, 'brig'), item('Topo personalizado', 2)] }),
      pedido({ itens: [item('topo personalizado ', 1), item('Beijinho', 10, 'beij')] }),
      pedido({ status: 'cancelado', itens: [item('Bolo de cenoura', 100, 'cenoura')] }),
    ])
    expect(r.map((l) => [l.nome, l.qtd])).toEqual([
      ['Brigadeiro', 75],
      ['Beijinho', 10],
      ['Topo personalizado', 3],
    ])
  })

  it('ignora quantidades zeradas', () => {
    expect(itensMaisPedidos([pedido({ itens: [item('Bolo', 0)] })])).toEqual([])
  })
})

describe('ordenarClientes', () => {
  const clientes = [
    { id: 'c', nome: 'Carla' },
    { id: 'a', nome: 'ana' },
    { id: 'b', nome: 'Bruna' },
  ]
  const resumos = resumosPorCliente([
    pedido({ cliente_id: 'c', entrega_data: '2026-10-01' }),
    pedido({ cliente_id: 'c', entrega_data: '2026-10-02' }),
    pedido({ cliente_id: 'b', entrega_data: '2026-10-10' }),
  ])

  it('A–Z ignora maiúsculas', () => {
    expect(ordenarClientes(clientes, resumos, 'nome').map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('mais pedidos primeiro; quem não tem vai por último', () => {
    expect(ordenarClientes(clientes, resumos, 'pedidos').map((c) => c.id)).toEqual(['c', 'b', 'a'])
  })

  it('pedido mais recente primeiro', () => {
    expect(ordenarClientes(clientes, resumos, 'recentes').map((c) => c.id)).toEqual(['b', 'c', 'a'])
  })

  it('não muda a lista original', () => {
    ordenarClientes(clientes, resumos, 'pedidos')
    expect(clientes[0].id).toBe('c')
  })
})

describe('usuarioInstagram', () => {
  it('tira o @ e aceita o link do perfil', () => {
    expect(usuarioInstagram('@@euforia.doces')).toBe('euforia.doces')
    expect(usuarioInstagram('https://www.instagram.com/euforia.doces/?hl=pt')).toBe('euforia.doces')
    expect(usuarioInstagram(' maria ')).toBe('maria')
    expect(usuarioInstagram(null)).toBe('')
  })
})
