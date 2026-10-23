import { insumoComprado, type ItemCompraCalc } from './compras'
import { rendimentoBase, type ReceitaCalculo } from './receitas'
import { paraBase, unidadeBase, type UnidadeCompra } from './unidades'

// Estoque como livro de movimentos (+ entra, − sai), em unidade base: insumo em g/ml/un,
// preparado (receita) na unidade base do rendimento. Funções puras.
// Resultados em objetos simples (não Map): vão para o cache salvo no aparelho como JSON.

export type ItemTipo = 'insumo' | 'receita'
export type OrigemMovimento = 'compra' | 'producao' | 'contagem' | 'perda' | 'venda' | 'uso' | 'entrada'

export interface MovimentoCalc {
  item_tipo: ItemTipo
  insumo_id: string | null
  receita_id: string | null
  quantidade: number
}

/** Mesmas casas do banco (numeric(14,3)). */
export const milesimos = (n: number) => Math.round((n + Math.sign(n) * Number.EPSILON * Math.max(1, Math.abs(n))) * 1000) / 1000

export interface Saldos {
  insumos: Record<string, number>
  receitas: Record<string, number>
}

/** Saldo de cada item: soma dos movimentos dele. */
export function calcularSaldos(movimentos: MovimentoCalc[]): Saldos {
  const insumos: Record<string, number> = {}
  const receitas: Record<string, number> = {}
  for (const m of movimentos) {
    if (m.item_tipo === 'insumo' && m.insumo_id) insumos[m.insumo_id] = (insumos[m.insumo_id] ?? 0) + m.quantidade
    else if (m.item_tipo === 'receita' && m.receita_id) receitas[m.receita_id] = (receitas[m.receita_id] ?? 0) + m.quantidade
  }
  for (const k in insumos) insumos[k] = milesimos(insumos[k])
  for (const k in receitas) receitas[k] = milesimos(receitas[k])
  return { insumos, receitas }
}

export type SituacaoEstoque = 'negativo' | 'zerado' | 'acabando' | 'ok' | 'sem_minimo'

/**
 * negativo: saiu mais do que entrou (falta registrar uma compra ou contar de novo);
 * zerado; acabando: abaixo do mínimo; ok; sem_minimo: tem saldo e não tem mínimo definido.
 */
export function situacaoEstoque(saldo: number, minimo: number | null | undefined): SituacaoEstoque {
  if (saldo < 0) return 'negativo'
  if (saldo === 0) return 'zerado'
  if (minimo != null && minimo > 0) return saldo < minimo ? 'acabando' : 'ok'
  return 'sem_minimo'
}

/** Precisa de atenção (entra no alerta "acabando"). Zerado só conta se tiver mínimo definido. */
export function precisaComprar(saldo: number, minimo: number | null | undefined): boolean {
  if (minimo == null || !(minimo > 0)) return saldo < 0
  return saldo < minimo
}

/**
 * Quantas embalagens comprar para voltar ao mínimo (pelo menos 1 quando está abaixo dele).
 * Ex.: mínimo 2000 g, tem 500 g, embalagem 1 kg → 2 pacotes.
 */
export function embalagensParaRepor(
  saldo: number,
  minimo: number | null | undefined,
  embalagem: { qtd: number; unidade: UnidadeCompra },
): number {
  if (!precisaComprar(saldo, minimo)) return 0
  const porEmbalagem = paraBase(embalagem.qtd, embalagem.unidade)
  if (!(porEmbalagem > 0)) return 1
  const falta = (minimo ?? 0) - saldo
  return Math.max(1, Math.ceil(milesimos(falta / porEmbalagem)))
}

/** Movimento de contagem: a diferença entre o que foi contado e o saldo atual (0 = nada a lançar). */
export function ajusteContagem(saldoAtual: number, contado: number): number {
  if (!(contado >= 0)) return 0
  return milesimos(contado - saldoAtual)
}

// ---- Produção ---------------------------------------------------------------------

export interface PlanoProducao {
  /** O que entra do preparado produzido (unidade base do rendimento). */
  entrada: number
  /** O que sai de cada insumo (g/ml/un). */
  insumos: Record<string, number>
  /** O que sai de cada preparado usado pronto do estoque (sub-receita). */
  receitas: Record<string, number>
}

/**
 * O que a produção movimenta. Desce nas sub-receitas como em explodirInsumos, mas uma
 * sub-receita em `usarDoEstoque` é tirada pronta do estoque (não desce nos insumos dela).
 * Ex.: bolo = massa + recheio; recheio já pronto no estoque → sai recheio, e da massa saem ovos, farinha…
 */
