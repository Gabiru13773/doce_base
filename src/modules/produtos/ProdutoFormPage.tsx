import { AlertTriangle, ArrowLeft, Copy, EyeOff, Plus, Trash2 } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAviso } from '../../components/Aviso'
import {
  BarraAcao,
  Botao,
  Campo,
  Carregando,
  Cartao,
  Entrada,
  EntradaNumero,
  Erro,
  Pilulas,
  TituloPagina,
  Vazio,
} from '../../components/ui'
import { lerNumero, moeda, numero, paraCampo, pct } from '../../lib/format'
import { custoMaoDeObra, type ConfigPrecificacao } from '../../lib/precificacao'
import { custoVariacao, precificarVariacao, type VariacaoCalculo } from '../../lib/produtos'
import type { Contexto, ItemReceita, ResultadoCusto, ResultadoPreco } from '../../lib/receitas'
import type { Insumo } from '../insumos/api'
import { useContextoCalculo, type Receita } from '../receitas/api'
import {
  CATEGORIAS_PRODUTO,
  SUGESTOES_VARIACAO,
  duplicarProduto,
  duplicarVariacao,
  produtoVazio,
  useProdutos,
  useRemoverProduto,
  useRestaurarProduto,
  useSalvarProduto,
  variacaoVazia,
  type CategoriaProduto,
  type DadosProduto,
  type Produto,
  type Variacao,
} from './api'
import { EditorItensProduto } from './componentes/EditorItensProduto'

// Cadastro e edição de produto (o que é vendido): receitas prontas + embalagens,
// com variações (ex.: "Prato MDF" / "Bandeja plástica"), cada uma com custo e preço próprios.
// Custo e preço são recalculados a cada mudança, sem precisar salvar.

const classeTexto =
  'w-full rounded-xl border border-borda bg-superficie px-4 py-3 text-base outline-none focus:border-marca focus:ring-2 focus:ring-marca/20'

const classeLink = 'inline-flex min-h-11 items-center rounded-xl px-2 font-semibold text-marca underline-offset-2 active:bg-marca-clara'

function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : 'tente novamente'
}

/** Cópia vinda do botão "Duplicar produto" (location.state.copia). */
function copiaDoEstado(estado: unknown): DadosProduto | null {
  const copia = (estado as { copia?: DadosProduto } | null)?.copia
  if (!copia || typeof copia.nome !== 'string' || !Array.isArray(copia.variacoes) || copia.variacoes.length === 0) return null
  return copia
}

export default function ProdutoFormPage() {
  const { id } = useParams()
  const local = useLocation()
  const editando = !!id && id !== 'novo'
  const { contexto, config, receitasAtivas, insumosAtivos, carregando, erro, tentarDeNovo } = useContextoCalculo()
  const produtos = useProdutos()

  const erroGeral = erro ?? produtos.error
  if (erroGeral)
    return (
      <Erro
        mensagem={mensagemDe(erroGeral)}
        tentarDeNovo={() => {
          tentarDeNovo()
          produtos.refetch()
        }}
      />
    )
  if (carregando || produtos.isPending || !contexto || !config) return <Carregando />

  const dadosComuns = { contexto, config, receitasAtivas, insumosAtivos }

  if (!editando) {
    const copia = copiaDoEstado(local.state)
    // key: recomeça o formulário ao abrir de novo (ex.: depois de "Duplicar produto").
    return <Formulario key={local.key} dados={copia ?? produtoVazio()} copia={!!copia} {...dadosComuns} />
  }

  const produto = (produtos.data ?? []).find((p) => p.id === id)
  if (!produto) {
    return (
      <>
        <Voltar />
        <Vazio
          titulo="Produto não encontrado"
          texto="Ele pode ter sido apagado."
          acao={
            <Link
              to="/produtos"
              className="inline-flex min-h-12 items-center rounded-2xl px-5 font-semibold text-marca active:bg-marca-clara"
            >
              Ver todos os produtos
            </Link>
          }
        />
      </>
    )
  }

  return <Formulario key={produto.id} original={produto} dados={produto} {...dadosComuns} />
}

/** Link "Voltar"; se houver mudanças não salvas, pergunta antes de sair. */
function Voltar({ sujo = false }: { sujo?: boolean }) {
  return (
    <Link
      to="/produtos"
      onClick={(e) => confirmarSaida(e, sujo)}
      className="-ml-2 mb-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-suave active:bg-marca-clara"
    >
      <ArrowLeft className="size-5" aria-hidden />
      Voltar
    </Link>
  )
}

function confirmarSaida(e: MouseEvent, sujo: boolean) {
  if (sujo && !window.confirm('Sair sem salvar?')) e.preventDefault()
}

// ---- Estado do formulário ------------------------------------------------------------

