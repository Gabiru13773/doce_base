import { centavos } from './compras'
import { milesimos } from './estoque'
import { somarDias } from './financeiro'
import { baixaVariacao, type VariacaoCalculo } from './produtos'

// PDV: preço por canal, totais, troco, taxas, baixa no estoque e fechamento do caixa do dia.
// Funções puras. Resultados em objetos simples (vão para o cache salvo no aparelho como JSON).

export type Canal = 'balcao' | 'whatsapp' | 'ifood'
export type FormaPagamento = 'dinheiro' | 'pix' | 'debito' | 'credito' | 'ifood'

export const CANAIS: { valor: Canal; rotulo: string }[] = [
  { valor: 'balcao', rotulo: 'Balcão' },
  { valor: 'whatsapp', rotulo: 'WhatsApp/Insta' },
  { valor: 'ifood', rotulo: 'iFood' },
]

export const FORMAS: { valor: FormaPagamento; rotulo: string }[] = [
  { valor: 'pix', rotulo: 'Pix' },
  { valor: 'dinheiro', rotulo: 'Dinheiro' },
  { valor: 'debito', rotulo: 'Débito' },
  { valor: 'credito', rotulo: 'Crédito' },
  { valor: 'ifood', rotulo: 'Pago no iFood' },
]

/** Formas aceitas em cada canal: no iFood o cliente paga pelo app. */
export function formasDoCanal(canal: Canal): FormaPagamento[] {
  return canal === 'ifood' ? ['ifood'] : ['pix', 'dinheiro', 'debito', 'credito']
}

export interface ItemVenda {
  produto_id: string
  variacao_id: string
  /** nome como estava na hora da venda ("Bolo de pote — Pote") */
  nome: string
  qtd: number
  /** preço de 1 unidade no canal da venda */
  preco: number
}

export interface Pagamento {
  forma: FormaPagamento
  valor: number
  /** taxa desta parte, calculada na hora da venda (se a taxa mudar depois, a venda guarda a de então) */
  taxa?: number
}

export interface ConfigPdv {
  taxa_debito: number
  taxa_credito: number
  taxa_pix: number
  comissao_ifood: number
  acrescimo_ifood: number
  prazo_debito: number
  prazo_credito: number
  prazo_ifood: number
  conta_caixa_id: string | null
  conta_banco_id: string | null
  fundo_troco: number
}

export const CONFIG_PDV_PADRAO: ConfigPdv = {
  taxa_debito: 1.99,
  taxa_credito: 4.99,
  taxa_pix: 0,
  comissao_ifood: 23,
  acrescimo_ifood: 0,
  prazo_debito: 1,
  prazo_credito: 30,
  prazo_ifood: 7,
  conta_caixa_id: null,
  conta_banco_id: null,
  fundo_troco: 0,
}

/**
 * Preço de 1 unidade no canal. No iFood: o preço iFood da variação, se tiver; senão o do balcão
 * com o acréscimo do iFood (arredondado para cima no 0,10, como preço de cardápio).
 */
export function precoNoCanal(precoBalcao: number | null, pvIfood: number | null | undefined, canal: Canal, acrescimoIfood: number): number | null {
  if (canal !== 'ifood') return precoBalcao
  if (pvIfood != null && pvIfood > 0) return centavos(pvIfood)
  if (precoBalcao == null) return null
  if (!(acrescimoIfood > 0)) return precoBalcao
  return Math.ceil(centavos(precoBalcao * (1 + acrescimoIfood / 100)) * 10 - 1e-9) / 10
}

export interface TotaisVenda {
  subtotal: number
  /** desconto aplicado (nunca maior que o subtotal) */
  desconto: number
  total: number
  itens: number
}

export function totaisVenda(itens: Pick<ItemVenda, 'qtd' | 'preco'>[], desconto = 0): TotaisVenda {
  const subtotal = centavos(itens.reduce((s, i) => s + (i.qtd > 0 && i.preco >= 0 ? centavos(i.qtd * i.preco) : 0), 0))
  const d = centavos(Math.min(Math.max(desconto || 0, 0), subtotal))
  return { subtotal, desconto: d, total: centavos(subtotal - d), itens: itens.reduce((s, i) => s + (i.qtd > 0 ? i.qtd : 0), 0) }
}

/** Desconto em % do subtotal, em reais. */
export function descontoPct(subtotal: number, pct: number): number {
  if (!(pct > 0)) return 0
  return centavos(subtotal * Math.min(pct, 100) / 100)
}

/** Quanto ainda falta pagar (positivo) ou quanto passou (negativo). */
export function faltaPagar(total: number, pagamentos: Pagamento[]): number {
  return centavos(total - pagamentos.reduce((s, p) => s + (p.valor > 0 ? p.valor : 0), 0))
}

