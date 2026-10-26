import { centavos } from './compras'
import { somarDias } from './financeiro'

// Pedidos (encomendas): totais, quanto já foi pago, sinal, agenda de entregas, o que produzir e
// a mensagem para o WhatsApp. Funções puras; resultados em objetos simples (vão para o cache
// salvo no aparelho como JSON).

export type StatusPedido = 'confirmado' | 'pronto' | 'entregue' | 'cancelado'
export type TipoEntrega = 'retirada' | 'propria' | 'motoboy'
export type CanalPedido = 'balcao' | 'whatsapp'

export const STATUS_PEDIDO: { valor: StatusPedido; rotulo: string }[] = [
  { valor: 'confirmado', rotulo: 'Confirmado' },
  { valor: 'pronto', rotulo: 'Pronto' },
  { valor: 'entregue', rotulo: 'Entregue' },
  { valor: 'cancelado', rotulo: 'Cancelado' },
]

export const TIPOS_ENTREGA: { valor: TipoEntrega; rotulo: string }[] = [
  { valor: 'retirada', rotulo: 'Retira na loja' },
  { valor: 'propria', rotulo: 'Entrega própria' },
  { valor: 'motoboy', rotulo: 'Motoboy/app' },
]

export const CANAIS_PEDIDO: { valor: CanalPedido; rotulo: string }[] = [
  { valor: 'whatsapp', rotulo: 'WhatsApp/Insta' },
  { valor: 'balcao', rotulo: 'Balcão' },
]

export interface ItemPedido {
  /** id da linha (a mesma variação pode aparecer duas vezes com personalizações diferentes) */
  id: string
  /** null = item avulso (descrição e preço combinados na hora) */
  produto_id: string | null
  variacao_id: string | null
  nome: string
  qtd: number
  /** preço de 1 unidade */
  preco: number
  /** sabor, recheio, tema, texto do bolo… */
  personalizacao?: string | null
}

export interface TotaisPedido {
  subtotal: number
  /** desconto aplicado (nunca maior que o subtotal) */
  desconto: number
  taxaEntrega: number
  total: number
}

export function totaisPedido(itens: Pick<ItemPedido, 'qtd' | 'preco'>[], desconto = 0, taxaEntrega = 0): TotaisPedido {
  const subtotal = centavos(itens.reduce((s, i) => s + (i.qtd > 0 && i.preco >= 0 ? centavos(i.qtd * i.preco) : 0), 0))
  const d = centavos(Math.min(Math.max(desconto || 0, 0), subtotal))
  const t = centavos(Math.max(taxaEntrega || 0, 0))
  return { subtotal, desconto: d, taxaEntrega: t, total: centavos(subtotal - d + t) }
}

/** Pagamento já recebido de um pedido (vendas do PDV ligadas a ele). */
export interface PagamentoPedidoCalc {
  total: number
  status: 'concluida' | 'cancelada'
}

export interface SituacaoPagamento {
  pago: number
  /** quanto falta receber (0 quando quitado; nunca negativo) */
  falta: number
  /** recebeu mais que o total (ex.: o pedido diminuiu depois do sinal) */
  passou: number
  quitado: boolean
}

export function situacaoPagamento(total: number, pagamentos: PagamentoPedidoCalc[]): SituacaoPagamento {
  const pago = centavos(pagamentos.reduce((s, p) => s + (p.status === 'concluida' && p.total > 0 ? p.total : 0), 0))
  const dif = centavos(total - pago)
  return { pago, falta: Math.max(0, dif), passou: Math.max(0, -dif), quitado: dif <= 0 }
}

/** Sinal sugerido: % do total, arredondado para cima no real (nunca mais que o que falta). */
export function sinalSugerido(total: number, pct: number, falta = total): number {
  if (!(total > 0) || !(pct > 0)) return 0
  const s = Math.ceil(centavos((total * Math.min(pct, 100)) / 100) - 1e-9)
  // `falta` pode vir negativo (pagou a mais): aí não sugere nada
  return Math.max(0, centavos(Math.min(s, falta)))
}

