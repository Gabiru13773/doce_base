import { describe, expect, it } from 'vitest'
import { PLANO_PADRAO } from '../modules/financeiro/planoPadrao'
import { folgaPdv, paraLancamentos, sugerir, type ContextoConciliacao, type LinhaImportacao } from './conciliacao'
import type { TransacaoOfx } from './ofx'

// Recebimento das vendas do PDV no extrato: o fechamento do caixa cria uma conta a receber por
// forma e por dia (valor líquido); o banco paga Pix por cliente, cartão de uma vez e iFood por semana.

const categorias = PLANO_PADRAO.map((c, i) => ({ id: `cat${i}`, tipo: c.tipo, nome: c.nome, ativo: true }))
const CONTA = 'nubank'

type Lanc = ContextoConciliacao['lancamentos'][number]
type Tit = ContextoConciliacao['titulos'][number]

const lanc = (l: Partial<Lanc> & Pick<Lanc, 'id' | 'data' | 'valor'>): Lanc => ({
  tipo: 'entrada',
  descricao: 'x',
  pessoa: null,
  categoria_id: null,
  conta_id: CONTA,
  conta_destino_id: null,
  titulo_id: null,
  ofx_fitid: null,
  ...l,
})

const tr = (fitid: string, data: string, valor: number, descricao: string): TransacaoOfx => ({
  fitid,
  data,
  valor,
  tipo: valor < 0 ? 'DEBIT' : 'CREDIT',
  descricao,
})

const pdv = (id: string, forma: NonNullable<Tit['forma_pdv']>, valor: number, dia: string, vencimento = dia): Tit => ({
  id,
  tipo: 'receber',
  descricao: `${forma} — vendas ${dia.slice(8, 10)}/${dia.slice(5, 7)}`,
  pessoa: null,
  categoria_id: 'cat-vendas',
  valor,
  emissao: dia,
  vencimento,
  fechamento_id: `f-${dia}`,
  forma_pdv: forma,
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
    ],
    hoje: '2026-10-25',
    ...over,
  }
}

/** O que a tela grava ao confirmar as sugestões como vieram. */
function confirmar(linhas: LinhaImportacao[]) {
  return paraLancamentos(
    linhas
      .filter((l) => !l.jaImportada)
      .map((l) => ({
        transacao: l.transacao,
        categoriaId: l.categoriaId,
        tituloId: l.titulo?.tituloId ?? null,
        titulosPdv: l.pdv?.tipo === 'soma' ? l.pdv.titulos : null,
      })),
    CONTA,
  )
}

