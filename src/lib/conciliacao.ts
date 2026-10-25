// Conciliação do extrato: para cada transação do OFX, sugere o que ela é
// (baixa de uma conta a pagar/receber, uma categoria, uma transferência) e avisa
// o que já foi importado ou parece repetido. Funções puras; tudo em O(n) com índices.

import type { CategoriaFin, ContaFin, DadosLancamento, Lancamento, Titulo } from '../modules/financeiro/api'
import { baixasPorTitulo, situacaoTitulo } from './financeiro'
import { hashTexto, type TransacaoOfx } from './ofx'

export type Confianca = 'alta' | 'media' | 'baixa'
export type Direcao = 'entrada' | 'saida'

export interface SugestaoTitulo {
  tituloId: string
  confianca: Confianca
  /** Dias entre o vencimento e a data da transação (positivo = pago depois do vencimento). */
  dias: number
  /** Quanto falta pagar/receber no título. */
  falta: number
  pontos: number
}

export type FormaPdv = 'pix' | 'debito' | 'credito' | 'ifood'

/**
 * Recebimento das vendas do PDV (o fechamento do caixa cria uma conta a receber por forma e por dia,
 * pelo valor líquido). O banco não paga do mesmo jeito: Pix cai um crédito por cliente (cada um baixa
 * parte da conta do dia), cartão cai de uma vez com centavos de diferença e o iFood repassa a semana
 * toda num crédito só (baixa várias contas, um lançamento para cada).
 */
export interface SugestaoPdv {
  tipo: 'parcial' | 'aproximado' | 'soma'
  forma: FormaPdv
  confianca: Confianca
  /**
   * Contas do PDV e quanto esta linha baixa de cada uma (na soma, a última fica com a diferença de
   * centavos, para a soma bater com o banco). `falta` é quanto faltava antes desta linha (no Pix,
   * já descontadas as linhas anteriores do mesmo arquivo); `dia` é o dia das vendas.
   */
  titulos: { tituloId: string; valor: number; falta: number; vencimento: string; dia: string }[]
  /** Banco − o que faltava (aproximado e soma; no parcial é negativo: a parte que continua em aberto). */
  diferenca: number
  /** Quanto continua em aberto nessas contas depois desta linha (0 quando quita; negativo = veio a mais). */
  restante: number
}

export interface LinhaImportacao {
  transacao: TransacaoOfx
  direcao: Direcao
  /** Já existe um lançamento desta conta com o mesmo FITID (e o mesmo sentido e valor). */
  jaImportada: boolean
  /**
   * Um lançamento parecido (mesmo valor, mesma data ±2 dias) já foi anotado à mão, ou um
   * lançamento desta conta tem o mesmo FITID mas outro valor/sentido (banco que reaproveita FITID).
   */
  possivelDuplicata: boolean
  duplicataDe: string | null
  /** Melhor conta a pagar/receber para dar baixa (só quando a certeza é razoável). */
  titulo: SugestaoTitulo | null
  /** Outras contas a pagar/receber com o mesmo valor e vencimento próximo. */
  alternativas: SugestaoTitulo[]
  /**
   * Recebimento das vendas do PDV. No parcial e no aproximado, `titulo` aponta para a mesma conta;
   * na soma (repasse do iFood), `titulo` fica vazio e a linha baixa todas as contas de `pdv.titulos`.
   */
  pdv: SugestaoPdv | null
  categoriaId: string | null
  confiancaCategoria: Confianca | null
  /** De onde veio a categoria sugerida. */
  origemCategoria: 'historico' | 'regra' | 'titulo' | null
  talvezTransferencia: boolean
  /** A outra conta da transferência, quando dá para saber. */
  contaTransferenciaId: string | null
  /** Descrição arrumada para o lançamento. */
  descricao: string
  pessoa: string | null
  formaPagamento: string | null
}

export interface ContextoConciliacao {
  contaId: string
  lancamentos: (Pick<
    Lancamento,
    'id' | 'tipo' | 'data' | 'descricao' | 'pessoa' | 'categoria_id' | 'conta_id' | 'conta_destino_id' | 'valor' | 'titulo_id' | 'ofx_fitid'
  > &
    Partial<Pick<Lancamento, 'ofx_conta_id'>>)[]
  titulos: (Pick<Titulo, 'id' | 'tipo' | 'descricao' | 'pessoa' | 'categoria_id' | 'valor' | 'vencimento'> &
    Partial<Pick<Titulo, 'emissao' | 'fechamento_id' | 'forma_pdv'>>)[]
  categorias: Pick<CategoriaFin, 'id' | 'tipo' | 'nome' | 'ativo'>[]
  /** Outras contas (para reconhecer transferências entre contas próprias). */
  contas?: Pick<ContaFin, 'id' | 'nome' | 'tipo' | 'ativo'>[]
  hoje: string
  /** Extrato de cartão de crédito (muda a forma de pagamento sugerida). */
  cartaoCredito?: boolean
}

// ---- Texto ---------------------------------------------------------------------------------

