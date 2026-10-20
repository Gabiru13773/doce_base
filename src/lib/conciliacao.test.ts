import { describe, expect, it } from 'vitest'
import { PLANO_PADRAO } from '../modules/financeiro/planoPadrao'
import {
  adivinharForma,
  capitalizar,
  extrairPessoa,
  limparDescricao,
  palavrasChave,
  paraLancamentos,
  sugerir,
  type ContextoConciliacao,
} from './conciliacao'
import type { TransacaoOfx } from './ofx'

const categorias = PLANO_PADRAO.map((c, i) => ({ id: `cat${i}`, tipo: c.tipo, nome: c.nome, ativo: true }))
const cat = (nome: string) => categorias.find((c) => c.nome === nome)!.id

const CONTA = 'nubank'

type Lanc = ContextoConciliacao['lancamentos'][number]
const lanc = (l: Partial<Lanc> & Pick<Lanc, 'id' | 'data' | 'valor'>): Lanc => ({
  tipo: 'saida',
  descricao: 'x',
  pessoa: null,
  categoria_id: null,
  conta_id: CONTA,
  conta_destino_id: null,
  titulo_id: null,
  ofx_fitid: null,
  ...l,
})

const tr = (fitid: string, data: string, valor: number, descricao: string, tipo = valor < 0 ? 'DEBIT' : 'CREDIT'): TransacaoOfx => ({
  fitid,
  data,
  valor,
  tipo,
  descricao,
})

function ctx(over: Partial<ContextoConciliacao> = {}): ContextoConciliacao {
  return {
    contaId: CONTA,
    lancamentos: [],
    titulos: [],
    categorias,
    contas: [
      { id: CONTA, nome: 'Nubank', tipo: 'banco', ativo: true },
      { id: 'inter', nome: 'Inter', tipo: 'banco', ativo: true },
      { id: 'caixa', nome: 'Caixa da loja', tipo: 'caixa', ativo: true },
    ],
    hoje: '2026-10-20',
    ...over,
  }
}

const ALUGUEL = {
  id: 't-aluguel',
  tipo: 'pagar' as const,
  descricao: 'Aluguel',
  pessoa: 'José Imóveis',
  categoria_id: cat('Aluguel'),
  valor: 1500,
  vencimento: '2026-10-10',
}
const ANA = {
  id: 't-ana',
  tipo: 'receber' as const,
  descricao: 'Encomenda bolo de casamento',
  pessoa: 'Ana Paula',
  categoria_id: cat('Encomendas'),
  valor: 850,
  vencimento: '2026-10-11',
}

describe('textos', () => {
  it('palavras-chave tiram ruído, números e acentos', () => {
    expect(palavrasChave('PIX ENVIADO - JOSÉ IMÓVEIS LTDA 123')).toEqual(['JOSE', 'IMOVEIS'])
    expect(palavrasChave('COMPRA CARTAO ASSAI ATACADISTA LJ23')).toEqual(['ASSAI', 'ATACADISTA'])
  })

  it('capitaliza só textos em maiúsculas', () => {
    expect(capitalizar('PIX ENVIADO JOAO DA SILVA')).toBe('PIX Enviado Joao da Silva')
    expect(capitalizar('Compra no débito')).toBe('Compra no débito')
    expect(capitalizar('PIX ENVIADO CASA DAS FESTAS')).toBe('PIX Enviado Casa das Festas')
    expect(capitalizar('PAGAMENTO DAS')).toBe('Pagamento DAS')
    expect(capitalizar('DAS MEI OUTUBRO')).toBe('DAS MEI Outubro')
  })

  it('limpa CPF mascarado e dados bancários', () => {
    expect(
      limparDescricao('Transferência recebida pelo Pix - ANA PAULA SOUZA - •••.123.456-•• - ITAÚ UNIBANCO S.A. (0341) Agência: 100 Conta: 2000-1'),
    ).toBe('Transferência recebida pelo Pix - ANA PAULA SOUZA')
    expect(limparDescricao('  TARIFA   PACOTE  ')).toBe('Tarifa Pacote')
  })

  it('extrai a pessoa de Pix/TED', () => {
    expect(extrairPessoa('Transferência enviada pelo Pix - JOSÉ IMÓVEIS LTDA - 12.345.678/0001-90 - BCO')).toBe('José Imóveis Ltda')
    expect(extrairPessoa('PIX RECEBIDO - MARIA DE SOUZA')).toBe('Maria de Souza')
    expect(extrairPessoa('PIX ENVIADO JOAO SILVA')).toBe('Joao Silva')
    expect(extrairPessoa('CRED PIX MARIA')).toBe('Maria')
    expect(extrairPessoa('TARIFA PACOTE SERVICOS')).toBeNull()
    expect(extrairPessoa('COMPRA CARTAO MERCADO BOM')).toBeNull()
  })

  it('adivinha a forma de pagamento', () => {
    expect(adivinharForma(tr('a', '2026-10-01', -10, 'PIX ENVIADO FULANO'))).toBe('Pix')
    expect(adivinharForma(tr('a', '2026-10-01', -10, 'PAG BOLETO ENEL'))).toBe('Boleto')
    expect(adivinharForma(tr('a', '2026-10-01', -10, 'TED 001 FULANO'))).toBe('Transferência')
    expect(adivinharForma(tr('a', '2026-10-01', -10, 'COMPRA CARTAO DEB PADARIA'))).toBe('Cartão de débito')
    expect(adivinharForma(tr('a', '2026-10-01', -10, 'IFOOD'), true)).toBe('Cartão de crédito')
    expect(adivinharForma(tr('a', '2026-10-01', -10, 'XYZ'))).toBeNull()
  })
})