// ---- Agenda ------------------------------------------------------------------------------

export type GrupoEntrega = 'atrasado' | 'hoje' | 'amanha' | 'semana' | 'depois'

export const ROTULO_GRUPO: Record<GrupoEntrega, string> = {
  atrasado: 'Atrasados',
  hoje: 'Hoje',
  amanha: 'Amanhã',
  semana: 'Próximos 7 dias',
  depois: 'Mais pra frente',
}

/** Em que grupo da agenda cai uma entrega (datas AAAA-MM-DD). */
export function grupoEntrega(data: string, hoje: string): GrupoEntrega {
  if (data < hoje) return 'atrasado'
  if (data === hoje) return 'hoje'
  if (data === somarDias(hoje, 1)) return 'amanha'
  if (data <= somarDias(hoje, 7)) return 'semana'
  return 'depois'
}

export interface PedidoAgenda {
  id: string
  entrega_data: string
  entrega_hora: string | null
  status: StatusPedido
  criado_em: string
}

/** Pedidos em aberto (confirmados e prontos), por data e hora de entrega. */
export function ordenarAgenda<T extends PedidoAgenda>(pedidos: T[]): T[] {
  return pedidos
    .filter((p) => p.status === 'confirmado' || p.status === 'pronto')
    .sort(
      (a, b) =>
        a.entrega_data.localeCompare(b.entrega_data) ||
        // sem hora (null ou "") vai para o fim do dia
        (a.entrega_hora || '99:99').localeCompare(b.entrega_hora || '99:99') ||
        a.criado_em.localeCompare(b.criado_em),
    )
}

/** Agenda em grupos (Atrasados, Hoje, Amanhã…), só os grupos com pedidos, na ordem. */
export function agruparAgenda<T extends PedidoAgenda>(pedidos: T[], hoje: string): { grupo: GrupoEntrega; pedidos: T[] }[] {
  const ordem: GrupoEntrega[] = ['atrasado', 'hoje', 'amanha', 'semana', 'depois']
  const grupos: Record<GrupoEntrega, T[]> = { atrasado: [], hoje: [], amanha: [], semana: [], depois: [] }
  for (const p of ordenarAgenda(pedidos)) grupos[grupoEntrega(p.entrega_data, hoje)].push(p)
  return ordem.filter((g) => grupos[g].length > 0).map((g) => ({ grupo: g, pedidos: grupos[g] }))
}

export interface LinhaProduzir {
  /** produto/variação (ou o nome, no item avulso) */
  chave: string
  nome: string
  qtd: number
  /** quantos pedidos levam este item */
  pedidos: number
}

/**
 * O que produzir para os pedidos confirmados (ainda não prontos) com entrega até `ate`
 * (inclusive): soma por variação; itens avulsos somam pelo nome.
 */
export function paraProduzir(
  pedidos: (Pick<PedidoAgenda, 'id' | 'entrega_data' | 'status'> & { itens: ItemPedido[] })[],
  ate: string,
): LinhaProduzir[] {
  const linhas = new Map<string, LinhaProduzir & { ids: Set<string> }>()
  for (const p of pedidos) {
    if (p.status !== 'confirmado' || p.entrega_data > ate) continue
    for (const i of p.itens) {
      if (!(i.qtd > 0)) continue
      const chave = i.variacao_id ? `v:${i.variacao_id}` : `n:${i.nome.trim().toLocaleLowerCase('pt-BR')}`
      const l = linhas.get(chave) ?? { chave, nome: i.nome.trim(), qtd: 0, pedidos: 0, ids: new Set<string>() }
      l.qtd += i.qtd
      l.ids.add(p.id)
      linhas.set(chave, l)
    }
  }
  return [...linhas.values()]
    // qtd em milésimos: 0,1 + 0,2 não vira 0,30000000000000004
    .map(({ ids, ...l }) => ({ ...l, qtd: Math.round(l.qtd * 1000) / 1000, pedidos: ids.size }))
    .sort((a, b) => b.qtd - a.qtd || a.nome.localeCompare(b.nome, 'pt-BR'))
}

