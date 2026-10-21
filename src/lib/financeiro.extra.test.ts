import { describe, expect, it } from 'vitest'
import { baixasPorTitulo, parcelar, saldoConta, situacaoTitulo, type LancamentoCalc, type TituloCalc } from './financeiro'
import { lerNumero } from './format'

// Testes extras da revisão adversarial (defeitos encontrados, já corrigidos).

const l = (p: Partial<LancamentoCalc>): LancamentoCalc => ({
  id: Math.random().toString(),
  tipo: 'saida',
  data: '2026-10-10',
  conta_id: 'nu',
  conta_destino_id: null,
  valor: 0,
  titulo_id: null,
  ...p,
})

const ALUGUEL: TituloCalc = { id: 't1', tipo: 'pagar', valor: 1500, vencimento: '2026-10-10' }

describe('saldo com muitos lançamentos', () => {
  it('soma 10 mil lançamentos de centavos sem erro de arredondamento', () => {
    const ls = Array.from({ length: 10_000 }, (_, i) => l({ tipo: i % 2 ? 'entrada' : 'saida', valor: i % 2 ? 0.1 : 0.07 }))
    // 5000 × 0,10 − 5000 × 0,07 = 150,00
    expect(saldoConta({ id: 'nu', saldo_inicial: 0, saldo_em: '2026-01-01' }, ls)).toBe(150)
  })
})

describe('baixa ligada a título', () => {
  it('baixa normal (saída num título a pagar) quita o título', () => {
    const b = baixasPorTitulo([l({ tipo: 'saida', valor: 1500, titulo_id: 't1' })], [ALUGUEL])
    expect(situacaoTitulo(ALUGUEL, b, '2026-10-20').situacao).toBe('pago')
  })

  // Antes: LancamentoFormPage deixava trocar Saída ↔ Entrada num lançamento que é baixa, e uma
  // ENTRADA de R$ 1.500 ligada a um título A PAGAR contava como pagamento dele. Agora o tipo da
  // baixa é fixo na tela, o banco recusa (gatilho) e baixasPorTitulo só conta o sentido certo.
  it('entrada ligada a uma conta a pagar não quita o título', () => {
    const b = baixasPorTitulo([l({ tipo: 'entrada', valor: 1500, titulo_id: 't1' })], [ALUGUEL])
    expect(situacaoTitulo(ALUGUEL, b, '2026-10-20').situacao).not.toBe('pago')
  })
})

describe('parcelar valores pequenos', () => {
  // Antes: R$ 0,02 em 3× gerava parcelas de R$ 0,00 (o banco recusava com mensagem genérica;
  // no modo local nasciam contas de R$ 0,00 "pagas"). O formulário recusa e parcelar() nunca gera zero.
  it('nenhuma parcela sai com valor zero', () => {
    expect(parcelar(0.02, 3, '2026-10-10').every((p) => p.valor > 0)).toBe(true)
  })
})

describe('lerNumero (mudança "1.500" → 1500)', () => {
  it('lê milhar e decimal brasileiros', () => {
    expect(lerNumero('1.500')).toBe(1500)
    expect(lerNumero('1.500,50')).toBe(1500.5)
    expect(lerNumero('-1.500')).toBe(-1500)
    expect(lerNumero('-80,00')).toBe(-80)
    expect(lerNumero('R$ 2.000.000')).toBe(2_000_000)
    expect(lerNumero('1.5')).toBe(1.5)
    expect(lerNumero('0.5')).toBe(0.5)
  })

  // No Android, inputMode="decimal" costuma mostrar a tecla "." mesmo em pt-BR. Quem digita
  // "0.500" kg na embalagem de um insumo (ou 0.395 L) agora grava 500 kg: custo por grama
  // 1000× menor e preço de venda errado nas receitas/produtos. Nenhum brasileiro escreve
  // 500 como "0.500", então um primeiro grupo começando por 0 nunca é milhar (corrigido).
  it('"0.500" é meio (não quinhentos)', () => {
    expect(lerNumero('0.500')).toBe(0.5)
  })
  it('"0.395" é 0,395 (não 395)', () => {
    expect(lerNumero('0.395')).toBe(0.395)
  })
})
