import { describe, expect, it } from 'vitest'
import { decodificarOfx, ERRO_NAO_E_OFX, juntarDescricao, lerDataOfx, lerOfx, lerValorOfx } from './ofx'

const CABECALHO_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE
`

// Nubank (conta): SGML, MEMO com o texto completo, FITID em UUID, sem NAME.
const NUBANK = `${CABECALHO_SGML}
<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>20261020000000[-3:BRT]
<LANGUAGE>POR
<FI>
<ORG>NU PAGAMENTOS S.A.
<FID>260
</FI>
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>0260
<BRANCHID>1
<ACCTID>12345678-9
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20261001000000[-3:BRT]
<DTEND>20261019000000[-3:BRT]
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261010000000[-3:BRT]
<TRNAMT>-1500.00
<FITID>6523a1f0-1c2d-4e5f-8a9b-0c1d2e3f4a5b
<MEMO>Transferência enviada pelo Pix - JOSÉ IMÓVEIS LTDA - 12.345.678/0001-90 - BCO DO BRASIL S.A. (0001) Agência: 1234 Conta: 56789-0
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261012000000[-3:BRT]
<TRNAMT>850.00
<FITID>6523a1f0-1c2d-4e5f-8a9b-0c1d2e3f4a5c
<MEMO>Transferência recebida pelo Pix - ANA PAULA SOUZA - •••.123.456-•• - ITAÚ UNIBANCO S.A. (0341) Agência: 100 Conta: 2000-1
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>3250.75
<DTASOF>20261019000000[-3:BRT]
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`

// Itaú: NAME + MEMO, CHECKNUM, vírgula decimal, datas só com dia, CRLF.
const ITAU = `${CABECALHO_SGML}
<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>0341
<BRANCHID>0912
<ACCTID>45678-1
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20261001
<DTEND>20261015
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261003
<TRNAMT>-89,90
<FITID>20261003001
<CHECKNUM>000123
<NAME>PAG BOLETO ENEL
<MEMO>CONTA DE LUZ SET/26
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261005
<TRNAMT>-1.234,56
<FITID>20261005001
<NAME>SISPAG FORNECEDOR
<MEMO>SISPAG FORNECEDOR ATACADAO
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>1.000,00<DTASOF>20261015</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
`.replace(/\n/g, '\r\n')

// Banco do Brasil: FITID repetido para transações diferentes, REFNUM, espaços sobrando.
const BB = `${CABECALHO_SGML}
<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>001
<BRANCHID>3456-7
<ACCTID>98765-4
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20261001120000[-3:BRT]
<DTEND>20261031120000[-3:BRT]
<STMTTRN>
<TRNTYPE>OTHER
<DTPOSTED>20261001120000[-3:BRT]
<TRNAMT>-25.00
<FITID>000000
<REFNUM>100.001
<MEMO>   Tarifa Pacote de   Serviços
</STMTTRN>
<STMTTRN>
<TRNTYPE>OTHER
<DTPOSTED>20261002120000[-3:BRT]
<TRNAMT>-25.00
<FITID>000000
<MEMO>Tarifa Pacote de Serviços
</STMTTRN>
<STMTTRN>
<TRNTYPE>OTHER
<DTPOSTED>20261003120000[-3:BRT]
<TRNAMT>-25.00
<FITID>000000
<MEMO>Tarifa Pacote de Serviços
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`

// Inter: sem FITID, HTML entities, STMTTRN sem fechamento.
const INTER = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:UTF-8
CHARSET:NONE

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>077
<ACCTID>1234567-8
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20261001
<DTEND>20261010
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261004
<TRNAMT>-45.30
<NAME>Compra no debito
<MEMO>PADARIA PÃO &amp; CIA
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261004
<TRNAMT>-45.30
<NAME>Compra no debito
<MEMO>PADARIA PÃO &amp; CIA
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261005
<TRNAMT>120.00
<MEMO>Pix recebido: &quot;Maria&quot;
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`

// Caixa: valores sem sinal, sentido só no TRNTYPE, datas com fuso [-03:EST].
const CAIXA = `${CABECALHO_SGML}
<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>104
<BRANCHID>1234
<ACCTID>000000012345
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20261001000000[-03:EST]
<DTEND>20261031000000[-03:EST]
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261007000000[-03:EST]
<TRNAMT>210.00
<FITID>201007000001
<NAME>DEB AUT SABESP
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261008000000[-03:EST]
<TRNAMT>300.00
<FITID>201008000001
<NAME>CRED PIX MARIA</NAME>
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`

