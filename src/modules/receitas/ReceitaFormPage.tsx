import { AlertTriangle, ArrowLeft, FileText } from 'lucide-react'
import { useId, useMemo, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
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
  Selecao,
  TituloPagina,
  Vazio,
} from '../../components/ui'
import { lerNumero, moeda, numero, paraCampo, pct } from '../../lib/format'
import { custoMaoDeObra, type ConfigPrecificacao } from '../../lib/precificacao'
import {
  calcularCusto,
  precificar,
  textoRendimento,
  unidadeBaseReceita,
  usadaEm,
  type Contexto,
  type ItemReceita,
  type ReceitaCalculo,
  type UnidadeRendimento,
} from '../../lib/receitas'
import type { Insumo } from '../insumos/api'
import { useProdutos } from '../produtos/api'
import {
  CATEGORIAS_RECEITA,
  SUGESTOES_NOME_UNIDADE,
  UNIDADES_RENDIMENTO,
  receitaVazia,
  useContextoCalculo,
  useRemoverReceita,
  useRestaurarReceita,
  useSalvarReceita,
  type CategoriaReceita,
  type DadosReceita,
  type Receita,
} from './api'
import { EditorItens } from './componentes/EditorItens'
import { EditorPassos } from './componentes/EditorPassos'

// Cadastro e edição de receita, em três abas (Receita · Preço · Preparo).
// Custo e preço são recalculados a cada mudança, sem precisar salvar.

type Aba = 'receita' | 'preco' | 'preparo'

const ABAS: { valor: Aba; rotulo: string }[] = [
  { valor: 'receita', rotulo: 'Receita' },
  { valor: 'preco', rotulo: 'Preço' },
  { valor: 'preparo', rotulo: 'Preparo' },
]

/** Id usado no cálculo enquanto a receita nova ainda não foi salva. */
const ID_NOVA = '__nova__'

const classeTexto =
  'w-full rounded-xl border border-borda bg-superficie px-4 py-3 text-base outline-none focus:border-marca focus:ring-2 focus:ring-marca/20'

function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : 'tente novamente'
}

export default function ReceitaFormPage() {
  const { id } = useParams()
  const editando = !!id && id !== 'nova'
  const { contexto, config, receitasAtivas, insumosAtivos, carregando, erro, tentarDeNovo } = useContextoCalculo()

  if (erro) return <Erro mensagem={mensagemDe(erro)} tentarDeNovo={tentarDeNovo} />
  if (carregando || !contexto || !config) return <Carregando />

  const dadosComuns = { contexto, config, receitasAtivas, insumosAtivos }

  if (!editando) return <Formulario {...dadosComuns} />

  // Só receitas ativas: uma receita apagada conta como "não encontrada".
  const receita = receitasAtivas.find((r) => r.id === id)
  if (!receita) {
    return (
      <>
        <Voltar />
        <Vazio
          titulo="Receita não encontrada"
          texto="Ela pode ter sido apagada."
          acao={
            <Link to="/receitas" className="inline-flex min-h-12 items-center rounded-2xl px-5 font-semibold text-marca active:bg-marca-clara">
              Ver todas as receitas
            </Link>
          }
        />
      </>
    )
  }

  // key: recomeça o formulário se trocar de receita.
  return <Formulario key={receita.id} original={receita} {...dadosComuns} />
}