/** Maiúsculas, sem acentos, só letras/números/espaço. */
export function normalizar(t: string | null | undefined): string {
  return (t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/&/g, ' E ')
    .replace(/[^A-Z0-9*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Palavras que aparecem em quase todo extrato e não dizem quem/o quê. */
const RUIDO = new Set(
  (
    'PIX TED DOC TEF TRANSF TRANSFERENCIA TRANSFERENCIAS ENVIADO ENVIADA ENVIO ENV RECEBIDO RECEBIDA RECEBIMENTO REC RECEB ' +
    'PAGAMENTO PAGAMENTOS PAGTO PGTO PAG PG COMPRA COMPRAS CARTAO DEBITO DEB CREDITO CRED DE DA DO DAS DOS PARA PELO PELA ' +
    'COM EM NO NA NOS NAS E A O AS OS AO LTDA ME EIRELI SA S A EPP MEI BOLETO TITULO AUT AUTOMATICO CONTA CC AG AGENCIA QR QRS ' +
    'CODE VIA REF NR N NUM ELO VISA MASTER MASTERCARD MAESTRO ELECTRON INTERNET BANKING IB SISPAG BCO BANCO SAQUE DEPOSITO ' +
    'CONV DEBITO OUTRA OUTRO TIT TRANSACAO VALOR CPF CNPJ APP'
  ).split(' '),
)

/** Palavras-chave de uma descrição (sem ruído, sem números, sem acento). */
export function palavrasChave(...textos: (string | null | undefined)[]): string[] {
  const saida: string[] = []
  for (const t of textos) {
    for (const p of normalizar(t).replace(/\*/g, ' ').split(' ')) {
      if (p.length < 2 || /\d/.test(p) || RUIDO.has(p)) continue
      if (!saida.includes(p)) saida.push(p)
    }
  }
  return saida
}

/** Quanto das palavras de `alvo` aparece em `fonte` (0 a 1); aceita nome cortado ("JOSE IMOV" ~ "IMOVEIS"). */
function semelhanca(fonte: string[], alvo: string[]): number {
  if (alvo.length === 0 || fonte.length === 0) return 0
  let achou = 0
  for (const a of alvo) {
    if (fonte.some((f) => f === a || (f.length >= 4 && a.length >= 4 && (f.startsWith(a) || a.startsWith(f))))) achou++
  }
  return achou / alvo.length
}

const PALAVRAS_MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'para', 'por', 'com', 'a', 'o'])
const SIGLAS = new Set(['PIX', 'TED', 'DOC', 'TEF', 'MEI', 'IOF', 'CPF', 'CNPJ', 'SA', 'S.A.', 'BB', 'CEF', 'DARF', 'GPS', 'FGTS', 'INSS', 'IPVA', 'IPTU', 'ME', 'EPP'])

/** "PIX ENVIADO JOSE DA SILVA" → "PIX Enviado Jose da Silva" (só mexe em textos todos em maiúsculas). */
export function capitalizar(t: string): string {
  if (/[a-zà-ÿ]/.test(t)) return t
  const palavras = t.toLowerCase().split(' ')
  return palavras
    .map((p, i) => {
      if (SIGLAS.has(p.toUpperCase())) return p.toUpperCase()
      // "das" é a guia do Simples (PAGAMENTO DAS, DAS MEI) ou só a palavra (CASA DAS FESTAS)
      if (p === 'das' && (i === palavras.length - 1 || /^(mei|simples)$/.test(palavras[i + 1]) || /^(pagamento|pgto|pag|guia)$/.test(palavras[i - 1] ?? '')))
        return 'DAS'
      if (i > 0 && PALAVRAS_MINUSCULAS.has(p)) return p
      return p.charAt(0).toUpperCase() + p.slice(1)
    })
    .join(' ')
}

/** Tira do texto o que só polui (CPF mascarado, dados bancários do destino, espaços). */
export function limparDescricao(t: string): string {
  const limpo = t
    .replace(/\s*-?\s*[•*x]{2,}[\d.•*x-]*[•*x]{2,}/gi, '') // •••.123.456-••
    .replace(/\s*-?\s*\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g, '') // CNPJ
    .replace(/\s*-?\s*\d{3}\.\d{3}\.\d{3}-\d{2}/g, '') // CPF
    .replace(/\s*-\s*[^-]*\(\d{3,4}\)\s*Ag[eê]ncia:.*$/i, '') // "- BCO X (0001) Agência: 1 Conta: 2"
    .replace(/\s*Ag[eê]ncia:\s*\S+\s*Conta:\s*\S+/i, '')
    .replace(/\s+-\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return capitalizar(limpo || t.trim()).slice(0, 200)
}

/** Quem pagou/recebeu, quando o extrato diz (Pix, TED, DOC). */
export function extrairPessoa(descricao: string): string | null {
  const partes = descricao.split(/\s+-\s+/)
  if (partes.length >= 2 && /pix|ted|doc|transfer/i.test(partes[0])) {
    const nome = partes[1].trim()
    if (/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'&]{2,}$/.test(nome)) return capitalizar(nome.replace(/\s+/g, ' '))
  }
  const n = descricao
    .normalize('NFC')
    .replace(/[•*][\d.•*-]*$/g, '')
    .trim()
  const m =
    /^(?:PIX|TED|DOC|TEF|TRANSF(?:ERENCIA|ERÊNCIA)?|CRED(?:ITO)?\s+PIX|RECEBIMENTO\s+PIX)\b(?:\s+(?:ENVIAD[OA]|RECEBID[OA]|ENV|REC|RECEB|EMITID[OA]|PIX|QRS?|DE|PARA|-|:))*\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'&]{2,}?)\s*$/i.exec(
      n,
    )
  if (!m) return null
  const nome = m[1].trim()
  if (palavrasChave(nome).length === 0) return null
  return capitalizar(nome)
}

/** Forma de pagamento provável pelo texto do extrato. */
export function adivinharForma(t: TransacaoOfx, cartaoCredito = false): string | null {
  if (cartaoCredito) return 'Cartão de crédito'
  const n = normalizar(t.descricao)
  if (/\bPIX\b/.test(n)) return 'Pix'
  if (/\bIFOOD\b/.test(n) && t.valor > 0) return 'iFood'
  if (/\b(BOLETO|BLT|COBRANCA|TITULO|TIT|CONV|CONVENIO)\b|DEB AUT|DEBITO AUTOMATICO/.test(n)) return 'Boleto'
  if (/\b(TED|DOC|TEF|TRANSF\w*)\b/.test(n) || t.tipo === 'XFER') return 'Transferência'
  if (/\bSAQUE\b/.test(n) || t.tipo === 'ATM' || t.tipo === 'CASH') return 'Dinheiro'
  if (/\b(COMPRA|CARTAO|DEBITO|ELO|MAESTRO|ELECTRON)\b/.test(n) || t.tipo === 'POS') return t.valor < 0 ? 'Cartão de débito' : null
  return null
}

// ---- Regras por palavra-chave --------------------------------------------------------------

interface Regra {
  padrao: RegExp
  direcao: Direcao | 'ambas'
  categoria: string
}

/** Textos comuns de extratos brasileiros → nome da categoria do plano padrão. A primeira que bater vale. */
export const REGRAS: Regra[] = [
  { padrao: /\bTARIFA|\bTAR\b|PACOTE (DE )?SERV|CESTA (DE )?SERV|ANUIDADE|MANUT(ENCAO)? CONTA/, direcao: 'saida', categoria: 'Tarifas bancárias' },
  { padrao: /\bIOF\b|\bJUROS\b|\bMULTA\b|ENCARGOS/, direcao: 'saida', categoria: 'Juros e multas' },
  { padrao: /\bRENDIMENTO|\bREND PAGO|RENDE FACIL|\bJUROS\b/, direcao: 'entrada', categoria: 'Rendimentos' },
  { padrao: /\bIFOOD\b|\bIFD\b|\bRAPPI\b|\b99 ?FOOD\b|AIQFOME/, direcao: 'entrada', categoria: 'iFood e aplicativos' },
  { padrao: /\bIFOOD\b|\bIFD\b|\bRAPPI\b|\b99 ?FOOD\b|AIQFOME/, direcao: 'saida', categoria: 'Taxas do iFood e apps' },
  { padrao: /SIMPLES NACIONAL|(^|PAGAMENTO |PGTO |PAG |GUIA )DAS\b|\bDAS ?MEI\b|\bPGMEI\b/, direcao: 'saida', categoria: 'Simples Nacional / DAS-MEI' },
  { padrao: /\bALUGUEL\b|\bALUGUER\b/, direcao: 'saida', categoria: 'Aluguel' },
  { padrao: /\bPOSTO\b|COMBUST|\bSHELL\b|IPIRANGA|\bPETROBRAS\b|\bBR MANIA\b|\bGASOLINA\b|\bETANOL\b/, direcao: 'saida', categoria: 'Combustível' },
  { padrao: /\bGAS\b|ULTRAGAZ|LIQUIGAS|SUPERGASBRAS|NACIONAL GAS|COPAGAZ|\bCOMGAS\b/, direcao: 'saida', categoria: 'Gás' },
  { padrao: /\bCEMIG\b|\bENEL\b|\bLIGHT\b|\bCOPEL\b|\bCPFL\b|\bCELESC\b|\bCOELBA\b|\bEQUATORIAL\b|\bNEOENERGIA\b|\bENERGISA\b|\bELEKTRO\b|\bENERGIA\b/, direcao: 'saida', categoria: 'Energia elétrica' },
  { padrao: /\bSABESP\b|\bCOPASA\b|\bCEDAE\b|\bSANEPAR\b|\bEMBASA\b|\bCASAN\b|\bCORSAN\b|\bCAESB\b|\bSANEAGO\b|\bAGUAS?\b|SANEAMENTO/, direcao: 'saida', categoria: 'Água' },
  { padrao: /\bVIVO\b|\bCLARO\b|\bTIM\b|\bOI\b|\bNET\b|\bINTERNET\b|TELEFONICA|\bNEXTEL\b|\bALGAR\b|\bSKY\b|FIBRA/, direcao: 'saida', categoria: 'Internet e telefone' },
  {
    padrao: /SUPERMERC|\bMERCADO\b(?! ?(PAGO|LIVRE))|\bMERCADINHO\b|ATACADAO|ATACADISTA|\bASSAI\b|\bMAKRO\b|\bCARREFOUR\b|\bSAMS CLUB\b|\bTENDA\b|\bHORTIFRUTI\b|\bSACOLAO\b|\bPADARIA\b/,
    direcao: 'saida',
    categoria: 'Ingredientes e insumos',
  },
  { padrao: /EMBALAG/, direcao: 'saida', categoria: 'Embalagens' },
  { padrao: /CONTABIL|CONTADOR/, direcao: 'saida', categoria: 'Contabilidade' },
  { padrao: /FACEBK|FACEBOOK|\bMETA\b.*ADS|GOOGLE ?ADS|INSTAGRAM/, direcao: 'saida', categoria: 'Anúncios e redes sociais' },
  { padrao: /\bSTONE\b|\bCIELO\b|\bREDE\b|REDECARD|PAGSEGURO|PAG ?SEGURO|\bPAGBANK\b|GETNET|SUMUP|MERCADO ?PAGO|\bTON\b|INFINITEPAY|\bSAFRAPAY\b/, direcao: 'entrada', categoria: 'Vendas no balcão' },
  { padrao: /\bSTONE\b|\bCIELO\b|\bREDE\b|PAGSEGURO|GETNET|SUMUP|\bTON\b|ALUGUEL (DE )?MAQ|\bMDR\b/, direcao: 'saida', categoria: 'Taxas de cartão/maquininha' },
]

const MESMA_TITULARIDADE = /MESMA TITULARIDADE|MESMA TITULAR|MESMO TITULAR|ENTRE CONTAS|CONTA PROPRIA|CONTAS PROPRIAS|TRANSF(ERENCIA)? ENTRE/

// ---- Sugestões -----------------------------------------------------------------------------

const cent = (v: number) => Math.round(Math.abs(v) * 100)

/** FITID das outras partes de uma transação que baixou várias contas: "FITID#2", "FITID#3"… */
const FITID_PARTE = /^(.+)#(\d+)$/

/** Diferença aceita entre o crédito do cartão/iFood e a conta do PDV: R$ 0,50 ou 1%. */
export function folgaPdv(forma: FormaPdv | null | undefined, falta: number): number {
  if (forma !== 'debito' && forma !== 'credito' && forma !== 'ifood') return 0
  return Math.max(0.5, Math.round(Math.abs(falta)) / 100)
}

function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000)
}

