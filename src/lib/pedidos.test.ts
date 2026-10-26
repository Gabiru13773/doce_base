import { describe, expect, it } from 'vitest'
import {
  agruparAgenda,
  dataCurta,
  grupoEntrega,
  itemPagamentoPedido,
  linkWhatsapp,
  mensagemPedido,
  ordenarAgenda,
  paraProduzir,
  sinalSugerido,
  situacaoPagamento,
  telefoneWhatsapp,
  totaisPedido,
  type ItemPedido,
  type PedidoAgenda,
  type PedidoTexto,
  type StatusPedido,
} from './pedidos'

// ---- Fixtures -------------------------------------------------------------------------

const item = (p: Partial<ItemPedido>): ItemPedido => ({
  id: 'i1',
  produto_id: 'p1',
  variacao_id: 'v1',
  nome: 'Bolo de pote',
  qtd: 1,
  preco: 10,
  personalizacao: null,
  ...p,
})

const agenda = (id: string, entrega_data: string, p: Partial<PedidoAgenda> = {}): PedidoAgenda => ({
  id,
  entrega_data,
  entrega_hora: null,
  status: 'confirmado',
  criado_em: '2026-01-01T10:00:00Z',
  ...p,
})

const prod = (id: string, entrega_data: string, itens: ItemPedido[], status: StatusPedido = 'confirmado') => ({
  id,
  entrega_data,
  status,
  itens,
})

const texto = (p: Partial<PedidoTexto> = {}): PedidoTexto => ({
  cliente_nome: 'Maria Souza',
  entrega_data: '2026-10-30',
  entrega_hora: null,
  entrega_tipo: 'retirada',
  endereco: null,
  itens: [item({ nome: 'Bolo de chocolate', qtd: 1, preco: 80 })],
  desconto: 0,
  taxa_entrega: 0,
  total: 80,
  observacao: null,
  ...p,
})

// ---- totaisPedido -----------------------------------------------------------------------

describe('totaisPedido', () => {
  it('soma itens, tira desconto e põe a taxa de entrega', () => {
    expect(totaisPedido([item({ qtd: 2, preco: 12.5 }), item({ qtd: 1, preco: 30 })], 5, 8)).toEqual({
      subtotal: 55,
      desconto: 5,
      taxaEntrega: 8,
      total: 58,
    })
  })

  it('desconto maior que o subtotal fica no subtotal (total só com a taxa)', () => {
    expect(totaisPedido([item({ qtd: 1, preco: 20 })], 50, 7)).toEqual({ subtotal: 20, desconto: 20, taxaEntrega: 7, total: 7 })
  })

  it('desconto e taxa negativos ou vazios viram 0', () => {
    expect(totaisPedido([item({ preco: 10 })], -3, -5)).toEqual({ subtotal: 10, desconto: 0, taxaEntrega: 0, total: 10 })
    expect(totaisPedido([item({ preco: 10 })], NaN, NaN)).toEqual({ subtotal: 10, desconto: 0, taxaEntrega: 0, total: 10 })
    expect(totaisPedido([item({ preco: 10 })])).toEqual({ subtotal: 10, desconto: 0, taxaEntrega: 0, total: 10 })
  })

  it('arredonda os centavos de cada item (e não deixa sobra de ponto flutuante)', () => {
    // 3 × 3,335 = 10,005 → 10,01 (meio centavo sobe, como o banco)
    expect(totaisPedido([item({ qtd: 3, preco: 3.335 })]).subtotal).toBe(10.01)
    // 0,1 + 0,2
    const t = totaisPedido([item({ preco: 0.1 }), item({ preco: 0.2 })], 0.05, 0.1)
    expect(t).toEqual({ subtotal: 0.3, desconto: 0.05, taxaEntrega: 0.1, total: 0.35 })
    // a conta que o banco confere (pedidos_total) fecha certinho
    expect(t.total).toBe(Math.round((t.subtotal - t.desconto + t.taxaEntrega) * 100) / 100)
  })

  it('ignora itens com qtd 0, negativa ou preço negativo', () => {
    expect(totaisPedido([item({ qtd: 0, preco: 50 }), item({ qtd: -1, preco: 50 }), item({ qtd: 2, preco: -5 }), item({ qtd: 1, preco: 9 })]).subtotal).toBe(9)
  })

  it('sem itens: tudo zero (o desconto não deixa o total negativo)', () => {
    expect(totaisPedido([], 10, 0)).toEqual({ subtotal: 0, desconto: 0, taxaEntrega: 0, total: 0 })
  })
})