describe('Pix: um crédito por cliente baixa parte da conta do dia', () => {
  const PIX21 = pdv('pix21', 'pix', 100, '2026-10-21')

  it('vários Pix dividem a conta, sem passar do que falta', () => {
    const linhas = sugerir(
      [
        tr('a', '2026-10-21', 30, 'PIX RECEBIDO - MARIA'),
        tr('b', '2026-10-21', 45.5, 'Transferência recebida pelo Pix - JOAO'),
        tr('c', '2026-10-22', 24.5, 'PIX RECEBIDO - ANA'),
        tr('d', '2026-10-22', 10, 'PIX RECEBIDO - PEDRO'), // já passaria dos R$ 100
      ],
      ctx({ titulos: [PIX21] }),
    )
    expect(linhas.slice(0, 3).map((l) => l.titulo?.tituloId)).toEqual(['pix21', 'pix21', 'pix21'])
    expect(linhas.slice(0, 3).map((l) => l.titulo?.confianca)).toEqual(['media', 'media', 'media'])
    expect(linhas.slice(0, 3).map((l) => [l.pdv?.tipo, l.pdv?.titulos[0].falta, l.pdv?.restante])).toEqual([
      ['parcial', 100, 70],
      ['parcial', 70, 24.5],
      ['parcial', 24.5, 0],
    ])
    expect(linhas[0].pdv?.titulos[0].dia).toBe('2026-10-21')
    expect(linhas[0].categoriaId).toBe('cat-vendas')
    expect(linhas[3].titulo).toBeNull()
    expect(linhas[3].pdv).toBeNull()
    const soma = confirmar(linhas)
      .filter((l) => l.titulo_id === 'pix21')
      .reduce((s, l) => s + l.valor, 0)
    expect(soma).toBeCloseTo(100, 2)
  })

  it('segue a ordem das datas, não a do arquivo', () => {
    const linhas = sugerir(
      [tr('tarde', '2026-10-22', 60, 'PIX RECEBIDO B'), tr('cedo', '2026-10-21', 60, 'PIX RECEBIDO A')],
      ctx({ titulos: [PIX21] }),
    )
    expect(linhas[1].titulo?.tituloId).toBe('pix21')
    expect(linhas[0].titulo).toBeNull()
  })

  it('desconta o que já foi recebido e escolhe o dia mais perto', () => {
    const PIX22 = pdv('pix22', 'pix', 50, '2026-10-22')
    const linhas = sugerir(
      [tr('a', '2026-10-22', 40, 'PIX RECEBIDO X'), tr('b', '2026-10-22', 15, 'PIX RECEBIDO Y')],
      ctx({ titulos: [PIX21, PIX22], lancamentos: [lanc({ id: 'b1', data: '2026-10-21', valor: 80, titulo_id: 'pix21' })] }),
    )
    expect(linhas[0].titulo?.tituloId).toBe('pix22') // o do próprio dia
    expect(linhas[1].titulo?.tituloId).toBe('pix21') // no 22 só sobram R$ 10; o 21 ainda tem R$ 20
    expect(linhas[1].pdv?.titulos[0].falta).toBe(20)
  })

  it('fora da janela (1 dia antes a 3 depois), sem "Pix" no texto ou transferência: nada', () => {
    const linhas = sugerir(
      [
        tr('antes', '2026-10-19', 10, 'PIX RECEBIDO'),
        tr('depois', '2026-10-25', 10, 'PIX RECEBIDO'),
        tr('ted', '2026-10-21', 10, 'TED RECEBIDA FULANO'),
        tr('minha', '2026-10-21', 10, 'PIX TRANSF MESMA TITULARIDADE'),
      ],
      ctx({ titulos: [PIX21] }),
    )
    expect(linhas.map((l) => l.pdv)).toEqual([null, null, null, null])
  })

  it('saída nunca baixa conta do PDV', () => {
    const [l] = sugerir([tr('a', '2026-10-21', -30, 'PIX ENVIADO')], ctx({ titulos: [PIX21] }))
    expect([l.titulo, l.pdv]).toEqual([null, null])
  })
})