describe('sugerir', () => {
  it('marca já importadas pelo FITID desta conta (inclusive transferência recebida)', () => {
    const linhas = sugerir(
      [tr('f1', '2026-10-05', -20, 'TARIFA'), tr('f2', '2026-10-06', 100, 'TRANSF MESMA TITULARIDADE'), tr('f3', '2026-10-07', -5, 'X')],
      ctx({
        lancamentos: [
          lanc({ id: 'l1', data: '2026-10-05', valor: 20, ofx_fitid: 'f1' }),
          lanc({ id: 'l2', tipo: 'transferencia', conta_id: 'inter', conta_destino_id: CONTA, data: '2026-10-06', valor: 100, ofx_fitid: 'f2' }),
          lanc({ id: 'l3', conta_id: 'inter', data: '2026-10-07', valor: 5, ofx_fitid: 'f3' }),
        ],
      }),
    )
    expect(linhas.map((l) => l.jaImportada)).toEqual([true, true, false])
  })

  it('avisa possível duplicata de lançamento anotado à mão (±2 dias, mesmo sentido), uma vez só', () => {
    const linhas = sugerir(
      [tr('a', '2026-10-05', -45.9, 'MERCADO BOM'), tr('b', '2026-10-05', -45.9, 'MERCADO BOM'), tr('c', '2026-10-05', 45.9, 'PIX')],
      ctx({ lancamentos: [lanc({ id: 'm1', data: '2026-10-03', valor: 45.9 })] }),
    )
    expect(linhas.map((l) => l.duplicataDe)).toEqual(['m1', null, null])
    const longe = sugerir([tr('a', '2026-10-05', -45.9, 'X')], ctx({ lancamentos: [lanc({ id: 'm1', data: '2026-10-01', valor: 45.9 })] }))
    expect(longe[0].possivelDuplicata).toBe(false)
  })

  it('importado com outro FITID no mesmo dia também é possível duplicata', () => {
    const linhas = sugerir(
      [tr('novo', '2026-10-05', -10, 'X')],
      ctx({ lancamentos: [lanc({ id: 'v', data: '2026-10-05', valor: 10, ofx_fitid: 'velho' })] }),
    )
    expect(linhas[0].possivelDuplicata).toBe(true)
  })

  it('liga o pagamento do aluguel e o Pix da Ana aos títulos certos', () => {
    const [aluguel, ana] = sugerir(
      [
        tr('a', '2026-10-09', -1500, 'Transferência enviada pelo Pix - JOSÉ IMÓVEIS LTDA - 12.345.678/0001-90'),
        tr('b', '2026-10-12', 850, 'Transferência recebida pelo Pix - ANA PAULA SOUZA - •••.123.456-••'),
      ],
      ctx({ titulos: [ALUGUEL, ANA] }),
    )
    expect(aluguel.titulo).toMatchObject({ tituloId: 't-aluguel', confianca: 'alta', dias: -1 })
    expect(aluguel.categoriaId).toBe(cat('Aluguel'))
    expect(aluguel.origemCategoria).toBe('titulo')
    expect(aluguel.pessoa).toBe('José Imóveis Ltda')
    expect(ana.titulo).toMatchObject({ tituloId: 't-ana', confianca: 'alta' })
  })

  it('usa o que falta de um título pago em parte, e ignora títulos pagos ou de outro sentido', () => {
    const lancamentos = [lanc({ id: 'b1', data: '2026-10-01', valor: 500, titulo_id: 't-aluguel' })]
    const [resto, cheio] = sugerir([tr('a', '2026-10-10', -1000, 'PIX X'), tr('b', '2026-10-10', 1500, 'PIX Y')], ctx({ titulos: [ALUGUEL], lancamentos }))
    expect(resto.titulo?.tituloId).toBe('t-aluguel')
    expect(resto.titulo?.falta).toBe(1000)
    expect(cheio.titulo).toBeNull()
    const pago = [lanc({ id: 'b1', data: '2026-10-01', valor: 1500, titulo_id: 't-aluguel' })]
    expect(sugerir([tr('a', '2026-10-10', -1500, 'X')], ctx({ titulos: [ALUGUEL], lancamentos: pago }))[0].titulo).toBeNull()
  })

  it('só valor igual e data longe vira alternativa, sem ligar sozinho; fora de ±10 dias nada', () => {
    const [l] = sugerir([tr('a', '2026-10-18', -1500, 'PAGAMENTO XYZ')], ctx({ titulos: [ALUGUEL] }))
    expect(l.titulo).toBeNull()
    expect(l.alternativas.map((a) => [a.tituloId, a.confianca])).toEqual([['t-aluguel', 'baixa']])
    const [fora] = sugerir([tr('a', '2026-10-25', -1500, 'ALUGUEL')], ctx({ titulos: [ALUGUEL] }))
    expect(fora.alternativas).toEqual([])
  })

  it('um título não é sugerido para duas transações', () => {
    const linhas = sugerir(
      [tr('a', '2026-10-15', -1500, 'PIX OUTRO'), tr('b', '2026-10-10', -1500, 'PIX JOSE IMOVEIS')],
      ctx({ titulos: [ALUGUEL] }),
    )
    expect(linhas[1].titulo?.tituloId).toBe('t-aluguel')
    expect(linhas[0].titulo).toBeNull()
    expect(linhas[0].alternativas[0].tituloId).toBe('t-aluguel')
  })

  it('aprende a categoria com o histórico', () => {
    const lancamentos = [
      lanc({ id: '1', data: '2026-09-01', valor: 80, descricao: 'Pix enviado Doce Sabor Distribuidora', categoria_id: cat('Embalagens') }),
      lanc({ id: '2', data: '2026-09-15', valor: 90, descricao: 'DOCE SABOR DISTRIBUIDORA', categoria_id: cat('Embalagens') }),
      lanc({ id: '3', data: '2026-09-20', valor: 90, descricao: 'Doce sabor', pessoa: 'Distribuidora', tipo: 'entrada', categoria_id: cat('Encomendas') }),
    ]
    const [l] = sugerir([tr('a', '2026-10-05', -120, 'PIX ENVIADO DOCE SABOR DISTRIBUIDORA LTDA')], ctx({ lancamentos }))
    expect(l.categoriaId).toBe(cat('Embalagens'))
    expect(l.origemCategoria).toBe('historico')
    expect(l.confiancaCategoria).toBe('alta')
  })

  it('o histórico ganha das regras', () => {
    const lancamentos = [lanc({ id: '1', data: '2026-09-01', valor: 80, descricao: 'ATACADAO', categoria_id: cat('Embalagens') })]
    expect(sugerir([tr('a', '2026-10-05', -120, 'COMPRA ATACADAO')], ctx({ lancamentos }))[0].categoriaId).toBe(cat('Embalagens'))
  })

  it.each([
    ['TARIFA PACOTE SERVICOS', -25, 'Tarifas bancárias'],
    ['Pacote de serviços', -25, 'Tarifas bancárias'],
    ['IFOOD.COM AGENCIA DE RESTAURANTES', 532.1, 'iFood e aplicativos'],
    ['IFOOD *TAXA', -12, 'Taxas do iFood e apps'],
    ['COMPRA CARTAO SUPERMERCADO BOM PRECO', -230, 'Ingredientes e insumos'],
    ['ASSAI ATACADISTA LJ 12', -410, 'Ingredientes e insumos'],
    ['PAG BOLETO CEMIG', -180, 'Energia elétrica'],
    ['DEB AUT SABESP', -90, 'Água'],
    ['DEBITO AUTOMATICO VIVO FIBRA', -120, 'Internet e telefone'],
    ['POSTO IPIRANGA', -150, 'Combustível'],
    ['PAGAMENTO DAS', -75.6, 'Simples Nacional / DAS-MEI'],
    ['PIX ALUGUEL OUTUBRO', -1400, 'Aluguel'],
    ['ULTRAGAZ', -110, 'Gás'],
    ['CRED STONE PAGAMENTOS', 1520.4, 'Vendas no balcão'],
    ['MERCADO PAGO REPASSE', 300, 'Vendas no balcão'],
  ])('regra: %s → %s', (descricao, valor, categoria) => {
    const [l] = sugerir([tr('a', '2026-10-05', valor, descricao)], ctx())
    expect(categorias.find((c) => c.id === l.categoriaId)?.nome).toBe(categoria)
    expect(l.origemCategoria).toBe('regra')
    expect(l.confiancaCategoria).toBe('media')
  })

  it('regras não confundem palavras comuns', () => {
    expect(sugerir([tr('a', '2026-10-05', -50, 'PIX ENVIADO CASA DAS FESTAS')], ctx())[0].categoriaId).toBeNull()
    expect(sugerir([tr('a', '2026-10-05', -50, 'MERCADO PAGO*LOJA')], ctx())[0].categoriaId).toBeNull()
  })

  it('regra ignora categoria desativada ou que não existe', () => {
    const semTarifa = categorias.map((c) => (c.nome === 'Tarifas bancárias' ? { ...c, ativo: false } : c))
    expect(sugerir([tr('a', '2026-10-05', -25, 'TARIFA')], ctx({ categorias: semTarifa }))[0].categoriaId).toBeNull()
  })

  it('reconhece transferência entre contas próprias e saque', () => {
    const [inter, mesma, saque, normal] = sugerir(
      [
        tr('a', '2026-10-05', -500, 'TED ENVIADA BANCO INTER'),
        tr('b', '2026-10-05', 300, 'TRANSF MESMA TITULARIDADE'),
        tr('c', '2026-10-05', -200, 'SAQUE 24H'),
        tr('d', '2026-10-05', -20, 'PADARIA'),
      ],
      ctx(),
    )
    expect([inter.talvezTransferencia, inter.contaTransferenciaId, inter.categoriaId]).toEqual([true, 'inter', null])
    expect([mesma.talvezTransferencia, mesma.contaTransferenciaId]).toEqual([true, null])
    expect([saque.talvezTransferencia, saque.contaTransferenciaId]).toEqual([true, 'caixa'])
    expect(normal.talvezTransferencia).toBe(false)
  })

  it('aguenta 2.000 transações e 5.000 lançamentos rápido', () => {
    const transacoes = Array.from({ length: 2000 }, (_, i) => tr(`f${i}`, `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, -(i % 300) - 1, `COMPRA LOJA ${i % 50} MERCADO`))
    const lancamentos = Array.from({ length: 5000 }, (_, i) =>
      lanc({ id: `l${i}`, data: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, valor: (i % 300) + 1, descricao: `LOJA ${i % 50} MERCADO`, categoria_id: cat('Embalagens'), ofx_fitid: i % 2 ? `x${i}` : null }),
    )
    const t0 = performance.now()
    const linhas = sugerir(transacoes, ctx({ lancamentos }))
    expect(linhas).toHaveLength(2000)
    expect(performance.now() - t0).toBeLessThan(1500)
  })
})

describe('paraLancamentos', () => {
  it('monta saída com título, entrada com categoria e transferências nos dois sentidos', () => {
    const r = paraLancamentos(
      [
        { transacao: tr('a', '2026-10-09', -1500, 'PIX ENVIADO JOSE IMOVEIS'), categoriaId: 'c1', tituloId: 't1' },
        { transacao: tr('b', '2026-10-10', 120.456, 'IFOOD REPASSE'), categoriaId: 'c2', tituloId: null },
        { transacao: tr('c', '2026-10-11', -500, 'TED BANCO INTER'), categoriaId: 'c3', tituloId: 't9', contaTransferenciaId: 'inter' },
        { transacao: tr('d', '2026-10-12', 300, 'TRANSF MESMA TITULARIDADE'), categoriaId: null, tituloId: null, contaTransferenciaId: 'inter' },
      ],
      CONTA,
    )
    expect(r[0]).toEqual({
      tipo: 'saida',
      data: '2026-10-09',
      descricao: 'PIX Enviado Jose Imoveis',
      pessoa: 'Jose Imoveis',
      valor: 1500,
      conta_id: CONTA,
      conta_destino_id: null,
      categoria_id: 'c1',
      titulo_id: 't1',
      ofx_fitid: 'a',
      forma_pagamento: 'Pix',
      observacao: null,
    })
    expect(r[1]).toMatchObject({ tipo: 'entrada', valor: 120.46, categoria_id: 'c2', forma_pagamento: 'iFood', pessoa: null })
    expect(r[2]).toMatchObject({ tipo: 'transferencia', conta_id: CONTA, conta_destino_id: 'inter', categoria_id: null, titulo_id: null, ofx_fitid: 'c' })
    expect(r[3]).toMatchObject({ tipo: 'transferencia', conta_id: 'inter', conta_destino_id: CONTA, ofx_fitid: 'd' })
  })

  it('usa a forma "Cartão de crédito" em fatura e respeita o que a pessoa editou', () => {
    const [l] = paraLancamentos(
      [{ transacao: tr('a', '2026-10-01', -59.9, 'IFOOD *IFOOD'), categoriaId: null, tituloId: null, descricao: 'Lanche', pessoa: null }],
      CONTA,
      { cartaoCredito: true },
    )
    expect(l).toMatchObject({ descricao: 'Lanche', pessoa: null, forma_pagamento: 'Cartão de crédito', categoria_id: null })
  })
})