// ---- situacaoPagamento --------------------------------------------------------------------

describe('situacaoPagamento', () => {
  it('sem pagamentos: falta tudo', () => {
    expect(situacaoPagamento(100, [])).toEqual({ pago: 0, falta: 100, passou: 0, quitado: false })
  })

  it('canceladas não contam', () => {
    expect(
      situacaoPagamento(100, [
        { total: 50, status: 'concluida' },
        { total: 50, status: 'cancelada' },
      ]),
    ).toEqual({ pago: 50, falta: 50, passou: 0, quitado: false })
  })

  it('quitado quando o pago bate com o total (sem resto de ponto flutuante)', () => {
    expect(
      situacaoPagamento(0.3, [
        { total: 0.1, status: 'concluida' },
        { total: 0.2, status: 'concluida' },
      ]),
    ).toEqual({ pago: 0.3, falta: 0, passou: 0, quitado: true })
  })

  it('pagou mais que o total (pedido diminuiu depois do sinal): passou, falta 0', () => {
    expect(situacaoPagamento(80, [{ total: 100, status: 'concluida' }])).toEqual({ pago: 100, falta: 0, passou: 20, quitado: true })
  })

  it('pagamentos zerados ou negativos são ignorados', () => {
    expect(situacaoPagamento(10, [{ total: -5, status: 'concluida' }, { total: 0, status: 'concluida' }]).pago).toBe(0)
  })

  it('pedido de total 0 já está quitado', () => {
    expect(situacaoPagamento(0, []).quitado).toBe(true)
  })
})

// ---- sinalSugerido ----------------------------------------------------------------------

describe('sinalSugerido', () => {
  it('% do total, arredondado para cima no real', () => {
    expect(sinalSugerido(100, 50)).toBe(50)
    expect(sinalSugerido(101, 50)).toBe(51)
    expect(sinalSugerido(99.9, 30)).toBe(30) // 29,97 → 30
    expect(sinalSugerido(85, 50)).toBe(43) // 42,50 → 43
  })

  it('valor redondo não sobe por erro de ponto flutuante', () => {
    // 70 × 0,3 dá 20,999999999999996 no JS
    expect(sinalSugerido(70, 30)).toBe(21)
    expect(sinalSugerido(110, 10)).toBe(11)
  })

  it('nunca passa do que falta', () => {
    expect(sinalSugerido(100, 50, 20)).toBe(20)
    expect(sinalSugerido(0.5, 50)).toBe(0.5) // 0,25 → 1, mas o pedido inteiro é 0,50
    expect(sinalSugerido(100, 50, 0)).toBe(0)
    expect(sinalSugerido(100, 50, -10)).toBe(0)
  })

  it('pct 0 → 0; pct 100 → o total exato (com centavos)', () => {
    expect(sinalSugerido(100, 0)).toBe(0)
    expect(sinalSugerido(10.5, 100)).toBe(10.5)
    expect(sinalSugerido(10.5, 150)).toBe(10.5)
  })

  it('total zero, negativo ou inválido → 0', () => {
    expect(sinalSugerido(0, 50)).toBe(0)
    expect(sinalSugerido(-10, 50)).toBe(0)
    expect(sinalSugerido(NaN, 50)).toBe(0)
    expect(sinalSugerido(100, NaN)).toBe(0)
  })
})