describe('Cartão: um crédito ≈ a conta do dia', () => {
  it('aceita diferença de até R$ 0,50 ou 1% e mostra a diferença', () => {
    const DEB = pdv('deb', 'debito', 487.3, '2026-10-21', '2026-10-22')
    const CRED = pdv('cred', 'credito', 1200, '2026-10-21', '2026-10-21') // 1% = R$ 12
    const linhas = sugerir(
      [tr('a', '2026-10-23', 487.0, 'CRED STONE'), tr('b', '2026-10-26', 1210.5, 'REDE CREDITO VENDAS')],
      ctx({ titulos: [DEB, CRED] }),
    )
    expect(linhas[0].titulo).toMatchObject({ tituloId: 'deb', confianca: 'media', dias: 1 })
    expect(linhas[0].pdv).toMatchObject({ tipo: 'aproximado', forma: 'debito', diferenca: -0.3, restante: 0.3 })
    expect(linhas[1].titulo?.tituloId).toBe('cred')
    expect(linhas[1].pdv).toMatchObject({ tipo: 'aproximado', diferenca: 10.5, restante: -10.5 })
    // a baixa usa o valor do banco
    expect(confirmar(linhas).map((l) => [l.titulo_id, l.valor])).toEqual([
      ['deb', 487],
      ['cred', 1210.5],
    ])
  })

  it('cada conta vai para um crédito só: o mais perto do valor', () => {
    const DEB = pdv('deb', 'debito', 300, '2026-10-21')
    const linhas = sugerir([tr('a', '2026-10-22', 299.6, 'CIELO'), tr('b', '2026-10-22', 300.1, 'CIELO')], ctx({ titulos: [DEB] }))
    expect(linhas.map((l) => l.titulo?.tituloId ?? null)).toEqual([null, 'deb'])
  })

  it('diferença grande ou data fora (2 dias antes a 5 depois): nada', () => {
    const DEB = pdv('deb', 'debito', 30, '2026-10-21') // 1% = R$ 0,30: vale a folga de R$ 0,50
    const linhas = sugerir(
      [tr('a', '2026-10-22', 29.4, 'CIELO'), tr('b', '2026-10-18', 30.2, 'CIELO'), tr('c', '2026-10-27', 30.2, 'CIELO')],
      ctx({ titulos: [DEB] }),
    )
    expect(linhas.map((l) => l.pdv)).toEqual([null, null, null])
    expect(sugerir([tr('a', '2026-10-26', 30.5, 'CIELO')], ctx({ titulos: [DEB] }))[0].pdv?.tipo).toBe('aproximado')
    expect(folgaPdv('debito', 30)).toBe(0.5)
    expect(folgaPdv('debito', 300)).toBe(3)
    expect(folgaPdv('credito', 2000)).toBe(20)
    expect(folgaPdv('pix', 2000)).toBe(0)
  })

  it('valor exato continua pelo caminho normal (alta certeza com o texto)', () => {
    const DEB = { ...pdv('deb', 'debito', 300, '2026-10-21'), descricao: 'Cartão de débito — vendas 21/10' }
    const [l] = sugerir([tr('a', '2026-10-21', 300, 'CARTAO DEBITO VENDAS')], ctx({ titulos: [DEB] }))
    expect(l.titulo?.tituloId).toBe('deb')
    expect(l.pdv).toBeNull()
  })
})