/** Campos de uma variação como a confeiteira digita (números como texto: "1,5"). */
interface CamposVariacao {
  id: string
  nome: string
  itens: ItemReceita[]
  tempo: string
  pctFixos: string
  pctTaxas: string
  pctMargem: string
  pvManual: string
  ativo: boolean
}

interface Campos {
  nome: string
  categoria: CategoriaProduto
  descricao: string
  variacoes: CamposVariacao[]
}

function camposVariacao(v: Variacao): CamposVariacao {
  return {
    id: v.id,
    nome: v.nome,
    itens: v.itens,
    tempo: v.tempo_montagem_min > 0 ? paraCampo(v.tempo_montagem_min) : '',
    pctFixos: paraCampo(v.pct_custos_fixos),
    pctTaxas: paraCampo(v.pct_taxas),
    pctMargem: paraCampo(v.pct_margem),
    pvManual: paraCampo(v.pv_manual),
    ativo: v.ativo !== false,
  }
}

function camposDe(d: DadosProduto): Campos {
  return {
    nome: d.nome,
    categoria: d.categoria,
    descricao: d.descricao ?? '',
    // Sempre pelo menos uma variação (dados antigos ou incompletos).
    variacoes: (d.variacoes.length ? d.variacoes : [variacaoVazia('Padrão')]).map(camposVariacao),
  }
}

