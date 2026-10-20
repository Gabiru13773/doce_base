// Leitura de extratos bancários no formato OFX (o "Money" dos bancos).
// Aceita OFX 1.x (SGML: tags sem fechamento) e OFX 2.x (XML), extrato de conta (STMTRS)
// e de cartão de crédito (CCSTMTRS), e as manias dos bancos brasileiros: vírgula decimal,
// datas com fuso "[-3:BRT]", FITID faltando ou repetido, acentos em Latin-1, &amp; etc.
// Funções puras, sem dependências.

export interface TransacaoOfx {
  /** Identificador da transação no banco (único dentro do arquivo; gerado quando o banco não manda). */
  fitid: string
  /** AAAA-MM-DD */
  data: string
  /** Com sinal: negativo = saiu, positivo = entrou. */
  valor: number
  /** TRNTYPE (DEBIT, CREDIT, PAYMENT, FEE, XFER…). */
  tipo: string
  /** NAME e MEMO juntos, sem repetir. */
  descricao: string
  /** CHECKNUM ou REFNUM. */
  documento?: string
}

export interface ExtratoOfx {
  /** Nome (ORG) ou código (BANKID) do banco. */
  banco?: string
  /** Número da conta (ACCTID). */
  conta?: string
  agencia?: string
  moeda?: string
  /** Período do extrato (AAAA-MM-DD). */
  inicio?: string
  fim?: string
  /** Saldo final informado pelo banco (LEDGERBAL). */
  saldoFinal?: number
  saldoEm?: string
  /** Extrato de cartão de crédito (CCSTMTRS). */
  cartaoCredito?: boolean
  transacoes: TransacaoOfx[]
}

export const ERRO_NAO_E_OFX =
  'Este arquivo não parece ser um extrato OFX. Confira se você baixou o extrato no formato OFX (às vezes chamado de "Money") e não em PDF ou planilha.'

// ---- Texto do arquivo ---------------------------------------------------------------------

/**
 * Converte os bytes do arquivo em texto, respeitando a codificação do cabeçalho
 * (CHARSET:1252 / ISO-8859-1 → windows-1252; senão UTF-8). Se o UTF-8 vier com
 * caracteres inválidos, tenta de novo como windows-1252 (o caso mais comum nos bancos).
 */
export function decodificarOfx(bytes: ArrayBuffer | Uint8Array): string {
  const dados = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  // O cabeçalho é sempre ASCII: lê os primeiros bytes "como vierem" para achar a codificação.
  let inicio = ''
  for (let i = 0; i < Math.min(dados.length, 2048); i++) inicio += String.fromCharCode(dados[i])
  const charset = /CHARSET\s*:\s*([^\s<]+)/i.exec(inicio)?.[1] ?? ''
  const encoding = /ENCODING\s*:\s*([^\s<]+)/i.exec(inicio)?.[1] ?? /encoding\s*=\s*["']([^"']+)["']/i.exec(inicio)?.[1] ?? ''
  const latin1 = /1252|8859|latin/i.test(charset) || /1252|8859|latin/i.test(encoding)
  const decodificar = (rotulo: string) => new TextDecoder(rotulo).decode(dados)
  let texto: string
  if (latin1) texto = decodificar('windows-1252')
  else {
    texto = decodificar('utf-8')
    if (texto.includes('�')) texto = decodificar('windows-1252')
  }
  return texto.replace(/^﻿/, '')
}

// ---- Árvore de tags ------------------------------------------------------------------------

interface No {
  nome: string
  valor?: string
  filhos: No[]
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodificarEntidades(t: string): string {
  return t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (tudo, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : tudo
    }
    return ENTIDADES[e.toLowerCase()] ?? tudo
  })
}

const limparTexto = (t: string) => decodificarEntidades(t).replace(/\s+/g, ' ').trim()

/** Agregados que alguns bancos esquecem de fechar: abrir outro igual fecha o anterior. */
const REPETIVEIS = new Set(['STMTTRN'])

/**
 * Monta a árvore aceitando SGML e XML: uma tag seguida de texto é uma folha (com ou sem
 * fechamento); uma tag seguida de outra tag é um agregado, fechado pela sua tag de fechamento.
 */
