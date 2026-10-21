import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from './supabase'

// Acesso simples às tabelas. Com Supabase configurado, os dados vão para a nuvem
// e ficam sincronizados entre os aparelhos; sem ele, ficam salvos neste aparelho
// (localStorage), com a mesma interface.

export interface Registro {
  id: string
}

type Ordem = { coluna: string; crescente?: boolean }

export interface Banco {
  listar<T extends Registro>(tabela: string, filtro?: Record<string, string | number | boolean>, ordem?: Ordem): Promise<T[]>
  buscar<T extends Registro>(tabela: string, id: string): Promise<T | null>
  /** Insere ou atualiza pelo id. Na atualização, só as colunas enviadas mudam. Devolve a linha completa. */
  salvar<T extends Registro>(tabela: string, registro: Omit<T, 'id'> & { id?: string }): Promise<T>
  /**
   * Insere ou atualiza várias linhas de uma vez: ou grava todas, ou nenhuma.
   * Mande linhas com as mesmas colunas (ex.: não misture novas, com criado_em, e edições, sem):
   * no Supabase, linhas com colunas diferentes vão em requisições separadas e aí o
   * "tudo ou nada" vale só dentro de cada grupo.
   */
  salvarVarios<T extends Registro>(tabela: string, registros: (Omit<T, 'id'> & { id?: string })[]): Promise<T[]>
  /**
   * Altera só as colunas enviadas de uma linha que já existe (nunca cria).
   * Devolve a linha completa, ou null se ela não existe mais (ex.: apagada em outro aparelho).
   */
  atualizar<T extends Registro>(tabela: string, id: string, campos: Partial<Omit<T, 'id'>>): Promise<T | null>
  remover(tabela: string, id: string): Promise<void>
}

export function novoId(): string {
  // crypto.randomUUID só existe em contexto seguro (https ou localhost); no celular
  // abrindo o servidor de desenvolvimento por IP (http) ele não existe.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40 // versão 4
  b[8] = (b[8] & 0x3f) | 0x80 // variante
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// Ordenação igual nos dois modos: números como números, textos em ordem de dicionário
// pt-BR ("Açúcar" junto do "A", sem separar maiúsculas), vazios no fim.
// O Postgres do Supabase ordena texto byte a byte, por isso reordenamos aqui também.
const NUMERO = /^-?\d+(\.\d+)?$/
const colador = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })

function comparar(va: unknown, vb: unknown): number {
  const vazioA = va === null || va === undefined || va === ''
  const vazioB = vb === null || vb === undefined || vb === ''
  if (vazioA || vazioB) return vazioA === vazioB ? 0 : vazioA ? 1 : -1
  const na = typeof va === 'number' ? va : typeof va === 'string' && NUMERO.test(va) ? Number(va) : NaN
  const nb = typeof vb === 'number' ? vb : typeof vb === 'string' && NUMERO.test(vb) ? Number(vb) : NaN
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
  if (typeof va === 'boolean' && typeof vb === 'boolean') return Number(va) - Number(vb)
  return colador.compare(String(va), String(vb))
}

function ordenar<T>(linhas: T[], ordem?: Ordem): T[] {
  if (!ordem) return linhas
  const sinal = ordem.crescente === false ? -1 : 1
  return [...linhas].sort((a, b) => {
    const va = (a as Record<string, unknown>)[ordem.coluna]
    const vb = (b as Record<string, unknown>)[ordem.coluna]
    const c = comparar(va, vb)
    // vazios ficam no fim nos dois sentidos
    const algumVazio = [va, vb].some((v) => v === null || v === undefined || v === '')
    return algumVazio ? c : c * sinal
  })
}

