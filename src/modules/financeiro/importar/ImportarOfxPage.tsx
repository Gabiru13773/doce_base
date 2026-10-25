import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, CheckCircle2, FileUp, Landmark } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BarraAcao, Botao, Cartao, Carregando, Erro, Pilulas, TituloPagina, Vazio } from '../../../components/ui'
import { folgaPdv, paraLancamentos, sugerir, type LinhaConfirmada, type LinhaImportacao } from '../../../lib/conciliacao'
import { novoId } from '../../../lib/db'
import { baixasPorTitulo, situacaoTitulo } from '../../../lib/financeiro'
import { moeda } from '../../../lib/format'
import { decodificarOfx, lerOfx, type ExtratoOfx } from '../../../lib/ofx'
import { hoje, useCategoriasFin, useContasFin, useLancamentos, useSalvarLancamentos, useTitulos } from '../api'
import { SeletorConta } from '../componentes/Seletores'
import { LinhaRevisao, escolhaFinal, partesRepasse, type Escolha, type TituloAberto } from './LinhaRevisao'

// Importar o extrato do banco (OFX): escolher a conta e o arquivo → revisar o que o app
// sugeriu para cada linha → gravar tudo de uma vez (tudo ou nada).

type Passo = 'arquivo' | 'revisar' | 'pronto'
type Filtro = 'todas' | 'sem_categoria'

interface Arquivo {
  nome: string
  extrato: ExtratoOfx
}

const LIMITE_ARQUIVO = 15 * 1024 * 1024

// ---- Lembretes no aparelho (sem quebrar se o armazenamento estiver bloqueado) --------------

const CHAVE_CONTA = 'euforia-ofx:conta-escolhida'
const chaveOrigem = (contaId: string) => `euforia-ofx:origem:${contaId}`

function lerLocal(chave: string): string | null {
  try {
    return localStorage.getItem(chave)
  } catch {
    return null
  }
}

function gravarLocal(chave: string, valor: string) {
  try {
    localStorage.setItem(chave, valor)
  } catch {
    // sem armazenamento: só não lembra da próxima vez
  }
}

/** Identificação da conta dentro do OFX (banco + conta), para avisar se o arquivo for de outra conta. */
function origemDoExtrato(e: ExtratoOfx): string | null {
  if (!e.conta) return null
  return `${(e.banco ?? '').replace(/^0+/, '')}|${e.conta.replace(/[^0-9A-Za-z]/g, '').replace(/^0+/, '')}`
}

// ---- Datas ---------------------------------------------------------------------------------

const fmtDia = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const fmtData = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
const utc = (d: string) => new Date(`${d}T00:00:00Z`)
const nomeDia = (d: string) => {
  const t = fmtDia.format(utc(d))
  return t.charAt(0).toUpperCase() + t.slice(1)
}
const diaMesCurto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