/** Efeito de um lançamento nesta conta: 'entrada', 'saida' ou null (não mexe nela). */
function sentidoNaConta(l: ContextoConciliacao['lancamentos'][number], contaId: string): Direcao | null {
  if (l.tipo === 'transferencia') {
    if (l.conta_id === contaId) return 'saida'
    if (l.conta_destino_id === contaId) return 'entrada'
    return null
  }
  return l.conta_id === contaId ? l.tipo : null
}

export function sugerir(transacoes: TransacaoOfx[], ctx: ContextoConciliacao): LinhaImportacao[] {
  const { contaId } = ctx
  const fitidsDoArquivo = new Set(transacoes.map((t) => t.fitid))

  // FITIDs importados do extrato DESTA conta (ofx_conta_id; nos lançamentos antigos, sem essa
  // coluna, vale qualquer lançamento que mexe nesta conta, inclusive transferência recebida).
  const porFitid = new Map<string, { id: string; chave: string }[]>()
  // Candidatas a duplicata, por sentido + valor em centavos.
  const parecidas = new Map<string, { id: string; data: string; janela: number }[]>()
  const doExtratoDestaConta = (l: ContextoConciliacao['lancamentos'][number]) =>
    !!l.ofx_fitid && (l.ofx_conta_id ? l.ofx_conta_id === contaId : true) && !!sentidoNaConta(l, contaId)
  // Uma transação que baixou várias contas do PDV (repasse do iFood) virou vários lançamentos:
  // FITID, FITID#2, FITID#3… Valem como um só, pelo total, guardado no do FITID original.
  const fitidsDaConta = new Set(ctx.lancamentos.filter(doExtratoDestaConta).map((l) => l.ofx_fitid!))
  const extraDasPartes = new Map<string, number>()
  const partes = new Set<string>()
  for (const l of ctx.lancamentos) {
    const m = l.ofx_fitid ? FITID_PARTE.exec(l.ofx_fitid) : null
    if (!m || !doExtratoDestaConta(l) || !fitidsDaConta.has(m[1])) continue
    partes.add(l.id)
    extraDasPartes.set(m[1], (extraDasPartes.get(m[1]) ?? 0) + cent(l.valor))
  }
  for (const l of ctx.lancamentos) {
    const sentido = sentidoNaConta(l, contaId)
    if (!sentido || partes.has(l.id)) continue
    const valorTotal = cent(l.valor) + (l.ofx_fitid ? (extraDasPartes.get(l.ofx_fitid) ?? 0) : 0)
    if (l.ofx_fitid && doExtratoDestaConta(l)) {
      const item = { id: l.id, chave: `${sentido}|${valorTotal}` }
      porFitid.set(l.ofx_fitid, [...(porFitid.get(l.ofx_fitid) ?? []), item])
      if (fitidsDoArquivo.has(l.ofx_fitid)) continue
    }
    // Anotado à mão (±2 dias), transferência vinda da outra conta (±2) ou importado com outro FITID (mesmo dia:
    // alguns bancos mudam o FITID de um extrato para outro).
    const janela = !l.ofx_fitid || l.tipo === 'transferencia' ? 2 : 0
    const chave = `${sentido}|${valorTotal}`
    const lista = parecidas.get(chave)
    const item = { id: l.id, data: l.data, janela }
    if (lista) lista.push(item)
    else parecidas.set(chave, [item])
  }

  // Contas a pagar/receber em aberto, pelo que falta (numa conta paga em parte, o valor cheio
  // não serve: pagaria mais do que o devido).
  const baixas = baixasPorTitulo(ctx.lancamentos, ctx.titulos)
  const titulosPorValor = new Map<string, { t: ContextoConciliacao['titulos'][number]; falta: number; palavras: string[] }[]>()
  // Contas a receber do fechamento do caixa (PDV), em aberto.
  const abertosPdv: { t: ContextoConciliacao['titulos'][number]; forma: FormaPdv; falta: number }[] = []
  for (const t of ctx.titulos) {
    const s = situacaoTitulo(t, baixas, ctx.hoje)
    if (s.situacao === 'pago') continue
    if (t.fechamento_id && t.tipo === 'receber' && t.forma_pdv && s.falta > 0) abertosPdv.push({ t, forma: t.forma_pdv, falta: s.falta })
    const item = { t, falta: s.falta, palavras: palavrasChave(t.descricao, t.pessoa) }
    const direcao: Direcao = t.tipo === 'pagar' ? 'saida' : 'entrada'
    const chave = `${direcao}|${cent(s.falta)}`
    titulosPorValor.set(chave, [...(titulosPorValor.get(chave) ?? []), item])
  }

  const titulosPorId = new Map(ctx.titulos.map((t) => [t.id, t]))

  // Histórico de categorias: descrições iguais viram uma entrada só (com contagem),
  // e um índice palavra → entradas evita comparar com o histórico inteiro.
  const porChave = new Map<string, EntradaHistorico>()
  const indice = new Map<string, EntradaHistorico[]>()
  for (const l of ctx.lancamentos) {
    if (l.tipo === 'transferencia' || !l.categoria_id) continue
    const palavras = palavrasChave(l.descricao, l.pessoa)
    if (palavras.length === 0) continue
    const chave = `${l.tipo}|${l.categoria_id}|${palavras.join(' ')}`
    const existente = porChave.get(chave)
    if (existente) {
      existente.vezes++
      continue
    }
    const h: EntradaHistorico = { direcao: l.tipo, categoria: l.categoria_id, palavras, vezes: 1 }
    porChave.set(chave, h)
    for (const p of palavras) {
      const lista = indice.get(p)
      if (lista) lista.push(h)
      else indice.set(p, [h])
    }
  }
  const cacheHistoria = new Map<string, ReturnType<typeof pelaHistoria>>()

  const categoriasAtivas = new Map<string, string>()
  for (const c of ctx.categorias) if (c.ativo) categoriasAtivas.set(`${c.tipo}|${normalizar(c.nome)}`, c.id)
  const categoriaValida = new Set(ctx.categorias.filter((c) => c.ativo).map((c) => `${c.tipo}|${c.id}`))

  const outrasContas = (ctx.contas ?? [])
    .filter((c) => c.id !== contaId && c.ativo)
    .map((c) => ({ ...c, n: normalizar(c.nome) }))
    .filter((c) => c.n.length >= 3)

  // 1º passo: já importada? E os candidatos de título de cada transação.
  const base = transacoes.map((original) => {
    const direcao: Direcao = original.valor < 0 ? 'saida' : 'entrada'
    const chaveValor = `${direcao}|${cent(original.valor)}`
    // Mesmo FITID só é "já importada" se o sentido e o valor também batem. Se não batem, o banco
    // reaproveitou o FITID: a transação ganha um FITID novo pelo conteúdo (senão o índice único
    // recusaria gravá-la) e fica marcada como possível repetida, para a pessoa conferir.
    let tr = original
    let jaImportada = false
    let conflitoFitid: string | null = null
    const mesmoFitid = porFitid.get(original.fitid)
    if (mesmoFitid) {
      if (mesmoFitid.some((x) => x.chave === chaveValor)) jaImportada = true
      else {
        conflitoFitid = mesmoFitid[0].id
        tr = { ...original, fitid: `${original.fitid}-${hashTexto(`${original.data}|${original.valor.toFixed(2)}|${original.descricao}`)}` }
        if (porFitid.get(tr.fitid)?.some((x) => x.chave === chaveValor)) {
          jaImportada = true
          conflitoFitid = null
        }
      }
    }
    const palavras = palavrasChave(tr.descricao)
    const candidatos: SugestaoTitulo[] = []
    for (const { t, falta, palavras: pt } of titulosPorValor.get(`${direcao}|${cent(tr.valor)}`) ?? []) {
      const dias = diasEntre(tr.data, t.vencimento)
      if (Math.abs(dias) > 10) continue
      const texto = semelhanca(palavras, pt)
      const pontos = (1 - Math.abs(dias) / 11) * 0.5 + texto * 0.5 + (cent(falta) === cent(tr.valor) ? 0.05 : 0)
      const confianca: Confianca = texto >= 0.34 ? 'alta' : Math.abs(dias) <= 3 ? 'media' : 'baixa'
      if (!candidatos.some((c) => c.tituloId === t.id)) candidatos.push({ tituloId: t.id, confianca, dias, falta, pontos })
    }
    candidatos.sort((a, b) => b.pontos - a.pontos)
    return { tr, direcao, palavras, candidatos, jaImportada, conflitoFitid }
  })

  // 2º passo: cada título vai para uma transação só (a que combina mais).
  const pares = base.flatMap((b, i) => b.candidatos.filter((c) => c.confianca !== 'baixa').map((c) => ({ i, c })))
  pares.sort((a, b) => b.c.pontos - a.c.pontos)
  const tituloDe = new Map<number, SugestaoTitulo>()
  const tituloUsado = new Set<string>()
  for (const { i, c } of pares) {
    if (tituloDe.has(i) || tituloUsado.has(c.tituloId) || base[i].jaImportada) continue
    tituloDe.set(i, c)
    tituloUsado.add(c.tituloId)
  }

  // Possível duplicata e transferência entre contas próprias (na ordem do arquivo).
  const duplicataUsada = new Set<string>()
  const outros = base.map(({ tr, direcao, jaImportada, conflitoFitid }) => {
    let duplicataDe: string | null = conflitoFitid
    if (!jaImportada && !duplicataDe) {
      let melhor = Infinity
      for (const p of parecidas.get(`${direcao}|${cent(tr.valor)}`) ?? []) {
        const d = Math.abs(diasEntre(tr.data, p.data))
        if (d <= p.janela && d < melhor && !duplicataUsada.has(p.id)) {
          melhor = d
          duplicataDe = p.id
        }
      }
      if (duplicataDe) duplicataUsada.add(duplicataDe)
    }

    const n = normalizar(tr.descricao)
    let contaTransferenciaId: string | null = null
    for (const c of outrasContas) {
      if (c.tipo === 'caixa') continue
      if (` ${n} `.includes(` ${c.n} `)) {
        contaTransferenciaId = c.id
        break
      }
    }
    if (!contaTransferenciaId && /\bSAQUE\b/.test(n) && direcao === 'saida') {
      contaTransferenciaId = outrasContas.find((c) => c.tipo === 'caixa')?.id ?? null
    }
    const pareceTransferencia = !!contaTransferenciaId || MESMA_TITULARIDADE.test(n) || /\bSAQUE\b/.test(n)
    return { duplicataDe, n, contaTransferenciaId, pareceTransferencia }
  })

  // 3º passo: recebimentos das vendas do PDV, nas entradas que não ligaram a nenhuma conta.
  const pdvDe = sugerirPdv(base, outros, abertosPdv, tituloDe, tituloUsado)

  return base.map(({ tr, direcao, palavras, candidatos, jaImportada }, i) => {
    const { duplicataDe, n, contaTransferenciaId, pareceTransferencia } = outros[i]
    const titulo = tituloDe.get(i) ?? null
    const pdv = pdvDe.get(i) ?? null
    // Um título já sugerido para uma linha não aparece como alternativa nas outras (senão dá para
    // baixar a mesma conta duas vezes).
    const alternativas = candidatos.filter((c) => !tituloUsado.has(c.tituloId))
    const talvezTransferencia = !titulo && !pdv && pareceTransferencia

    // Categoria: do título, do histórico ou das regras.
    let categoriaId: string | null = null
    let confiancaCategoria: Confianca | null = null
    let origemCategoria: LinhaImportacao['origemCategoria'] = null
    const tituloEscolhido = titulo ? titulosPorId.get(titulo.tituloId) : undefined
    if (tituloEscolhido?.categoria_id) {
      categoriaId = tituloEscolhido.categoria_id
      confiancaCategoria = titulo!.confianca
      origemCategoria = 'titulo'
    } else if (!titulo && !talvezTransferencia) {
      const chave = `${direcao}|${palavras.join(' ')}`
      if (!cacheHistoria.has(chave)) cacheHistoria.set(chave, pelaHistoria(palavras, direcao, indice))
      const h = cacheHistoria.get(chave)
      if (h && categoriaValida.has(`${direcao}|${h.categoria}`)) {
        categoriaId = h.categoria
        confiancaCategoria = h.confianca
        origemCategoria = 'historico'
      } else {
        const regra = REGRAS.find((r) => (r.direcao === 'ambas' || r.direcao === direcao) && r.padrao.test(n))
        const id = regra ? categoriasAtivas.get(`${direcao}|${normalizar(regra.categoria)}`) : undefined
        if (id) {
          categoriaId = id
          confiancaCategoria = 'media'
          origemCategoria = 'regra'
        }
      }
    }

    return {
      transacao: tr,
      direcao,
      jaImportada,
      possivelDuplicata: !!duplicataDe,
      duplicataDe,
      titulo,
      alternativas,
      categoriaId,
      confiancaCategoria,
      origemCategoria,
      talvezTransferencia,
      contaTransferenciaId,
      pdv,
      descricao: limparDescricao(tr.descricao),
      pessoa: extrairPessoa(tr.descricao),
      formaPagamento: adivinharForma(tr, ctx.cartaoCredito),
    }
  })
}