const bancoSupabase = (sb: NonNullable<typeof supabase>): Banco => ({
  async listar<T extends Registro>(tabela: string, filtro?: Record<string, string | number | boolean>, ordem?: Ordem) {
    // O Supabase devolve no máximo um tanto de linhas por vez (1000 no padrão, mas o projeto pode
    // ter um limite menor): busca em páginas até vir uma vazia. Parar na página "incompleta" cortaria
    // a lista sem aviso se o limite do servidor fosse menor que a página pedida.
    const PAGINA = 500
    const todas: T[] = []
    for (let inicio = 0; ; ) {
      let q = sb.from(tabela).select('*')
      for (const [k, v] of Object.entries(filtro ?? {})) q = q.eq(k, v)
      // id como desempate deixa a paginação estável
      q = (ordem ? q.order(ordem.coluna, { ascending: ordem.crescente ?? true }) : q).order('id')
      const { data, error } = await q.range(inicio, inicio + PAGINA - 1)
      if (error) throw erroDoBanco(error)
      if (!data || data.length === 0) break
      todas.push(...(data as T[]))
      inicio += data.length
    }
    return ordenar(todas, ordem)
  },
  async buscar<T extends Registro>(tabela: string, id: string) {
    const { data, error } = await sb.from(tabela).select('*').eq('id', id).maybeSingle()
    if (error) throw erroDoBanco(error)
    return (data ?? null) as T | null
  },
  async salvar<T extends Registro>(tabela: string, registro: Omit<T, 'id'> & { id?: string }) {
    // upsert de um objeto só: no insert, colunas ausentes usam o default da tabela;
    // no update, só as colunas enviadas são alteradas.
    const linha = { ...registro, id: registro.id ?? novoId() }
    const { data, error } = await sb.from(tabela).upsert(linha, { onConflict: 'id' }).select().single()
    if (error) throw erroDoBanco(error)
    return data as T
  },
  async salvarVarios<T extends Registro>(tabela: string, registros: (Omit<T, 'id'> & { id?: string })[]) {
    if (registros.length === 0) return []
    const linhas = registros.map((r) => ({ ...r, id: r.id ?? novoId() }))
    // Num upsert de várias linhas, o PostgREST usa as colunas de todas juntas: numa linha que
    // não traz uma coluna (ex.: criado_em numa edição), a atualização gravaria o default da
    // tabela por cima do valor antigo. Por isso linhas com colunas diferentes vão em grupos
    // separados. Com linhas iguais (o normal: ver Banco.salvarVarios) é uma requisição só,
    // uma transação. defaultToNull: false → coluna ausente num registro novo usa o default.
    const grupos = new Map<string, typeof linhas>()
    for (const l of linhas) {
      const chave = Object.keys(l).sort().join(',')
      grupos.set(chave, [...(grupos.get(chave) ?? []), l])
    }
    const salvas: T[] = []
    for (const grupo of grupos.values()) {
      const { data, error } = await sb.from(tabela).upsert(grupo, { onConflict: 'id', defaultToNull: false }).select()
      if (error) throw erroDoBanco(error)
      salvas.push(...((data ?? []) as T[]))
    }
    // devolve na ordem pedida
    const porId = new Map(salvas.map((l) => [l.id, l]))
    return linhas.map((l) => porId.get(l.id)).filter((l): l is T => !!l)
  },
  async atualizar<T extends Registro>(tabela: string, id: string, campos: Partial<Omit<T, 'id'>>) {
    // update (e não upsert): não exige as colunas obrigatórias e não recria uma linha apagada.
    const { data, error } = await sb.from(tabela).update(campos as Record<string, unknown>).eq('id', id).select().maybeSingle()
    if (error) throw erroDoBanco(error)
    return (data ?? null) as T | null
  },
  async remover(tabela: string, id: string) {
    const { error } = await sb.from(tabela).delete().eq('id', id)
    if (error) throw erroDoBanco(error)
  },
})

// ---- Modo local -------------------------------------------------------------
// Se o localStorage não puder ser usado (navegação privada, armazenamento cheio ou
// bloqueado), os dados ficam só na memória até fechar a aba, sem quebrar o app.

const PREFIXO = 'euforia:'
const memoria = new Map<string, string>()
let avisou = false

function avisarSemArmazenamento(e: unknown) {
  if (avisou) return
  avisou = true
  console.warn('Euforia: não foi possível usar o armazenamento do navegador; os dados ficam só até fechar a aba.', e)
}

function lerTexto(chave: string): string | null {
  if (memoria.has(chave)) return memoria.get(chave)!
  try {
    return localStorage.getItem(chave)
  } catch (e) {
    avisarSemArmazenamento(e)
    return null
  }
}

function gravarTexto(chave: string, valor: string) {
  try {
    localStorage.setItem(chave, valor)
    memoria.delete(chave)
  } catch (e) {
    avisarSemArmazenamento(e)
    memoria.set(chave, valor)
  }
}

function lerTabela<T>(tabela: string): T[] {
  try {
    const linhas: unknown = JSON.parse(lerTexto(PREFIXO + tabela) ?? '[]')
    return Array.isArray(linhas) ? (linhas as T[]) : []
  } catch {
    return []
  }
}

function gravarTabela<T>(tabela: string, linhas: T[]) {
  gravarTexto(PREFIXO + tabela, JSON.stringify(linhas))
}