/** Troco do dinheiro: recebido em mãos − parte da venda paga em dinheiro. */
export function troco(recebido: number, valorEmDinheiro: number): number {
  if (!(recebido > 0) || !(valorEmDinheiro >= 0)) return 0
  return Math.max(0, centavos(recebido - valorEmDinheiro))
}

/** % de taxa de cada forma (maquininha, comissão do iFood). */
export function pctTaxa(forma: FormaPagamento, c: Pick<ConfigPdv, 'taxa_debito' | 'taxa_credito' | 'taxa_pix' | 'comissao_ifood'>): number {
  switch (forma) {
    case 'debito':
      return c.taxa_debito
    case 'credito':
      return c.taxa_credito
    case 'pix':
      return c.taxa_pix
    case 'ifood':
      return c.comissao_ifood
    default:
      return 0
  }
}

/** Taxas estimadas de uma venda (somadas por forma, arredondadas no centavo). */
export function taxasVenda(pagamentos: Pagamento[], c: Pick<ConfigPdv, 'taxa_debito' | 'taxa_credito' | 'taxa_pix' | 'comissao_ifood'>): number {
  return centavos(pagamentos.reduce((s, p) => s + (p.valor > 0 ? centavos((p.valor * pctTaxa(p.forma, c)) / 100) : 0), 0))
}

/** Pagamentos com a taxa de cada parte já calculada (guardada na venda). */
export function pagamentosComTaxa(
  pagamentos: Pagamento[],
  c: Pick<ConfigPdv, 'taxa_debito' | 'taxa_credito' | 'taxa_pix' | 'comissao_ifood'>,
): Required<Pagamento>[] {
  return juntarPagamentos(pagamentos).map((p) => ({ ...p, taxa: centavos((p.valor * pctTaxa(p.forma, c)) / 100) }))
}

/** Junta pagamentos da mesma forma e tira os zerados. */
export function juntarPagamentos(pagamentos: Pagamento[]): Pagamento[] {
  const soma = new Map<FormaPagamento, number>()
  for (const p of pagamentos) if (p.valor > 0) soma.set(p.forma, (soma.get(p.forma) ?? 0) + p.valor)
  return [...soma].map(([forma, valor]) => ({ forma, valor: centavos(valor) }))
}

// ---- Estoque ----------------------------------------------------------------------

export interface BaixaVenda {
  item_tipo: 'insumo' | 'receita'
  insumo_id: string | null
  receita_id: string | null
  /** negativo: sai do estoque */
  quantidade: number
}

/**
 * O que sai do estoque numa venda: para cada item, a variação vendida (preparados prontos e
 * embalagens/insumos), vezes a quantidade. Itens de produto/variação que não existem mais ficam de fora.
 */
export function baixaEstoqueVenda(
  itens: Pick<ItemVenda, 'produto_id' | 'variacao_id' | 'qtd'>[],
  produtos: { id: string; variacoes: Pick<VariacaoCalculo, 'id' | 'itens'>[] }[],
): BaixaVenda[] {
  const receitas: Record<string, number> = {}
  const insumos: Record<string, number> = {}
  for (const it of itens) {
    const v = produtos.find((p) => p.id === it.produto_id)?.variacoes.find((x) => x.id === it.variacao_id)
    if (!v || !(it.qtd > 0)) continue
    const b = baixaVariacao(v, it.qtd)
    for (const [id, q] of b.receitas) receitas[id] = (receitas[id] ?? 0) + q
    for (const [id, q] of b.insumos) insumos[id] = (insumos[id] ?? 0) + q
  }
  const linhas: BaixaVenda[] = []
  for (const [id, q] of Object.entries(receitas)) {
    const m = milesimos(q)
    if (m > 0) linhas.push({ item_tipo: 'receita', receita_id: id, insumo_id: null, quantidade: -m })
  }
  for (const [id, q] of Object.entries(insumos)) {
    const m = milesimos(q)
    if (m > 0) linhas.push({ item_tipo: 'insumo', insumo_id: id, receita_id: null, quantidade: -m })
  }
  return linhas
}

// ---- Resumo do dia e fechamento --------------------------------------------------------

export interface VendaCalc {
  canal: Canal
  pagamentos: Pagamento[]
  total: number
  desconto: number
  troco: number
  taxas: number
  status: 'concluida' | 'cancelada'
}

export interface ResumoDia {
  vendas: number
  canceladas: number
  total: number
  descontos: number
  taxas: number
  ticketMedio: number
  porForma: Record<FormaPagamento, number>
  porCanal: Record<Canal, number>
  /** taxa por forma (para descontar de cada conta a receber) */
  taxasPorForma: Record<FormaPagamento, number>
}

const zeroFormas = (): Record<FormaPagamento, number> => ({ dinheiro: 0, pix: 0, debito: 0, credito: 0, ifood: 0 })

