import { describe, expect, it } from 'vitest'
import { custoAmigavel, custoPorUnidadeBase } from './custos'
import { paraBase } from './unidades'

describe('unidades', () => {
  it('converte unidades de compra para a base', () => {
    expect(paraBase(1, 'kg')).toBe(1000)
    expect(paraBase(2, 'l')).toBe(2000)
    expect(paraBase(1, 'dz')).toBe(12)
    expect(paraBase(395, 'g')).toBe(395)
  })
})

describe('custoPorUnidadeBase', () => {
  it('leite condensado 395 g por R$ 6,50', () => {
    expect(custoPorUnidadeBase({ qtdCompra: 395, unidadeCompra: 'g', precoCompra: 6.5 })).toBeCloseTo(0.016456, 6)
  })
  it('farinha 5 kg por R$ 25 → R$ 0,005/g', () => {
    expect(custoPorUnidadeBase({ qtdCompra: 5, unidadeCompra: 'kg', precoCompra: 25 })).toBeCloseTo(0.005, 9)
  })
  it('ovos: 1 dúzia por R$ 12 → R$ 1/un', () => {
    expect(custoPorUnidadeBase({ qtdCompra: 1, unidadeCompra: 'dz', precoCompra: 12 })).toBe(1)
  })
  it('quantidade zero ou inválida retorna 0', () => {
    expect(custoPorUnidadeBase({ qtdCompra: 0, unidadeCompra: 'g', precoCompra: 10 })).toBe(0)
    expect(custoPorUnidadeBase({ qtdCompra: NaN, unidadeCompra: 'g', precoCompra: 10 })).toBe(0)
  })
})

describe('custoAmigavel', () => {
  it('mostra por kg, L ou un', () => {
    expect(custoAmigavel({ qtdCompra: 395, unidadeCompra: 'g', precoCompra: 6.5 })).toEqual({ valor: expect.closeTo(16.4557, 3), por: 'kg' })
    expect(custoAmigavel({ qtdCompra: 1, unidadeCompra: 'l', precoCompra: 5 })).toEqual({ valor: 5, por: 'L' })
    expect(custoAmigavel({ qtdCompra: 50, unidadeCompra: 'un', precoCompra: 25 })).toEqual({ valor: 0.5, por: 'un' })
  })
})
