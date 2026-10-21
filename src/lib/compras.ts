import { custoPorUnidadeBase } from './custos'
import { paraBase, unidadeBase, type UnidadeCompra } from './unidades'

// Compras: lista feita com os insumos cadastrados. Quantidades em EMBALAGENS
// (ex.: 3 pacotes de 1 kg) e preço pago POR EMBALAGEM. Funções puras.

export type StatusItem = 'pendente' | 'comprado' | 'substituido' | 'nao'

export interface ItemCompraCalc {
  id: string
  insumo_id: string | null
  nome: string
  qtd_pedida: number
  embalagem_qtd: number
  embalagem_unidade: UnidadeCompra
  status: StatusItem
  qtd_comprada: number | null
  preco_pago: number | null
  sub_insumo_id: string | null
  fora_da_lista: boolean
}

/** Um registro do histórico de preços de um insumo (tabela precos_insumo). */
export interface PrecoHistorico {
  qtd_compra: number
  unidade_compra: UnidadeCompra
  preco_compra: number
  registrado_em: string
}

export interface Embalagem {
  qtd: number
  unidade: UnidadeCompra
}

/** Arredonda para centavos como o banco (numeric(12,2)): meio centavo sobe (1,005 → 1,01). */
export const centavos = (n: number) => Math.round((n + Math.sign(n) * Number.EPSILON * Math.max(1, Math.abs(n))) * 100) / 100

/** O item foi para o carrinho (pegou o pedido ou levou outro no lugar). */
export const levou = (i: Pick<ItemCompraCalc, 'status'>) => i.status === 'comprado' || i.status === 'substituido'

/** Valor do item no carrinho (quantidade × preço da embalagem), ou null quando não tem preço. */
export function totalItem(i: Pick<ItemCompraCalc, 'status' | 'qtd_comprada' | 'preco_pago'>): number | null {
  if (!levou(i) || i.preco_pago == null || i.qtd_comprada == null) return null
  return centavos(i.qtd_comprada * i.preco_pago)
}

export interface ResumoCompra {
  total: number
  pendentes: number
  /** comprados + substituídos */
  carrinho: number
  nao: number
  /** resolvidos (carrinho + não levei) */
  feitos: number
  itens: number
  /** itens no carrinho sem preço informado (não entram no total nem no histórico) */
  semPreco: number
}

export function resumoCompra(itens: ItemCompraCalc[]): ResumoCompra {
  let total = 0
  let pendentes = 0
  let carrinho = 0
  let nao = 0
  let semPreco = 0
  for (const i of itens) {
    if (i.status === 'pendente') pendentes++
    else if (i.status === 'nao') nao++
    else {
      carrinho++
      const t = totalItem(i)
      if (t == null) semPreco++
      else total += t
    }
  }
  return { total: centavos(total), pendentes, carrinho, nao, feitos: carrinho + nao, itens: itens.length, semPreco }
}

export interface FaixaPrecos {
  /** preço da compra mais recente, convertido para a embalagem pedida */
  ultimo: number
  menor: number
  maior: number
  /** quantas compras entraram na conta */
  vezes: number
}

/**
 * Último, menor e maior preço já pagos, convertidos para a `embalagem` (ex.: o histórico tem
 * um pacote de 5 kg a R$ 25 e a embalagem é 1 kg → R$ 5). Compara pelo custo por g/ml/un, então
 * embalagens de tamanhos diferentes entram juntas; unidades que não se convertem (kg × un) ficam de fora.
 * Preço zero (brinde) não entra. Sem histórico comparável → null.
 */
export function faixaPrecos(historico: PrecoHistorico[], embalagem: Embalagem): FaixaPrecos | null {
  const qtdBase = paraBase(embalagem.qtd, embalagem.unidade)
  if (!(qtdBase > 0)) return null
  const base = unidadeBase(embalagem.unidade)
  let ultimo: { valor: number; em: string } | null = null
  let menor = Infinity
  let maior = -Infinity
  let vezes = 0
  for (const p of historico) {
    if (!(p.preco_compra > 0) || unidadeBase(p.unidade_compra) !== base) continue
    const porBase = custoPorUnidadeBase({ qtdCompra: p.qtd_compra, unidadeCompra: p.unidade_compra, precoCompra: p.preco_compra })
    if (!(porBase > 0)) continue
    const valor = centavos(porBase * qtdBase)
    vezes++
    menor = Math.min(menor, valor)
    maior = Math.max(maior, valor)
    if (!ultimo || p.registrado_em >= ultimo.em) ultimo = { valor, em: p.registrado_em }
  }
  if (!ultimo) return null
  return { ultimo: ultimo.valor, menor, maior, vezes }
}

export type AvaliacaoPreco = 'menor_de_todos' | 'acima_do_maior' | 'na_faixa'

