import { Lock, Minus, Plus, RotateCcw, Sparkles } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAviso } from '../../components/Aviso'
import { BarraAcao, Botao, Busca, Carregando, Entrada, Erro, Pilulas, TituloPagina, Vazio } from '../../components/ui'
import { faixaPrecos, type FaixaPrecos, type StatusItem } from '../../lib/compras'
import { novoId } from '../../lib/db'
import { embalagensParaRepor, precisaComprar, type Saldos } from '../../lib/estoque'
import { moeda, numero } from '../../lib/format'
import { textoQuantidade } from '../../lib/receitas'
import { unidadeBase } from '../../lib/unidades'
import { useSaldos } from '../estoque/api'
import { hoje } from '../financeiro/api'
import { Interruptor, Voltar } from '../financeiro/componentes/Comum'
import { mensagemDe, simplificar } from '../financeiro/util'
import { CATEGORIAS, useInsumos, type CategoriaInsumo, type Insumo } from '../insumos/api'
import {
  itemDoInsumo,
  useCompras,
  useHistoricoPorInsumo,
  useItensCompra,
  useRemoverItemCompra,
  useSalvarCompra,
  useSalvarItensCompra,
  type Compra,
  type DadosCompra,
  type DadosItemCompra,
  type ItemCompra,
} from './api'

type Filtro = 'todos' | CategoriaInsumo

const OPCOES_FILTRO: { valor: Filtro; rotulo: string }[] = [
  { valor: 'todos', rotulo: 'Todos' },
  ...CATEGORIAS.map((c) => ({ valor: c.valor, rotulo: c.rotulo })),
]

const ROTULO_CURTO: Record<Insumo['unidade_compra'], [string, string]> = {
  g: ['g', 'g'],
  kg: ['kg', 'kg'],
  ml: ['ml', 'ml'],
  l: ['L', 'L'],
  un: ['unidade', 'unidades'],
  dz: ['dúzia', 'dúzias'],
}

/** "1 kg", "395 g", "1 unidade" */
function descreverEmbalagem(qtd: number, unidade: Insumo['unidade_compra']): string {
  const [um, varios] = ROTULO_CURTO[unidade]
  return `${numero(qtd, 3)} ${qtd === 1 ? um : varios}`
}

const TEXTO_STATUS: Record<StatusItem, string> = {
  pendente: 'Falta pegar',
  comprado: 'Peguei',
  substituido: 'Trocado',
  nao: 'Não levei',
}

/** "2026-10-21" → "21/10" */
function diaMes(data: string): string {
  const [, m, d] = data.split('-')
  return `${d}/${m}`
}

/**
 * "O que está acabando": para cada insumo abaixo do mínimo (ou com saldo negativo), põe na lista
 * as embalagens que faltam para voltar ao mínimo, sem diminuir o que já estava escolhido.
 * Insumos já marcados no mercado (`bloqueados`) ficam de fora.
 */
function sugerirAcabando(
  insumos: Insumo[],
  saldos: Saldos,
  qtds: Record<string, number>,
  bloqueados: ReadonlySet<string>,
): { novo: Record<string, number>; n: number } {
  const novo = { ...qtds }
  let n = 0
  for (const i of insumos) {
    if (bloqueados.has(i.id)) continue
    const saldo = saldos.insumos[i.id]
    if (!precisaComprar(saldo, i.estoque_minimo)) continue
    const q = embalagensParaRepor(saldo, i.estoque_minimo, { qtd: i.qtd_compra, unidade: i.unidade_compra })
    const atual = novo[i.id] ?? 0
    if (q > atual) {
      if (!(atual > 0)) n++
      novo[i.id] = q
    }
  }
  return { novo, n }
}

/** Saldo para mostrar: sem movimentos conta como 0 só se o insumo tem mínimo (senão não mostra). */
function saldoDe(saldos: Saldos | undefined, i: Insumo): number | undefined {
  if (!saldos) return undefined
  return saldos.insumos[i.id] ?? (i.estoque_minimo != null && i.estoque_minimo > 0 ? 0 : undefined)
}