/** Número opcional: vazio → null; inválido ou negativo → null (o erro aparece à parte). */
function opcional(s: string): number | null {
  if (!s.trim()) return null
  const n = lerNumero(s)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Preenchido, mas não é um número ≥ 0. */
function invalido(s: string): boolean {
  return s.trim() !== '' && !(lerNumero(s) >= 0)
}

/** Campos → formato dos cálculos (o que ainda está incompleto conta como zero). */
function paraCalculo(v: CamposVariacao): Variacao {
  const pv = lerNumero(v.pvManual)
  return {
    id: v.id,
    nome: v.nome.trim() || 'Variação',
    itens: v.itens,
    tempo_montagem_min: opcional(v.tempo) ?? 0,
    pct_custos_fixos: opcional(v.pctFixos),
    pct_taxas: opcional(v.pctTaxas),
    pct_margem: opcional(v.pctMargem),
    pv_manual: v.pvManual.trim() && pv > 0 ? pv : null,
    ativo: v.ativo,
  }
}

interface ErrosVariacao {
  nome?: string
  itens?: string
  tempo?: string
  pctFixos?: string
  pctTaxas?: string
  pctMargem?: string
  pctSoma?: string
  pvManual?: string
}

interface Erros {
  nome?: string
  variacoes: Record<string, ErrosVariacao>
}

const simplificar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

function validar(c: Campos, config: ConfigPrecificacao): Erros {
  const erros: Erros = { variacoes: {} }
  if (!c.nome.trim()) erros.nome = 'Escreva o nome do produto'
  const contagem = new Map<string, number>()
  for (const v of c.variacoes) {
    const k = simplificar(v.nome)
    if (k) contagem.set(k, (contagem.get(k) ?? 0) + 1)
  }
  for (const v of c.variacoes) {
    const e: ErrosVariacao = {}
    if (!v.nome.trim()) e.nome = 'Dê um nome para esta variação (ex.: Prato MDF)'
    else if ((contagem.get(simplificar(v.nome)) ?? 0) > 1) e.nome = 'Já existe outra variação com esse nome'
    if (v.itens.length === 0) e.itens = 'Adicione pelo menos 1 item (a receita ou a embalagem)'
    else if (v.itens.some((i) => !(i.quantidade > 0))) e.itens = 'Preencha a quantidade de todos os itens'
    if (invalido(v.tempo)) e.tempo = 'Digite os minutos (ex.: 10)'
    for (const k of ['pctFixos', 'pctTaxas', 'pctMargem'] as const) {
      if (v[k].trim() && !(lerNumero(v[k]) >= 0 && lerNumero(v[k]) < 100)) e[k] = 'Use um número de 0 a 99'
    }
    const temAjuste = !!(v.pctFixos.trim() || v.pctTaxas.trim() || v.pctMargem.trim())
    if (temAjuste && !e.pctFixos && !e.pctTaxas && !e.pctMargem) {
      // Mesmo arredondamento do salvar (2 casas), para não passar aqui e o banco recusar.
      const c2 = (n: number) => Math.round(n * 100) / 100
      const soma =
        c2(opcional(v.pctFixos) ?? config.pctCustosFixos) +
        c2(opcional(v.pctTaxas) ?? config.pctTaxas) +
        c2(opcional(v.pctMargem) ?? config.pctMargem)
      if (soma >= 100) e.pctSoma = `Custos fixos + taxas + lucro somam ${pct(soma)}. Precisam somar menos de 100%.`
    }
    if (v.pvManual.trim() && !(lerNumero(v.pvManual) > 0)) e.pvManual = 'Digite um preço maior que zero'
    if (Object.keys(e).length) erros.variacoes[v.id] = e
  }
  return erros
}

const temErros = (e: Erros) => !!e.nome || Object.keys(e.variacoes).length > 0
const temErroPct = (e: ErrosVariacao | undefined) => !!(e && (e.pctFixos || e.pctTaxas || e.pctMargem || e.pctSoma))

// ---- Formulário ------------------------------------------------------------------------

interface PropsFormulario {
  original?: Produto
  dados: DadosProduto
  copia?: boolean
  contexto: Contexto
  config: ConfigPrecificacao
  receitasAtivas: Receita[]
  insumosAtivos: Insumo[]
}

interface Calculo {
  calc: VariacaoCalculo
  custo: ResultadoCusto
  preco: ResultadoPreco
}

function Formulario({ original, dados, copia = false, contexto, config, receitasAtivas, insumosAtivos }: PropsFormulario) {
  const navegar = useNavigate()
  const avisar = useAviso()
  const salvar = useSalvarProduto()
  const remover = useRemoverProduto()
  const restaurar = useRestaurarProduto()

  const [inicial] = useState(() => camposDe(dados))
  const [c, setC] = useState<Campos>(inicial)
  const [selId, setSelId] = useState(inicial.variacoes[0]?.id ?? '')
  const [tentou, setTentou] = useState(false)
  // "Mais opções" e "Usar outro preço" ficam abertos por variação.
  const [maisAberto, setMaisAberto] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(inicial.variacoes.map((v) => [v.id, !!(v.pctFixos || v.pctTaxas || v.pctMargem)])),
  )
  const [outroPreco, setOutroPreco] = useState<Record<string, boolean>>({})
  const [focarNome, setFocarNome] = useState(false)
  const caixaNome = useRef<HTMLDivElement>(null)
  const secaoPreco = useRef<HTMLElement>(null)
  const secaoVariacoes = useRef<HTMLElement>(null)

  const sel = c.variacoes.find((v) => v.id === selId) ?? c.variacoes[0]

  const sujo = useMemo(() => JSON.stringify(c) !== JSON.stringify(inicial), [c, inicial])
  const erros = validar(c, config)
  const temErro = temErros(erros)
  const mostrar: Erros = tentou ? erros : { variacoes: {} }
  const errosSel = mostrar.variacoes[sel.id] ?? {}

  // Custo e preço de todas as variações (para a comparação), recalculados ao vivo.
  const calculos = useMemo(() => {
    const m = new Map<string, Calculo>()
    for (const v of c.variacoes) {
      const calc = paraCalculo(v)
      const custo = custoVariacao(calc, contexto)
      m.set(v.id, { calc, custo, preco: precificarVariacao(calc, custo.custoDireto, config) })
    }
    return m
  }, [c.variacoes, contexto, config])
  const atual = calculos.get(sel.id)!

  // Foca o nome da variação recém-criada.
  useEffect(() => {
    if (!focarNome) return
    const campo = caixaNome.current?.querySelector('input')
    if (campo) {
      campo.focus()
      campo.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
    setFocarNome(false)
  }, [focarNome, selId])

  function mudar<K extends keyof Campos>(campo: K, valor: Campos[K]) {
    setC((a) => ({ ...a, [campo]: valor }))
  }

  function mudarVariacao<K extends keyof CamposVariacao>(campo: K, valor: CamposVariacao[K]) {
    const alvo = sel.id
    setC((a) => ({ ...a, variacoes: a.variacoes.map((v) => (v.id === alvo ? { ...v, [campo]: valor } : v)) }))
  }

  function selecionar(id: string) {
    setSelId(id)
  }

  function irParaVariacoes() {
    secaoVariacoes.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  function novaVariacao() {
    const nova = camposVariacao(variacaoVazia())
    setC((a) => ({ ...a, variacoes: [...a.variacoes, nova] }))
    setSelId(nova.id)
    setFocarNome(true)
  }

  function duplicarSelecionada() {
    const copiaV = camposVariacao(duplicarVariacao(paraCalculo(sel)))
    // Mantém exatamente o que foi digitado (inclusive textos ainda incompletos).
    const nova = { ...sel, id: copiaV.id, nome: copiaV.nome, itens: copiaV.itens }
    setC((a) => {
      const i = a.variacoes.findIndex((v) => v.id === sel.id)
      const lista = [...a.variacoes]
      lista.splice(i + 1, 0, nova)
      return { ...a, variacoes: lista }
    })
    setMaisAberto((m) => ({ ...m, [nova.id]: !!m[sel.id] }))
    setSelId(nova.id)
    setFocarNome(true)
  }

  function removerSelecionada() {
    if (c.variacoes.length <= 1) return
    const removida = sel
    const indice = c.variacoes.findIndex((v) => v.id === removida.id)
    const vizinha = c.variacoes[indice + 1] ?? c.variacoes[indice - 1]
    setC((a) => ({ ...a, variacoes: a.variacoes.filter((v) => v.id !== removida.id) }))
    setSelId(vizinha.id)
    avisar({
      texto: `Variação "${removida.nome.trim() || 'sem nome'}" removida`,
      desfazer: () => {
        setC((a) => {
          if (a.variacoes.some((v) => v.id === removida.id)) return a
          const lista = [...a.variacoes]
          lista.splice(Math.min(indice, lista.length), 0, removida)
          return { ...a, variacoes: lista }
        })
        setSelId(removida.id)
      },
    })
  }

  function verPreco() {
    secaoPreco.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  async function aoSalvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (temErro) {
      if (erros.nome) {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else {
        // Se a variação aberta está certa, abre a primeira que tem erro.
        const comErro = erros.variacoes[sel.id] ? sel.id : c.variacoes.find((v) => erros.variacoes[v.id])!.id
        setSelId(comErro)
        if (temErroPct(erros.variacoes[comErro])) setMaisAberto((m) => ({ ...m, [comErro]: true }))
        if (erros.variacoes[comErro]?.pvManual) setOutroPreco((m) => ({ ...m, [comErro]: true }))
        requestAnimationFrame(irParaVariacoes)
      }
      return
    }
    try {
      await salvar.mutateAsync({
        id: original?.id,
        nome: c.nome.trim(),
        categoria: c.categoria,
        descricao: c.descricao.trim() || null,
        variacoes: c.variacoes.map((v) => ({ ...paraCalculo(v), nome: v.nome.trim() })),
      })
      avisar({ texto: 'Produto salvo ✓' })
      navegar('/produtos')
    } catch {
      // O erro aparece na tela pelo estado da mutação.
    }
  }

  function aoDuplicarProduto() {
    if (!original) return
    if (sujo && !window.confirm('As mudanças desta tela não foram salvas. Duplicar o produto como está salvo?')) return
    navegar('/produtos/novo', { state: { copia: duplicarProduto(original) } })
  }

  function aoApagar() {
    if (!original) return
    const salvo = original
    remover.mutate(salvo, {
      onSuccess: () => {
        navegar('/produtos')
        avisar({ texto: 'Produto apagado', desfazer: () => restaurar.mutate(salvo) })
      },
    })
  }

  const semReceitas = receitasAtivas.length === 0
  const semEmbalagem = !insumosAtivos.some((i) => i.categoria === 'embalagem')
  const usados = new Set(c.variacoes.filter((v) => v.id !== sel.id).map((v) => simplificar(v.nome)))
  const sugestoes = SUGESTOES_VARIACAO.filter((s) => !usados.has(simplificar(s)))
  const todasEscondidas = c.variacoes.every((v) => !v.ativo)
  const varias = c.variacoes.length > 1
  const idDescricao = useId()

  return (
    <form onSubmit={aoSalvar} noValidate>
      <Voltar sujo={sujo} />
      <TituloPagina
        titulo={original ? original.nome : copia ? 'Novo produto (cópia)' : 'Novo produto'}
        subtitulo={original || copia ? undefined : 'O que você vende: a receita pronta + a embalagem'}
      />

      <div className="flex flex-col gap-6">
        {semReceitas && (
          <Cartao className="flex flex-col gap-2 border-laranja/30 bg-laranja-clara">
            <p className="font-semibold">Você ainda não tem receitas</p>
            <p className="text-tinta">
              O produto é feito com receitas prontas (ex.: um bolo que rende 10 fatias) mais a embalagem. Cadastre a receita primeiro para o
              app calcular o custo.
            </p>
            <Link to="/receitas/nova" onClick={(e) => confirmarSaida(e, sujo)} className={`${classeLink} self-start`}>
              Cadastrar receita
            </Link>
          </Cartao>
        )}

        <Entrada
          rotulo="Nome do produto"
          placeholder="Ex.: Bolo de aniversário"
          value={c.nome}
          onChange={(e) => mudar('nome', e.target.value)}
          erro={mostrar.nome}
          autoFocus={!original && !copia}
          autoCapitalize="sentences"
        />

        <div className="flex flex-col gap-1.5">
          <p className="font-semibold">Categoria</p>
          <Pilulas rotulo="Categoria" valor={c.categoria} aoMudar={(v) => mudar('categoria', v)} opcoes={CATEGORIAS_PRODUTO} />
        </div>

        <Campo rotulo="Descrição (opcional)" id={idDescricao} ajuda="Uma frase curta para lembrar o que vem no produto">
          <textarea
            id={idDescricao}
            rows={2}
            maxLength={200}
            placeholder="Ex.: Bolo de 2 kg, recheio a escolher"
            value={c.descricao}
            onChange={(e) => mudar('descricao', e.target.value)}
            className={classeTexto}
          />
        </Campo>

        {/* ---- Variações ---- */}
        <section ref={secaoVariacoes} className="flex scroll-mt-20 flex-col gap-4 md:scroll-mt-4">
          <div>
            <h2 className="text-xl font-bold">{varias ? 'Variações' : 'Como é vendido'}</h2>
            <p className="text-suave">
              {varias
                ? 'Cada variação tem o seu custo e o seu preço. Toque para editar.'
                : 'Vende de mais de um jeito (ex.: no prato MDF ou na bandeja)? Crie uma variação.'}
            </p>
          </div>

          {varias && (
            <div role="group" aria-label="Escolha a variação" className="flex flex-wrap gap-2">
              {c.variacoes.map((v) => {
                const ativo = v.id === sel.id
                const comErro = !!mostrar.variacoes[v.id]
                return (
                  <button
                    key={v.id}
                    type="button"
                    aria-pressed={ativo}
                    onClick={() => selecionar(v.id)}
                    className={`inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border px-4 text-[15px] font-medium transition-colors ${
                      ativo
                        ? 'border-marca bg-marca text-white'
                        : comErro
                          ? 'border-perigo bg-perigo-claro text-perigo'
                          : 'border-borda bg-superficie text-tinta active:bg-marca-clara'
                    }`}
                  >
                    {!v.ativo && <EyeOff className="size-4 shrink-0" aria-label="escondida" />}
                    <span className="truncate">{v.nome.trim() || 'Sem nome'}</span>
                    {comErro && !ativo && <AlertTriangle className="size-4 shrink-0" aria-label="falta arrumar" />}
                  </button>
                )
              })}
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Botao variante="secundario" className="px-3" onClick={novaVariacao}>
              <Plus className="size-5 shrink-0" aria-hidden />
              Nova variação
            </Botao>
            <Botao variante="secundario" className="px-3" onClick={duplicarSelecionada}>
              <Copy className="size-5 shrink-0" aria-hidden />
              {varias ? 'Duplicar esta variação' : 'Duplicar variação'}
            </Botao>
          </div>

          <Cartao className="flex flex-col gap-6 border-marca/25 p-4">
            <div ref={caixaNome} className="flex flex-col gap-2">
              <Entrada
                rotulo="Nome da variação"
                placeholder="Ex.: Prato MDF"
                value={sel.nome}
                onChange={(e) => mudarVariacao('nome', e.target.value)}
                erro={errosSel.nome}
                autoCapitalize="sentences"
              />
              {sugestoes.length > 0 && (
                <div className="flex flex-wrap gap-2" aria-label="Sugestões de nome">
                  {sugestoes.map((s) => {
                    const ativo = simplificar(sel.nome) === simplificar(s)
                    return (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={ativo}
                        onClick={() => mudarVariacao('nome', s)}
                        className={`min-h-11 rounded-full border px-4 text-[15px] transition-colors ${
                          ativo
                            ? 'border-marca bg-marca-clara font-semibold text-marca'
                            : 'border-borda bg-creme text-tinta active:bg-marca-clara'
                        }`}
                      >
                        {s}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <h3 className="text-lg font-bold">O que vai neste produto</h3>
              <EditorItensProduto
                key={sel.id}
                itens={sel.itens}
                aoMudar={(itens) => mudarVariacao('itens', itens)}
                linhas={atual.custo.linhas}
                insumos={insumosAtivos}
                receitas={receitasAtivas}
                contexto={contexto}
                erro={errosSel.itens}
              />
              {semEmbalagem && (
                <p className="text-sm text-suave">
                  Dica: cadastre suas embalagens (prato, caixa, bandeja) como insumo da categoria Embalagem para elas entrarem no custo.{' '}
                  <Link to="/insumos/novo" onClick={(e) => confirmarSaida(e, sujo)} className="font-semibold text-marca underline">
                    Cadastrar embalagem
                  </Link>
                </p>
              )}
            </div>

            <EntradaNumero
              rotulo="Tempo para montar e embalar (opcional)"
              sufixo="min"
              placeholder="Ex.: 10"
              value={sel.tempo}
              onChange={(e) => mudarVariacao('tempo', e.target.value)}
              erro={errosSel.tempo}
              ajuda={
                config.valorHora > 0
                  ? `Entra no custo como mão de obra: ${moeda(custoMaoDeObra(opcional(sel.tempo) ?? 0, config.valorHora))}`
                  : 'Defina quanto vale sua hora em Configurações de preço para contar a mão de obra'
              }
            />

            <section ref={secaoPreco} className="scroll-mt-20 md:scroll-mt-4">
              <CartaoPreco
                v={sel}
                calculo={atual}
                erros={errosSel}
                config={config}
                contexto={contexto}
                receitasAtivas={receitasAtivas}
                insumosAtivos={insumosAtivos}
                mudar={mudarVariacao}
                maisAberto={!!maisAberto[sel.id]}
                setMaisAberto={(aberto) => setMaisAberto((m) => ({ ...m, [sel.id]: aberto }))}
                outroPreco={!!outroPreco[sel.id] || sel.pvManual.trim() !== ''}
                setOutroPreco={(aberto) => setOutroPreco((m) => ({ ...m, [sel.id]: aberto }))}
                sujo={sujo}
              />
            </section>

            <div className="flex flex-col gap-3 border-t border-borda pt-4">
              <Interruptor
                rotulo="Esconder nos pedidos"
                ajuda="A variação continua salva, mas não aparece para escolher nos pedidos."
                ligado={!sel.ativo}
                aoMudar={(esconder) => mudarVariacao('ativo', !esconder)}
              />
              {todasEscondidas && (
                <p className="rounded-xl bg-alerta-claro p-3 text-sm font-medium text-alerta">
                  Todas as variações estão escondidas: este produto não vai aparecer nos pedidos.
                </p>
              )}
              {varias && (
                <Botao variante="perigo" onClick={removerSelecionada}>
                  <Trash2 className="size-5" aria-hidden />
                  Remover esta variação
                </Botao>
              )}
            </div>
          </Cartao>

          {varias && (
            <Comparacao
              variacoes={c.variacoes}
              calculos={calculos}
              selId={sel.id}
              aoEscolher={(id) => {
                selecionar(id)
                requestAnimationFrame(irParaVariacoes)
              }}
            />
          )}
        </section>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {tentou && temErro && <p className="text-sm font-medium text-perigo">Falta arrumar alguns campos antes de salvar.</p>}
        {salvar.isError && <Erro mensagem={mensagemDe(salvar.error)} />}
      </div>

      {original && (
        <div className="flex flex-col gap-3 pt-6">
          <Botao variante="secundario" onClick={aoDuplicarProduto}>
            <Copy className="size-5" aria-hidden />
            Duplicar produto
          </Botao>
          {remover.isError && <Erro mensagem={mensagemDe(remover.error)} />}
          <Botao variante="perigo" onClick={aoApagar} disabled={remover.isPending}>
            {remover.isPending ? 'Apagando…' : 'Apagar produto'}
          </Botao>
        </div>
      )}

      <BarraAcao>
        <button
          type="button"
          onClick={verPreco}
          className="flex min-h-12 min-w-0 flex-1 flex-col justify-center rounded-xl px-1 text-left text-sm leading-snug active:bg-marca-clara"
          aria-label="Ver detalhes do preço"
        >
          <span className="truncate text-suave">
            {varias ? sel.nome.trim() || 'Sem nome' : `Custo ${moeda(atual.preco.custoPorUnidade)}`}
          </span>
          <span className="truncate font-bold text-marca-escura">
            Venda {atual.preco.pvFinal === null ? '—' : moeda(atual.preco.pvFinal)}
          </span>
        </button>
        <Botao type="submit" className="shrink-0 px-7" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </Botao>
      </BarraAcao>
    </form>
  )
}

type MudarVariacao = <K extends keyof CamposVariacao>(campo: K, valor: CamposVariacao[K]) => void

// ---- Peças -----------------------------------------------------------------------------

function Interruptor({
  rotulo,
  ajuda,
  ligado,
  aoMudar,
}: {
  rotulo: string
  ajuda?: string
  ligado: boolean
  aoMudar: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      onClick={() => aoMudar(!ligado)}
      className="flex min-h-12 w-full items-center gap-3 rounded-xl text-left active:bg-marca-clara"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{rotulo}</span>
        {ajuda && <span className="block text-sm text-suave">{ajuda}</span>}
      </span>
      <span aria-hidden className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${ligado ? 'bg-marca' : 'bg-borda'}`}>
        <span
          className={`absolute top-1 left-1 size-6 rounded-full bg-white shadow transition-transform ${ligado ? 'translate-x-6' : ''}`}
        />
      </span>
    </button>
  )
}

function Alerta({ tom, children }: { tom: 'perigo' | 'alerta'; children: ReactNode }) {
  const cores = tom === 'perigo' ? 'bg-perigo-claro text-perigo' : 'bg-alerta-claro text-alerta'
  return (
    <div role="alert" className={`flex items-start gap-3 rounded-2xl p-4 ${cores}`}>
      <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 font-medium">{children}</div>
    </div>
  )
}

function Linha({ rotulo, valor, forte = false }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-2.5 ${forte ? 'font-bold' : ''}`}>
      <dt className={forte ? '' : 'text-suave'}>{rotulo}</dt>
      <dd className="text-right tabular-nums">{valor}</dd>
    </div>
  )
}

/** Itens que ainda calculam, mas cuja receita/insumo foi apagado do cadastro. */
function itensApagados(itens: ItemReceita[], contexto: Contexto, receitasAtivas: Receita[], insumosAtivos: Insumo[]): string[] {
  const receitas = new Set(receitasAtivas.map((r) => r.id))
  const insumos = new Set(insumosAtivos.map((i) => i.id))
  const avisos: string[] = []
  for (const item of itens) {
    if (item.tipo === 'receita' && !receitas.has(item.id) && contexto.receitas.has(item.id)) {
      avisos.push(`A receita "${contexto.receitas.get(item.id)!.nome}" foi apagada. Troque por outra ou remova.`)
    }
    if (item.tipo === 'insumo' && !insumos.has(item.id) && contexto.insumos.has(item.id)) {
      avisos.push(`O insumo "${contexto.insumos.get(item.id)!.nome}" foi apagado. Troque por outro ou remova.`)
    }
  }
  return avisos
}

function CartaoPreco({
  v,
  calculo,
  erros,
  config,
  contexto,
  receitasAtivas,
  insumosAtivos,
  mudar,
  maisAberto,
  setMaisAberto,
  outroPreco,
  setOutroPreco,
  sujo,
}: {
  v: CamposVariacao
  calculo: Calculo
  erros: ErrosVariacao
  config: ConfigPrecificacao
  contexto: Contexto
  receitasAtivas: Receita[]
  insumosAtivos: Insumo[]
  mudar: MudarVariacao
  maisAberto: boolean
  setMaisAberto: (v: boolean) => void
  outroPreco: boolean
  setOutroPreco: (v: boolean) => void
  sujo: boolean
}) {
  const { custo, preco, calc } = calculo
  const somaLinhas = (tipo: ItemReceita['tipo']) =>
    custo.linhas.filter((l) => l.item.tipo === tipo).reduce((s, l) => s + (Number.isFinite(l.custo) ? l.custo : 0), 0)
  const custoReceitas = somaLinhas('receita')
  const custoInsumos = somaLinhas('insumo')
  const problemas = [...new Set([...custo.problemas, ...itensApagados(v.itens, contexto, receitasAtivas, insumosAtivos)])]
  const prejuizo = preco.pvFinal !== null && !preco.abaixoDoCusto && preco.lucroPorUnidade < 0
  const semItens = v.itens.length === 0 || custo.custoDireto <= 0

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-lg font-bold">Preço desta variação</h3>

      <Cartao className="border-marca/20 bg-marca-clara text-center">
        <p className="text-sm font-semibold text-marca-escura">Preço de venda</p>
        {semItens ? (
          <p className="mt-1 text-lg font-semibold text-marca-escura">Adicione os itens para ver o preço</p>
        ) : preco.pvFinal === null ? (
          <p className="mt-1 text-2xl font-bold text-marca-escura">Sem preço sugerido</p>
        ) : (
          <>
            <p aria-live="polite" className="mt-1 text-4xl font-extrabold text-marca-escura tabular-nums">
              {moeda(preco.pvFinal)}
            </p>
            <p className="mt-2 text-tinta">
              Você lucra <strong>{moeda(preco.lucroPorUnidade)}</strong> ({pct(preco.pctMargemReal)})
            </p>
            {preco.manual && <p className="mt-1 text-sm text-suave">Preço digitado por você</p>}
          </>
        )}
      </Cartao>

      {preco.abaixoDoCusto && <Alerta tom="perigo">Esse preço não cobre o custo ({moeda(preco.custoPorUnidade)}).</Alerta>}
      {prejuizo && <Alerta tom="alerta">Com esse preço, depois dos custos fixos e taxas, sobra prejuízo.</Alerta>}
      {preco.pvSugerido === null && <Alerta tom="alerta">Custos fixos + taxas + lucro passam de 100% — ajuste em Mais opções.</Alerta>}
      {problemas.length > 0 && (
        <Alerta tom="alerta">
          <p>O custo pode estar incompleto:</p>
          <ul className="mt-1 list-disc pl-5 font-normal">
            {problemas.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alerta>
      )}

      {!semItens && (
        <>
          <dl className="divide-y divide-borda rounded-2xl border border-borda bg-superficie px-4">
            <Linha rotulo="Receitas" valor={moeda(custoReceitas)} />
            <Linha rotulo="Embalagens e extras" valor={moeda(custoInsumos)} />
            <Linha
              rotulo={calc.tempo_montagem_min > 0 ? `Montagem (${numero(calc.tempo_montagem_min, 0)} min)` : 'Montagem'}
              valor={moeda(custo.custoMaoDeObra)}
            />
            <Linha rotulo="Custo da unidade" valor={moeda(preco.custoPorUnidade)} forte />
            <Linha rotulo="Preço sugerido" valor={preco.pvSugerido === null ? '—' : moeda(preco.pvSugerido)} />
            {preco.pvFinal !== null && (
              <Linha rotulo="Lucro" valor={`${moeda(preco.lucroPorUnidade)} (${pct(preco.pctMargemReal)})`} forte />
            )}
          </dl>
          <p className="text-sm text-suave">
            O custo das receitas já inclui a mão de obra delas. O preço separa {pct(preco.pcts.pctCustosFixos)} para custos fixos e{' '}
            {pct(preco.pcts.pctTaxas)} para taxas.
          </p>

          {outroPreco ? (
            <div className="flex flex-col gap-2">
              <EntradaNumero
                rotulo="Seu preço"
                prefixo="R$"
                placeholder={preco.pvSugerido !== null ? paraCampo(preco.pvSugerido) : 'Ex.: 89,90'}
                value={v.pvManual}
                onChange={(e) => mudar('pvManual', e.target.value)}
                erro={erros.pvManual}
                ajuda={
                  preco.manual
                    ? `Com esse preço você lucra ${moeda(preco.lucroPorUnidade)} (${pct(preco.pctMargemReal)})`
                    : 'Deixe vazio para usar o preço sugerido'
                }
              />
              {preco.pvSugerido !== null && (
                <Botao
                  variante="texto"
                  className="self-start"
                  onClick={() => {
                    mudar('pvManual', '')
                    setOutroPreco(false)
                  }}
                >
                  Usar o sugerido ({moeda(preco.pvSugerido)})
                </Botao>
              )}
            </div>
          ) : (
            <Botao variante="secundario" onClick={() => setOutroPreco(true)}>
              Usar outro preço
            </Botao>
          )}
        </>
      )}

      <details
        open={maisAberto}
        onToggle={(e) => setMaisAberto(e.currentTarget.open)}
        className="rounded-2xl border border-borda bg-superficie"
      >
        <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold text-marca">Mais opções</summary>
        <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
          <p className="text-sm text-suave">Ajustes só desta variação. Deixe vazio para usar o padrão.</p>
          <EntradaNumero
            rotulo="Custos fixos"
            sufixo="%"
            placeholder={numero(config.pctCustosFixos)}
            value={v.pctFixos}
            onChange={(e) => mudar('pctFixos', e.target.value)}
            erro={erros.pctFixos}
            ajuda={`Padrão: ${pct(config.pctCustosFixos)}`}
          />
          <EntradaNumero
            rotulo="Taxas"
            sufixo="%"
            placeholder={numero(config.pctTaxas)}
            value={v.pctTaxas}
            onChange={(e) => mudar('pctTaxas', e.target.value)}
            erro={erros.pctTaxas}
            ajuda={`Padrão: ${pct(config.pctTaxas)}`}
          />
          <EntradaNumero
            rotulo="Lucro desejado"
            sufixo="%"
            placeholder={numero(config.pctMargem)}
            value={v.pctMargem}
            onChange={(e) => mudar('pctMargem', e.target.value)}
            erro={erros.pctMargem}
            ajuda={`Padrão: ${pct(config.pctMargem)}`}
          />
          {erros.pctSoma && <p className="text-sm font-medium text-perigo">{erros.pctSoma}</p>}
          <Link to="/config/precos" onClick={(e) => confirmarSaida(e, sujo)} className={`${classeLink} self-start`}>
            Mudar o padrão de todos os produtos
          </Link>
        </div>
      </details>
    </div>
  )
}

/** Resumo de todas as variações lado a lado (ex.: Prato MDF R$ 89,90 · Bandeja R$ 79,90). */
function Comparacao({
  variacoes,
  calculos,
  selId,
  aoEscolher,
}: {
  variacoes: CamposVariacao[]
  calculos: Map<string, Calculo>
  selId: string
  aoEscolher: (id: string) => void
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-lg font-bold">Comparar variações</h3>
      <ul className="divide-y divide-borda overflow-hidden rounded-2xl border border-borda bg-superficie">
        {variacoes.map((v) => {
          const { preco, custo } = calculos.get(v.id)!
          const temPreco = preco.pvFinal !== null && custo.custoDireto > 0
          const atual = v.id === selId
          return (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => aoEscolher(v.id)}
                aria-current={atual ? 'true' : undefined}
                className={`flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-marca-clara ${atual ? 'bg-marca-clara/50' : ''}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    {v.nome.trim() || 'Sem nome'}
                    {!v.ativo && <span className="ml-2 text-sm font-normal text-suave">(escondida)</span>}
                  </span>
                  <span className="block text-sm text-suave">Custo {moeda(preco.custoPorUnidade)}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-bold text-marca-escura tabular-nums">{temPreco ? moeda(preco.pvFinal!) : '—'}</span>
                  {temPreco && (
                    <span className={`block text-sm tabular-nums ${preco.lucroPorUnidade < 0 ? 'text-perigo' : 'text-ok'}`}>
                      lucro {moeda(preco.lucroPorUnidade)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