/** Compara o preço digitado com o que já foi pago: avisa quando é o menor ou passa do maior. */
export function avaliarPreco(preco: number | null, faixa: FaixaPrecos | null): AvaliacaoPreco | null {
  // Com um preço só (em geral o digitado no cadastro do insumo) ainda não há faixa para comparar.
  if (preco == null || !(preco > 0) || !faixa || faixa.vezes < 2) return null
  if (preco < faixa.menor) return 'menor_de_todos'
  if (preco > faixa.maior) return 'acima_do_maior'
  return 'na_faixa'
}

/** Insumo que recebe o preço do item: o pedido ou, na troca, o que foi levado no lugar. */
export function insumoComprado(i: Pick<ItemCompraCalc, 'status' | 'insumo_id' | 'sub_insumo_id'>): string | null {
  if (i.status === 'comprado') return i.insumo_id
  if (i.status === 'substituido') return i.sub_insumo_id
  return null
}

export interface LinhaHistorico {
  insumo_id: string
  qtd_compra: number
  unidade_compra: UnidadeCompra
  preco_compra: number
  /** item de onde veio (para gerar o id uma vez só e não duplicar ao tentar de novo) */
  item_id: string
}

/**
 * O que vai para o histórico de preços ao finalizar: cada item levado, com preço e ligado a um
 * insumo cadastrado, vira uma linha (preço da embalagem comprada).
 */
export function historicoDaCompra(itens: ItemCompraCalc[]): LinhaHistorico[] {
  const linhas: LinhaHistorico[] = []
  for (const i of itens) {
    const insumo = insumoComprado(i)
    // preço zero é brinde: não entra no histórico nem vira custo do insumo
    if (!insumo || i.preco_pago == null || !(i.preco_pago > 0) || !(i.embalagem_qtd > 0)) continue
    linhas.push({
      insumo_id: insumo,
      qtd_compra: i.embalagem_qtd,
      unidade_compra: i.embalagem_unidade,
      preco_compra: centavos(i.preco_pago),
      item_id: i.id,
    })
  }
  return linhas
}

export interface CustoAtual {
  id: string
  nome: string
  qtd_compra: number
  unidade_compra: UnidadeCompra
  preco_compra: number
}

export interface MudancaCusto {
  insumo_id: string
  nome: string
  antes: Embalagem & { preco: number }
  depois: Embalagem & { preco: number }
  /** variação do custo por g/ml/un, em % (positivo = ficou mais caro) */
  variacaoPct: number
}

/**
 * Novo custo de cada insumo depois da compra (o último preço pago passa a ser o custo do insumo,
 * igual a editar o insumo à mão). Se o mesmo insumo foi comprado em mais de um item, vale o mais
 * caro por g/ml/un (conta pelo lado seguro). Só lista o que de fato muda.
 */
export function mudancasDeCusto(linhas: LinhaHistorico[], insumos: CustoAtual[]): MudancaCusto[] {
  const porInsumo = new Map<string, LinhaHistorico>()
  const porBase = (l: LinhaHistorico) =>
    custoPorUnidadeBase({ qtdCompra: l.qtd_compra, unidadeCompra: l.unidade_compra, precoCompra: l.preco_compra })
  for (const l of linhas) {
    const atual = porInsumo.get(l.insumo_id)
    if (!atual || porBase(l) > porBase(atual)) porInsumo.set(l.insumo_id, l)
  }
  const mudancas: MudancaCusto[] = []
  for (const [id, l] of porInsumo) {
    const ins = insumos.find((x) => x.id === id)
    if (!ins) continue
    // Embalagem em outro tipo de unidade (ex.: insumo em unidades, comprado em kg): trocar o custo
    // mudaria a unidade do insumo e estragaria as receitas que o usam. Fica só no histórico.
    if (unidadeBase(ins.unidade_compra) !== unidadeBase(l.unidade_compra)) continue
    if (ins.preco_compra === l.preco_compra && ins.qtd_compra === l.qtd_compra && ins.unidade_compra === l.unidade_compra) continue
    const antesBase = custoPorUnidadeBase({ qtdCompra: ins.qtd_compra, unidadeCompra: ins.unidade_compra, precoCompra: ins.preco_compra })
    const depoisBase = porBase(l)
    const comparavel = antesBase > 0
    mudancas.push({
      insumo_id: id,
      nome: ins.nome,
      antes: { qtd: ins.qtd_compra, unidade: ins.unidade_compra, preco: ins.preco_compra },
      depois: { qtd: l.qtd_compra, unidade: l.unidade_compra, preco: l.preco_compra },
      variacaoPct: comparavel ? Math.round(((depoisBase - antesBase) / antesBase) * 1000) / 10 : 0,
    })
  }
  return mudancas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

/** Junta o que veio do servidor com as marcações deste aparelho que ainda não subiram (as daqui mandam). */
export function mesclarPendentes<T extends { id: string }>(servidor: T[], pendentes: Map<string, T>): T[] {
  const ids = new Set(servidor.map((i) => i.id))
  const mesclados = servidor.map((i) => pendentes.get(i.id) ?? i)
  for (const [id, p] of pendentes) if (!ids.has(id)) mesclados.push(p)
  return mesclados
}