// ---- Textos ----------------------------------------------------------------------------------

const reais = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`
export const dataCurta = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

/** Item da venda que registra um pagamento do pedido no PDV (sem baixa no estoque). */
export function itemPagamentoPedido(
  p: { cliente_nome: string; entrega_data: string },
  valor: number,
  tipo: 'sinal' | 'restante' | 'pagamento',
): { produto_id: string; variacao_id: string; nome: string; qtd: number; preco: number } {
  const rotulo = tipo === 'sinal' ? 'Sinal do pedido' : tipo === 'restante' ? 'Restante do pedido' : 'Pagamento do pedido'
  return { produto_id: '', variacao_id: '', nome: `${rotulo} — ${p.cliente_nome.trim()} (entrega ${dataCurta(p.entrega_data)})`, qtd: 1, preco: centavos(valor) }
}

/**
 * Só os dígitos, com o 55 do Brasil quando faltar (para o link do WhatsApp).
 * Com "+" na frente é número com o código do país (pode ser de fora). Sem "+", 12 ou 13
 * dígitos só valem começando com 55 (senão é código de operadora, "0 21 11 9…"): null.
 */
export function telefoneWhatsapp(telefone: string | null | undefined): string | null {
  const bruto = (telefone ?? '').trim()
  const d = bruto.replace(/\D/g, '').replace(/^0+/, '')
  if (bruto.startsWith('+')) return d.length >= 8 && d.length <= 15 ? d : null
  if (d.length < 10 || d.length > 13) return null
  if (d.length <= 11) return `55${d}`
  return d.startsWith('55') ? d : null
}

export function linkWhatsapp(telefone: string | null | undefined, texto: string): string | null {
  const t = telefoneWhatsapp(telefone)
  return t ? `https://wa.me/${t}?text=${encodeURIComponent(texto)}` : null
}

export interface PedidoTexto {
  cliente_nome: string
  entrega_data: string
  entrega_hora: string | null
  entrega_tipo: TipoEntrega
  endereco: string | null
  itens: ItemPedido[]
  desconto: number
  taxa_entrega: number
  total: number
  observacao: string | null
}

/** Resumo do pedido para mandar ao cliente pelo WhatsApp. */
export function mensagemPedido(p: PedidoTexto, pago: number): string {
  const primeiroNome = p.cliente_nome.trim().split(/\s+/)[0] ?? ''
  const linhas = [`Olá${primeiroNome ? `, ${primeiroNome}` : ''}! Seu pedido na Euforia Confeitaria:`, '']
  for (const i of p.itens) {
    linhas.push(`• ${String(i.qtd).replace('.', ',')}x ${i.nome.trim()} — ${reais(centavos(i.qtd * i.preco))}`)
    if (i.personalizacao?.trim()) linhas.push(`   ${i.personalizacao.trim()}`)
  }
  linhas.push('')
  if (p.desconto > 0) linhas.push(`Desconto: −${reais(p.desconto)}`)
  if (p.taxa_entrega > 0) linhas.push(`Entrega: ${reais(p.taxa_entrega)}`)
  linhas.push(`Total: ${reais(p.total)}`)
  const falta = centavos(p.total - pago)
  if (pago > 0) linhas.push(`Pago: ${reais(pago)}`)
  if (pago > 0 && falta > 0) linhas.push(`Falta: ${reais(falta)}`)
  if (falta <= 0) linhas.push('Pagamento: quitado ✓')
  linhas.push('')
  const quando = `${dataCurta(p.entrega_data)}${p.entrega_hora ? ` às ${p.entrega_hora}` : ''}`
  if (p.entrega_tipo === 'retirada') linhas.push(`Retirada: ${quando}`)
  else linhas.push(`Entrega: ${quando}${p.endereco?.trim() ? ` — ${p.endereco.trim()}` : ''}`)
  if (p.observacao?.trim()) linhas.push(`Obs.: ${p.observacao.trim()}`)
  return linhas.join('\n')
}
