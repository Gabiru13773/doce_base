import { useMemo } from 'react'
import { centavos } from '../../../lib/compras'
import { custoVariacao, precificarVariacao } from '../../../lib/produtos'
import { CANAIS, precoNoCanal, type Canal, type ItemVenda } from '../../../lib/vendas'
import type { CategoriaProduto, Produto, Variacao } from '../../produtos/api'
import { useContextoCalculo } from '../../receitas/api'

// Carrinho do PDV (guardado neste aparelho) e o "cardápio": preço de cada variação no canal.

export interface ItemCarrinho extends ItemVenda {
  /** preço digitado na hora: não muda ao trocar de canal */
  manual: boolean
}

export interface DescontoCarrinho {
  tipo: 'reais' | 'pct'
  valor: number
}

export interface Carrinho {
  canal: Canal
  itens: ItemCarrinho[]
  desconto: DescontoCarrinho
}

const CHAVE = 'euforia:pdv-carrinho'

export const CARRINHO_VAZIO: Carrinho = { canal: 'balcao', itens: [], desconto: { tipo: 'reais', valor: 0 } }

export function lerCarrinho(): Carrinho {
  try {
    const c = JSON.parse(localStorage.getItem(CHAVE) ?? 'null') as Partial<Carrinho> | null
    if (!c || typeof c !== 'object') return CARRINHO_VAZIO
    const canal = CANAIS.some((x) => x.valor === c.canal) ? (c.canal as Canal) : 'balcao'
    const itens = (Array.isArray(c.itens) ? c.itens : [])
      .filter((i) => i && typeof i.variacao_id === 'string' && typeof i.produto_id === 'string' && Number(i.qtd) > 0 && Number(i.preco) >= 0)
      .map((i) => ({ produto_id: i.produto_id, variacao_id: i.variacao_id, nome: String(i.nome ?? ''), qtd: Math.round(Number(i.qtd)), preco: Number(i.preco), manual: !!i.manual }))
    const d = c.desconto
    const desconto: DescontoCarrinho =
      d && (d.tipo === 'reais' || d.tipo === 'pct') && Number(d.valor) > 0 ? { tipo: d.tipo, valor: Number(d.valor) } : CARRINHO_VAZIO.desconto
    return { canal, itens, desconto }
  } catch {
    return CARRINHO_VAZIO
  }
}

export function gravarCarrinho(c: Carrinho) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(c))
  } catch {
    /* sem armazenamento: o carrinho fica só na memória */
  }
}

// ---- Cardápio ------------------------------------------------------------------------------

export interface OpcaoVariacao {
  variacao: Variacao
  /** preço do balcão (manual ou sugerido); null = sem preço */
  precoBalcao: number | null
  pvIfood: number | null
  /** preparado único que a variação leva (para "restam N"), em unidades base por item */
  preparado: { id: string; qtd: number } | null
}

export interface OpcaoProduto {
  produto: Produto
  categoria: CategoriaProduto
  variacoes: OpcaoVariacao[]
}

const positivo = (v: number | null | undefined) => (v != null && Number.isFinite(v) && v > 0 ? centavos(v) : null)

/** Produtos à venda (variações ativas), com o preço do balcão de cada variação. */
export function useCardapio(produtos: Produto[] | undefined) {
  const { contexto, config, carregando, erro, tentarDeNovo } = useContextoCalculo()
  const cardapio = useMemo<OpcaoProduto[]>(() => {
    if (!produtos) return []
    return [...produtos]
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .map((produto) => ({
        produto,
        categoria: produto.categoria,
        variacoes: produto.variacoes
          .filter((v) => v.ativo !== false)
          .map((variacao) => {
            let preco: number | null = positivo(variacao.pv_manual)
            if (preco === null && contexto && config) {
              const custo = custoVariacao(variacao, contexto)
              preco = positivo(precificarVariacao(variacao, custo.custoDireto, config).pvFinal)
            }
            const receitas = variacao.itens.filter((i) => i.tipo === 'receita' && i.quantidade > 0)
            return {
              variacao,
              precoBalcao: preco,
              pvIfood: positivo((variacao as { pv_ifood?: number | null }).pv_ifood),
              preparado: receitas.length === 1 ? { id: receitas[0].id, qtd: receitas[0].quantidade } : null,
            }
          }),
      }))
      .filter((p) => p.variacoes.length > 0)
  }, [produtos, contexto, config])
  return { cardapio, carregando, erro, tentarDeNovo }
}

export function precoDaOpcao(o: OpcaoVariacao, canal: Canal, acrescimoIfood: number): number | null {
  return precoNoCanal(o.precoBalcao, o.pvIfood, canal, acrescimoIfood)
}

export function nomeItem(produto: Produto, variacao: Variacao): string {
  const v = variacao.nome.trim()
  return v ? `${produto.nome} — ${v}` : produto.nome
}

/** Quantas unidades ainda dá para vender pelo saldo do preparado (null = não sabemos). */
export function restam(o: OpcaoVariacao, saldosReceitas: Record<string, number> | undefined, noCarrinho: number): number | null {
  if (!o.preparado || !saldosReceitas || !(o.preparado.id in saldosReceitas)) return null
  const n = Math.floor(saldosReceitas[o.preparado.id] / o.preparado.qtd + 1e-9) - noCarrinho
  return Math.max(0, n)
}

/** Troca o canal: reprecifica os itens (menos os de preço digitado). */
export function reprecificar(c: Carrinho, canal: Canal, cardapio: OpcaoProduto[], acrescimoIfood: number): Carrinho {
  const itens = c.itens.map((i) => {
    if (i.manual) return i
    const o = cardapio.find((p) => p.produto.id === i.produto_id)?.variacoes.find((v) => v.variacao.id === i.variacao_id)
    const preco = o ? precoDaOpcao(o, canal, acrescimoIfood) : null
    return preco === null ? { ...i, manual: true } : { ...i, preco }
  })
  return { ...c, canal, itens }
}