// Sicoob (cooperativa): tudo numa linha só, tags folha com fechamento misturadas.
const SICOOB = `${CABECALHO_SGML}<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL<BANKACCTFROM><BANKID>756<BRANCHID>3001<ACCTID>55555-0</BANKACCTFROM><BANKTRANLIST><DTSTART>20261001<DTEND>20261020<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261015120000[-3:BRT]<TRNAMT>+1520,40<FITID>S1</FITID><NAME>CRED STONE PAGAMENTOS</STMTTRN><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261016<TRNAMT>-80,00<FITID>S2<MEMO>DÉB. CONV. COPEL</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>4.321,00<DTASOF>20261020</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

// OFX 2 em XML (cartão de crédito), com UTF-8.
const XML_CARTAO = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <CREDITCARDMSGSRSV1>
    <CCSTMTTRNRS>
      <TRNUID>1001</TRNUID>
      <CCSTMTRS>
        <CURDEF>BRL</CURDEF>
        <CCACCTFROM>
          <ACCTID>5162********1234</ACCTID>
        </CCACCTFROM>
        <BANKTRANLIST>
          <DTSTART>20260915000000[-3:BRT]</DTSTART>
          <DTEND>20261015000000[-3:BRT]</DTEND>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>20260920000000[-3:BRT]</DTPOSTED>
            <TRNAMT>-59.90</TRNAMT>
            <FITID>cc-1</FITID>
            <NAME>IFOOD *IFOOD</NAME>
            <MEMO></MEMO>
          </STMTTRN>
          <STMTTRN>
            <TRNTYPE>CREDIT</TRNTYPE>
            <DTPOSTED>20261001000000[-3:BRT]</DTPOSTED>
            <TRNAMT>500.00</TRNAMT>
            <FITID>cc-2</FITID>
            <MEMO>Pagamento recebido</MEMO>
          </STMTTRN>
        </BANKTRANLIST>
        <LEDGERBAL>
          <BALAMT>-1234.50</BALAMT>
          <DTASOF>20261015</DTASOF>
        </LEDGERBAL>
      </CCSTMTRS>
    </CCSTMTTRNRS>
  </CREDITCARDMSGSRSV1>
</OFX>`

describe('lerValorOfx', () => {
  it('entende ponto, vírgula, milhar e sinais', () => {
    expect(lerValorOfx('-12.50')).toBe(-12.5)
    expect(lerValorOfx('-12,50')).toBe(-12.5)
    expect(lerValorOfx('1.234,56')).toBe(1234.56)
    expect(lerValorOfx('1,234.56')).toBe(1234.56)
    expect(lerValorOfx('+50')).toBe(50)
    expect(lerValorOfx(' - 7.5 ')).toBe(-7.5)
    expect(lerValorOfx('12.50-')).toBe(-12.5)
    expect(lerValorOfx('.5')).toBe(0.5)
    expect(lerValorOfx('abc')).toBeNaN()
    expect(lerValorOfx(undefined)).toBeNaN()
  })
})

describe('lerDataOfx', () => {
  it('pega a data do jeito que o banco escreveu', () => {
    expect(lerDataOfx('20261015120000[-3:BRT]')).toBe('2026-10-15')
    expect(lerDataOfx('20261015')).toBe('2026-10-15')
    expect(lerDataOfx('20261015000000.000[-03:EST]')).toBe('2026-10-15')
    expect(lerDataOfx('2026-10-15')).toBe('2026-10-15')
    expect(lerDataOfx('20261345')).toBeUndefined()
    expect(lerDataOfx('')).toBeUndefined()
  })
})

describe('juntarDescricao', () => {
  it('não repete quando um contém o outro', () => {
    expect(juntarDescricao('SISPAG FORNECEDOR', 'SISPAG FORNECEDOR ATACADAO')).toBe('SISPAG FORNECEDOR ATACADAO')
    expect(juntarDescricao('PAG BOLETO ENEL', 'CONTA DE LUZ')).toBe('PAG BOLETO ENEL - CONTA DE LUZ')
    expect(juntarDescricao('', 'X')).toBe('X')
    expect(juntarDescricao('Y', undefined)).toBe('Y')
  })
})

