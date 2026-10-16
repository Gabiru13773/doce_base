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
    let q = sb.from(tabela).select('*')
    for (const [k, v] of Object.entries(filtro ?? {})) q = q.eq(k, v)
    if (ordem) q = q.order(ordem.coluna, { ascending: ordem.crescente ?? true })
    const { data, error } = await q
    if (error) throw erroDoBanco(error)
    return ordenar((data ?? []) as T[], ordem)
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
  async remover(tabela: string, id: string) {
    gravarTabela(
      tabela,
      lerTabela<Registro>(tabela).filter((l) => l.id !== id),
    )
  },
}

export const db: Banco = supabase ? bancoSupabase(supabase) : bancoLocal

// ---- Erros em português -----------------------------------------------------

// Mensagens para restrições com nome conhecido (ver supabase/migrations).
const RESTRICOES: Record<string, string> = {
  pct_validos: 'Custos fixos + taxas + margem precisam somar menos de 100%.',
}

function erroDoBanco(error: Pick<PostgrestError, 'message' | 'code'> & { details?: string | null }): Error {
  return new Error(traduzirErro(error.message ?? '', error.code ?? '', error.details ?? ''))
}

function traduzirErro(msg: string, codigo = '', detalhes = ''): string {
  const tudo = `${msg} ${detalhes}`
  if (/Failed to fetch|NetworkError|Load failed|network|fetch failed/i.test(tudo)) return 'Sem conexão com a internet. Tente de novo.'
  if (codigo === 'PGRST301' || codigo === 'PGRST303' || /JWT/i.test(msg)) return 'Sua sessão expirou. Entre de novo.'
  if (codigo === '42501' || /permission denied|row-level security/i.test(msg)) return 'Sem permissão para isso. Saia e entre de novo.'
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
