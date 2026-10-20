import { describe, expect, it } from 'vitest'
import { baixasPorTitulo, parcelar, saldoConta, situacaoTitulo, somarDias, somarMeses, type LancamentoCalc } from './financeiro'

const l = (p: Partial<LancamentoCalc>): LancamentoCalc => ({
  id: Math.random().toString(),
  tipo: 'entrada',
  data: '2026-10-10',
  conta_id: 'nu',
  conta_destino_id: null,
  valor: 0,
  titulo_id: null,
  ...p,
})

describe('saldoConta', () => {
  const conta = { id: 'nu', saldo_inicial: 100, saldo_em: '2026-10-01' }
  const movs = [
    l({ tipo: 'entrada', valor: 50 }),
    l({ tipo: 'saida', valor: 30.1 }),
    l({ tipo: 'transferencia', valor: 20, conta_destino_id: 'caixa' }),
    l({ tipo: 'transferencia', valor: 5, conta_id: 'caixa', conta_destino_id: 'nu' }),
    l({ tipo: 'entrada', valor: 999, data: '2026-09-30' }), // antes do saldo inicial
    l({ tipo: 'entrada', valor: 1, conta_id: 'outra' }),
  ]
  it('soma entradas, tira saídas e trata transferências nos dois lados', () => {
    expect(saldoConta(conta, movs)).toBe(104.9)
    expect(saldoConta({ id: 'caixa', saldo_inicial: 0, saldo_em: '2026-01-01' }, movs)).toBe(15)
  })
  it('saldo até uma data', () => {
    expect(saldoConta(conta, [...movs, l({ valor: 10, data: '2026-10-20' })], '2026-10-15')).toBe(104.9)
  })
})

describe('situacaoTitulo', () => {
  const t = { id: 't', tipo: 'pagar' as const, valor: 100, vencimento: '2026-10-10' }
  it('aberto, vence hoje, atrasado, parcial e pago', () => {
    expect(situacaoTitulo(t, new Map(), '2026-10-01').situacao).toBe('aberto')
    expect(situacaoTitulo(t, new Map(), '2026-10-10').situacao).toBe('vence_hoje')
    expect(situacaoTitulo(t, new Map(), '2026-10-11').situacao).toBe('atrasado')
    const parcial = baixasPorTitulo([l({ tipo: 'saida', valor: 40, titulo_id: 't' })])
    expect(situacaoTitulo(t, parcial, '2026-10-01')).toMatchObject({ situacao: 'parcial', pago: 40, falta: 60 })
    const pago = baixasPorTitulo([
      l({ tipo: 'saida', valor: 40, titulo_id: 't', data: '2026-10-02' }),
      l({ tipo: 'saida', valor: 60, titulo_id: 't', data: '2026-10-05' }),
    ])
    expect(situacaoTitulo(t, pago, '2026-12-01')).toMatchObject({ situacao: 'pago', pagoEm: '2026-10-05' })
  })
})

describe('datas e parcelas', () => {
  it('somarMeses segura o fim do mês', () => {
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28')
    expect(somarMeses('2028-01-31', 1)).toBe('2028-02-29')
    expect(somarMeses('2026-11-15', 3)).toBe('2027-02-15')
    expect(somarDias('2026-12-30', 3)).toBe('2027-01-02')
  })
  it('parcelar fecha a soma nos centavos', () => {
    const p = parcelar(100, 3, '2026-10-05')
    expect(p.map((x) => x.valor)).toEqual([33.34, 33.33, 33.33])
    expect(p.map((x) => x.parcela)).toEqual(['1/3', '2/3', '3/3'])
    expect(p[2].vencimento).toBe('2026-12-05')
    expect(parcelar(50, 1, '2026-10-05')[0].parcela).toBeNull()
  })
})