const bancoLocal: Banco = {
  async listar<T extends Registro>(tabela: string, filtro?: Record<string, string | number | boolean>, ordem?: Ordem) {
    let linhas = lerTabela<T>(tabela)
    if (filtro) {
      linhas = linhas.filter((l) => Object.entries(filtro).every(([k, v]) => (l as Record<string, unknown>)[k] === v))
    }
    return ordenar(linhas, ordem)
  },
  async buscar<T extends Registro>(tabela: string, id: string) {
    return lerTabela<T>(tabela).find((l) => l.id === id) ?? null
  },
  async salvar<T extends Registro>(tabela: string, registro: Omit<T, 'id'> & { id?: string }) {
    const linhas = lerTabela<T>(tabela)
    const linha = { ...registro, id: registro.id ?? novoId() } as T
    const i = linhas.findIndex((l) => l.id === linha.id)
    // como no Supabase: na atualização só mudam as colunas enviadas, e devolve a linha completa
    const final = i >= 0 ? ({ ...linhas[i], ...linha } as T) : linha
    if (i >= 0) linhas[i] = final
    else linhas.push(final)
    gravarTabela(tabela, linhas)
    return final
  },
  async salvarVarios<T extends Registro>(tabela: string, registros: (Omit<T, 'id'> & { id?: string })[]) {
    const linhas = lerTabela<T>(tabela)
    const salvas = registros.map((registro) => {
      const linha = { ...registro, id: registro.id ?? novoId() } as T
      const i = linhas.findIndex((l) => l.id === linha.id)
      const final = i >= 0 ? ({ ...linhas[i], ...linha } as T) : linha
      if (i >= 0) linhas[i] = final
      else linhas.push(final)
      return final
    })
    gravarTabela(tabela, linhas)
    return salvas
  },
  async atualizar<T extends Registro>(tabela: string, id: string, campos: Partial<Omit<T, 'id'>>) {
    const linhas = lerTabela<T>(tabela)
    const i = linhas.findIndex((l) => l.id === id)
    if (i < 0) return null
    linhas[i] = { ...linhas[i], ...campos, id } as T
    gravarTabela(tabela, linhas)
    return linhas[i]
  },
  async remover(tabela: string, id: string) {
    gravarTabela(
      tabela,
      lerTabela<Registro>(tabela).filter((l) => l.id !== id),
    )
  },
}

export const db: Banco = supabase ? bancoSupabase(supabase) : bancoLocal

// ---- Erros em português -----------------------------------------------------

// Mensagens de erro levantadas pelos gatilhos (raise exception '<código>'; ver supabase/migrations).
const ERROS_GATILHO: Record<string, string> = {
  baixa_sentido_invalido: 'Uma conta a pagar só pode ser baixada com uma saída (e a receber, com uma entrada).',
}

// Mensagens para restrições com nome conhecido (ver supabase/migrations).
const RESTRICOES: Record<string, string> = {
  pct_validos: 'Custos fixos + taxas + margem precisam somar menos de 100%.',
  fin_lancamentos_ofx_unico: 'Essa transação do extrato já foi importada nesta conta.',
  fin_lancamentos_ofx_unico2: 'Essa transação do extrato já foi importada nesta conta.',
  fin_lancamentos_transferencia: 'Na transferência, escolha uma conta de destino diferente da de origem.',
  fin_categorias_unica: 'Já existe uma categoria com esse nome neste grupo.',
  produtos_variacoes_formato: 'Confira as variações: o produto precisa de pelo menos uma, cada uma com nome, e os ajustes de % precisam somar menos de 100%.',
  insumos_codigo_barras_check: 'O código de barras precisa ter só números (de 6 a 14).',
  compra_itens_levou: 'Informe a quantidade que pegou.',
  compra_itens_troca: 'Escolha o produto que levou no lugar.',
  compra_itens_nao: 'Escolha o motivo de não ter levado.',
}

function erroDoBanco(error: Pick<PostgrestError, 'message' | 'code'> & { details?: string | null }): Error {
  return new Error(traduzirErro(error.message ?? '', error.code ?? '', error.details ?? ''))
}

function traduzirErro(msg: string, codigo = '', detalhes = ''): string {
  const tudo = `${msg} ${detalhes}`
  if (/Failed to fetch|NetworkError|Load failed|network|fetch failed/i.test(tudo)) return 'Sem conexão com a internet. Tente de novo.'
  if (codigo === 'PGRST301' || codigo === 'PGRST303' || /JWT/i.test(msg)) return 'Sua sessão expirou. Entre de novo.'
  if (codigo === '42501' || /permission denied|row-level security/i.test(msg)) return 'Sem permissão para isso. Saia e entre de novo.'
  const gatilho = Object.keys(ERROS_GATILHO).find((c) => msg.includes(c))
  if (gatilho) return ERROS_GATILHO[gatilho]
  const restricao = /constraint "([^"]+)"/.exec(msg)?.[1]
  if (restricao && RESTRICOES[restricao]) return RESTRICOES[restricao]
  switch (codigo) {
    case '23514':
      return 'Algum valor está fora do permitido. Confira os campos.'
    case '23502':
      return 'Preencha todos os campos obrigatórios.'
    case '23505':
      return 'Já existe um registro igual a este.'
    case '23503':
      return /delete|update or delete/i.test(msg)
        ? 'Não dá para apagar: este item está sendo usado em outro cadastro.'
        : 'Este item está ligado a um registro que não existe mais.'
    case '22P02':
    case '22007':
    case '22008':
      return 'Algum valor está num formato inválido. Confira os campos.'
    case '22003':
      return 'Algum número está grande demais.'
    case '22001':
      return 'Algum texto está comprido demais.'
    case 'PGRST116':
      return 'Registro não encontrado.'
  }
  return msg ? `Erro ao acessar os dados: ${msg}` : 'Erro ao acessar os dados. Tente de novo.'
}