function montarArvore(corpo: string): No {
  const raiz: No = { nome: '#raiz', filhos: [] }
  const pilha: No[] = [raiz]
  const re = /<([/!?]?)([A-Za-z0-9_.:-]*)[^>]*?(\/?)>/g
  const tags: { fecha: boolean; nome: string; vazia: boolean; ini: number; fim: number }[] = []
  for (let m = re.exec(corpo); m; m = re.exec(corpo)) {
    if (m[1] === '!' || m[1] === '?' || !m[2]) continue
    tags.push({ fecha: m[1] === '/', nome: m[2].toUpperCase(), vazia: m[3] === '/', ini: m.index, fim: m.index + m[0].length })
  }
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i]
    const topo = pilha[pilha.length - 1]
    if (t.fecha) {
      // fecha o agregado com esse nome (e o que ficou aberto dentro dele); fechamento de folha é ignorado
      const pos = pilha.map((n) => n.nome).lastIndexOf(t.nome)
      if (pos > 0) pilha.length = pos
      continue
    }
    if (t.vazia) {
      topo.filhos.push({ nome: t.nome, valor: '', filhos: [] })
      continue
    }
    const proxima = tags[i + 1]
    const texto = corpo.slice(t.fim, proxima ? proxima.ini : corpo.length)
    if (texto.trim() !== '' || (proxima && proxima.fecha && proxima.nome === t.nome)) {
      topo.filhos.push({ nome: t.nome, valor: limparTexto(texto), filhos: [] })
      continue
    }
    if (REPETIVEIS.has(t.nome)) {
      const pos = pilha.map((n) => n.nome).lastIndexOf(t.nome)
      if (pos > 0) pilha.length = pos
    }
    const no: No = { nome: t.nome, filhos: [] }
    pilha[pilha.length - 1].filhos.push(no)
    pilha.push(no)
  }
  return raiz
}

function procurarTodos(no: No, nome: string, saida: No[] = []): No[] {
  for (const f of no.filhos) {
    if (f.nome === nome) saida.push(f)
    else procurarTodos(f, nome, saida)
  }
  return saida
}

function procurar(no: No | undefined, nome: string): No | undefined {
  if (!no) return undefined
  for (const f of no.filhos) {
    if (f.nome === nome) return f
    const achou = procurar(f, nome)
    if (achou) return achou
  }
  return undefined
}

/** Valor de uma folha filha direta (ou neta, quando o banco aninha diferente). */
function campo(no: No | undefined, nome: string): string | undefined {
  const f = procurar(no, nome)
  return f?.valor !== undefined && f.valor !== '' ? f.valor : undefined
}

// ---- Valores e datas -----------------------------------------------------------------------

/** "-12.50", "-12,50", "1.234,56", "1,234.56", "+50", "12.50-" → número (NaN se não der). */
export function lerValorOfx(texto: string | undefined): number {
  if (!texto) return NaN
  let t = texto.replace(/\s/g, '').replace(/^R\$/i, '')
  let negativo = false
  if (/-$/.test(t)) {
    negativo = true
    t = t.slice(0, -1)
  }
  if (/^[+-]/.test(t)) {
    negativo = negativo !== (t[0] === '-')
    t = t.slice(1)
  }
  const virgula = t.lastIndexOf(',')
  const ponto = t.lastIndexOf('.')
  if (virgula >= 0 && ponto >= 0) {
    // o separador que aparece por último é o decimal
    t = virgula > ponto ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  } else if (virgula >= 0) {
    t = (t.match(/,/g)!.length > 1 ? t.replace(/,(?=.*,)/g, '') : t).replace(',', '.')
  } else if ((t.match(/\./g) ?? []).length > 1) {
    t = t.replace(/\.(?=.*\.)/g, '')
  }
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return NaN
  const n = Number(t)
  return Math.round((negativo ? -n : n) * 100) / 100
}

/** "20261015120000[-3:BRT]", "20261015", "2026-10-15" → "2026-10-15" (a data como o banco escreveu). */
export function lerDataOfx(texto: string | undefined): string | undefined {
  if (!texto) return undefined
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(texto.trim())
  if (!m) return undefined
  const [, a, me, d] = m
  const data = new Date(Date.UTC(Number(a), Number(me) - 1, Number(d)))
  if (data.getUTCFullYear() !== Number(a) || data.getUTCMonth() !== Number(me) - 1 || data.getUTCDate() !== Number(d)) return undefined
  return `${a}-${me}-${d}`
}

// ---- Descrição e identificadores -----------------------------------------------------------

const simples = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Junta NAME e MEMO sem repetir (NAME costuma vir cortado em 32 letras e MEMO completo). */
export function juntarDescricao(nome: string | undefined, memo: string | undefined): string {
  const a = (nome ?? '').trim()
  const b = (memo ?? '').trim()
  if (!a) return b
  if (!b) return a
  const sa = simples(a)
  const sb = simples(b)
  if (!sa) return b
  if (!sb) return a
  if (sb.includes(sa)) return b
  if (sa.includes(sb)) return a
  return `${a} - ${b}`
}