type AbertoPdv = { t: ContextoConciliacao['titulos'][number]; forma: FormaPdv; falta: number }

/**
 * Liga as entradas às contas a receber do PDV (só as que não ligaram a nenhuma conta pelo valor exato).
 * Cartão primeiro (um crédito ≈ uma conta), depois o repasse do iFood (um crédito = soma de dias
 * seguidos) e por fim o Pix (cada crédito baixa parte da conta do dia, sem passar do que falta).
 * Marca em `tituloDe`/`tituloUsado` as contas do parcial e do aproximado, como no 2º passo.
 */
function sugerirPdv(
  base: { tr: TransacaoOfx; direcao: Direcao; jaImportada: boolean }[],
  outros: { duplicataDe: string | null; n: string; pareceTransferencia: boolean }[],
  abertos: AbertoPdv[],
  tituloDe: Map<number, SugestaoTitulo>,
  tituloUsado: Set<string>,
): Map<number, SugestaoPdv> {
  const pdvDe = new Map<number, SugestaoPdv>()
  const livres = abertos.filter((a) => !tituloUsado.has(a.t.id))
  if (livres.length === 0) return pdvDe
  const parte = (a: AbertoPdv, valor: number, falta = a.falta) => ({
    tituloId: a.t.id,
    valor,
    falta,
    vencimento: a.t.vencimento,
    dia: a.t.emissao || a.t.vencimento,
  })
  // Em ordem de data (no mesmo dia, a do arquivo): no Pix, cada crédito desconta do que falta.
  const ordem = base
    .map((_, i) => i)
    .filter((i) => {
      const b = base[i]
      return b.direcao === 'entrada' && b.tr.valor > 0 && !b.jaImportada && !tituloDe.has(i) && !outros[i].duplicataDe && !outros[i].pareceTransferencia
    })
    .sort((x, y) => base[x].tr.data.localeCompare(base[y].tr.data) || x - y)
  const ehPix = (i: number) => /\bPIX\b/.test(outros[i].n)

  // Cartão (débito/crédito): um crédito por dia, perto do que falta (R$ 0,50 ou 1%), de 2 dias antes a 5 depois.
  const cartoes = livres.filter((a) => a.forma === 'debito' || a.forma === 'credito')
  const pares: { i: number; a: AbertoPdv; dif: number; dias: number }[] = []
  for (const i of ordem) {
    if (ehPix(i)) continue
    const v = cent(base[i].tr.valor)
    for (const a of cartoes) {
      const dias = diasEntre(base[i].tr.data, a.t.vencimento)
      if (dias < -2 || dias > 5) continue
      const dif = v - cent(a.falta)
      if (Math.abs(dif) > Math.round(folgaPdv(a.forma, a.falta) * 100)) continue
      pares.push({ i, a, dif, dias })
    }
  }
  pares.sort((x, y) => Math.abs(x.dif) - Math.abs(y.dif) || Math.abs(x.dias) - Math.abs(y.dias) || x.i - y.i)
  for (const { i, a, dif, dias } of pares) {
    if (pdvDe.has(i) || tituloUsado.has(a.t.id)) continue
    tituloDe.set(i, { tituloId: a.t.id, confianca: 'media', dias, falta: a.falta, pontos: 0 })
    tituloUsado.add(a.t.id)
    pdvDe.set(i, {
      tipo: 'aproximado',
      forma: a.forma,
      confianca: 'media',
      titulos: [parte(a, cent(base[i].tr.valor) / 100)],
      diferenca: dif / 100,
      restante: -dif / 100,
    })
  }

  // iFood: o repasse da semana = soma do que falta em 2 a 10 contas seguidas (por vencimento), ± R$ 0,05.
  const ifood = livres
    .filter((a) => a.forma === 'ifood' && !tituloUsado.has(a.t.id))
    .sort((x, y) => x.t.vencimento.localeCompare(y.t.vencimento) || x.t.id.localeCompare(y.t.id))
  for (const i of ordem) {
    if (pdvDe.has(i) || ehPix(i) || ifood.length < 2) continue
    const { tr } = base[i]
    const v = cent(tr.valor)
    let melhor: { s: number; k: number; soma: number } | null = null
    for (let s = 0; s < ifood.length; s++) {
      if (diasEntre(tr.data, ifood[s].t.vencimento) < -7) break // as próximas vencem ainda mais tarde
      let soma = 0
      for (let k = s; k < ifood.length && k < s + 10; k++) {
        soma += cent(ifood[k].falta)
        if (soma > v + 5) break
        if (k === s || Math.abs(soma - v) > 5) continue
        if (diasEntre(tr.data, ifood[k].t.vencimento) > 10) continue
        if (cent(ifood[k].falta) + v - soma <= 0) continue // a última fica com a diferença
        if (!melhor || Math.abs(soma - v) < Math.abs(melhor.soma - v)) melhor = { s, k, soma }
      }
    }
    if (!melhor) continue
    const { s, k, soma } = melhor
    const grupo = ifood.splice(s, k - s + 1)
    for (const a of grupo) tituloUsado.add(a.t.id)
    pdvDe.set(i, {
      tipo: 'soma',
      forma: 'ifood',
      // Sem "iFood" no texto, só sugere (não marca sozinho): pode ser outro crédito com a mesma soma.
      confianca: /\bIFOOD\b|\bIFD\b/.test(outros[i].n) ? 'media' : 'baixa',
      titulos: grupo.map((a, j) => parte(a, j === grupo.length - 1 ? (cent(a.falta) + v - soma) / 100 : a.falta)),
      diferenca: (v - soma) / 100,
      restante: 0,
    })
  }

  // Pix: um crédito por cliente; cada um baixa parte da conta do dia (de 1 dia antes a 3 depois do
  // vencimento), sem passar do que ainda falta nela depois das linhas anteriores.
  const pix = livres.filter((a) => a.forma === 'pix' && !tituloUsado.has(a.t.id)).map((a) => ({ a, resto: cent(a.falta) }))
  for (const i of ordem) {
    if (pdvDe.has(i) || !ehPix(i)) continue
    const { tr } = base[i]
    const v = cent(tr.valor)
    let melhor: (typeof pix)[number] | null = null
    let melhorDias = 0
    for (const p of pix) {
      if (p.resto < v) continue
      const dias = diasEntre(tr.data, p.a.t.vencimento)
      if (dias < -1 || dias > 3) continue
      // o dia mais perto; empatado, o dia anterior (Pix da noite que cai no dia seguinte)
      if (!melhor || Math.abs(dias) < Math.abs(melhorDias) || (Math.abs(dias) === Math.abs(melhorDias) && dias > melhorDias)) {
        melhor = p
        melhorDias = dias
      }
    }
    if (!melhor) continue
    const antes = melhor.resto
    melhor.resto -= v
    tituloDe.set(i, { tituloId: melhor.a.t.id, confianca: 'media', dias: melhorDias, falta: antes / 100, pontos: 0 })
    pdvDe.set(i, {
      tipo: 'parcial',
      forma: 'pix',
      confianca: 'media',
      titulos: [parte(melhor.a, v / 100, antes / 100)],
      diferenca: (v - antes) / 100,
      restante: melhor.resto / 100,
    })
  }
  for (const p of pix) if (p.resto < cent(p.a.falta)) tituloUsado.add(p.a.t.id)
  return pdvDe
}

