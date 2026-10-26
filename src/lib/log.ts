// Registro do que acontece no app, para achar bugs: vai para o console do navegador (com o
// prefixo [Euforia]) e fica guardado neste aparelho (últimos eventos), para ver na tela
// Diagnóstico — no celular não dá para abrir o console.
// Nunca registre senhas nem o conteúdo das linhas (só tabela, ids, quantidades e erros).

export type NivelLog = 'debug' | 'info' | 'warn' | 'error'

export interface EntradaLog {
  /** horário ISO */
  t: string
  nivel: NivelLog
  /** parte do app: db, consulta, salvar, tela, fila-vendas, auth, app… */
  area: string
  msg: string
  /** detalhes em texto (já resumido) */
  dados?: string
}

const CHAVE = 'euforia:logs'
const MAXIMO = 400
const MAX_DADOS = 600

let entradas: EntradaLog[] = carregar()
let timer: ReturnType<typeof setTimeout> | undefined
const ouvintes = new Set<() => void>()

function carregar(): EntradaLog[] {
  try {
    const l: unknown = JSON.parse(localStorage.getItem(CHAVE) ?? '[]')
    return Array.isArray(l) ? (l as EntradaLog[]).slice(-MAXIMO) : []
  } catch {
    return []
  }
}

function gravarAgora() {
  clearTimeout(timer)
  timer = undefined
  try {
    localStorage.setItem(CHAVE, JSON.stringify(entradas))
  } catch {
    /* sem espaço: os eventos ficam só na memória */
  }
}

function guardar(urgente = false) {
  // Erros e avisos vão na hora (a página pode recarregar logo depois); o resto junta várias
  // gravações seguidas numa só (o app registra muita coisa ao abrir uma tela).
  if (urgente) return gravarAgora()
  clearTimeout(timer)
  timer = setTimeout(gravarAgora, 1000)
}

function resumir(dados: unknown): string | undefined {
  if (dados === undefined) return undefined
  let s: string
  if (dados instanceof Error) s = `${dados.name}: ${dados.message}${dados.stack ? `\n${dados.stack.split('\n').slice(1, 4).join('\n')}` : ''}`
  else if (typeof dados === 'string') s = dados
  else {
    try {
      s = JSON.stringify(dados, (_k, v) => (v instanceof Error ? `${v.name}: ${v.message}` : v))
    } catch {
      s = String(dados)
    }
  }
  return s.length > MAX_DADOS ? `${s.slice(0, MAX_DADOS)}…` : s
}

const COR: Record<NivelLog, string> = { debug: '#888', info: '#8a4b6b', warn: '#b26b00', error: '#c0392b' }

export function registrar(nivel: NivelLog, area: string, msg: string, dados?: unknown) {
  const e: EntradaLog = { t: new Date().toISOString(), nivel, area, msg, dados: resumir(dados) }
  entradas = [...entradas.slice(-(MAXIMO - 1)), e]
  guardar(nivel === 'warn' || nivel === 'error')
  for (const o of ouvintes) o()
  const metodo = nivel === 'debug' ? console.debug : nivel === 'info' ? console.info : nivel === 'warn' ? console.warn : console.error
  const args: unknown[] = [`%c[Euforia]%c ${area}: ${msg}`, `color:${COR[nivel]};font-weight:bold`, 'color:inherit']
  if (dados !== undefined) args.push(dados)
  metodo(...args)
}

export const log = {
  /** operações normais (consultas ao banco): no Chrome aparecem com o nível "Detalhado/Verbose" */
  debug: (area: string, msg: string, dados?: unknown) => registrar('debug', area, msg, dados),
  info: (area: string, msg: string, dados?: unknown) => registrar('info', area, msg, dados),
  warn: (area: string, msg: string, dados?: unknown) => registrar('warn', area, msg, dados),
  error: (area: string, msg: string, dados?: unknown) => registrar('error', area, msg, dados),
}

export function lerLogs(): EntradaLog[] {
  return entradas
}

export function ouvirLogs(o: () => void): () => void {
  ouvintes.add(o)
  return () => ouvintes.delete(o)
}

export function limparLogs() {
  entradas = []
  guardar()
  for (const o of ouvintes) o()
}

/** Texto para copiar/baixar e mandar para quem vai investigar. */
export function textoLogs(lista: EntradaLog[] = entradas): string {
  const cab = [
    `Euforia — diagnóstico gerado em ${new Date().toLocaleString('pt-BR')}`,
    `Navegador: ${navigator.userAgent}`,
    `Endereço: ${location.href}`,
    `Internet: ${navigator.onLine ? 'conectado' : 'sem conexão'}`,
    '',
  ]
  const linhas = lista.map((e) => {
    const hora = new Date(e.t).toLocaleString('pt-BR')
    return `${hora} ${e.nivel.toUpperCase().padEnd(5)} ${e.area}: ${e.msg}${e.dados ? `\n    ${e.dados.replace(/\n/g, '\n    ')}` : ''}`
  })
  return [...cab, ...linhas].join('\n')
}

let instalado = false

/** Erros soltos, internet caindo/voltando e atalhos no console (window.euforia). */
export function instalarLogsGlobais(info: Record<string, unknown>) {
  if (instalado || typeof window === 'undefined') return
  instalado = true
  log.info('app', 'App aberto', info)
  window.addEventListener('error', (ev) => log.error('app', 'Erro não tratado', ev.error ?? `${ev.message} (${ev.filename}:${ev.lineno})`))
  window.addEventListener('unhandledrejection', (ev) => log.error('app', 'Promessa rejeitada sem tratamento', ev.reason))
  // ao sair/recarregar ou ir para segundo plano (celular), grava o que falta
  window.addEventListener('pagehide', () => timer !== undefined && gravarAgora())
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && timer !== undefined && gravarAgora())
  window.addEventListener('online', () => log.info('rede', 'Internet voltou'))
  window.addEventListener('offline', () => log.warn('rede', 'Sem internet'))
  ;(window as unknown as { euforia: unknown }).euforia = {
    /** mostra os eventos guardados numa tabela */
    logs: () => console.table(entradas.map((e) => ({ hora: new Date(e.t).toLocaleTimeString('pt-BR'), nivel: e.nivel, area: e.area, msg: e.msg, dados: e.dados ?? '' }))),
    /** só os erros e avisos */
    erros: () => console.table(entradas.filter((e) => e.nivel === 'error' || e.nivel === 'warn')),
    /** texto completo, para copiar */
    texto: () => textoLogs(),
    limpar: limparLogs,
  }
}