describe('lerOfx', () => {
  it('Nubank: cabeçalho, conta, período, saldo e MEMO', () => {
    const r = lerOfx(NUBANK)
    expect(r).toMatchObject({
      banco: 'NU PAGAMENTOS S.A.',
      conta: '12345678-9',
      agencia: '1',
      moeda: 'BRL',
      inicio: '2026-10-01',
      fim: '2026-10-19',
      saldoFinal: 3250.75,
      saldoEm: '2026-10-19',
    })
    expect(r.cartaoCredito).toBeUndefined()
    expect(r.transacoes).toHaveLength(2)
    expect(r.transacoes[0]).toEqual({
      fitid: '6523a1f0-1c2d-4e5f-8a9b-0c1d2e3f4a5b',
      data: '2026-10-10',
      valor: -1500,
      tipo: 'DEBIT',
      descricao: expect.stringContaining('Transferência enviada pelo Pix - JOSÉ IMÓVEIS LTDA'),
    })
    expect(r.transacoes[1].valor).toBe(850)
  })

  it('Itaú: CRLF, vírgula decimal, NAME + MEMO e CHECKNUM', () => {
    const r = lerOfx(ITAU)
    expect(r.banco).toBe('0341')
    expect(r.agencia).toBe('0912')
    expect(r.saldoFinal).toBe(1000)
    expect(r.transacoes.map((t) => [t.data, t.valor, t.descricao, t.documento])).toEqual([
      ['2026-10-03', -89.9, 'PAG BOLETO ENEL - CONTA DE LUZ SET/26', '000123'],
      ['2026-10-05', -1234.56, 'SISPAG FORNECEDOR ATACADAO', undefined],
    ])
  })

  it('Banco do Brasil: FITID repetido vira único de forma estável', () => {
    const r = lerOfx(BB)
    const ids = r.transacoes.map((t) => t.fitid)
    expect(new Set(ids).size).toBe(3)
    // repetido no arquivo: todas as cópias (inclusive a 1ª) ganham sufixo pelo conteúdo
    expect(ids.every((id) => id.startsWith('000000-'))).toBe(true)
    expect(lerOfx(BB).transacoes.map((t) => t.fitid)).toEqual(ids)
    expect(r.transacoes[0].descricao).toBe('Tarifa Pacote de Serviços')
    expect(r.transacoes[0].documento).toBe('100.001')
  })

  it('Inter: gera FITID quando falta, desempata iguais e decodifica &amp;', () => {
    const r = lerOfx(INTER)
    expect(r.transacoes).toHaveLength(3)
    const [a, b, c] = r.transacoes
    expect(a.descricao).toBe('Compra no debito - PADARIA PÃO & CIA')
    expect(c.descricao).toBe('Pix recebido: "Maria"')
    expect(a.fitid).toMatch(/^gerado-/)
    expect(a.fitid).not.toBe(b.fitid)
    expect(lerOfx(INTER).transacoes.map((t) => t.fitid)).toEqual([a.fitid, b.fitid, c.fitid])
  })

  it('Caixa: valores sem sinal ganham o sinal pelo TRNTYPE', () => {
    const r = lerOfx(CAIXA)
    expect(r.transacoes.map((t) => t.valor)).toEqual([-210, 300])
    expect(r.transacoes[1].descricao).toBe('CRED PIX MARIA')
    expect(r.inicio).toBe('2026-10-01')
  })

  it('Sicoob: tudo numa linha, sinal + e fechamentos misturados', () => {
    const r = lerOfx(SICOOB)
    expect(r.conta).toBe('55555-0')
    expect(r.saldoFinal).toBe(4321)
    expect(r.transacoes).toEqual([
      { fitid: 'S1', data: '2026-10-15', valor: 1520.4, tipo: 'CREDIT', descricao: 'CRED STONE PAGAMENTOS' },
      { fitid: 'S2', data: '2026-10-16', valor: -80, tipo: 'DEBIT', descricao: 'DÉB. CONV. COPEL' },
    ])
  })

  it('XML de cartão de crédito (CCSTMTRS)', () => {
    const r = lerOfx(XML_CARTAO)
    expect(r.cartaoCredito).toBe(true)
    expect(r.conta).toBe('5162********1234')
    expect(r.saldoFinal).toBe(-1234.5)
    expect(r.transacoes.map((t) => [t.fitid, t.data, t.valor, t.descricao])).toEqual([
      ['cc-1', '2026-09-20', -59.9, 'IFOOD *IFOOD'],
      ['cc-2', '2026-10-01', 500, 'Pagamento recebido'],
    ])
  })

  it('extrato sem movimento devolve lista vazia', () => {
    const r = lerOfx('<OFX><STMTRS><BANKTRANLIST><DTSTART>20261001<DTEND>20261002</BANKTRANLIST></STMTRS></OFX>')
    expect(r.transacoes).toEqual([])
  })

  it('arquivo que não é OFX dá erro amigável', () => {
    expect(() => lerOfx('%PDF-1.4 blá blá')).toThrow(ERRO_NAO_E_OFX)
    expect(() => lerOfx('<html><body>oi</body></html>')).toThrow(/não parece ser um extrato OFX/)
  })
})

describe('decodificarOfx', () => {
  const latin1 = (t: string) => Uint8Array.from([...t].map((c) => c.charCodeAt(0)))

  it('usa windows-1252 quando o cabeçalho diz CHARSET:1252', () => {
    const bytes = latin1('OFXHEADER:100\nCHARSET:1252\n<OFX><STMTTRN><MEMO>Pão de açúcar</STMTTRN></OFX>')
    expect(decodificarOfx(bytes.buffer)).toContain('Pão de açúcar')
  })

  it('lê UTF-8 normalmente e tenta windows-1252 se vier caractere inválido', () => {
    const utf8 = new TextEncoder().encode('CHARSET:NONE\n<MEMO>Café</MEMO>')
    expect(decodificarOfx(utf8)).toContain('Café')
    const semCabecalho = latin1('<OFX><MEMO>Feijão</MEMO></OFX>')
    expect(decodificarOfx(semCabecalho)).toContain('Feijão')
  })

  it('XML com encoding ISO-8859-1', () => {
    const bytes = latin1('<?xml version="1.0" encoding="ISO-8859-1"?><OFX><MEMO>Ação</MEMO></OFX>')
    expect(decodificarOfx(bytes)).toContain('Ação')
  })
})
