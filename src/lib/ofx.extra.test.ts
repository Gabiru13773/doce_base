import { describe, expect, it } from 'vitest'
import { lerDataOfx, lerOfx, lerValorOfx } from './ofx'

// Testes extras da revisão adversarial (defeitos encontrados, já corrigidos).

const ofx = (trns: string) => `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>0756<ACCTID>12345</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261001<DTEND>20261031
${trns}
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

const trn = (fitid: string, data: string, valor: string, memo: string) =>
  `<STMTTRN><TRNTYPE>OTHER<DTPOSTED>${data}<TRNAMT>${valor}<FITID>${fitid}<MEMO>${memo}</STMTTRN>`

describe('valores e datas', () => {
  it('sinais e separadores', () => {
    expect(lerValorOfx('-1.234,56')).toBe(-1234.56)
    expect(lerValorOfx('1,234.56')).toBe(1234.56)
    expect(lerValorOfx('12.50-')).toBe(-12.5)
    expect(lerValorOfx('-5-')).toBe(5) // sinal na frente e atrás: menos com menos
    expect(lerValorOfx('abc')).toBeNaN()
  })
  it('data com fuso fica como o banco escreveu', () => {
    expect(lerDataOfx('20261031235959[-3:BRT]')).toBe('2026-10-31')
    expect(lerDataOfx('20260230')).toBeUndefined()
  })
})

describe('FITID que o banco repete', () => {
  it('dentro do mesmo arquivo, cada transação fica com um FITID diferente', () => {
    const e = lerOfx(ofx(trn('0', '20261001', '-10.00', 'PADARIA') + trn('0', '20261002', '-20.00', 'MERCADO')))
    expect(new Set(e.transacoes.map((t) => t.fitid)).size).toBe(2)
  })

  // Bancos que mandam FITID fixo/sequencial ("0", "1", "2"… reiniciando a cada arquivo):
  // antes, a 1ª transação de cada arquivo ficava com o FITID cru e dois extratos de meses
  // diferentes produziam o mesmo FITID. Agora todas as cópias de um FITID repetido no arquivo
  // ganham o sufixo pelo conteúdo.
  it('FITID repetido no arquivo não é confiável: transações diferentes de arquivos diferentes não colidem', () => {
    const setembro = lerOfx(ofx(trn('0', '20260901', '-10.00', 'PADARIA') + trn('0', '20260902', '-20.00', 'MERCADO')))
    const outubro = lerOfx(ofx(trn('0', '20261001', '-99.00', 'ALUGUEL') + trn('0', '20261002', '-5.00', 'TARIFA')))
    const usadosSetembro = new Set(setembro.transacoes.map((t) => t.fitid))
    expect(outubro.transacoes.some((t) => usadosSetembro.has(t.fitid))).toBe(false)
  })
})