/** Hash curto e estável (cyrb53) em base 36. */
export function hashTexto(texto: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

const ROTULO_TIPO: Record<string, string> = {
  CREDIT: 'Crédito',
  DEBIT: 'Débito',
  INT: 'Juros',
  DIV: 'Dividendos',
  FEE: 'Tarifa',
  SRVCHG: 'Tarifa de serviço',
  DEP: 'Depósito',
  ATM: 'Saque',
  POS: 'Compra no cartão',
  XFER: 'Transferência',
  CHECK: 'Cheque',
  PAYMENT: 'Pagamento',
  CASH: 'Saque',
  DIRECTDEP: 'Depósito',
  DIRECTDEBIT: 'Débito automático',
  REPEATPMT: 'Pagamento recorrente',
}

/** Tipos que, num extrato de conta sem sinal nenhum negativo, indicam saída. */
const TIPOS_SAIDA = new Set(['DEBIT', 'FEE', 'SRVCHG', 'ATM', 'CHECK', 'CASH', 'DIRECTDEBIT', 'PAYMENT', 'REPEATPMT', 'POS'])

// ---- Leitura -------------------------------------------------------------------------------

export function lerOfx(texto: string): ExtratoOfx {
  const normal = (texto ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const posOfx = normal.search(/<OFX[\s>]/i)
  const corpo = posOfx >= 0 ? normal.slice(posOfx) : normal
  const raiz = montarArvore(corpo)

  const extratos = [...procurarTodos(raiz, 'STMTRS'), ...procurarTodos(raiz, 'CCSTMTRS')]
  const cartaoCredito = extratos.length > 0 && extratos.every((e) => e.nome === 'CCSTMTRS')
  const listas = procurarTodos(raiz, 'BANKTRANLIST')
  let brutos = procurarTodos(raiz, 'STMTTRN')
  if (brutos.length === 0 && listas.length === 0) throw new Error(ERRO_NAO_E_OFX)

  const principal = extratos[0]
  const lista = listas[0]
  const contaDe = procurar(principal ?? raiz, 'BANKACCTFROM') ?? procurar(principal ?? raiz, 'CCACCTFROM')
  const saldo = procurar(principal ?? raiz, 'LEDGERBAL')
  const fi = procurar(raiz, 'FI')
  const saldoFinal = lerValorOfx(campo(saldo, 'BALAMT'))

  // Só transações com data e valor válidos.
  brutos = brutos.filter((t) => lerDataOfx(campo(t, 'DTPOSTED') ?? campo(t, 'DTUSER') ?? campo(t, 'DTAVAIL')) && Number.isFinite(lerValorOfx(campo(t, 'TRNAMT'))))

  let transacoes = brutos.map((t) => {
    const tipo = (campo(t, 'TRNTYPE') ?? 'OTHER').toUpperCase()
    const descricao =
      juntarDescricao(campo(t, 'NAME') ?? campo(procurar(t, 'PAYEE'), 'NAME'), campo(t, 'MEMO')) || ROTULO_TIPO[tipo] || 'Transação'
    const documento = campo(t, 'CHECKNUM') ?? campo(t, 'REFNUM')
    return {
      fitid: (campo(t, 'FITID') ?? '').trim(),
      data: lerDataOfx(campo(t, 'DTPOSTED') ?? campo(t, 'DTUSER') ?? campo(t, 'DTAVAIL'))!,
      valor: lerValorOfx(campo(t, 'TRNAMT')),
      tipo,
      descricao: descricao.slice(0, 300),
      ...(documento ? { documento } : {}),
    } satisfies TransacaoOfx
  })

  // Alguns bancos mandam tudo positivo e o sentido só no TRNTYPE.
  if (!cartaoCredito && transacoes.length > 0 && transacoes.every((t) => t.valor >= 0)) {
    transacoes = transacoes.map((t) => (TIPOS_SAIDA.has(t.tipo) ? { ...t, valor: -t.valor } : t))
  }

  // FITID: gera quando falta e desempata quando o banco repete.
  const ocorrencias = new Map<string, number>()
  const usados = new Set<string>()
  for (const t of transacoes) {
    if (t.fitid) continue
    const chave = `${t.data}|${t.valor.toFixed(2)}|${simples(t.descricao)}`
    const n = (ocorrencias.get(chave) ?? 0) + 1
    ocorrencias.set(chave, n)
    t.fitid = `gerado-${hashTexto(`${chave}|${n}`)}`
  }
  for (const t of transacoes) {
    if (!usados.has(t.fitid)) {
      usados.add(t.fitid)
      continue
    }
    // repetido: o primeiro fica com o original; os outros ganham um sufixo pelo conteúdo
    const base = `${t.fitid}-${hashTexto(`${t.data}|${t.valor.toFixed(2)}|${simples(t.descricao)}`)}`
    let novo = base
    for (let n = 2; usados.has(novo); n++) novo = `${base}-${n}`
    t.fitid = novo
    usados.add(novo)
  }

  const resultado: ExtratoOfx = { transacoes }
  const banco = campo(fi, 'ORG') ?? campo(contaDe, 'BANKID')
  if (banco) resultado.banco = banco
  const conta = campo(contaDe, 'ACCTID')
  if (conta) resultado.conta = conta
  const agencia = campo(contaDe, 'BRANCHID')
  if (agencia) resultado.agencia = agencia
  const moeda = campo(principal, 'CURDEF')
  if (moeda) resultado.moeda = moeda
  const ini = lerDataOfx(campo(lista, 'DTSTART'))
  if (ini) resultado.inicio = ini
  const fim = lerDataOfx(campo(lista, 'DTEND'))
  if (fim) resultado.fim = fim
  if (Number.isFinite(saldoFinal)) resultado.saldoFinal = saldoFinal
  const saldoEm = lerDataOfx(campo(saldo, 'DTASOF'))
  if (saldoEm) resultado.saldoEm = saldoEm
  if (cartaoCredito) resultado.cartaoCredito = true
  return resultado
}