export default function ImportarOfxPage() {
  const contasQ = useContasFin()
  const categoriasQ = useCategoriasFin()
  const titulosQ = useTitulos()
  const lancamentosQ = useLancamentos()
  const salvar = useSalvarLancamentos()
  const qc = useQueryClient()

  const [passo, setPasso] = useState<Passo>('arquivo')
  const [contaEscolhida, setContaEscolhida] = useState<string | null>(() => lerLocal(CHAVE_CONTA))
  const [arquivo, setArquivo] = useState<Arquivo | null>(null)
  const [erroArquivo, setErroArquivo] = useState<string | null>(null)
  const [lendo, setLendo] = useState(false)
  const [mudancas, setMudancas] = useState<Record<string, Partial<Escolha>>>({})
  const [aberta, setAberta] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)
  const [resultado, setResultado] = useState<{ lancamentos: number; baixas: number; transferencias: number } | null>(null)
  const entradaArquivo = useRef<HTMLInputElement>(null)

  const contas = useMemo(() => contasQ.data ?? [], [contasQ.data])
  const contasAtivas = useMemo(() => contas.filter((c) => c.ativo), [contas])
  const categorias = useMemo(() => categoriasQ.data ?? [], [categoriasQ.data])
  const titulos = useMemo(() => titulosQ.data ?? [], [titulosQ.data])
  const lancamentos = useMemo(() => lancamentosQ.data ?? [], [lancamentosQ.data])

  // Conta escolhida: a lembrada (se ainda existir) ou a única ativa.
  const contaId = useMemo(() => {
    if (contaEscolhida && contasAtivas.some((c) => c.id === contaEscolhida)) return contaEscolhida
    return contasAtivas.length === 1 ? contasAtivas[0].id : null
  }, [contaEscolhida, contasAtivas])
  const conta = contas.find((c) => c.id === contaId)

  // Sugestões (o trabalho pesado), só quando mudam os dados ou o arquivo.
  const dataHoje = useMemo(() => hoje(), [])
  const linhas = useMemo<LinhaImportacao[]>(() => {
    if (!arquivo || !contaId) return []
    return sugerir(arquivo.extrato.transacoes, {
      contaId,
      lancamentos,
      titulos,
      categorias,
      contas,
      hoje: dataHoje,
      cartaoCredito: arquivo.extrato.cartaoCredito,
    })
  }, [arquivo, contaId, lancamentos, titulos, categorias, contas, dataHoje])

  // Id de cada lançamento, gerado uma vez por arquivo (na mesma ordem das linhas): se a importação
  // for repetida (toque duplo, rede que caiu depois de gravar), atualiza as mesmas linhas.
  const idsLinhas = useMemo(() => (arquivo?.extrato.transacoes ?? []).map(() => novoId()), [arquivo])
  // O repasse do iFood vira um lançamento por conta do PDV: ids das partes 2, 3… (mesma ideia).
  const idsPartes = useRef<{ arquivo: Arquivo | null; ids: Map<string, string> }>({ arquivo: null, ids: new Map() })
  function idParte(i: number, k: number) {
    if (idsPartes.current.arquivo !== arquivo) idsPartes.current = { arquivo, ids: new Map() }
    const chave = `${i}#${k}`
    let id = idsPartes.current.ids.get(chave)
    if (!id) {
      id = novoId()
      idsPartes.current.ids.set(chave, id)
    }
    return id
  }

  const titulosAbertos = useMemo<TituloAberto[]>(() => {
    const baixas = baixasPorTitulo(lancamentos, titulos)
    return titulos
      .map((t) => ({ t, s: situacaoTitulo(t, baixas, dataHoje) }))
      .filter(({ s }) => s.situacao !== 'pago')
      .map(({ t, s }) => ({
        id: t.id,
        tipo: t.tipo,
        descricao: t.descricao,
        pessoa: t.pessoa,
        categoria_id: t.categoria_id,
        vencimento: t.vencimento,
        falta: s.falta,
        forma_pdv: t.fechamento_id ? (t.forma_pdv ?? null) : null,
      }))
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
  }, [titulos, lancamentos, dataHoje])
  const tituloPorId = useMemo(() => new Map(titulosAbertos.map((t) => [t.id, t])), [titulosAbertos])
  const lancamentoPorId = useMemo(() => new Map(lancamentos.map((l) => [l.id, l])), [lancamentos])

  // Escolhas finais e contadores (uma passada só).
  const resumo = useMemo(() => {
    let novas = 0
    let jaImportadas = 0
    let marcadas = 0
    let ligadas = 0
    let semCategoria = 0
    let transferenciaSemConta = 0
    const escolhas = new Map<string, Escolha>()
    for (const l of linhas) {
      const e = escolhaFinal(l, mudancas[l.transacao.fitid])
      escolhas.set(l.transacao.fitid, e)
      if (l.jaImportada) jaImportadas++
      else novas++
      if (!e.incluir) continue
      marcadas++
      if ((e.modo === 'titulo' && e.tituloId) || (e.modo === 'repasse' && partesRepasse(l).length > 0)) ligadas++
      else if (e.modo === 'transferencia') {
        if (!e.contaId) transferenciaSemConta++
      } else if (!e.categoriaId) semCategoria++
    }
    return { novas, jaImportadas, marcadas, ligadas, semCategoria, transferenciaSemConta, escolhas }
  }, [linhas, mudancas])

  // Contas a pagar/receber escolhidas em cada linha marcada: a mesma conta não pode ser baixada
  // por mais do que falta nela (ex.: dois Pix iguais ligados à mesma conta).
  // (No Pix do PDV, várias linhas baixam a mesma conta; no repasse do iFood, uma linha baixa várias.)
  const usoTitulos = useMemo(() => {
    const porTitulo = new Map<string, { l: LinhaImportacao; valor: number }[]>()
    const usar = (id: string, l: LinhaImportacao, valor: number) => porTitulo.set(id, [...(porTitulo.get(id) ?? []), { l, valor }])
    for (const l of linhas) {
      const e = resumo.escolhas.get(l.transacao.fitid)!
      if (!e.incluir || l.jaImportada) continue
      if (e.modo === 'titulo' && e.tituloId) usar(e.tituloId, l, Math.abs(l.transacao.valor))
      else if (e.modo === 'repasse') for (const p of partesRepasse(l)) usar(p.tituloId, l, p.valor)
    }
    const problemas: string[] = []
    for (const [id, usos] of porTitulo) {
      const t = tituloPorId.get(id)
      if (!t) continue
      const ls = usos.map((u) => u.l)
      const soma = usos.reduce((s, u) => s + u.valor, 0)
      // Cartão/iFood do PDV: o banco pode pagar alguns centavos a mais (a baixa usa o valor do banco).
      const folga = ls.length === 1 ? folgaPdv(t.forma_pdv, t.falta) : 0
      if (soma <= t.falta + folga + 0.005) continue
      const quais = ls.map((l) => `${diaMesCurto(l.transacao.data)} (${moeda(Math.abs(l.transacao.valor))})`).join(', ')
      problemas.push(
        ls.length === 1
          ? `A linha de ${quais} passa do que falta na conta “${t.descricao}” (${moeda(t.falta)}). Ligue a outra conta ou escolha uma categoria.`
          : `A conta “${t.descricao}” só tem ${moeda(t.falta)} em aberto, mas está ligada a ${ls.length} linhas que somam ${moeda(soma)}: ${quais}. Deixe ligada só a certa.`,
      )
    }
    // Para a revisão: em qual linha cada conta já foi escolhida (as outras linhas não a oferecem).
    const dono = new Map<string, string>()
    for (const [id, usos] of porTitulo) dono.set(id, usos[0].l.transacao.fitid)
    return { problemas, dono }
  }, [linhas, resumo.escolhas, tituloPorId])
  // Mesma referência enquanto as escolhas de conta não mudam (as linhas são memo).
  const chaveDono = [...usoTitulos.dono].map(([t, f]) => `${t}:${f}`).join('|')
  const tituloEscolhidoEm = useMemo(() => usoTitulos.dono, [chaveDono])

  // Lista por dia (mais recente primeiro), já filtrada.
  const dias = useMemo(() => {
    const grupos = new Map<string, LinhaImportacao[]>()
    const ordenadas = [...linhas].sort((a, b) => b.transacao.data.localeCompare(a.transacao.data))
    for (const l of ordenadas) {
      if (filtro === 'sem_categoria') {
        const e = resumo.escolhas.get(l.transacao.fitid)!
        if (l.jaImportada || e.modo === 'transferencia' || e.modo === 'repasse' || (e.modo === 'titulo' && e.tituloId) || e.categoriaId) continue
      }
      const lista = grupos.get(l.transacao.data)
      if (lista) lista.push(l)
      else grupos.set(l.transacao.data, [l])
    }
    return [...grupos]
  }, [linhas, filtro, resumo.escolhas])

  const totais = useMemo(() => {
    let entradas = 0
    let saidas = 0
    for (const t of arquivo?.extrato.transacoes ?? []) {
      if (t.valor > 0) entradas += t.valor
      else saidas -= t.valor
    }
    return { entradas, saidas }
  }, [arquivo])

  const origemAnterior = contaId ? lerLocal(chaveOrigem(contaId)) : null
  const origemAtual = arquivo ? origemDoExtrato(arquivo.extrato) : null
  const outraOrigem = !!(origemAnterior && origemAtual && origemAnterior !== origemAtual)

  const alterar = useCallback((fitid: string, mudanca: Partial<Escolha>) => {
    setMudancas((m) => ({ ...m, [fitid]: { ...m[fitid], ...mudanca } }))
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [passo])

  function escolherConta(id: string | null) {
    setContaEscolhida(id)
    setMudancas({})
    if (id) gravarLocal(CHAVE_CONTA, id)
  }

  async function aoEscolherArquivo(ev: ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0]
    ev.target.value = '' // permite escolher o mesmo arquivo de novo
    if (!f) return
    setErroArquivo(null)
    setMudancas({})
    setAberta(null)
    setFiltro('todas')
    if (f.size > LIMITE_ARQUIVO) {
      setArquivo(null)
      setErroArquivo('Esse arquivo é grande demais para um extrato. Baixe um período menor (um mês, por exemplo).')
      return
    }
    setLendo(true)
    try {
      const extrato = lerOfx(decodificarOfx(await f.arrayBuffer()))
      setArquivo({ nome: f.name, extrato })
      if (extrato.transacoes.length === 0) setErroArquivo('O arquivo foi lido, mas não tem nenhuma transação nesse período.')
    } catch (e) {
      setArquivo(null)
      setErroArquivo(e instanceof Error ? e.message : 'Não consegui ler esse arquivo.')
    } finally {
      setLendo(false)
    }
  }

  function selecionarTodas(marcar: boolean) {
    setMudancas((m) => {
      const novo = { ...m }
      for (const l of linhas) if (!l.jaImportada) novo[l.transacao.fitid] = { ...novo[l.transacao.fitid], incluir: marcar }
      return novo
    })
  }

  async function importar() {
    if (!contaId || !arquivo) return
    setErroSalvar(null)
    if (usoTitulos.problemas.length > 0) {
      setErroSalvar(usoTitulos.problemas.join(' '))
      return
    }
    const confirmadas: LinhaConfirmada[] = []
    const ids: string[] = []
    let baixas = 0
    let transferencias = 0
    for (const [i, l] of linhas.entries()) {
      const e = resumo.escolhas.get(l.transacao.fitid)!
      if (!e.incluir || l.jaImportada) continue
      const titulo = e.modo === 'titulo' && e.tituloId ? tituloPorId.get(e.tituloId) : undefined
      const transferencia = e.modo === 'transferencia' && e.contaId ? e.contaId : null
      // Repasse do iFood: um lançamento por conta do PDV (todas ainda em aberto).
      const partes = e.modo === 'repasse' ? partesRepasse(l) : []
      if (partes.some((p) => !tituloPorId.has(p.tituloId))) {
        setErroSalvar(`O repasse de ${diaMesCurto(l.transacao.data)} aponta para uma conta do PDV que não está mais em aberto. Toque nele e escolha outra opção.`)
        return
      }
      const primeiraParte = partes.length > 0 ? tituloPorId.get(partes[0].tituloId) : undefined
      ids.push(idsLinhas[i])
      for (let k = 1; k < partes.length; k++) ids.push(idParte(i, k))
      if (titulo) baixas++
      baixas += partes.length
      if (transferencia) transferencias++
      confirmadas.push({
        transacao: l.transacao,
        descricao: l.descricao,
        pessoa: l.pessoa ?? (titulo?.pessoa || null),
        formaPagamento: l.formaPagamento,
        categoriaId: titulo
          ? (titulo.categoria_id ?? e.categoriaId)
          : primeiraParte
            ? (primeiraParte.categoria_id ?? e.categoriaId)
            : e.modo === 'categoria'
              ? e.categoriaId
              : null,
        tituloId: titulo?.id ?? null,
        contaTransferenciaId: transferencia,
        titulosPdv: partes.length > 0 ? partes.map((p) => ({ tituloId: p.tituloId, valor: p.valor })) : null,
      })
    }
    if (confirmadas.length === 0) return
    try {
      const lista = paraLancamentos(confirmadas, contaId, { cartaoCredito: arquivo.extrato.cartaoCredito }).map((d, k) => ({ ...d, id: ids[k] }))
      await salvar.mutateAsync({ novos: true, lista })
      if (origemAtual) gravarLocal(chaveOrigem(contaId), origemAtual)
      setResultado({ lancamentos: lista.length, baixas, transferencias })
      setPasso('pronto')
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (/importada|registro igual/i.test(msg)) {
        await qc.invalidateQueries({ queryKey: ['fin', 'lancamentos'] })
        setMudancas({})
        setErroSalvar(
          'Algumas dessas transações já tinham sido importadas (talvez por outro aparelho). Atualizei a lista: confira e toque em Importar de novo.',
        )
      } else {
        setErroSalvar(msg || 'Não deu para importar. Tente de novo.')
      }
    }
  }

  function recomecar() {
    setArquivo(null)
    setMudancas({})
    setResultado(null)
    setErroArquivo(null)
    setErroSalvar(null)
    setPasso('arquivo')
  }

  // ---- Telas ---------------------------------------------------------------------------------

  const carregando = contasQ.isLoading || categoriasQ.isLoading || titulosQ.isLoading || lancamentosQ.isLoading
  const erroDados = contasQ.error ?? categoriasQ.error ?? titulosQ.error ?? lancamentosQ.error

  if (carregando) {
    return (
      <>
        <TituloPagina titulo="Importar extrato" />
        <Carregando />
      </>
    )
  }
  if (erroDados) {
    return (
      <>
        <TituloPagina titulo="Importar extrato" />
        <Erro
          mensagem={erroDados.message}
          tentarDeNovo={() => {
            void contasQ.refetch()
            void categoriasQ.refetch()
            void titulosQ.refetch()
            void lancamentosQ.refetch()
          }}
        />
      </>
    )
  }

  if (passo === 'pronto' && resultado) {
    return (
      <>
        <TituloPagina titulo="Extrato importado" />
        <Cartao className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-ok-claro text-ok">
            <CheckCircle2 className="size-9" aria-hidden />
          </span>
          <p className="text-xl font-bold">
            {resultado.lancamentos} {resultado.lancamentos === 1 ? 'lançamento importado' : 'lançamentos importados'}
          </p>
          <p className="text-suave">
            {resultado.baixas > 0
              ? `${resultado.baixas} ${resultado.baixas === 1 ? 'conta baixada' : 'contas baixadas'} (a pagar/receber).`
              : 'Nenhuma conta a pagar/receber foi baixada.'}
            {resultado.transferencias > 0 &&
              ` ${resultado.transferencias} ${resultado.transferencias === 1 ? 'transferência' : 'transferências'} entre contas.`}
          </p>
          {conta && <p className="text-suave">Conta: {conta.nome}</p>}
        </Cartao>
        <div className="mt-4 flex flex-col gap-3">
          <Link
            to="/financeiro/extrato"
            className="flex min-h-12 items-center justify-center rounded-2xl bg-marca px-5 font-semibold text-white shadow-sm active:bg-marca-escura"
          >
            Ver o extrato
          </Link>
          <Link
            to="/financeiro/contas"
            className="flex min-h-12 items-center justify-center rounded-2xl border border-borda bg-superficie px-5 font-semibold text-marca active:bg-marca-clara"
          >
            Ver contas a pagar e receber
          </Link>
          <Botao variante="texto" onClick={recomecar}>
            Importar outro extrato
          </Botao>
        </div>
      </>
    )
  }

  if (passo === 'revisar' && arquivo && contaId) {
    const todasMarcadas = resumo.novas > 0 && resumo.marcadas === resumo.novas
    return (
      <>
        <button
          type="button"
          onClick={() => setPasso('arquivo')}
          className="-ml-2 mb-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 font-medium text-marca active:bg-marca-clara"
        >
          <ArrowLeft className="size-5" aria-hidden />
          Voltar
        </button>
        <TituloPagina titulo="Revisar e confirmar" subtitulo={`${conta?.nome ?? ''} · ${arquivo.extrato.transacoes.length} transações no arquivo`} />
        <Passos atual={2} />

        <div className="mb-3 grid grid-cols-3 gap-2 text-center">
          <Contador valor={resumo.novas} rotulo={resumo.novas === 1 ? 'nova' : 'novas'} />
          <Contador valor={resumo.jaImportadas} rotulo={resumo.jaImportadas === 1 ? 'já importada' : 'já importadas'} />
          <Contador valor={resumo.ligadas} rotulo="ligadas a contas a pagar/receber" />
        </div>

        {resumo.novas === 0 ? (
          <p className="mb-3 rounded-2xl bg-ok-claro px-4 py-3 text-ok">
            Tudo deste arquivo já foi importado nesta conta. Não há nada novo.
          </p>
        ) : (
          <p className="mb-3 text-suave">
            Confira as sugestões. Toque numa linha para mudar a categoria, ligar a uma conta a pagar/receber ou marcar como
            transferência.
          </p>
        )}

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Pilulas<Filtro>
            rotulo="Mostrar"
            valor={filtro}
            aoMudar={setFiltro}
            opcoes={[
              { valor: 'todas', rotulo: 'Todas' },
              { valor: 'sem_categoria', rotulo: `Só as sem categoria${resumo.semCategoria ? ` (${resumo.semCategoria})` : ''}` },
            ]}
          />
          {resumo.novas > 0 && (
            <Botao variante="texto" className="px-3" onClick={() => selecionarTodas(!todasMarcadas)}>
              {todasMarcadas ? 'Desmarcar todas' : 'Selecionar todas'}
            </Botao>
          )}
        </div>

        {dias.length === 0 ? (
          <Vazio titulo="Nada por aqui" texto="Todas as linhas marcadas já têm categoria ou conta ligada." />
        ) : (
          <div className="flex flex-col gap-4">
            {dias.map(([dia, lista]) => (
              <section key={dia}>
                <h2 className="mb-1.5 px-1 text-sm font-semibold text-suave">{nomeDia(dia)}</h2>
                <ul className="overflow-hidden rounded-2xl border border-borda bg-superficie">
                  {lista.map((l) => (
                    <LinhaRevisao
                      key={l.transacao.fitid}
                      linha={l}
                      mudou={mudancas[l.transacao.fitid]}
                      aberta={aberta === l.transacao.fitid}
                      categorias={categorias}
                      contas={contas}
                      contaId={contaId}
                      titulosAbertos={titulosAbertos}
                      tituloPorId={tituloPorId}
                      tituloEscolhidoEm={tituloEscolhidoEm}
                      duplicata={l.duplicataDe ? lancamentoPorId.get(l.duplicataDe) : undefined}
                      alterar={alterar}
                      abrir={setAberta}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {(resumo.semCategoria > 0 || resumo.transferenciaSemConta > 0 || usoTitulos.problemas.length > 0 || erroSalvar) && (
          <div className="h-4" />
        )}
        {usoTitulos.problemas.map((p) => (
          <p key={p} role="alert" className="mb-2 flex items-start gap-2 rounded-2xl bg-perigo-claro px-4 py-3 text-perigo">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>{p}</span>
          </p>
        ))}
        {resumo.semCategoria > 0 && (
          <p className="mb-2 flex items-start gap-2 rounded-2xl bg-alerta-claro px-4 py-3 text-alerta">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>
              {resumo.semCategoria === 1 ? '1 marcada está' : `${resumo.semCategoria} marcadas estão`} sem categoria. Dá para importar
              assim e escolher depois no extrato, mas os relatórios ficam menos certos.
            </span>
          </p>
        )}
        {resumo.transferenciaSemConta > 0 && (
          <p className="mb-2 flex items-start gap-2 rounded-2xl bg-alerta-claro px-4 py-3 text-alerta">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>
              {resumo.transferenciaSemConta === 1 ? '1 transferência está' : `${resumo.transferenciaSemConta} transferências estão`} sem a
              outra conta. Escolha a conta ou mude para categoria.
            </span>
          </p>
        )}
        {erroSalvar && <Erro mensagem={erroSalvar} />}

        <BarraAcao>
          <Botao
            className="flex-1"
            onClick={importar}
            disabled={resumo.marcadas === 0 || resumo.transferenciaSemConta > 0 || usoTitulos.problemas.length > 0 || salvar.isPending}
          >
            {salvar.isPending
              ? 'Importando…'
              : resumo.marcadas === 0
                ? resumo.novas === 0
                  ? 'Nada novo para importar'
                  : 'Marque o que quer importar'
                : `Importar ${resumo.marcadas} ${resumo.marcadas === 1 ? 'lançamento' : 'lançamentos'}`}
          </Botao>
        </BarraAcao>
      </>
    )
  }

  // Passo 1: conta + arquivo
  const ext = arquivo?.extrato
  return (
    <>
      <TituloPagina titulo="Importar extrato" subtitulo="Traga as entradas e saídas do banco de uma vez, sem digitar." />
      <Passos atual={1} />

      {contasAtivas.length === 0 ? (
        <Vazio
          titulo="Cadastre a conta do banco primeiro"
          texto="O extrato entra numa conta (Nubank, Itaú, Inter…). Cadastre a sua e volte aqui."
          acao={
            <Link
              to="/financeiro/bancos/nova"
              className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-marca px-5 font-semibold text-white shadow-sm active:bg-marca-escura"
            >
              <Landmark className="size-5" aria-hidden />
              Cadastrar conta
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Cartao className="flex flex-col gap-4">
            <SeletorConta
              rotulo="1. De qual conta é o extrato?"
              contas={contas}
              valor={contaId}
              aoMudar={escolherConta}
            />
            <Link to="/financeiro/bancos/nova" className="-mt-2 inline-flex min-h-10 w-fit items-center text-sm font-semibold text-marca underline">
              Não está na lista? Cadastrar outra conta
            </Link>

            <div className="flex flex-col gap-1.5">
              <span className="font-semibold">2. Arquivo do extrato</span>
              <input
                ref={entradaArquivo}
                type="file"
                accept=".ofx,.OFX,application/x-ofx"
                className="sr-only"
                onChange={aoEscolherArquivo}
                aria-label="Escolher arquivo do extrato (.ofx)"
                tabIndex={-1}
              />
              <button
                type="button"
                onClick={() => entradaArquivo.current?.click()}
                disabled={lendo}
                className="flex min-h-20 w-full items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-marca/40 bg-marca-clara/50 px-4 py-4 text-lg font-semibold text-marca active:bg-marca-clara disabled:opacity-60"
              >
                <FileUp className="size-7 shrink-0" aria-hidden />
                <span className="min-w-0 break-words">
                  {lendo ? 'Lendo o arquivo…' : arquivo ? 'Trocar arquivo' : 'Escolher arquivo .ofx'}
                </span>
              </button>
              {arquivo && <p className="text-sm break-all text-suave">Arquivo: {arquivo.nome}</p>}
            </div>

            <details className="rounded-xl bg-creme px-4 py-3">
              <summary className="min-h-8 cursor-pointer font-semibold text-marca">Como baixar o extrato em OFX?</summary>
              <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-[15px]">
                <li>No app ou no site do banco, abra o extrato da conta.</li>
                <li>
                  Procure <strong>Exportar</strong>, <strong>Salvar</strong> ou <strong>Compartilhar extrato</strong> e escolha o formato{' '}
                  <strong>OFX</strong> (às vezes aparece como “Money” ou “Microsoft Money”).
                </li>
                <li>Escolha o período (um mês é o ideal) e salve o arquivo no celular ou no computador.</li>
                <li>Volte aqui e toque em “Escolher arquivo .ofx”.</li>
              </ol>
              <p className="mt-2 text-sm text-suave">
                Se o app do banco só oferecer PDF, tente pelo site do banco no computador. Pode importar o mesmo período mais de uma vez:
                o que já entrou não é repetido.
              </p>
            </details>
          </Cartao>

          {erroArquivo && (
            <p role="alert" className="flex items-start gap-2 rounded-2xl bg-perigo-claro px-4 py-3 text-perigo">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
              <span>{erroArquivo}</span>
            </p>
          )}

          {ext && ext.transacoes.length > 0 && (
            <Cartao className="flex flex-col gap-3">
              <h2 className="text-lg font-bold">Resumo do arquivo</h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Dado rotulo="Período">
                  {ext.inicio && ext.fim
                    ? `${fmtData.format(utc(ext.inicio))} a ${fmtData.format(utc(ext.fim))}`
                    : `${fmtData.format(utc(minData(ext)))} a ${fmtData.format(utc(maxData(ext)))}`}
                </Dado>
                <Dado rotulo="Transações">{ext.transacoes.length}</Dado>
                <Dado rotulo="Entradas">
                  <span className="text-ok">+ {moeda(totais.entradas)}</span>
                </Dado>
                <Dado rotulo="Saídas">
                  <span className="text-perigo">− {moeda(totais.saidas)}</span>
                </Dado>
                {ext.saldoFinal !== undefined && (
                  <Dado rotulo={`Saldo informado${ext.saldoEm ? ` em ${fmtData.format(utc(ext.saldoEm)).slice(0, 5)}` : ''}`}>
                    {moeda(ext.saldoFinal)}
                  </Dado>
                )}
                {ext.conta && (
                  <Dado rotulo={ext.cartaoCredito ? 'Cartão no arquivo' : 'Conta no arquivo'}>
                    <span className="break-all">{ext.conta}</span>
                  </Dado>
                )}
              </dl>
              {ext.cartaoCredito && (
                <p className="text-sm text-suave">É uma fatura de cartão de crédito: as compras entram como saídas pagas no cartão.</p>
              )}
              {outraOrigem && conta && (
                <p className="flex items-start gap-2 rounded-xl bg-alerta-claro px-3 py-2 text-alerta">
                  <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
                  <span>
                    Este arquivo é da conta {origemAtual?.split('|')[1]}, mas da última vez “{conta.nome}” recebeu o extrato da conta{' '}
                    {origemAnterior?.split('|')[1]}. Confira se escolheu a conta certa.
                  </span>
                </p>
              )}
              <Botao onClick={() => setPasso('revisar')} disabled={!contaId}>
                {contaId ? `Revisar ${ext.transacoes.length} ${ext.transacoes.length === 1 ? 'transação' : 'transações'}` : 'Escolha a conta acima'}
              </Botao>
            </Cartao>
          )}
        </div>
      )}
    </>
  )
}

function minData(e: ExtratoOfx) {
  return e.transacoes.reduce((m, t) => (t.data < m ? t.data : m), e.transacoes[0].data)
}
function maxData(e: ExtratoOfx) {
  return e.transacoes.reduce((m, t) => (t.data > m ? t.data : m), e.transacoes[0].data)
}

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-suave">{rotulo}</dt>
      <dd className="font-semibold tabular-nums">{children}</dd>
    </div>
  )
}

function Contador({ valor, rotulo }: { valor: number; rotulo: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center justify-start rounded-2xl border border-borda bg-superficie px-1 py-2">
      <span className="text-2xl font-bold tabular-nums">{valor}</span>
      <span className="text-xs leading-tight text-suave">{rotulo}</span>
    </div>
  )
}

function Passos({ atual }: { atual: 1 | 2 | 3 }) {
  const passos = ['Arquivo', 'Revisar', 'Pronto']
  return (
    <ol className="mb-4 flex items-center gap-2 text-sm" aria-label="Etapas">
      {passos.map((p, i) => {
        const n = i + 1
        const feito = n < atual
        const agora = n === atual
        return (
          <li key={p} className="flex items-center gap-2" aria-current={agora ? 'step' : undefined}>
            <span
              className={`flex size-7 items-center justify-center rounded-full font-semibold ${
                agora ? 'bg-marca text-white' : feito ? 'bg-marca-clara text-marca' : 'bg-borda text-suave'
              }`}
            >
              {n}
            </span>
            <span className={agora ? 'font-semibold' : 'text-suave'}>{p}</span>
            {n < passos.length && <span className="h-px w-4 bg-borda" aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}