// ---- Agenda -----------------------------------------------------------------------------

describe('grupoEntrega', () => {
  it('atrasado, hoje, amanhã, próximos 7 dias e depois', () => {
    expect(grupoEntrega('2026-10-24', '2026-10-25')).toBe('atrasado')
    expect(grupoEntrega('2026-10-25', '2026-10-25')).toBe('hoje')
    expect(grupoEntrega('2026-10-26', '2026-10-25')).toBe('amanha')
    expect(grupoEntrega('2026-10-27', '2026-10-25')).toBe('semana')
    expect(grupoEntrega('2026-11-01', '2026-10-25')).toBe('semana') // hoje + 7, inclusive
    expect(grupoEntrega('2026-11-02', '2026-10-25')).toBe('depois')
  })

  it('virada de mês e de ano', () => {
    expect(grupoEntrega('2026-11-01', '2026-10-31')).toBe('amanha')
    expect(grupoEntrega('2027-01-01', '2026-12-31')).toBe('amanha')
    expect(grupoEntrega('2027-01-07', '2026-12-31')).toBe('semana')
    expect(grupoEntrega('2027-01-08', '2026-12-31')).toBe('depois')
    expect(grupoEntrega('2026-12-31', '2027-01-01')).toBe('atrasado')
    // fevereiro (2028 é bissexto)
    expect(grupoEntrega('2028-02-29', '2028-02-28')).toBe('amanha')
    expect(grupoEntrega('2027-03-01', '2027-02-28')).toBe('amanha')
  })
})