describe('iFood: o repasse da semana = soma de vários dias', () => {
  const dias = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']
  const IFOOD = dias.map((d, i) => pdv(`if${i}`, 'ifood', [80.1, 95.25, 60, 120.4, 70][i], d, d))

  it('acha os dias seguidos cuja soma bate (± R$ 0,05) e baixa todos', () => {
    // 95,25 + 60 + 120,40 = 275,65; o banco pagou 275,62
    const [l] = sugerir([tr('rep', '2026-10-20', 275.62, 'IFOOD.COM AGENCIA DE RESTAURANTES')], ctx({ titulos: IFOOD }))
    expect(l.titulo).toBeNull()
    expect(l.pdv?.tipo).toBe('soma')
    expect(l.pdv?.confianca).toBe('media')
    expect(l.pdv?.titulos.map((t) => [t.tituloId, t.valor])).toEqual([
      ['if1', 95.25],
      ['if2', 60],
      ['if3', 120.37],
    ])
    expect(l.pdv?.diferenca).toBeCloseTo(-0.03, 2)
    expect(l.talvezTransferencia).toBe(false)
  })

  it('a semana inteira, e o desconto do que já foi recebido', () => {
    const ja = [lanc({ id: 'p', data: '2026-10-14', valor: 30.1, titulo_id: 'if0' })] // if0: falta 50
    const total = 50 + 95.25 + 60 + 120.4 + 70
    const [l] = sugerir([tr('rep', '2026-10-21', total, 'IFOOD')], ctx({ titulos: IFOOD, lancamentos: ja }))
    expect(l.pdv?.titulos.map((t) => t.tituloId)).toEqual(['if0', 'if1', 'if2', 'if3', 'if4'])
    expect(l.pdv?.titulos[0].valor).toBe(50)
  })

  it('sem "iFood" no texto, só sugere (pouca certeza)', () => {
    const [l] = sugerir([tr('rep', '2026-10-20', 155.25, 'CREDITO EM CONTA')], ctx({ titulos: IFOOD }))
    expect(l.pdv).toMatchObject({ tipo: 'soma', confianca: 'baixa' })
  })

  it('não junta dias fora de sequência, nem uma conta só, nem fora da data', () => {
    // 80,10 + 60 pula o dia 14
    const linhas = sugerir(
      [
        tr('pula', '2026-10-20', 140.1, 'IFOOD'),
        tr('uma', '2026-10-20', 95.27, 'IFOOD'), // uma conta só com diferença: não é soma
        tr('tarde', '2026-11-05', 155.25, 'IFOOD'), // mais de 10 dias depois do último vencimento
      ],
      ctx({ titulos: IFOOD }),
    )
    expect(linhas.map((l) => l.pdv)).toEqual([null, null, null])
  })

  it('dois repasses no mesmo arquivo não usam o mesmo dia', () => {
    const linhas = sugerir(
      [tr('r1', '2026-10-17', 175.35, 'IFOOD'), tr('r2', '2026-10-20', 250.4, 'IFOOD')],
      ctx({ titulos: IFOOD }),
    )
    expect(linhas[0].pdv?.titulos.map((t) => t.tituloId)).toEqual(['if0', 'if1'])
    expect(linhas[1].pdv?.titulos.map((t) => t.tituloId)).toEqual(['if2', 'if3', 'if4'])
  })

  it('grava um lançamento por conta: FITID, FITID#2, #3; a soma bate com o banco', () => {
    const linhas = sugerir([tr('rep', '2026-10-20', 275.62, 'IFOOD')], ctx({ titulos: IFOOD }))
    const lista = confirmar(linhas)
    expect(lista.map((l) => [l.ofx_fitid, l.titulo_id, l.valor, l.tipo, l.ofx_conta_id])).toEqual([
      ['rep', 'if1', 95.25, 'entrada', CONTA],
      ['rep#2', 'if2', 60, 'entrada', CONTA],
      ['rep#3', 'if3', 120.37, 'entrada', CONTA],
    ])
    expect(Math.round(lista.reduce((s, l) => s + l.valor, 0) * 100)).toBe(27562)
  })

  it('paraLancamentos: o último fica com o arredondamento, mesmo se os valores vierem trocados', () => {
    const lista = paraLancamentos(
      [{ transacao: tr('x', '2026-10-20', 100, 'IFOOD'), categoriaId: 'c', tituloId: 'ignorado', titulosPdv: [{ tituloId: 'a', valor: 33.33 }, { tituloId: 'b', valor: 33.33 }, { tituloId: 'c', valor: 33.33 }] }],
      CONTA,
    )
    expect(lista.map((l) => [l.ofx_fitid, l.titulo_id, l.valor, l.categoria_id])).toEqual([
      ['x', 'a', 33.33, 'c'],
      ['x#2', 'b', 33.33, 'c'],
      ['x#3', 'c', 33.34, 'c'],
    ])
    expect(() =>
      paraLancamentos([{ transacao: tr('x', '2026-10-20', 10, 'IFOOD'), categoriaId: null, tituloId: null, titulosPdv: [{ tituloId: 'a', valor: 10 }, { tituloId: 'b', valor: 5 }] }], CONTA),
    ).toThrow()
  })
})

