import { useNavigate } from 'react-router-dom'

// Ajudantes das telas do financeiro (datas em texto AAAA-MM-DD, busca, voltar).

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

function partes(data: string) {
  const [a, m, d] = data.split('-').map(Number)
  return { a, m, d }
}

/** "2026-10" → "outubro de 2026" */
export function nomeMes(mes: string): string {
  const { a, m } = partes(`${mes}-01`)
  return `${MESES[m - 1] ?? ''} de ${a}`
}

/** "2026-10" + 1 → "2026-11" */
export function somarMes(mes: string, n: number): string {
  const { a, m } = partes(`${mes}-01`)
  const total = a * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** Último dia do mês "2026-10" → "2026-10-31" */
export function fimDoMes(mes: string): string {
  const { a, m } = partes(`${mes}-01`)
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`
}

/** "2026-10-20" → "20/10/2026" */
export function dataBr(data: string): string {
  const { a, m, d } = partes(data)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}`
}

/** "2026-10-20" → "terça, 20 de outubro" (com "Hoje"/"Ontem" quando for o caso). */
export function diaPorExtenso(data: string, hoje: string): string {
  const { a, m, d } = partes(data)
  const semana = DIAS[new Date(a, m - 1, d).getDay()]
  const texto = `${d} de ${MESES[m - 1]}`
  if (data === hoje) return `Hoje, ${texto}`
  const ontem = new Date(a, m - 1, d + 1)
  const h = partes(hoje)
  if (ontem.getFullYear() === h.a && ontem.getMonth() === h.m - 1 && ontem.getDate() === h.d) return `Ontem, ${texto}`
  return `${semana}, ${texto}`
}

/** Minúsculas e sem acentos, para a busca achar "acucar" em "Açúcar". */
export function simplificar(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

export function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : 'tente novamente'
}

/** Volta para a tela anterior do app; se a tela foi aberta direto (sem histórico), vai para `padrao`. */
export function useVoltar(padrao: string) {
  const navegar = useNavigate()
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navegar(-1)
    else navegar(padrao, { replace: true })
  }
}

// Última conta usada no lançamento (só neste aparelho, para agilizar).
const CHAVE_ULTIMA_CONTA = 'euforia-fin-ultima-conta'

export function lerUltimaConta(): string | null {
  try {
    return localStorage.getItem(CHAVE_ULTIMA_CONTA)
  } catch {
    return null
  }
}

export function gravarUltimaConta(id: string) {
  try {
    localStorage.setItem(CHAVE_ULTIMA_CONTA, id)
  } catch {
    // sem armazenamento: só não lembra
  }
}