describe('ordenarAgenda / agruparAgenda', () => {
  it('só confirmados e prontos', () => {
    const r = ordenarAgenda([
      agenda('a', '2026-10-25', { status: 'confirmado' }),
      agenda('b', '2026-10-25', { status: 'pronto' }),
      agenda('c', '2026-10-25', { status: 'entregue' }),
      agenda('d', '2026-10-25', { status: 'cancelado' }),
    ])
    expect(r.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('por data, depois hora (sem hora no fim do dia, null ou vazio), depois criação', () => {
    const r = ordenarAgenda([
      agenda('semHora', '2026-10-25', { entrega_hora: null }),
      agenda('vazia', '2026-10-25', { entrega_hora: '' }),
      agenda('tarde', '2026-10-25', { entrega_hora: '15:00' }),
      agenda('cedo', '2026-10-25', { entrega_hora: '09:30' }),
      agenda('outroDia', '2026-10-24', { entrega_hora: '18:00' }),
      agenda('tarde2', '2026-10-25', { entrega_hora: '15:00', criado_em: '2025-12-31T10:00:00Z' }),
    ])
    expect(r.map((p) => p.id)).toEqual(['outroDia', 'cedo', 'tarde2', 'tarde', 'semHora', 'vazia'])
  })

  it('não mexe na lista original', () => {
    const lista = [agenda('b', '2026-10-26'), agenda('a', '2026-10-25')]
    ordenarAgenda(lista)
    expect(lista.map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('agrupa na ordem certa e só os grupos com pedidos', () => {
    const g = agruparAgenda(
      [
        agenda('depois', '2027-02-01'),
        agenda('amanha', '2027-01-01'),
        agenda('atrasado', '2026-12-30'),
        agenda('entregue', '2026-12-31', { status: 'entregue' }),
        agenda('semana', '2027-01-05'),
        agenda('hoje2', '2026-12-31', { entrega_hora: '10:00' }),
        agenda('hoje1', '2026-12-31', { entrega_hora: '08:00', status: 'pronto' }),
      ],
      '2026-12-31',
    )
    expect(g.map((x) => [x.grupo, x.pedidos.map((p) => p.id)])).toEqual([
      ['atrasado', ['atrasado']],
      ['hoje', ['hoje1', 'hoje2']],
      ['amanha', ['amanha']],
      ['semana', ['semana']],
      ['depois', ['depois']],
    ])
  })

  it('sem pedidos em aberto: lista vazia', () => {
    expect(agruparAgenda([agenda('x', '2026-10-25', { status: 'cancelado' })], '2026-10-25')).toEqual([])
  })
})

// ---- paraProduzir ------------------------------------------------------------------------

describe('paraProduzir', () => {
  it('soma a mesma variação entre pedidos e conta cada pedido uma vez', () => {
    const r = paraProduzir(
      [
        prod('p1', '2026-10-25', [
          item({ id: 'a', variacao_id: 'v1', nome: 'Brigadeiro (cento)', qtd: 2, personalizacao: 'granulado' }),
          item({ id: 'b', variacao_id: 'v1', nome: 'Brigadeiro (cento)', qtd: 1, personalizacao: 'confete' }),
        ]),
        prod('p2', '2026-10-26', [item({ id: 'c', variacao_id: 'v1', nome: 'Brigadeiro (cento)', qtd: 3 })]),
      ],
      '2026-10-26',
    )
    expect(r).toEqual([{ chave: 'v:v1', nome: 'Brigadeiro (cento)', qtd: 6, pedidos: 2 }])
  })

  it('avulsos somam pelo nome, sem diferenciar maiúsculas nem espaços', () => {
    const r = paraProduzir(
      [
        prod('p1', '2026-10-25', [item({ produto_id: null, variacao_id: null, nome: 'Bolo Unicórnio ', qtd: 1 })]),
        prod('p2', '2026-10-25', [item({ produto_id: null, variacao_id: null, nome: 'bolo unicórnio', qtd: 2 })]),
        prod('p3', '2026-10-25', [item({ produto_id: null, variacao_id: null, nome: 'Torta', qtd: 1 })]),
      ],
      '2026-10-25',
    )
    expect(r).toEqual([
      { chave: 'n:bolo unicórnio', nome: 'Bolo Unicórnio', qtd: 3, pedidos: 2 },
      { chave: 'n:torta', nome: 'Torta', qtd: 1, pedidos: 1 },
    ])
  })

  it('só confirmados (prontos, entregues e cancelados ficam fora)', () => {
    const r = paraProduzir(
      [
        prod('p1', '2026-10-25', [item({ qtd: 1 })], 'confirmado'),
        prod('p2', '2026-10-25', [item({ qtd: 10 })], 'pronto'),
        prod('p3', '2026-10-25', [item({ qtd: 10 })], 'entregue'),
        prod('p4', '2026-10-25', [item({ qtd: 10 })], 'cancelado'),
      ],
      '2026-10-25',
    )
    expect(r).toEqual([{ chave: 'v:v1', nome: 'Bolo de pote', qtd: 1, pedidos: 1 }])
  })

  it('data limite inclusiva (e os atrasados entram)', () => {
    const r = paraProduzir(
      [
        prod('ontem', '2026-10-24', [item({ qtd: 1 })]),
        prod('limite', '2026-10-27', [item({ qtd: 2 })]),
        prod('depois', '2026-10-28', [item({ qtd: 100 })]),
      ],
      '2026-10-27',
    )
    expect(r).toEqual([{ chave: 'v:v1', nome: 'Bolo de pote', qtd: 3, pedidos: 2 }])
  })

  it('ignora itens com qtd 0 (e não conta o pedido por causa deles)', () => {
    const r = paraProduzir([prod('p1', '2026-10-25', [item({ qtd: 0 })]), prod('p2', '2026-10-25', [item({ qtd: 1 })])], '2026-10-25')
    expect(r).toEqual([{ chave: 'v:v1', nome: 'Bolo de pote', qtd: 1, pedidos: 1 }])
  })

  it('ordena pela quantidade (maior primeiro), empate pelo nome', () => {
    const r = paraProduzir(
      [
        prod('p1', '2026-10-25', [
          item({ variacao_id: 'b', nome: 'Beijinho', qtd: 2 }),
          item({ variacao_id: 'a', nome: 'Amanteigado', qtd: 2 }),
          item({ variacao_id: 'c', nome: 'Cookie', qtd: 5 }),
        ]),
      ],
      '2026-10-25',
    )
    expect(r.map((l) => l.nome)).toEqual(['Cookie', 'Amanteigado', 'Beijinho'])
  })

  it('quantidade quebrada soma sem lixo de ponto flutuante', () => {
    const r = paraProduzir([prod('p1', '2026-10-25', [item({ qtd: 0.1 })]), prod('p2', '2026-10-25', [item({ qtd: 0.2 })])], '2026-10-25')
    expect(r[0].qtd).toBe(0.3)
  })

  it('resultado é objeto simples (vai para o cache em JSON)', () => {
    const r = paraProduzir([prod('p1', '2026-10-25', [item({})])], '2026-10-25')
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
  })
})

// ---- Textos -------------------------------------------------------------------------------

describe('itemPagamentoPedido', () => {
  const p = { cliente_nome: '  Ana Lima ', entrega_data: '2026-11-03' }

  it('um item, qtd 1, preço em centavos, sem produto (não dá baixa no estoque)', () => {
    expect(itemPagamentoPedido(p, 42.505, 'sinal')).toEqual({
      produto_id: '',
      variacao_id: '',
      nome: 'Sinal do pedido — Ana Lima (entrega 03/11)',
      qtd: 1,
      preco: 42.51,
    })
  })

  it('rótulo do restante e do pagamento avulso', () => {
    expect(itemPagamentoPedido(p, 10, 'restante').nome).toBe('Restante do pedido — Ana Lima (entrega 03/11)')
    expect(itemPagamentoPedido(p, 10, 'pagamento').nome).toBe('Pagamento do pedido — Ana Lima (entrega 03/11)')
  })

  it('dataCurta', () => {
    expect(dataCurta('2027-01-09')).toBe('09/01')
  })
})

describe('telefoneWhatsapp / linkWhatsapp', () => {
  it('celular e fixo sem 55 ganham o 55', () => {
    expect(telefoneWhatsapp('11987654321')).toBe('5511987654321')
    expect(telefoneWhatsapp('(11) 98765-4321')).toBe('5511987654321')
    expect(telefoneWhatsapp('11 3333-4444')).toBe('551133334444')
  })

  it('com 55 fica como está', () => {
    expect(telefoneWhatsapp('55 11 98765-4321')).toBe('5511987654321')
    expect(telefoneWhatsapp('+55 (11) 98765-4321')).toBe('5511987654321')
    expect(telefoneWhatsapp('551133334444')).toBe('551133334444')
  })

  it('DDD 55 (RS) sem o código do país', () => {
    expect(telefoneWhatsapp('(55) 99876-5432')).toBe('5555998765432')
  })

  it('tira o 0 da frente (0 + DDD)', () => {
    expect(telefoneWhatsapp('011 98765-4321')).toBe('5511987654321')
    expect(telefoneWhatsapp('0055 11 98765-4321')).toBe('5511987654321')
  })

  it('com + é número de qualquer país', () => {
    expect(telefoneWhatsapp('+1 415 555 2671')).toBe('14155552671')
    expect(telefoneWhatsapp('+351 912 345 678')).toBe('351912345678')
  })

  it('curto demais, comprido demais, vazio ou com código de operadora → null', () => {
    expect(telefoneWhatsapp('98765-4321')).toBeNull()
    expect(telefoneWhatsapp('')).toBeNull()
    expect(telefoneWhatsapp(null)).toBeNull()
    expect(telefoneWhatsapp(undefined)).toBeNull()
    expect(telefoneWhatsapp('11 98765-4321 / 11 3333-4444')).toBeNull()
    expect(telefoneWhatsapp('0 21 11 98765-4321')).toBeNull()
  })

  it('link com o texto codificado (ou null sem telefone)', () => {
    expect(linkWhatsapp('(11) 98765-4321', 'Olá, tudo bem? & obrigada')).toBe(
      'https://wa.me/5511987654321?text=Ol%C3%A1%2C%20tudo%20bem%3F%20%26%20obrigada',
    )
    expect(linkWhatsapp('123', 'oi')).toBeNull()
  })
})

describe('mensagemPedido', () => {
  it('quitado, retirada sem hora', () => {
    expect(mensagemPedido(texto(), 80)).toBe(
      [
        'Olá, Maria! Seu pedido na Euforia Confeitaria:',
        '',
        '• 1x Bolo de chocolate — R$ 80,00',
        '',
        'Total: R$ 80,00',
        'Pago: R$ 80,00',
        'Pagamento: quitado ✓',
        '',
        'Retirada: 30/10',
      ].join('\n'),
    )
  })

  it('com sinal pago: mostra o que falta; entrega com hora, endereço, taxa, desconto e obs.', () => {
    const m = mensagemPedido(
      texto({
        entrega_tipo: 'propria',
        entrega_hora: '15:30',
        endereco: ' Rua das Flores, 10 ',
        itens: [item({ nome: 'Docinhos', qtd: 2, preco: 45.5 })],
        desconto: 6,
        taxa_entrega: 10,
        total: 95,
        observacao: ' Tocar o interfone ',
      }),
      40,
    )
    expect(m).toContain('• 2x Docinhos — R$ 91,00')
    expect(m).toContain('Desconto: −R$ 6,00')
    expect(m).toContain('Entrega: R$ 10,00')
    expect(m).toContain('Total: R$ 95,00')
    expect(m).toContain('Pago: R$ 40,00')
    expect(m).toContain('Falta: R$ 55,00')
    expect(m).not.toContain('quitado')
    expect(m).toContain('Entrega: 30/10 às 15:30 — Rua das Flores, 10')
    expect(m.endsWith('Obs.: Tocar o interfone')).toBe(true)
  })

  it('nada pago: só o total (sem "Pago" nem "Falta")', () => {
    const m = mensagemPedido(texto(), 0)
    expect(m).not.toContain('Pago:')
    expect(m).not.toContain('Falta:')
    expect(m).not.toContain('quitado')
  })

  it('retirada não mostra endereço; motoboy sem endereço não deixa traço sobrando', () => {
    expect(mensagemPedido(texto({ endereco: 'Rua X' }), 0)).not.toContain('Rua X')
    expect(mensagemPedido(texto({ entrega_tipo: 'motoboy', entrega_hora: '10:00' }), 0).endsWith('\nEntrega: 30/10 às 10:00')).toBe(true)
  })

  it('personalização embaixo do item (vazia não aparece)', () => {
    const m = mensagemPedido(
      texto({
        itens: [
          item({ nome: 'Bolo', qtd: 1, preco: 80, personalizacao: ' Tema Frozen, "Feliz 5 anos, Lia" ' }),
          item({ nome: 'Brigadeiro', qtd: 1, preco: 0, personalizacao: '   ' }),
        ],
      }),
      0,
    )
    expect(m).toContain('• 1x Bolo — R$ 80,00\n   Tema Frozen, "Feliz 5 anos, Lia"\n• 1x Brigadeiro — R$ 0,00\n\n')
  })

  it('quantidade quebrada com vírgula; nome vazio não deixa "Olá, !"', () => {
    const m = mensagemPedido(texto({ cliente_nome: '  ', itens: [item({ nome: 'Brownie (kg)', qtd: 1.5, preco: 60 })], total: 90 }), 0)
    expect(m.startsWith('Olá! Seu pedido')).toBe(true)
    expect(m).toContain('• 1,5x Brownie (kg) — R$ 90,00')
  })

  it('pago a mais também conta como quitado', () => {
    expect(mensagemPedido(texto({ total: 50 }), 80)).toContain('Pagamento: quitado ✓')
  })
})