describe('importar de novo', () => {
  const IFOOD = ['2026-10-13', '2026-10-14', '2026-10-15'].map((d, i) => pdv(`if${i}`, 'ifood', 100, d))

  it('reconhece o repasse dividido pelo FITID original, sem acusar as partes', () => {
    const arquivo = [tr('rep', '2026-10-20', 300.02, 'IFOOD'), tr('outra', '2026-10-20', 100, 'PIX RECEBIDO')]
    const primeira = sugerir(arquivo, ctx({ titulos: IFOOD }))
    const gravados: Lanc[] = confirmar(primeira).map((d, i) => ({ ...d, id: `l${i}` }))
    expect(gravados.map((l) => l.ofx_fitid)).toEqual(['rep', 'rep#2', 'rep#3', 'outra'])

    const segunda = sugerir(arquivo, ctx({ titulos: IFOOD, lancamentos: gravados }))
    expect(segunda.map((l) => [l.jaImportada, l.possivelDuplicata, l.transacao.fitid])).toEqual([
      [true, false, 'rep'],
      [true, false, 'outra'],
    ])
    // e as contas já estão pagas: nada mais a sugerir
    expect(segunda[0].pdv).toBeNull()
  })

  it('num extrato de outro período, as partes não viram "parece repetida"', () => {
    const gravados: Lanc[] = [
      lanc({ id: 'a', data: '2026-10-20', valor: 100, ofx_fitid: 'rep', ofx_conta_id: CONTA, titulo_id: 'if0' }),
      lanc({ id: 'b', data: '2026-10-20', valor: 100, ofx_fitid: 'rep#2', ofx_conta_id: CONTA, titulo_id: 'if1' }),
    ]
    // outro crédito de R$ 100 no mesmo dia, com outro FITID: não é repetição de uma parte
    const [l] = sugerir([tr('novo', '2026-10-20', 100, 'TED RECEBIDA')], ctx({ lancamentos: gravados }))
    expect(l.possivelDuplicata).toBe(false)
    // mas o total (R$ 200) no mesmo dia, com outro FITID, ainda é avisado
    const [t] = sugerir([tr('novo', '2026-10-20', 200, 'IFOOD')], ctx({ lancamentos: gravados }))
    expect(t.duplicataDe).toBe('a')
  })

  it('Pix já importados contam no que falta', () => {
    const PIX = pdv('pix21', 'pix', 100, '2026-10-21')
    const arquivo = [tr('a', '2026-10-21', 60, 'PIX RECEBIDO A'), tr('b', '2026-10-21', 40, 'PIX RECEBIDO B')]
    const gravados: Lanc[] = confirmar(sugerir(arquivo, ctx({ titulos: [PIX] }))).map((d, i) => ({ ...d, id: `l${i}` }))
    expect(gravados.map((l) => l.titulo_id)).toEqual(['pix21', 'pix21'])
    const de_novo = sugerir([...arquivo, tr('c', '2026-10-21', 5, 'PIX RECEBIDO C')], ctx({ titulos: [PIX], lancamentos: gravados }))
    expect(de_novo.map((l) => l.jaImportada)).toEqual([true, true, false])
    expect(de_novo[2].pdv).toBeNull() // a conta do dia já foi toda recebida
  })
})

describe('não muda nada fora do PDV', () => {
  it('conta a receber comum não recebe Pix em parte, cartão aproximado nem soma', () => {
    const comum = (id: string, valor: number, vencimento: string): Tit => ({
      id,
      tipo: 'receber',
      descricao: 'Encomenda',
      pessoa: 'Ana',
      categoria_id: null,
      valor,
      vencimento,
    })
    const titulos = [comum('enc', 100, '2026-10-21'), comum('e1', 50, '2026-10-14'), comum('e2', 50, '2026-10-15')]
    const linhas = sugerir(
      [tr('a', '2026-10-21', 30, 'PIX RECEBIDO'), tr('b', '2026-10-21', 99.8, 'CIELO'), tr('c', '2026-10-20', 100, 'IFOOD')],
      ctx({ titulos }),
    )
    expect(linhas.map((l) => l.pdv)).toEqual([null, null, null])
    expect(linhas[0].titulo).toBeNull()
    expect(linhas[1].titulo).toBeNull()
    // o crédito de R$ 100 casa com a encomenda de R$ 100 pelo valor exato (comportamento de antes)
    expect(linhas[2].titulo?.tituloId).toBe('enc')
  })

  it('conta a receber do PDV com valor exato vai pelo caminho de antes, e tem prioridade', () => {
    const PIX = pdv('pix21', 'pix', 100, '2026-10-21')
    const linhas = sugerir([tr('a', '2026-10-21', 100, 'PIX RECEBIDO'), tr('b', '2026-10-21', 20, 'PIX RECEBIDO')], ctx({ titulos: [PIX] }))
    expect(linhas[0].titulo?.tituloId).toBe('pix21')
    expect(linhas[0].pdv).toBeNull()
    expect(linhas[1].titulo).toBeNull() // a conta já foi toda para a outra linha
  })
})