interface EntradaHistorico {
  direcao: Direcao
  categoria: string
  palavras: string[]
  vezes: number
}

/** Categoria mais usada em lançamentos com as mesmas palavras-chave (Jaccard ≥ 0,5). */
function pelaHistoria(palavras: string[], direcao: Direcao, indice: Map<string, EntradaHistorico[]>): { categoria: string; confianca: Confianca } | null {
  if (palavras.length === 0) return null
  const vistos = new Set<EntradaHistorico>()
  const votos = new Map<string, number>()
  let total = 0
  let quantos = 0
  for (const p of palavras) {
    for (const h of indice.get(p) ?? []) {
      if (vistos.has(h)) continue
      vistos.add(h)
      if (h.direcao !== direcao) continue
      const comum = h.palavras.filter((x) => palavras.includes(x)).length
      const jaccard = comum / (palavras.length + h.palavras.length - comum)
      if (jaccard < 0.5) continue
      votos.set(h.categoria, (votos.get(h.categoria) ?? 0) + jaccard * h.vezes)
      total += jaccard * h.vezes
      quantos += h.vezes
    }
  }
  if (quantos === 0) return null
  const [categoria, peso] = [...votos].sort((a, b) => b[1] - a[1])[0]
  const parte = peso / total
  return { categoria, confianca: quantos >= 2 && parte >= 0.7 ? 'alta' : parte >= 0.5 ? 'media' : 'baixa' }
}

