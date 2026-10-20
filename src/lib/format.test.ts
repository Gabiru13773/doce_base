import { describe, expect, it } from 'vitest'
import { lerNumero, moeda, paraCampo } from './format'

describe('lerNumero', () => {
  it('aceita vírgula, ponto e milhar', () => {
    expect(lerNumero('6,50')).toBe(6.5)
    expect(lerNumero('1.234,5')).toBe(1234.5)
    expect(lerNumero('6.5')).toBe(6.5)
    expect(lerNumero('1.500')).toBe(1500)
    expect(lerNumero('2.000.000')).toBe(2000000)
    expect(lerNumero('1.50')).toBe(1.5)
    expect(lerNumero('-1.200')).toBe(-1200)
    expect(lerNumero('395')).toBe(395)
    expect(lerNumero('R$ 12,90')).toBe(12.9)
  })
  it('texto inválido é NaN', () => {
    expect(lerNumero('')).toBeNaN()
    expect(lerNumero('abc')).toBeNaN()
  })
})

describe('moeda e paraCampo', () => {
  it('formata em reais', () => {
    expect(moeda(1234.5).replace(/\s/g, ' ')).toBe('R$ 1.234,50')
  })
  it('número para campo', () => {
    expect(paraCampo(6.5)).toBe('6,5')
    expect(paraCampo(null)).toBe('')
  })
})