/** "1,5 kg", "−200 g" */
function textoSaldo(q: number, unidade: Insumo['unidade_compra']): string {
  return `${q < 0 ? '−' : ''}${textoQuantidade(Math.abs(q), unidadeBase(unidade))}`
}

export default function MontarCompraPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const compras = useCompras()
  const itens = useItensCompra(id)
  const insumos = useInsumos()
  const saldos = useSaldos()
  // ?sugerir=1 (vindo do alerta do Início): a lista já abre com o que está acabando.
  const sugerir = params.get('sugerir') === '1'

  if (insumos.isLoading || compras.isLoading || (id && itens.isLoading) || (sugerir && saldos.isLoading)) return <Carregando />
  const erro = insumos.error ?? compras.error ?? (id ? itens.error : null)
  if (erro) {
    return (
      <Erro
        mensagem={mensagemDe(erro)}
        tentarDeNovo={() => {
          insumos.refetch()
          compras.refetch()
          if (id) itens.refetch()
        }}
      />
    )
  }

  const original = id ? compras.data?.find((c) => c.id === id) : undefined

  if (id && !original) {
    return (
      <>
        <Voltar padrao="/compras" />
        <Vazio
          titulo="Compra não encontrada"
          texto="Ela pode ter sido apagada."
          acao={<LinkTexto para="/compras">Ver as compras</LinkTexto>}
        />
      </>
    )
  }

  if (original?.status === 'finalizada') {
    return (
      <>
        <Voltar padrao={`/compras/${original.id}`} />
        <Vazio
          titulo="Esta compra já foi finalizada"
          texto="A lista de uma compra finalizada não muda mais. Para comprar de novo, faça uma lista nova."
          acao={<LinkTexto para={`/compras/${original.id}`}>Ver a compra</LinkTexto>}
        />
      </>
    )
  }

  if ((insumos.data ?? []).length === 0) {
    return (
      <>
        <Voltar padrao="/compras" />
        <TituloPagina titulo="Nova compra" />
        <Vazio
          titulo="Nenhum insumo cadastrado"
          texto="A lista de compras é feita com os seus insumos (leite condensado, caixinhas, fitas…). Cadastre pelo menos um para começar."
          acao={<LinkTexto para="/insumos/novo">Cadastrar insumo</LinkTexto>}
        />
      </>
    )
  }

  return (
    <Formulario
      key={id ?? 'nova'}
      original={original}
      itensOriginais={itens.data ?? []}
      insumos={insumos.data ?? []}
      compras={compras.data ?? []}
      saldos={saldos.data}
      sugerirAoAbrir={sugerir}
    />
  )
}

function LinkTexto({ para, children }: { para: string; children: string }) {
  return (
    <Link to={para} className="inline-flex min-h-12 items-center rounded-2xl px-5 font-semibold text-marca active:bg-marca-clara">
      {children}
    </Link>
  )
}

