import { centavos } from './compras'
import type { ItemPedido, StatusPedido } from './pedidos'

// Números de cada cliente (quantos pedidos, quanto gastou, o que mais pede) a partir dos pedidos.
// Funções puras; resultados em objetos simples (vão para o cache salvo no aparelho como JSON).

export interface PedidoCliente {
  cliente_id: string | null
  entrega_data: string
  status: StatusPedido
  total: number
  itens: Pick<ItemPedido, 'variacao_id' | 'nome' | 'qtd'>[]
}

export interface ResumoCliente {
  /** pedidos não cancelados */
  pedidos: number
  /** soma dos pedidos entregues (o que ainda não foi entregue pode mudar ou ser cancelado) */
  totalGasto: number
  entregues: number
  /** média por pedido entregue (0 sem entregas) */
  ticketMedio: number
  /** data de entrega do pedido mais recente (não cancelado) */
  ultimoPedido: string | null
}

export const RESUMO_VAZIO: ResumoCliente = { pedidos: 0, totalGasto: 0, entregues: 0, ticketMedio: 0, ultimoPedido: null }

/** Resumo de um cliente: passe só os pedidos dele. */
export function resumoCliente(pedidos: Omit<PedidoCliente, 'itens' | 'cliente_id'>[]): ResumoCliente {
  let qtd = 0
  let entregues = 0
  let gasto = 0
  let ultimo: string | null = null
  for (const p of pedidos) {
    if (p.status === 'cancelado') continue
    qtd++
    if (!ultimo || p.entrega_data > ultimo) ultimo = p.entrega_data
    if (p.status === 'entregue') {
      entregues++
      gasto += p.total > 0 ? p.total : 0
    }
  }
  const totalGasto = centavos(gasto)
  return { pedidos: qtd, totalGasto, entregues, ticketMedio: entregues > 0 ? centavos(totalGasto / entregues) : 0, ultimoPedido: ultimo }
}

/** Resumo de todos os clientes de uma vez (para a lista). Pedidos sem cliente_id ficam de fora. */
export function resumosPorCliente(pedidos: Omit<PedidoCliente, 'itens'>[]): Record<string, ResumoCliente> {
  const grupos: Record<string, Omit<PedidoCliente, 'itens'>[]> = {}
  for (const p of pedidos) {
    if (!p.cliente_id) continue
    ;(grupos[p.cliente_id] ??= []).push(p)
  }
  const resumos: Record<string, ResumoCliente> = {}
  for (const [id, lista] of Object.entries(grupos)) resumos[id] = resumoCliente(lista)
  return resumos
}

export interface ItemFavorito {
  /** variação (ou o nome, no item avulso) */
  chave: string
  nome: string
  qtd: number
}

/** O que o cliente mais pede: soma por variação (avulsos pelo nome) nos pedidos não cancelados. */
export function itensMaisPedidos(pedidos: Pick<PedidoCliente, 'status' | 'itens'>[], quantos = 3): ItemFavorito[] {
  const linhas: Record<string, ItemFavorito> = {}
  for (const p of pedidos) {
    if (p.status === 'cancelado') continue
    for (const i of p.itens) {
      if (!(i.qtd > 0)) continue
      const chave = i.variacao_id ? `v:${i.variacao_id}` : `n:${i.nome.trim().toLocaleLowerCase('pt-BR')}`
      const l = (linhas[chave] ??= { chave, nome: i.nome.trim(), qtd: 0 })
      l.qtd += i.qtd
    }
  }
  return Object.values(linhas)
    .sort((a, b) => b.qtd - a.qtd || a.nome.localeCompare(b.nome, 'pt-BR'))
    .slice(0, quantos)
}

export type OrdemClientes = 'nome' | 'pedidos' | 'recentes'

/** Ordena a lista: A–Z, mais pedidos ou pedido mais recente (empates e sem pedidos vão por nome). */
export function ordenarClientes<T extends { id: string; nome: string }>(
  clientes: T[],
  resumos: Record<string, ResumoCliente>,
  ordem: OrdemClientes,
): T[] {
  const r = (c: T) => resumos[c.id] ?? RESUMO_VAZIO
  const porNome = (a: T, b: T) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })
  return [...clientes].sort((a, b) => {
    if (ordem === 'pedidos') return r(b).pedidos - r(a).pedidos || porNome(a, b)
    if (ordem === 'recentes') return (r(b).ultimoPedido ?? '').localeCompare(r(a).ultimoPedido ?? '') || porNome(a, b)
    return porNome(a, b)
  })
}

/** Instagram digitado de qualquer jeito ("@doce", link do perfil) → só o usuário ("doce"). */
export function usuarioInstagram(texto: string | null | undefined): string {
  const t = (texto ?? '').trim()
  const doLink = t.match(/instagram\.com\/([^/?#\s]+)/i)
  return (doLink ? doLink[1] : t).replace(/^@+/, '').trim()
}