export function planoProducao(
  receitaId: string,
  lotes: number,
  receitas: Map<string, ReceitaCalculo>,
  usarDoEstoque: ReadonlySet<string> = new Set(),
): PlanoProducao {
  const plano: PlanoProducao = { entrada: 0, insumos: {}, receitas: {} }
  const r = receitas.get(receitaId)
  if (!r || !(lotes > 0)) return plano
  plano.entrada = milesimos(rendimentoBase(r) * lotes)
  const visitando = new Set<string>()
  function descer(id: string, mult: number) {
    const rec = receitas.get(id)
    if (!rec || visitando.has(id)) return
    visitando.add(id)
    for (const item of rec.itens) {
      if (!(item.quantidade > 0)) continue
      if (item.tipo === 'insumo') {
        plano.insumos[item.id] = (plano.insumos[item.id] ?? 0) + item.quantidade * mult
      } else if (usarDoEstoque.has(item.id)) {
        plano.receitas[item.id] = (plano.receitas[item.id] ?? 0) + item.quantidade * mult
      } else {
        const sub = receitas.get(item.id)
        const base = sub ? rendimentoBase(sub) : 0
        if (base > 0) descer(item.id, mult * (item.quantidade / base))
      }
    }
    visitando.delete(id)
  }
  descer(receitaId, lotes)
  for (const k in plano.insumos) plano.insumos[k] = milesimos(plano.insumos[k])
  for (const k in plano.receitas) plano.receitas[k] = milesimos(plano.receitas[k])
  return plano
}

export interface SubReceitaPlano {
  id: string
  /** Quanto dela a produção precisa (unidade base do rendimento dela). */
  quantidade: number
  /** Nível na árvore (1 = usada direto na receita). */
  nivel: number
}

/**
 * Sub-receitas que a produção usa, para a tela perguntar "fazer agora ou usar do estoque?".
 * Só aparecem as de dentro de uma sub-receita que vai ser feita agora (se ela sai pronta do
 * estoque, o que vai dentro dela não importa).
 */
export function subReceitasDaProducao(
  receitaId: string,
  lotes: number,
  receitas: Map<string, ReceitaCalculo>,
  usarDoEstoque: ReadonlySet<string> = new Set(),
): SubReceitaPlano[] {
  const lista: SubReceitaPlano[] = []
  const visitando = new Set<string>()
  function descer(id: string, mult: number, nivel: number) {
    const rec = receitas.get(id)
    if (!rec || visitando.has(id)) return
    visitando.add(id)
    for (const item of rec.itens) {
      if (item.tipo !== 'receita' || !(item.quantidade > 0)) continue
      const sub = receitas.get(item.id)
      if (!sub) continue
      const qtd = item.quantidade * mult
      const ja = lista.find((s) => s.id === item.id)
      if (ja) ja.quantidade += qtd
      else lista.push({ id: item.id, quantidade: qtd, nivel })
      const base = rendimentoBase(sub)
      if (!usarDoEstoque.has(item.id) && base > 0) descer(item.id, mult * (item.quantidade / base), nivel + 1)
    }
    visitando.delete(id)
  }
  if (lotes > 0) descer(receitaId, lotes, 1)
  return lista.map((s) => ({ ...s, quantidade: milesimos(s.quantidade) }))
}

/** Linhas de estoque de uma produção (sem id/data: quem grava completa). */
export function movimentosDaProducao(receitaId: string, rendimento: number, plano: PlanoProducao): (MovimentoCalc & { origem: 'producao' })[] {
  const linhas: (MovimentoCalc & { origem: 'producao' })[] = []
  if (rendimento > 0) linhas.push({ item_tipo: 'receita', receita_id: receitaId, insumo_id: null, quantidade: milesimos(rendimento), origem: 'producao' })
  for (const [id, q] of Object.entries(plano.receitas))
    if (q > 0) linhas.push({ item_tipo: 'receita', receita_id: id, insumo_id: null, quantidade: -q, origem: 'producao' })
  for (const [id, q] of Object.entries(plano.insumos))
    if (q > 0) linhas.push({ item_tipo: 'insumo', insumo_id: id, receita_id: null, quantidade: -q, origem: 'producao' })
  return linhas
}

// ---- Compra ----------------------------------------------------------------------

/**
 * Entradas no estoque de uma compra finalizada: cada item levado, de um insumo cadastrado,
 * entra com quantidade × embalagem (ex.: 3 × 1 kg = 3000 g). Embalagem em outro tipo de unidade
 * que o insumo (ex.: insumo em un, comprado em kg) fica de fora: não dá para converter.
 * Vários itens do mesmo insumo somam numa linha só.
 */
export function entradasDaCompra(
  itens: ItemCompraCalc[],
  insumos: { id: string; unidade_compra: UnidadeCompra }[],
): { insumo_id: string; quantidade: number }[] {
  const porId = new Map(insumos.map((i) => [i.id, i]))
  const soma = new Map<string, number>()
  for (const i of itens) {
    const id = insumoComprado(i)
    const ins = id ? porId.get(id) : undefined
    if (!id || !ins || !(i.qtd_comprada != null && i.qtd_comprada > 0) || !(i.embalagem_qtd > 0)) continue
    if (unidadeBase(i.embalagem_unidade) !== unidadeBase(ins.unidade_compra)) continue
    soma.set(id, (soma.get(id) ?? 0) + i.qtd_comprada * paraBase(i.embalagem_qtd, i.embalagem_unidade))
  }
  return [...soma].map(([insumo_id, q]) => ({ insumo_id, quantidade: milesimos(q) })).filter((l) => l.quantidade > 0)
}