function Formulario({
  original,
  itensOriginais,
  insumos,
  compras,
  saldos,
  sugerirAoAbrir,
}: {
  original?: Compra
  itensOriginais: DadosItemCompra[]
  insumos: Insumo[]
  compras: Compra[]
  /** saldo de cada insumo (undefined enquanto o estoque carrega ou se falhou) */
  saldos?: Saldos
  sugerirAoAbrir?: boolean
}) {
  const navegar = useNavigate()
  const avisar = useAviso()
  const idLocais = useId()
  const { data: historico } = useHistoricoPorInsumo()
  const { refetch: recarregarCompras } = useCompras()
  const { refetch: recarregarItens } = useItensCompra(original?.id)
  const salvarCompra = useSalvarCompra()
  const salvarItens = useSalvarItensCompra()
  const removerItem = useRemoverItemCompra()

  // Ids gerados uma vez por formulário: se a gravação for repetida (toque duplo, rede que caiu
  // depois de gravar), atualiza as mesmas linhas em vez de duplicar a compra ou os itens.
  const [compraId] = useState(() => original?.id ?? novoId())
  const idsNovos = useRef(new Map<string, string>())
  const idNovo = (insumoId: string) => {
    let v = idsNovos.current.get(insumoId)
    if (!v) idsNovos.current.set(insumoId, (v = novoId()))
    return v
  }

  // Item pendente (ainda não marcado no mercado) de cada insumo: é o que dá para mudar aqui.
  // O resto (já marcado, fora da lista, insumo apagado) fica como está.
  const { editaveis, travados } = useMemo(() => {
    const ativos = new Set(insumos.map((i) => i.id))
    const editaveis = new Map<string, DadosItemCompra>()
    const travados: DadosItemCompra[] = []
    for (const it of itensOriginais) {
      if (it.status === 'pendente' && !it.fora_da_lista && it.insumo_id && ativos.has(it.insumo_id) && !editaveis.has(it.insumo_id)) {
        editaveis.set(it.insumo_id, it)
      } else travados.push(it)
    }
    return { editaveis, travados }
  }, [itensOriginais, insumos])

  const travadosPorInsumo = useMemo(() => {
    const m = new Map<string, DadosItemCompra[]>()
    for (const t of travados) if (t.insumo_id) m.set(t.insumo_id, [...(m.get(t.insumo_id) ?? []), t])
    return m
  }, [travados])

  const [nome, setNome] = useState(original?.nome ?? `Compra ${diaMes(hoje())}`)
  const [local, setLocal] = useState(original?.local ?? '')
  const [data, setData] = useState(original?.data ?? hoje())
  // Abrindo com ?sugerir=1, o que está acabando já entra na lista (o aviso sai uma vez, logo abaixo).
  const [inicio] = useState(() => {
    const qtds: Record<string, number> = Object.fromEntries([...editaveis].map(([insumoId, it]) => [insumoId, it.qtd_pedida]))
    if (!sugerirAoAbrir || !saldos) return { qtds, sugeridos: 0 }
    const r = sugerirAcabando(insumos, saldos, qtds, new Set(travadosPorInsumo.keys()))
    return { qtds: r.novo, sugeridos: r.n }
  })
  const [qtds, setQtds] = useState<Record<string, number>>(inicio.qtds)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [soSelecionados, setSoSelecionados] = useState(false)
  const [tentou, setTentou] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)

  // Lista arrumada como no mercado: por tipo (ingredientes, embalagens…) e depois por nome.
  const ordenados = useMemo(() => {
    const idx = (c: CategoriaInsumo) => CATEGORIAS.findIndex((x) => x.valor === c)
    return [...insumos].sort((a, b) => idx(a.categoria) - idx(b.categoria) || a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [insumos])
  const ordemDe = useMemo(() => new Map(ordenados.map((i, n) => [i.id, (n + 1) * 10])), [ordenados])

  const faixas = useMemo(() => {
    const m = new Map<string, FaixaPrecos>()
    if (!historico) return m
    for (const i of insumos) {
      const f = faixaPrecos(historico[i.id] ?? [], { qtd: i.qtd_compra, unidade: i.unidade_compra })
      if (f) m.set(i.id, f)
    }
    return m
  }, [historico, insumos])

  // Sugestões de onde comprar: fornecedores dos insumos e lugares das compras anteriores.
  const locais = useMemo(() => {
    const s = new Set<string>()
    for (const i of insumos) if (i.fornecedor?.trim()) s.add(i.fornecedor.trim())
    for (const c of compras) if (c.local?.trim()) s.add(c.local.trim())
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [insumos, compras])

  // "Repetir a última compra": a mais recente que não seja esta (useCompras já vem da mais nova).
  const anterior = compras.find((c) => c.id !== compraId)
  const itensAnterior = useItensCompra(anterior?.id)

  const acabando = useMemo(
    () => (saldos ? insumos.filter((i) => precisaComprar(saldos.insumos[i.id], i.estoque_minimo)).length : 0),
    [saldos, insumos],
  )

  const avisouSugestao = useRef(false)
  useEffect(() => {
    if (avisouSugestao.current || !sugerirAoAbrir) return
    avisouSugestao.current = true
    avisar({
      texto:
        inicio.sugeridos > 0
          ? `${inicio.sugeridos} ${inicio.sugeridos === 1 ? 'item que está acabando entrou' : 'itens que estão acabando entraram'} na lista`
          : 'Nada acabando para pôr na lista',
    })
  }, [sugerirAoAbrir, inicio.sugeridos, avisar])

  const qtd = (insumoId: string) => qtds[insumoId] ?? 0
  const mudarQtd = (insumoId: string, n: number) => setQtds((q) => ({ ...q, [insumoId]: Math.max(0, Math.round(n * 1000) / 1000) }))

  const selecionados = ordenados.filter((i) => qtd(i.id) > 0)
  const totalItens = selecionados.length + travados.length
  const estimativa = selecionados.reduce((s, i) => s + qtd(i.id) * (faixas.get(i.id)?.ultimo ?? 0), 0)
  const semPrecoNaEstimativa = selecionados.some((i) => !faixas.has(i.id))

  const visiveis = useMemo(() => {
    const termo = simplificar(busca)
    return ordenados.filter((i) => {
      if (filtro !== 'todos' && i.categoria !== filtro) return false
      if (soSelecionados && !((qtds[i.id] ?? 0) > 0)) return false
      if (!termo) return true
      return [i.nome, i.marca, i.fornecedor].some((c) => simplificar(c).includes(termo))
    })
  }, [ordenados, filtro, soSelecionados, busca, qtds])

  const grupos = CATEGORIAS.map((c) => ({ categoria: c, lista: visiveis.filter((i) => i.categoria === c.valor) })).filter(
    (g) => g.lista.length > 0,
  )

  const erros: { nome?: string; data?: string; itens?: string } = {}
  if (!nome.trim()) erros.nome = 'Dê um nome para a compra'
  if (!data) erros.data = 'Escolha a data'
  if (totalItens === 0) erros.itens = 'Escolha pelo menos um item'
  const temErro = Object.keys(erros).length > 0
  const mostrar = tentou ? erros : {}

  function repetirUltima() {
    if (!itensAnterior.data) return
    const ativos = new Set(insumos.map((i) => i.id))
    const antes = qtds
    const novo = { ...qtds }
    let n = 0
    for (const it of itensAnterior.data) {
      if (!it.insumo_id || !ativos.has(it.insumo_id) || !(it.qtd_pedida > 0)) continue
      if (!(novo[it.insumo_id] > 0)) n++
      novo[it.insumo_id] = Math.max(novo[it.insumo_id] ?? 0, it.qtd_pedida)
    }
    setQtds(novo)
    avisar({
      texto: n > 0 ? `${n} ${n === 1 ? 'item entrou' : 'itens entraram'} na lista` : 'Os itens da última compra já estão na lista',
      desfazer: n > 0 ? () => setQtds(antes) : undefined,
    })
  }

  function sugerir() {
    if (!saldos) return
    const antes = qtds
    const { novo, n } = sugerirAcabando(insumos, saldos, qtds, new Set(travadosPorInsumo.keys()))
    setQtds(novo)
    const mudou = Object.keys(novo).some((k) => novo[k] !== antes[k])
    avisar({
      texto:
        n > 0
          ? `${n} ${n === 1 ? 'item entrou' : 'itens entraram'} na lista`
          : mudou
            ? 'Quantidades aumentadas para repor o estoque'
            : 'O que está acabando já está na lista',
      desfazer: mudou ? () => setQtds(antes) : undefined,
    })
  }

  async function aoSalvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (temErro || salvando) return
    setSalvando(true)
    setErroSalvar(null)
    try {
      let dados: DadosCompra
      if (original) {
        // Confere de novo no servidor: o outro celular pode ter finalizado a compra enquanto isso.
        const atual = (await recarregarCompras()).data?.find((c) => c.id === original.id)
        if (!atual) throw new Error('esta compra foi apagada')
        if (atual.status === 'finalizada') throw new Error('esta compra já foi finalizada no outro celular')
        const { criado_em: _c, atualizado_em: _a, ...resto } = atual
        dados = { ...resto, nome, local: local || null, data }
      } else {
        dados = { id: compraId, nome, local: local || null, data, status: 'aberta', total: null, finalizada_em: null, observacao: null }
      }
      await salvarCompra.mutateAsync({ dados, novo: !original })

      // Itens que o outro celular marcou depois que esta tela abriu ficam como estão.
      const servidor = original ? ((await recarregarItens()).data ?? []) : []
      const aindaPendente = (id: string) => servidor.find((s) => s.id === id)?.status === 'pendente'
      const novos: DadosItemCompra[] = []
      const alterados: DadosItemCompra[] = []
      const removidos: DadosItemCompra[] = []
      let pulados = 0
      for (const ins of ordenados) {
        const q = qtd(ins.id)
        const existente = editaveis.get(ins.id)
        if (existente) {
          if (q === existente.qtd_pedida) continue
          if (!aindaPendente(existente.id)) {
            pulados++
            continue
          }
          if (q <= 0) removidos.push(existente)
          else {
            // Os itens vindos do servidor trazem criado_em: tira para não misturar com os novos.
            const { criado_em: _c, atualizado_em: _a, ...resto } = existente as ItemCompra
            alterados.push({ ...resto, qtd_pedida: q })
          }
        } else if (q > 0) {
          novos.push({ ...itemDoInsumo(compraId, ins, q, ordemDe.get(ins.id) ?? 0), id: idNovo(ins.id) })
        }
      }
      // Novos (com criado_em) e alterados (sem) em gravações separadas: ver db.salvarVarios.
      if (novos.length > 0) await salvarItens.mutateAsync({ novos: true, lista: novos })
      if (alterados.length > 0) await salvarItens.mutateAsync({ novos: false, lista: alterados })
      for (const r of removidos) await removerItem.mutateAsync(r)

      avisar({
        texto:
          pulados > 0
            ? `Lista salva ✓ (${pulados} ${pulados === 1 ? 'item já foi marcado' : 'itens já foram marcados'} no mercado e ficou como estava)`
            : 'Lista salva ✓',
      })
      navegar(`/compras/${compraId}`, { replace: true })
    } catch (err) {
      setErroSalvar(mensagemDe(err))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <form onSubmit={aoSalvar} noValidate>
      <Voltar padrao={original ? `/compras/${original.id}` : '/compras'} />
      <TituloPagina titulo={original ? 'Editar lista' : 'Nova compra'} subtitulo="Escolha o que vai comprar" />

      <div className="flex flex-col gap-6">
        <Entrada
          rotulo="Nome da compra"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          erro={mostrar.nome}
          autoCapitalize="sentences"
        />
        <div className="grid grid-cols-1 items-start gap-4 min-[420px]:grid-cols-2">
          <Entrada
            rotulo="Onde vai comprar"
            placeholder="Ex.: Atacadão"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            list={idLocais}
            autoCapitalize="words"
            autoComplete="off"
            ajuda="Opcional"
          />
          <Entrada rotulo="Data" type="date" value={data} onChange={(e) => setData(e.target.value)} erro={mostrar.data} />
        </div>
        <datalist id={idLocais}>
          {locais.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>

        {travados.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-bold">Já marcados no mercado</h2>
            <p className="text-sm text-suave">Estes não mudam aqui. Para mexer neles, abra a compra.</p>
            <ul className="divide-y divide-borda overflow-hidden rounded-2xl border border-borda bg-superficie">
              {travados.map((t) => (
                <li key={t.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
                  <Lock className="size-4 shrink-0 text-suave" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{t.nome}</span>
                    <span className="block text-sm text-suave">
                      {numero(t.qtd_pedida, 3)} × {descreverEmbalagem(t.embalagem_qtd, t.embalagem_unidade)}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-creme px-3 py-1 text-sm font-medium text-suave">{TEXTO_STATUS[t.status]}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-4" aria-labelledby="titulo-itens">
          <div className="flex flex-col gap-1">
            <h2 id="titulo-itens" className="text-lg font-bold">
              Itens
            </h2>
            <p className="text-sm text-suave" aria-live="polite">
              {selecionados.length === 0
                ? 'Toque num item para colocar na lista. Use + e − para a quantidade de pacotes.'
                : `${selecionados.length} ${selecionados.length === 1 ? 'escolhido' : 'escolhidos'}${
                    estimativa > 0 ? ` · cerca de ${moeda(estimativa)}${semPrecoNaEstimativa ? ' (sem contar os que nunca foram comprados)' : ''}` : ''
                  }`}
            </p>
            {mostrar.itens && <p className="text-sm font-medium text-perigo">{mostrar.itens}</p>}
          </div>

          {acabando > 0 && (
            <Botao variante="secundario" onClick={sugerir}>
              <Sparkles className="size-5" aria-hidden />
              Sugerir o que está acabando ({acabando})
            </Botao>
          )}
          {anterior && (
            <Botao variante="secundario" onClick={repetirUltima} disabled={!itensAnterior.data}>
              <RotateCcw className="size-5" aria-hidden />
              Repetir a última compra
            </Botao>
          )}
          <Interruptor
            ligado={soSelecionados}
            aoMudar={setSoSelecionados}
            rotulo="Só os selecionados"
            texto="Mostra só o que já está na lista, para conferir"
          />

          <Busca valor={busca} aoMudar={setBusca} placeholder="Buscar por nome, marca ou fornecedor" />
          <div className="-mx-4 overflow-x-auto px-4 pb-1">
            <Pilulas rotulo="Filtrar por tipo" valor={filtro} aoMudar={setFiltro} opcoes={OPCOES_FILTRO} />
          </div>

          {grupos.length === 0 ? (
            <Vazio
              titulo="Nada encontrado"
              texto={soSelecionados ? 'Nenhum item escolhido com esse filtro.' : 'Tente outra palavra ou escolha “Todos”.'}
              acao={
                <Botao
                  variante="secundario"
                  onClick={() => {
                    setBusca('')
                    setFiltro('todos')
                    setSoSelecionados(false)
                  }}
                >
                  Limpar filtros
                </Botao>
              }
            />
          ) : (
            grupos.map(({ categoria, lista }) => (
              <div key={categoria.valor} className="flex flex-col gap-2">
                <h3 className="font-semibold text-suave">
                  <span aria-hidden>{categoria.emoji}</span> {categoria.rotulo}
                </h3>
                <ul className="flex flex-col gap-2">
                  {lista.map((i) => (
                    <LinhaInsumo
                      key={i.id}
                      insumo={i}
                      qtd={qtd(i.id)}
                      aoMudar={(n) => mudarQtd(i.id, n)}
                      faixa={faixas.get(i.id)}
                      marcados={travadosPorInsumo.get(i.id)}
                      saldo={saldoDe(saldos, i)}
                    />
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>

        {erroSalvar && <Erro mensagem={erroSalvar} />}
      </div>

      <BarraAcao>
        <Botao type="submit" className="flex-1" disabled={salvando}>
          {salvando ? 'Salvando…' : `Salvar lista (${totalItens} ${totalItens === 1 ? 'item' : 'itens'})`}
        </Botao>
      </BarraAcao>
    </form>
  )
}

function LinhaInsumo({
  insumo: i,
  qtd,
  aoMudar,
  faixa,
  marcados,
  saldo,
}: {
  insumo: Insumo
  qtd: number
  aoMudar: (n: number) => void
  faixa?: FaixaPrecos
  marcados?: DadosItemCompra[]
  /** quanto tem em estoque (unidade base); undefined = sem dados */
  saldo?: number
}) {
  const selecionado = qtd > 0
  const temMinimo = i.estoque_minimo != null && i.estoque_minimo > 0
  const acabando = saldo !== undefined && precisaComprar(saldo, i.estoque_minimo)
  // Já marcado no mercado: não entra de novo (viraria um segundo item igual na compra).
  const bloqueado = !selecionado && !!marcados?.length
  const conteudo = (
    <>
      <span className="block truncate font-semibold">{i.nome}</span>
      <span className="block truncate text-sm text-suave">
        {descreverEmbalagem(i.qtd_compra, i.unidade_compra)}
        {i.marca ? ` · ${i.marca}` : ''}
      </span>
      {faixa && (
        <span className="block text-sm text-suave">
          {faixa.vezes === 1
            ? `Último ${moeda(faixa.ultimo)}`
            : `Último ${moeda(faixa.ultimo)} · menor ${moeda(faixa.menor)} · maior ${moeda(faixa.maior)}`}
        </span>
      )}
      {saldo !== undefined && (
        <span className={`block text-sm ${acabando ? 'font-semibold text-perigo' : 'text-suave'}`}>
          Tem {textoSaldo(saldo, i.unidade_compra)}
          {temMinimo && ` · mínimo ${textoSaldo(i.estoque_minimo!, i.unidade_compra)}`}
          {acabando && ' · acabando'}
        </span>
      )}
      {marcados && marcados.length > 0 && (
        <span className="block text-sm font-medium text-ok">Já marcado: {marcados.map((m) => TEXTO_STATUS[m.status]).join(', ')}</span>
      )}
    </>
  )

  return (
    <li
      className={`flex items-center gap-2 rounded-2xl border py-2 pr-2 pl-4 transition-colors ${
        selecionado ? 'border-marca bg-marca-clara/60' : 'border-borda bg-superficie'
      }`}
    >
      {/* Tocar no item fora da lista coloca 1 pacote; depois, a quantidade muda só no + e −. */}
      {selecionado || bloqueado ? (
        <div className="min-h-12 min-w-0 flex-1 py-1">{conteudo}</div>
      ) : (
        <button type="button" onClick={() => aoMudar(1)} className="min-h-12 min-w-0 flex-1 py-1 text-left">
          {conteudo}
        </button>
      )}
      <div className="flex shrink-0 items-center gap-1">
        {selecionado && (
          <>
            <button
              type="button"
              aria-label={`Menos ${i.nome}`}
              onClick={() => aoMudar(qtd - 1)}
              className="flex size-12 items-center justify-center rounded-xl border border-borda bg-superficie text-marca active:bg-marca-clara"
            >
              <Minus className="size-5" aria-hidden />
            </button>
            <span className="min-w-8 text-center text-lg font-bold" aria-label={`${numero(qtd, 3)} na lista`}>
              {numero(qtd, 3)}
            </span>
          </>
        )}
        {bloqueado ? (
          <Lock className="mx-3 size-5 text-suave" aria-label="Já está na compra" />
        ) : (
          <button
            type="button"
            aria-label={`Mais ${i.nome}`}
            onClick={() => aoMudar(qtd + 1)}
            className={`flex size-12 items-center justify-center rounded-xl ${
              selecionado ? 'bg-marca text-white active:bg-marca-escura' : 'border border-borda bg-superficie text-marca active:bg-marca-clara'
            }`}
          >
            <Plus className="size-5" aria-hidden />
          </button>
        )}
      </div>
    </li>
  )
}