/** Link "Voltar"; se houver mudanças não salvas, pergunta antes de sair. */
function Voltar({ sujo = false }: { sujo?: boolean }) {
  return (
    <Link
      to="/receitas"
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

/** Campos como a confeiteira digita (números ficam como texto: "1,5"). */
interface Campos {
  nome: string
  categoria: CategoriaReceita
  rendQtd: string
  rendUnidade: UnidadeRendimento
  rendNome: string
  tempoPreparo: string
  itens: ItemReceita[]
  pctFixos: string
  pctTaxas: string
  pctMargem: string
  pvManual: string
  passos: string[]
  tempoForno: string
  tempoDescanso: string
  temperatura: string
  utensilios: string
  pontos: string
  validade: string
}

function camposDe(d: DadosReceita): Campos {
  return {
    nome: d.nome,
    categoria: d.categoria,
    rendQtd: d.rendimento_qtd > 0 ? paraCampo(d.rendimento_qtd) : '',
    rendUnidade: d.rendimento_unidade,
    rendNome: d.rendimento_nome ?? '',
    tempoPreparo: d.tempo_preparo_min > 0 ? paraCampo(d.tempo_preparo_min) : '',
    itens: d.itens,
    pctFixos: paraCampo(d.pct_custos_fixos),
    pctTaxas: paraCampo(d.pct_taxas),
    pctMargem: paraCampo(d.pct_margem),
    pvManual: paraCampo(d.pv_manual),
    passos: d.passos,
    tempoForno: paraCampo(d.tempo_forno_min),
    tempoDescanso: paraCampo(d.tempo_descanso_min),
    temperatura: paraCampo(d.temperatura_forno),
    utensilios: d.utensilios ?? '',
    pontos: d.pontos_atencao ?? '',
    validade: d.validade ?? '',
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

interface Erros {
  nome?: string
  rendQtd?: string
  rendNome?: string
  tempoPreparo?: string
  itens?: string
  pctFixos?: string
  pctTaxas?: string
  pctMargem?: string
  pvManual?: string
  tempoForno?: string
  tempoDescanso?: string
  temperatura?: string
}

const ABA_DO_ERRO: Record<keyof Erros, Aba> = {
  nome: 'receita',
  rendQtd: 'receita',
  rendNome: 'receita',
  tempoPreparo: 'receita',
  itens: 'receita',
  pctFixos: 'preco',
  pctTaxas: 'preco',
  pctMargem: 'preco',
  pvManual: 'preco',
  tempoForno: 'preparo',
  tempoDescanso: 'preparo',
  temperatura: 'preparo',
}

function validar(c: Campos): Erros {
  const e: Erros = {}
  if (!c.nome.trim()) e.nome = 'Escreva o nome da receita'
  if (!(lerNumero(c.rendQtd) > 0)) e.rendQtd = 'Informe quanto a receita rende'
  if (c.rendUnidade === 'un' && !c.rendNome.trim()) e.rendNome = 'Escreva o que ela rende (ex.: fatia)'
  if (invalido(c.tempoPreparo)) e.tempoPreparo = 'Digite os minutos (ex.: 40)'
  if (c.itens.length === 0) e.itens = 'Adicione pelo menos 1 ingrediente'
  else if (c.itens.some((i) => !(i.quantidade > 0))) e.itens = 'Preencha a quantidade de todos os ingredientes'
  for (const k of ['pctFixos', 'pctTaxas', 'pctMargem'] as const) {
    if (c[k].trim() && !(lerNumero(c[k]) >= 0 && lerNumero(c[k]) < 100)) e[k] = 'Use um número de 0 a 99'
  }
  if (c.pvManual.trim() && !(lerNumero(c.pvManual) > 0)) e.pvManual = 'Digite um preço maior que zero'
  if (invalido(c.tempoForno)) e.tempoForno = 'Número inválido'
  if (invalido(c.tempoDescanso)) e.tempoDescanso = 'Número inválido'
  if (invalido(c.temperatura)) e.temperatura = 'Número inválido'
  else if ((opcional(c.temperatura) ?? 0) > 400) e.temperatura = 'Use até 400 °C'
  return e
}

/** Campos → formato usado nos cálculos (o que ainda está incompleto conta como zero). */
function paraCalculo(c: Campos, id: string): ReceitaCalculo {
  const rend = lerNumero(c.rendQtd)
  const pv = lerNumero(c.pvManual)
  return {
    id,
    nome: c.nome.trim() || 'Esta receita',
    rendimento_qtd: rend > 0 ? rend : 0,
    rendimento_unidade: c.rendUnidade,
    rendimento_nome: c.rendUnidade === 'un' ? c.rendNome.trim() || null : null,
    itens: c.itens,
    tempo_preparo_min: opcional(c.tempoPreparo) ?? 0,
    pct_custos_fixos: opcional(c.pctFixos),
    pct_taxas: opcional(c.pctTaxas),
    pct_margem: opcional(c.pctMargem),
    pv_manual: c.pvManual.trim() && pv > 0 ? pv : null,
  }
}

// ---- Formulário ------------------------------------------------------------------------

interface PropsFormulario {
  original?: Receita
  contexto: Contexto
  config: ConfigPrecificacao
  receitasAtivas: Receita[]
  insumosAtivos: Insumo[]
}

function Formulario({ original, contexto, config, receitasAtivas, insumosAtivos }: PropsFormulario) {
  const navegar = useNavigate()
  const avisar = useAviso()
  const salvar = useSalvarReceita()
  const remover = useRemoverReceita()
  const restaurar = useRestaurarReceita()

  const [inicial] = useState(() => camposDe(original ?? receitaVazia()))
  const [c, setC] = useState<Campos>(inicial)
  const [aba, setAba] = useState<Aba>('receita')
  // Mensagens de erro só aparecem depois da primeira tentativa de salvar.
  const [tentou, setTentou] = useState(false)
  // Abre "Mais opções" se a receita já tiver ajustes próprios.
  const [maisAberto, setMaisAberto] = useState(!!(inicial.pctFixos || inicial.pctTaxas || inicial.pctMargem))

  function mudar<K extends keyof Campos>(campo: K, valor: Campos[K]) {
    setC((atual) => ({ ...atual, [campo]: valor }))
  }

  const sujo = useMemo(() => JSON.stringify(c) !== JSON.stringify(inicial), [c, inicial])
  const erros = validar(c)
  const temErro = Object.keys(erros).length > 0
  const mostrar: Erros = tentou ? erros : {}

  // Cálculo ao vivo: o contexto com esta receita do jeito que está na tela.
  const idCalculo = original?.id ?? ID_NOVA
  const rascunho = useMemo(() => paraCalculo(c, idCalculo), [c, idCalculo])
  const contextoRascunho = useMemo<Contexto>(
    () => ({ ...contexto, receitas: new Map(contexto.receitas).set(idCalculo, rascunho) }),
    [contexto, idCalculo, rascunho],
  )
  const custo = useMemo(() => calcularCusto(idCalculo, contextoRascunho), [idCalculo, contextoRascunho])
  const preco = useMemo(() => precificar(rascunho, custo.custoDireto, config), [rascunho, custo.custoDireto, config])
  const temRendimento = rascunho.rendimento_qtd > 0
  const porUnidade = preco.unidade

  function trocarAba(nova: Aba) {
    setAba(nova)
    window.scrollTo({ top: 0 })
  }

  async function aoSalvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (temErro) {
      const abasComErro = (Object.keys(erros) as (keyof Erros)[]).map((k) => ABA_DO_ERRO[k])
      if (!abasComErro.includes(aba)) trocarAba(abasComErro[0])
      if (erros.pctFixos || erros.pctTaxas || erros.pctMargem) setMaisAberto(true)
      return
    }
    try {
      await salvar.mutateAsync({
        id: original?.id,
        nome: c.nome.trim(),
        categoria: c.categoria,
        rendimento_qtd: lerNumero(c.rendQtd),
        rendimento_unidade: c.rendUnidade,
        rendimento_nome: c.rendUnidade === 'un' ? c.rendNome.trim() : null,
        itens: c.itens,
        tempo_preparo_min: opcional(c.tempoPreparo) ?? 0,
        pct_custos_fixos: opcional(c.pctFixos),
        pct_taxas: opcional(c.pctTaxas),
        pct_margem: opcional(c.pctMargem),
        pv_manual: rascunho.pv_manual,
        passos: c.passos,
        tempo_forno_min: opcional(c.tempoForno),
        tempo_descanso_min: opcional(c.tempoDescanso),
        temperatura_forno: opcional(c.temperatura),
        utensilios: c.utensilios.trim() || null,
        pontos_atencao: c.pontos.trim() || null,
        validade: c.validade.trim() || null,
      })
      avisar({ texto: 'Receita salva ✓' })
      navegar('/receitas')
    } catch {
      // O erro aparece na tela pelo estado da mutação.
    }
  }

  function aoApagar() {
    if (!original) return
    const usos = usadaEm(original.id, receitasAtivas)
    if (
      usos.length > 0 &&
      !window.confirm(
        `Esta receita é usada em: ${usos.map((r) => r.nome).join(', ')}. As outras continuam calculando com ela. Apagar mesmo assim?`,
      )
    ) {
      return
    }
    const copia = original
    remover.mutate(copia, {
      onSuccess: () => {
        navegar('/receitas')
        avisar({ texto: 'Receita apagada', desfazer: () => restaurar.mutate(copia) })
      },
    })
  }

  return (
    <form onSubmit={aoSalvar} noValidate>
      <Voltar sujo={sujo} />
      <TituloPagina titulo={original ? original.nome : 'Nova receita'} />

      {/* Abas: grudam logo abaixo do topo do app ao rolar. */}
      <div className="sticky top-[calc(4rem+1px)] z-10 -mx-4 mb-5 border-b border-borda bg-creme/95 px-4 py-2 backdrop-blur md:top-0">
        <Pilulas rotulo="Parte da receita" valor={aba} aoMudar={trocarAba} opcoes={ABAS} />
      </div>

      {aba === 'receita' && (
        <AbaReceita
          c={c}
          mudar={mudar}
          erros={mostrar}
          novo={!original}
          config={config}
          rascunho={rascunho}
          linhas={custo.linhas}
          contexto={contextoRascunho}
          receitasAtivas={receitasAtivas}
          insumosAtivos={insumosAtivos}
          receitaAtualId={original?.id ?? null}
        />
      )}

      {aba === 'preco' && (
        <AbaPreco
          c={c}
          mudar={mudar}
          erros={mostrar}
          config={config}
          rascunho={rascunho}
          custo={custo}
          preco={preco}
          temRendimento={temRendimento}
          maisAberto={maisAberto}
          setMaisAberto={setMaisAberto}
          sujo={sujo}
        />
      )}

      {aba === 'preparo' && (
        <AbaPreparo
          c={c}
          mudar={mudar}
          erros={mostrar}
          aoVerFicha={original ? () => navegar(`/receitas/${original.id}/ficha`) : undefined}
          sujo={sujo}
        />
      )}

      <div className="mt-6 flex flex-col gap-3">
        {tentou && temErro && (
          <p className="text-sm font-medium text-perigo">Falta arrumar alguns campos antes de salvar.</p>
        )}
        {salvar.isError && <Erro mensagem={mensagemDe(salvar.error)} />}
      </div>

      {aba === 'receita' && original && (
        <div className="flex flex-col gap-3 pt-6">
          {remover.isError && <Erro mensagem={mensagemDe(remover.error)} />}
          <Botao variante="perigo" onClick={aoApagar} disabled={remover.isPending}>
            {remover.isPending ? 'Apagando…' : 'Apagar receita'}
          </Botao>
        </div>
      )}

      <BarraAcao>
        {/* Resumo sempre visível; tocar leva à aba Preço. */}
        <button
          type="button"
          onClick={() => trocarAba('preco')}
          className="flex min-h-12 min-w-0 flex-1 flex-col justify-center rounded-xl px-1 text-left text-sm leading-snug active:bg-marca-clara"
          aria-label="Ver detalhes do preço"
        >
          {temRendimento ? (
            <>
              <span className="text-suave">
                Custo {moeda(preco.custoPorUnidade)} / {porUnidade}
              </span>
              <span className="font-bold text-marca-escura">
                Venda {preco.pvFinal === null ? '—' : moeda(preco.pvFinal)} / {porUnidade}
              </span>
            </>
          ) : (
            <span className="text-suave">Diga quanto rende para ver o preço</span>
          )}
        </button>
        <Botao type="submit" className="shrink-0 px-7" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </Botao>
      </BarraAcao>
    </form>
  )
}

type Mudar = <K extends keyof Campos>(campo: K, valor: Campos[K]) => void

// ---- Aba Receita -------------------------------------------------------------------------

function AbaReceita({
  c,
  mudar,
  erros,
  novo,
  config,
  rascunho,
  linhas,
  contexto,
  receitasAtivas,
  insumosAtivos,
  receitaAtualId,
}: {
  c: Campos
  mudar: Mudar
  erros: Erros
  novo: boolean
  config: ConfigPrecificacao
  rascunho: ReceitaCalculo
  linhas: ReturnType<typeof calcularCusto>['linhas']
  contexto: Contexto
  receitasAtivas: Receita[]
  insumosAtivos: Insumo[]
  receitaAtualId: string | null
}) {
  const minutos = opcional(c.tempoPreparo) ?? 0
  // Trocar g ↔ un ↔ ml numa receita base já usada muda o sentido das quantidades nas outras.
  const salva = receitaAtualId ? receitasAtivas.find((r) => r.id === receitaAtualId) : undefined
  const { data: produtos } = useProdutos()
  const usos = salva
    ? [
        ...usadaEm(salva.id, receitasAtivas),
        ...(produtos ?? []).filter((p) => p.variacoes.some((v) => v.itens.some((i) => i.tipo === 'receita' && i.id === salva.id))),
      ]
    : []
  const mudouFamilia = !!salva && usos.length > 0 && unidadeBaseReceita(salva) !== unidadeBaseReceita({ rendimento_unidade: c.rendUnidade })
  const ajudaTempo =
    config.valorHora > 0
      ? `Entra no custo como mão de obra: ${moeda(custoMaoDeObra(minutos, config.valorHora))}`
      : 'Defina quanto vale sua hora em Configurações de preço para contar a mão de obra'

  return (
    <div className="flex flex-col gap-6">
      <Entrada
        rotulo="Nome"
        placeholder="Ex.: Bolo de cenoura com calda"
        value={c.nome}
        onChange={(e) => mudar('nome', e.target.value)}
        erro={erros.nome}
        autoFocus={novo}
        autoCapitalize="sentences"
      />

      <div className="flex flex-col gap-1.5">
        <p className="font-semibold">Tipo</p>
        <Pilulas rotulo="Tipo" valor={c.categoria} aoMudar={(v) => mudar('categoria', v)} opcoes={CATEGORIAS_RECEITA} />
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-lg font-bold">Quanto rende?</legend>
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-3">
          <EntradaNumero
            rotulo="Quantidade"
            placeholder="Ex.: 10"
            value={c.rendQtd}
            onChange={(e) => mudar('rendQtd', e.target.value)}
            erro={erros.rendQtd}
          />
          <Selecao
            rotulo="Medida"
            valor={c.rendUnidade}
            aoMudar={(v) => mudar('rendUnidade', v as UnidadeRendimento)}
            opcoes={UNIDADES_RENDIMENTO}
          />
        </div>

        {mudouFamilia && (
          <p role="alert" className="rounded-xl bg-alerta-claro p-3 text-sm font-medium text-alerta">
            Atenção: esta receita é usada em {usos.map((u) => u.nome).join(', ')}. Mudar de{' '}
            {unidadeBaseReceita(salva!) === 'un' ? 'unidades' : unidadeBaseReceita(salva!) === 'g' ? 'peso' : 'volume'} para outro tipo
            de medida muda as quantidades lá. Confira esses cadastros depois de salvar.
          </p>
        )}

        {c.rendUnidade === 'un' && (
          <div className="flex flex-col gap-2">
            <Entrada
              rotulo="Rende o quê? (no singular)"
              placeholder="Ex.: fatia"
              value={c.rendNome}
              onChange={(e) => mudar('rendNome', e.target.value)}
              erro={erros.rendNome}
              autoCapitalize="none"
            />
            <div className="flex flex-wrap gap-2" aria-label="Sugestões">
              {SUGESTOES_NOME_UNIDADE.map((s) => {
                const ativo = c.rendNome.trim().toLowerCase() === s
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={ativo}
                    onClick={() => mudar('rendNome', s)}
                    className={`min-h-11 rounded-full border px-4 text-[15px] transition-colors ${
                      ativo ? 'border-marca bg-marca-clara font-semibold text-marca' : 'border-borda bg-superficie text-tinta active:bg-marca-clara'
                    }`}
                  >
                    {s}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {rascunho.rendimento_qtd > 0 && (c.rendUnidade !== 'un' || c.rendNome.trim() !== '') && (
          <p aria-live="polite" className="rounded-xl bg-marca-clara px-4 py-3 font-semibold text-marca-escura">
            Rende {textoRendimento(rascunho)}
          </p>
        )}
      </fieldset>

      <EntradaNumero
        rotulo="Quanto tempo você trabalha nela?"
        sufixo="min"
        placeholder="Ex.: 40"
        value={c.tempoPreparo}
        onChange={(e) => mudar('tempoPreparo', e.target.value)}
        erro={erros.tempoPreparo}
        ajuda={ajudaTempo}
      />

      <EditorItens
        itens={c.itens}
        aoMudar={(itens) => mudar('itens', itens)}
        linhas={linhas}
        insumos={insumosAtivos}
        receitas={receitasAtivas}
        receitaAtualId={receitaAtualId}
        contexto={contexto}
        erro={erros.itens}
      />
    </div>
  )
}

// ---- Aba Preço ---------------------------------------------------------------------------

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

function AbaPreco({
  c,
  mudar,
  erros,
  config,
  rascunho,
  custo,
  preco,
  temRendimento,
  maisAberto,
  setMaisAberto,
  sujo,
}: {
  c: Campos
  mudar: Mudar
  erros: Erros
  config: ConfigPrecificacao
  rascunho: ReceitaCalculo
  custo: ReturnType<typeof calcularCusto>
  preco: ReturnType<typeof precificar>
  temRendimento: boolean
  maisAberto: boolean
  setMaisAberto: (v: boolean) => void
  sujo: boolean
}) {
  const un = preco.unidade
  const problemas = [...new Set(custo.problemas)]
  const prejuizo = preco.pvFinal !== null && !preco.abaixoDoCusto && preco.lucroPorUnidade < 0

  if (!temRendimento) {
    return (
      <Vazio
        titulo="Falta dizer quanto a receita rende"
        texto="Com o rendimento, o app calcula o preço de cada fatia, unidade ou kg."
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Cartao className="border-marca/20 bg-marca-clara text-center">
        <p className="text-sm font-semibold text-marca-escura">Preço de venda</p>
        {preco.pvFinal === null ? (
          <p className="mt-1 text-2xl font-bold text-marca-escura">Sem preço sugerido</p>
        ) : (
          <>
            <p aria-live="polite" className="mt-1 text-4xl font-extrabold text-marca-escura">
              {moeda(preco.pvFinal)}
              <span className="text-xl font-bold"> por {un}</span>
            </p>
            <p className="mt-2 text-suave">
              Receita inteira: <strong className="text-tinta">{moeda(preco.pvTotal)}</strong> ({textoRendimento(rascunho)})
            </p>
            {preco.manual && <p className="mt-1 text-sm text-suave">Preço digitado por você</p>}
          </>
        )}
      </Cartao>

      {preco.abaixoDoCusto && <Alerta tom="perigo">Esse preço não cobre o custo.</Alerta>}
      {prejuizo && <Alerta tom="alerta">Com esse preço, depois dos custos fixos e taxas, sobra prejuízo.</Alerta>}
      {preco.pvSugerido === null && (
        <Alerta tom="alerta">Custos fixos + taxas + lucro passam de 100% — ajuste em Mais opções.</Alerta>
      )}
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

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-bold">De onde vem o preço</h2>
        <dl className="divide-y divide-borda rounded-2xl border border-borda bg-superficie px-4">
          <Linha rotulo="Ingredientes" valor={moeda(custo.custoIngredientes)} />
          <Linha
            rotulo={rascunho.tempo_preparo_min > 0 ? `Mão de obra (${numero(rascunho.tempo_preparo_min, 0)} min)` : 'Mão de obra'}
            valor={moeda(custo.custoMaoDeObra)}
          />
          <Linha rotulo="Custo total" valor={moeda(custo.custoDireto)} forte />
          <Linha rotulo={`Custo por ${un}`} valor={moeda(preco.custoPorUnidade)} />
          {preco.pvFinal !== null && (
            <Linha
              rotulo={`Lucro por ${un}`}
              valor={`${moeda(preco.lucroPorUnidade)} (${pct(preco.pctMargemReal)})`}
              forte
            />
          )}
        </dl>
        <p className="text-sm text-suave">
          O preço já separa {pct(preco.pcts.pctCustosFixos)} para custos fixos e {pct(preco.pcts.pctTaxas)} para taxas.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">Quer usar outro preço?</h2>
        <EntradaNumero
          rotulo={`Seu preço por ${un}`}
          prefixo="R$"
          placeholder={preco.pvSugerido !== null ? paraCampo(preco.pvSugerido) : 'Ex.: 6,50'}
          value={c.pvManual}
          onChange={(e) => mudar('pvManual', e.target.value)}
          erro={erros.pvManual}
          ajuda={
            preco.manual
              ? `Com esse preço você lucra ${moeda(preco.lucroPorUnidade)} por ${un} (${pct(preco.pctMargemReal)})`
              : 'Deixe vazio para usar o preço sugerido'
          }
        />
        {c.pvManual.trim() !== '' && preco.pvSugerido !== null && (
          <Botao variante="texto" className="self-start" onClick={() => mudar('pvManual', '')}>
            Usar o sugerido ({moeda(preco.pvSugerido)})
          </Botao>
        )}
      </section>

      <details
        open={maisAberto}
        onToggle={(e) => setMaisAberto(e.currentTarget.open)}
        className="rounded-2xl border border-borda bg-superficie"
      >
        <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold text-marca">Mais opções</summary>
        <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
          <p className="text-sm text-suave">Ajustes só desta receita.</p>
          <EntradaNumero
            rotulo="Custos fixos"
            sufixo="%"
            placeholder={numero(config.pctCustosFixos)}
            value={c.pctFixos}
            onChange={(e) => mudar('pctFixos', e.target.value)}
            erro={erros.pctFixos}
            ajuda={`Deixe vazio para usar o padrão (${pct(config.pctCustosFixos)})`}
          />
          <EntradaNumero
            rotulo="Taxas"
            sufixo="%"
            placeholder={numero(config.pctTaxas)}
            value={c.pctTaxas}
            onChange={(e) => mudar('pctTaxas', e.target.value)}
            erro={erros.pctTaxas}
            ajuda={`Deixe vazio para usar o padrão (${pct(config.pctTaxas)})`}
          />
          <EntradaNumero
            rotulo="Lucro desejado"
            sufixo="%"
            placeholder={numero(config.pctMargem)}
            value={c.pctMargem}
            onChange={(e) => mudar('pctMargem', e.target.value)}
            erro={erros.pctMargem}
            ajuda={`Deixe vazio para usar o padrão (${pct(config.pctMargem)})`}
          />
          <Link
            to="/config/precos"
            onClick={(e) => confirmarSaida(e, sujo)}
            className="inline-flex min-h-11 items-center self-start rounded-xl px-2 font-semibold text-marca underline-offset-2 active:bg-marca-clara"
          >
            Mudar o padrão de todas as receitas
          </Link>
        </div>
      </details>
    </div>
  )
}

// ---- Aba Preparo (ficha técnica) -----------------------------------------------------------

function AbaPreparo({
  c,
  mudar,
  erros,
  aoVerFicha,
  sujo,
}: {
  c: Campos
  mudar: Mudar
  erros: Erros
  aoVerFicha?: () => void
  sujo: boolean
}) {
  const idPontos = useId()
  return (
    <div className="flex flex-col gap-6">
      <EditorPassos passos={c.passos} aoMudar={(passos) => mudar('passos', passos)} />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-lg font-bold">Forno e descanso</legend>
        <div className="grid grid-cols-3 items-start gap-2">
          <EntradaNumero
            rotulo="Forno"
            sufixo="min"
            placeholder="40"
            value={c.tempoForno}
            onChange={(e) => mudar('tempoForno', e.target.value)}
            erro={erros.tempoForno}
          />
          <EntradaNumero
            rotulo="Descanso"
            sufixo="min"
            placeholder="30"
            value={c.tempoDescanso}
            onChange={(e) => mudar('tempoDescanso', e.target.value)}
            erro={erros.tempoDescanso}
          />
          <EntradaNumero
            rotulo="Temperatura"
            sufixo="°C"
            placeholder="180"
            value={c.temperatura}
            onChange={(e) => mudar('temperatura', e.target.value)}
            erro={erros.temperatura}
          />
        </div>
      </fieldset>

      <Entrada
        rotulo="Utensílios"
        placeholder="Ex.: forma 22 cm, batedeira"
        value={c.utensilios}
        onChange={(e) => mudar('utensilios', e.target.value)}
      />

      <Campo rotulo="Pontos de atenção" id={idPontos} ajuda="O que não pode dar errado (ex.: não abrir o forno nos primeiros 20 min)">
        <textarea
          id={idPontos}
          rows={3}
          value={c.pontos}
          onChange={(e) => mudar('pontos', e.target.value)}
          className={classeTexto}
        />
      </Campo>

      <Entrada
        rotulo="Validade e conservação"
        placeholder="Ex.: 3 dias na geladeira"
        value={c.validade}
        onChange={(e) => mudar('validade', e.target.value)}
      />

      {aoVerFicha && (
        <div className="flex flex-col gap-1.5">
          <Botao variante="secundario" onClick={aoVerFicha} disabled={sujo}>
            <FileText className="size-5" aria-hidden />
            Ver ficha técnica
          </Botao>
          {sujo && <p className="text-sm text-suave">Salve as mudanças para ver a ficha atualizada.</p>}
        </div>
      )}
    </div>
  )
}