export function resumoDia(vendas: VendaCalc[], c: Pick<ConfigPdv, 'taxa_debito' | 'taxa_credito' | 'taxa_pix' | 'comissao_ifood'>): ResumoDia {
  const porForma = zeroFormas()
  const taxasPorForma = zeroFormas()
  const porCanal: Record<Canal, number> = { balcao: 0, whatsapp: 0, ifood: 0 }
  let total = 0
  let descontos = 0
  let n = 0
  let canceladas = 0
  for (const v of vendas) {
    if (v.status === 'cancelada') {
      canceladas++
      continue
    }
    n++
    total += v.total
    descontos += v.desconto
    porCanal[v.canal] += v.total
    // Vale a taxa guardada na venda (a taxa da maquininha pode ter mudado depois): a de cada
    // pagamento ou, se só houver o total da venda, ele dividido na proporção da taxa de cada forma.
    const pagos = v.pagamentos.filter((p) => p.valor > 0)
    const calculadas = pagos.map((p) => (p.taxa != null ? p.taxa : centavos((p.valor * pctTaxa(p.forma, c)) / 100)))
    const semTaxaPropria = pagos.every((p) => p.taxa == null)
    const somaCalc = calculadas.reduce((s, x) => s + x, 0)
    pagos.forEach((p, i) => {
      porForma[p.forma] += p.valor
      taxasPorForma[p.forma] += semTaxaPropria && v.taxas > 0 && somaCalc > 0 ? (v.taxas * calculadas[i]) / somaCalc : calculadas[i]
    })
  }
  const arred = <K extends string>(r: Record<K, number>) => {
    for (const k in r) r[k] = centavos(r[k])
    return r
  }
  const taxas = centavos(Object.values(taxasPorForma).reduce((s, x) => s + x, 0))
  return {
    vendas: n,
    canceladas,
    total: centavos(total),
    descontos: centavos(descontos),
    taxas,
    ticketMedio: n > 0 ? centavos(total / n) : 0,
    porForma: arred(porForma),
    porCanal: arred(porCanal),
    taxasPorForma: arred(taxasPorForma),
  }
}

/** Dinheiro que deveria estar na gaveta: fundo de troco + vendas em dinheiro. */
export function dinheiroEsperado(resumo: Pick<ResumoDia, 'porForma'>, fundoTroco: number): number {
  return centavos((fundoTroco > 0 ? fundoTroco : 0) + resumo.porForma.dinheiro)
}

export interface PlanoFechamento {
  /** dinheiro: entrada no caixa no próprio dia */
  lancamentos: { forma: 'dinheiro'; valor: number; data: string; conta: 'caixa'; descricao: string }[]
  /** Pix, cartão e iFood: contas a receber pelo valor líquido (o que de fato cai na conta) */
  titulos: { forma: Exclude<FormaPagamento, 'dinheiro'>; valor: number; bruto: number; taxa: number; vencimento: string; descricao: string }[]
}

const ROTULO_FORMA: Record<FormaPagamento, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  debito: 'Cartão de débito',
  credito: 'Cartão de crédito',
  ifood: 'iFood',
}

const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

/**
 * O que o fechamento do dia leva para o Financeiro. Dinheiro entra no caixa na hora. Pix, débito,
 * crédito e iFood viram contas a receber com o valor líquido (bruto − taxa) e o vencimento do prazo
 * de cada um: quando o extrato OFX for importado, o crédito do banco dá baixa nelas (sem duplicar).
 */
export function planoFechamento(resumo: ResumoDia, c: ConfigPdv, data: string): PlanoFechamento {
  const plano: PlanoFechamento = { lancamentos: [], titulos: [] }
  if (resumo.porForma.dinheiro > 0)
    plano.lancamentos.push({ forma: 'dinheiro', valor: resumo.porForma.dinheiro, data, conta: 'caixa', descricao: `Vendas em dinheiro ${dataBr(data)}` })
  const prazo: Record<Exclude<FormaPagamento, 'dinheiro'>, number> = { pix: 0, debito: c.prazo_debito, credito: c.prazo_credito, ifood: c.prazo_ifood }
  for (const forma of ['pix', 'debito', 'credito', 'ifood'] as const) {
    const bruto = resumo.porForma[forma]
    if (!(bruto > 0)) continue
    const taxa = resumo.taxasPorForma[forma]
    const valor = centavos(bruto - taxa)
    if (!(valor > 0)) continue
    plano.titulos.push({
      forma,
      valor,
      bruto,
      taxa,
      vencimento: somarDias(data, Math.max(0, Math.round(prazo[forma] || 0))),
      descricao: `${ROTULO_FORMA[forma]} — vendas ${dataBr(data)}`,
    })
  }
  return plano
}
