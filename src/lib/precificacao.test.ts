import { describe, expect, it } from 'vitest'
import { arredondarPreco, custoMaoDeObra, margemReal, precoPorMarkupDivisor } from './precificacao'

const cfg = { pctCustosFixos: 20, pctTaxas: 5, pctMargem: 25 }

describe('precoPorMarkupDivisor', () => {
  it('custo R$ 30 com 20% fixos + 5% taxas + 25% margem → R$ 60', () => {
    expect(precoPorMarkupDivisor(30, cfg)).toBeCloseTo(60, 9)
  })
  it('percentuais somando 100% ou mais é impossível', () => {
    expect(precoPorMarkupDivisor(30, { pctCustosFixos: 50, pctTaxas: 10, pctMargem: 40 })).toBeNull()
  })
})

describe('custoMaoDeObra', () => {
  it('90 minutos a R$ 20/h → R$ 30', () => {
    expect(custoMaoDeObra(90, 20)).toBe(30)
  })
  it('sem tempo não há custo', () => {
    expect(custoMaoDeObra(0, 20)).toBe(0)
  })
})

describe('arredondarPreco', () => {
  it('termina em ,90 sem baixar o preço', () => {
    expect(arredondarPreco(12.31, 'centavos90')).toBe(12.9)
    expect(arredondarPreco(12.95, 'centavos90')).toBe(13.9)
    expect(arredondarPreco(12.9, 'centavos90')).toBe(12.9)
  })
  it('meio real e real inteiro', () => {
    expect(arredondarPreco(12.01, 'meio_real')).toBe(12.5)
    expect(arredondarPreco(12.51, 'meio_real')).toBe(13)
    expect(arredondarPreco(12.01, 'real')).toBe(13)
  })
  it('ignora ruído de ponto flutuante', () => {
    expect(arredondarPreco(30 / 0.5 + 1e-12, 'real')).toBe(60)
  })
})

describe('margemReal', () => {
  it('no preço sugerido, a margem real é a desejada', () => {
    const { pctMargem, lucro } = margemReal(60, 30, cfg)
    expect(pctMargem).toBeCloseTo(25, 9)
    expect(lucro).toBeCloseTo(15, 9)
  })
  it('preço abaixo do custo dá margem negativa', () => {
    expect(margemReal(25, 30, cfg).pctMargem).toBeLessThan(0)
  })
})