// ---- Para gravar ---------------------------------------------------------------------------

/** O que a pessoa decidiu para cada linha marcada. */
export interface LinhaConfirmada {
  transacao: TransacaoOfx
  descricao?: string
  pessoa?: string | null
  formaPagamento?: string | null
  categoriaId: string | null
  tituloId: string | null
  /** Quando é transferência: a outra conta (destino se saiu, origem se entrou). */
  contaTransferenciaId?: string | null
  /**
   * Repasse que baixa várias contas do PDV (iFood): um lançamento por conta, cada um com o seu
   * valor; o último fica com a diferença de centavos, para a soma bater com o banco. Ignora tituloId.
   */
  titulosPdv?: { tituloId: string; valor: number }[] | null
}

export function paraLancamentos(linhas: LinhaConfirmada[], contaId: string, opcoes: { cartaoCredito?: boolean } = {}): DadosLancamento[] {
  return linhas.flatMap((l): DadosLancamento[] => {
    const t = l.transacao
    const saiu = t.valor < 0
    const comum = {
      data: t.data,
      descricao: l.descricao?.trim() || limparDescricao(t.descricao),
      pessoa: l.pessoa !== undefined ? l.pessoa : extrairPessoa(t.descricao),
      valor: Math.round(Math.abs(t.valor) * 100) / 100,
      ofx_fitid: t.fitid,
      // O FITID é do extrato desta conta, mesmo quando o lançamento fica guardado na outra
      // (transferência recebida: conta_id = origem).
      ofx_conta_id: contaId,
      observacao: null,
    }
    const forma_pagamento = l.formaPagamento !== undefined ? l.formaPagamento : adivinharForma(t, opcoes.cartaoCredito)
    const outra = l.contaTransferenciaId && l.contaTransferenciaId !== contaId ? l.contaTransferenciaId : null
    if (outra) {
      return [
        {
          ...comum,
          tipo: 'transferencia',
          conta_id: saiu ? contaId : outra,
          conta_destino_id: saiu ? outra : contaId,
          categoria_id: null,
          titulo_id: null,
          forma_pagamento,
        },
      ]
    }
    const normal: DadosLancamento = {
      ...comum,
      tipo: saiu ? 'saida' : 'entrada',
      conta_id: contaId,
      conta_destino_id: null,
      categoria_id: l.categoriaId,
      titulo_id: l.tituloId,
      forma_pagamento,
    }
    const partes = l.titulosPdv ?? []
    if (partes.length === 0) return [normal]
    // Um lançamento por conta: o primeiro fica com o FITID do banco (é por ele que uma nova
    // importação reconhece a transação), os outros com FITID#2, FITID#3… (o índice único é por FITID).
    const total = cent(t.valor)
    let usado = 0
    return partes.map((p, k) => {
      const valor = k === partes.length - 1 ? total - usado : cent(p.valor)
      usado += valor
      if (valor <= 0) throw new Error('A soma das contas do repasse não bate com o valor do extrato. Confira a linha e tente de novo.')
      return { ...normal, valor: valor / 100, titulo_id: p.tituloId, ofx_fitid: k === 0 ? t.fitid : `${t.fitid}#${k + 1}` }
    })
  })
}
