import { describe, expect, it } from 'vitest'
import { PLANO_PADRAO } from '../modules/financeiro/planoPadrao'
import { paraLancamentos, sugerir, type ContextoConciliacao } from './conciliacao'
import type { TransacaoOfx } from './ofx'

// Testes extras da revisão adversarial. `it.fails` documenta um defeito real.

const categorias = PLANO_PADRAO.map((c, i) => ({ id: `cat${i}`, tipo: c.tipo, nome: c.nome, ativo: true }))
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

const tr = (fitid: string, data: string, valor: number, descricao: string): TransacaoOfx => ({
  fitid,
  data,
  valor,
  tipo: valor < 0 ? 'DEBIT' : 'CREDIT',
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
    ],
    hoje: '2026-10-20',
    ...over,
  }
}

const EMBALAGENS = {
  id: 't-emb',
  tipo: 'pagar' as const,
  descricao: 'Embalagens',
  pessoa: 'Embalagens Silva',
  categoria_id: null,
  valor: 150,
  vencimento: '2026-10-10',
}

describe('ligar transação a conta a pagar/receber', () => {
  // Título de R$ 100 com R$ 40 já pagos (falta 60). Uma saída de R$ 100 no extrato casa pelo
  // valor CHEIO e vem marcada (incluir = true) como baixa: o título fica com R$ 140 pagos.
  it.fails('não sugere baixa cheia num título que já foi pago em parte', () => {
    const titulo = { ...EMBALAGENS, valor: 100 }
    const r = sugerir([tr('a', '2026-10-10', -100, 'PIX ENVIADO EMBALAGENS SILVA')], {
      ...ctx(),
      titulos: [titulo],
      lancamentos: [lanc({ id: 'p1', data: '2026-10-01', valor: 40, titulo_id: titulo.id })],
    })
    expect(r[0].titulo).toBeNull()
  })

  it('o mesmo título não é sugerido como principal em duas linhas', () => {
    const r = sugerir(
      [tr('a', '2026-10-10', -150, 'PIX ENVIADO EMBALAGENS SILVA'), tr('b', '2026-10-11', -150, 'PIX ENVIADO EMBALAGENS SILVA')],
      { ...ctx(), titulos: [EMBALAGENS] },
    )
    expect(r.filter((x) => x.titulo?.tituloId === EMBALAGENS.id)).toHaveLength(1)
  })

  // ...mas a segunda linha recebe o MESMO título em `alternativas`, e a LinhaRevisao mostra
  // "Pode ser a conta “Embalagens”? Toque para ver." — um toque e as duas linhas viram baixa
  // do mesmo título (R$ 300 pagos numa conta de R$ 150). importar() não confere isso.
  it.fails('a outra linha não oferece como alternativa um título já usado', () => {
    const r = sugerir(
      [tr('a', '2026-10-10', -150, 'PIX ENVIADO EMBALAGENS SILVA'), tr('b', '2026-10-11', -150, 'PIX ENVIADO EMBALAGENS SILVA')],
      { ...ctx(), titulos: [EMBALAGENS] },
    )
    const semTitulo = r.find((x) => !x.titulo)!
    expect(semTitulo.alternativas.map((a) => a.tituloId)).not.toContain(EMBALAGENS.id)
  })
})

describe('já importada (FITID)', () => {
  // Banco que reaproveita FITID: um lançamento de setembro com FITID "1" faz uma transação
  // de outubro, com outro valor e outro sentido, aparecer como "já importada" — ela fica
  // desmarcada e travada, e o dinheiro nunca entra no app.
  it.fails('mesmo FITID mas valor, sentido e data diferentes não é "já importada"', () => {
    const r = sugerir([tr('1', '2026-10-05', 80, 'PIX RECEBIDO ANA')], {
      ...ctx(),
      lancamentos: [lanc({ id: 'set', data: '2026-09-01', valor: 50, tipo: 'saida', ofx_fitid: '1' })],
    })
    expect(r[0].jaImportada).toBe(false)
  })

  // Transferência recebida importada do extrato do Inter: fica gravada com conta_id = Nubank
  // (origem) e ofx_fitid = FITID do Inter. O índice único é (conta_id, ofx_fitid), então o
  // FITID do Inter passa a "ocupar" o espaço de FITIDs do Nubank.
  it('transferência recebida grava o FITID na conta de ORIGEM (conta_id = outra conta)', () => {
    const [l] = paraLancamentos(
      [{ transacao: tr('inter-77', '2026-10-05', 300, 'TED RECEBIDA NUBANK'), categoriaId: null, tituloId: null, contaTransferenciaId: 'nubank' }],
      'inter',
    )
    expect(l).toMatchObject({ tipo: 'transferencia', conta_id: 'nubank', conta_destino_id: 'inter', ofx_fitid: 'inter-77' })
  })
})
