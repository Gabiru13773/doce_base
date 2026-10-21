import { ArrowLeftRight, ChevronDown, Minus, Plus, TrendingDown, TriangleAlert } from 'lucide-react'
import { useId, useMemo, useState, type FormEvent } from 'react'
import { Botao, Entrada, EntradaNumero, classeEntrada } from '../../../components/ui'
import { avaliarPreco, faixaPrecos, type FaixaPrecos, type PrecoHistorico } from '../../../lib/compras'
import { lerNumero, moeda, paraCampo } from '../../../lib/format'
import { UNIDADES_COMPRA, type UnidadeCompra } from '../../../lib/unidades'
import type { Insumo } from '../../insumos/api'
import { MOTIVOS_NAO, MOTIVOS_TROCA, type DadosItemCompra } from '../api'
import { Fichas, Folha } from './Folha'
import { PrecosReferencia } from './PrecosReferencia'
import { SeletorInsumo } from './SeletorInsumo'
import { textoEmbalagem, textoQtd } from './formato'

// Folhas de marcação de um item: Peguei, Trocar, Não levei, item já marcado e "seu nome".
// Cada folha devolve o item inteiro já alterado; quem chama põe o "marcado_por" e grava.

const OUTRO = 'Outro'
const arred = (n: number) => Math.round(n * 1000) / 1000

/** Lê o campo de preço: vazio = sem preço (vale), texto inválido = NaN. */
function lerPreco(texto: string): number | null {
  return texto.trim() === '' ? null : lerNumero(texto)
}

function Rodape({ aoCancelar, rotulo, desativado, form }: { aoCancelar: () => void; rotulo: string; desativado?: boolean; form: string }) {
  return (
    <>
      <Botao variante="secundario" className="flex-1" onClick={aoCancelar}>
        Cancelar
      </Botao>
      <Botao type="submit" form={form} className="flex-[2]" disabled={desativado}>
        {rotulo}
      </Botao>
    </>
  )
}

/** Quantidade com − e + (aceita decimal digitado: 1,5). */
function Passos({ valor, aoMudar, rotulo, sufixo, erro }: { valor: string; aoMudar: (v: string) => void; rotulo: string; sufixo?: string; erro?: string }) {
  const id = useId()
  const n = lerNumero(valor)
  const botao =
    'flex size-14 shrink-0 items-center justify-center rounded-2xl border border-borda bg-superficie text-marca active:bg-marca-clara disabled:opacity-40'
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-semibold">
        {rotulo}
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Diminuir quantidade"
          className={botao}
          disabled={!(n > 1)}
          onClick={() => aoMudar(paraCampo(arred(n - 1)))}
        >
          <Minus className="size-6" aria-hidden />
        </button>
        <input
          id={id}
          data-foco-inicial
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          onFocus={(e) => e.target.select()}
          aria-invalid={erro ? true : undefined}
          className={`${classeEntrada} min-h-14 text-center text-2xl font-bold tabular-nums ${erro ? 'border-perigo' : ''}`}
        />
        <button
          type="button"
          aria-label="Aumentar quantidade"
          className={botao}
          onClick={() => aoMudar(paraCampo(arred((Number.isFinite(n) ? n : 0) + 1)))}
        >
          <Plus className="size-6" aria-hidden />
        </button>
      </div>
      {erro ? <p className="text-sm font-medium text-perigo">{erro}</p> : sufixo && <p className="text-center text-sm text-suave">{sufixo}</p>}
    </div>
  )
}

/** Embalagem do item, com opção de mudar (ex.: levou o pacote de 5 kg em vez do de 1 kg). */
function CampoEmbalagem({
  qtd,
  unidade,
  aoMudarQtd,
  aoMudarUnidade,
  aberto,
  aoAbrir,
  erro,
}: {
  qtd: string
  unidade: UnidadeCompra
  aoMudarQtd: (v: string) => void
  aoMudarUnidade: (u: UnidadeCompra) => void
  aberto: boolean
  aoAbrir: () => void
  erro?: string
}) {
  const idUn = useId()
  const n = lerNumero(qtd)
  if (!aberto) {
    return (
      <button
        type="button"
        onClick={aoAbrir}
        aria-expanded={false}
        className="-mt-2 inline-flex min-h-12 items-center gap-1 self-start rounded-xl px-2 text-marca active:bg-marca-clara"
      >
        Embalagem de {n > 0 ? textoEmbalagem(n, unidade) : '?'}. Embalagem diferente?
        <ChevronDown className="size-5" aria-hidden />
      </button>
    )
  }
  return (
    <fieldset className="flex flex-col gap-2 rounded-2xl border border-borda bg-superficie p-3">
      <legend className="px-1 font-semibold">Tamanho da embalagem que pegou</legend>
      <div className="grid grid-cols-2 gap-3">
        <EntradaNumero rotulo="Quantidade" value={qtd} onChange={(e) => aoMudarQtd(e.target.value)} erro={erro} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={idUn} className="font-semibold">
            Unidade
          </label>
          <select id={idUn} className={classeEntrada} value={unidade} onChange={(e) => aoMudarUnidade(e.target.value as UnidadeCompra)}>
            {UNIDADES_COMPRA.map((u) => (
              <option key={u.valor} value={u.valor}>
                {u.rotulo}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-sm text-suave">A quantidade e o preço contam por esta embalagem.</p>
    </fieldset>
  )
}

/** Preço por embalagem, com as referências e o aviso de menor/maior preço. */
function CampoPreco({
  valor,
  aoMudar,
  faixa,
  embalagem,
  erro,
}: {
  valor: string
  aoMudar: (v: string) => void
  faixa: FaixaPrecos | null
  embalagem: string
  erro?: string
}) {
  const preco = lerPreco(valor)
  const aval = avaliarPreco(preco != null && Number.isFinite(preco) ? preco : null, faixa)
  return (
    <div className="flex flex-col gap-2">
      <EntradaNumero
        rotulo="Preço de cada embalagem (opcional)"
        prefixo="R$"
        placeholder="0,00"
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        erro={erro}
        ajuda={`Embalagem de ${embalagem}`}
      />
      {faixa ? <PrecosReferencia faixa={faixa} /> : <p className="text-sm text-suave">Ainda não tem preço anotado deste insumo.</p>}
      {aval === 'menor_de_todos' && (
        <p className="flex items-center gap-2 rounded-xl bg-ok-claro px-3 py-2 font-semibold text-ok" role="status">
          <TrendingDown className="size-5 shrink-0" aria-hidden />
          Menor preço já pago!
        </p>
      )}
      {aval === 'acima_do_maior' && faixa && (
        <p className="flex items-center gap-2 rounded-xl bg-alerta-claro px-3 py-2 font-semibold text-alerta" role="status">
          <TriangleAlert className="size-5 shrink-0" aria-hidden />
          Mais caro que o maior já pago ({moeda(faixa.maior)})
        </p>
      )}
    </div>
  )
}

/** Estado comum de Peguei e Trocar: quantidade, preço e embalagem. */
function useCamposCompra(item: DadosItemCompra, historico: PrecoHistorico[] | undefined, edicao: boolean) {
  const [qtd, setQtd] = useState(paraCampo(edicao && item.qtd_comprada != null ? item.qtd_comprada : item.qtd_pedida))
  const [preco, setPreco] = useState(edicao ? paraCampo(item.preco_pago) : '')
  const [embQtd, setEmbQtd] = useState(paraCampo(item.embalagem_qtd))
  const [embUn, setEmbUn] = useState<UnidadeCompra>(item.embalagem_unidade)
  const [embAberto, setEmbAberto] = useState(false)
  const [tentou, setTentou] = useState(false)

  const qtdNum = lerNumero(qtd)
  const precoNum = lerPreco(preco)
  const embNum = lerNumero(embQtd)
  const embValida = embNum > 0
  const faixa = useMemo(
    () => (historico && embValida ? faixaPrecos(historico, { qtd: embNum, unidade: embUn }) : null),
    [historico, embValida, embNum, embUn],
  )
  const erros: { qtd?: string; preco?: string; emb?: string } = {}
  if (!(qtdNum > 0)) erros.qtd = 'Quantas embalagens pegou?'
  if (precoNum != null && !(precoNum >= 0)) erros.preco = 'Preço inválido'
  if (!embValida) erros.emb = 'Informe o tamanho'
  const valido = Object.keys(erros).length === 0
  const subtotal = valido && precoNum != null ? Math.round(qtdNum * precoNum * 100) / 100 : null

  return {
    qtd, setQtd, preco, setPreco, embQtd, setEmbQtd, embUn, setEmbUn, embAberto: embAberto || !!(tentou && erros.emb), setEmbAberto,
    tentou, setTentou, faixa, erros: tentou ? erros : {}, valido, subtotal,
    textoEmb: embValida ? textoEmbalagem(embNum, embUn) : '?',
    resultado: () => ({ qtd_comprada: arred(qtdNum), preco_pago: precoNum, embalagem_qtd: arred(embNum), embalagem_unidade: embUn }),
    setEmbalagem: (q: number, u: UnidadeCompra) => {
      setEmbQtd(paraCampo(q))
      setEmbUn(u)
    },
  }
}

function Subtotal({ valor }: { valor: number | null }) {
  if (valor == null) return null
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-2xl bg-superficie px-4 py-3">
      <span className="text-suave">Subtotal</span>
      <span className="text-lg font-bold tabular-nums">{moeda(valor)}</span>
    </div>
  )
}

// ---- Peguei ---------------------------------------------------------------------------------

export function FolhaPegar({
  item,
  historico,
  edicao,
  aoConfirmar,
  aoFechar,
}: {
  item: DadosItemCompra
  historico: PrecoHistorico[] | undefined
  /** já estava no carrinho: começa com a quantidade e o preço anotados */
  edicao: boolean
  aoConfirmar: (item: DadosItemCompra) => void
  aoFechar: () => void
}) {
  const c = useCamposCompra(item, historico, edicao)
  const idForm = useId()

  function confirmar(e: FormEvent) {
    e.preventDefault()
    c.setTentou(true)
    if (!c.valido) return
    aoConfirmar({ ...item, ...c.resultado(), status: 'comprado', motivo: null, sub_insumo_id: null, sub_nome: null })
  }

  return (
    <Folha
      titulo={item.nome}
      subtitulo={`Na lista: ${textoQtd(item.qtd_pedida, item)}`}
      aoFechar={aoFechar}
      rodape={<Rodape form={idForm} aoCancelar={aoFechar} rotulo="Pôr no carrinho" />}
    >
      <form id={idForm} onSubmit={confirmar} noValidate className="flex flex-col gap-5">
        <Passos rotulo="Quantas embalagens pegou?" valor={c.qtd} aoMudar={c.setQtd} erro={c.erros.qtd} sufixo={`de ${c.textoEmb}`} />
        <CampoEmbalagem
          qtd={c.embQtd}
          unidade={c.embUn}
          aoMudarQtd={c.setEmbQtd}
          aoMudarUnidade={c.setEmbUn}
          aberto={c.embAberto}
          aoAbrir={() => c.setEmbAberto(true)}
          erro={c.erros.emb}
        />
        <CampoPreco valor={c.preco} aoMudar={c.setPreco} faixa={c.faixa} embalagem={c.textoEmb} erro={c.erros.preco} />
        <Subtotal valor={c.subtotal} />
      </form>
    </Folha>
  )
}

// ---- Trocar ---------------------------------------------------------------------------------

function motivoInicial(motivo: string | null, opcoes: string[]): { ficha: string | null; outro: string } {
  if (!motivo) return { ficha: null, outro: '' }
  if (opcoes.includes(motivo)) return { ficha: motivo, outro: '' }
  return { ficha: OUTRO, outro: motivo }
}

export function FolhaTrocar({
  item,
  insumos,
  historicoPorInsumo,
  edicao,
  aoConfirmar,
  aoFechar,
}: {
  item: DadosItemCompra
  /** todos os insumos ativos (o próprio item fica de fora da escolha) */
  insumos: Insumo[]
  historicoPorInsumo: Map<string, PrecoHistorico[]> | undefined
  edicao: boolean
  aoConfirmar: (item: DadosItemCompra) => void
  aoFechar: () => void
}) {
  const inicialSub = edicao && item.sub_insumo_id ? insumos.find((i) => i.id === item.sub_insumo_id) ?? null : null
  const [sub, setSub] = useState<{ id: string | null; nome: string } | null>(
    inicialSub ? { id: inicialSub.id, nome: inicialSub.nome } : edicao && item.sub_nome ? { id: item.sub_insumo_id, nome: item.sub_nome } : null,
  )
  const [escolhendo, setEscolhendo] = useState(!sub)
  const historico = sub?.id ? historicoPorInsumo?.get(sub.id) : undefined
  const c = useCamposCompra(item, historico, edicao)
  const m0 = motivoInicial(edicao ? item.motivo : null, MOTIVOS_TROCA)
  const [ficha, setFicha] = useState<string | null>(m0.ficha)
  const [outro, setOutro] = useState(m0.outro)
  const idForm = useId()
  const opcoes = useMemo(() => insumos.filter((i) => i.id !== item.insumo_id && i.id !== sub?.id), [insumos, item.insumo_id, sub?.id])

  function escolher(i: Insumo) {
    setSub({ id: i.id, nome: i.nome })
    c.setEmbalagem(i.qtd_compra, i.unidade_compra)
    setEscolhendo(false)
  }

  function confirmar(e: FormEvent) {
    e.preventDefault()
    c.setTentou(true)
    if (!c.valido || !sub) return
    const motivo = ficha === OUTRO ? outro.trim() || null : ficha
    aoConfirmar({ ...item, ...c.resultado(), status: 'substituido', motivo, sub_insumo_id: sub.id, sub_nome: sub.nome })
  }

  const seletor = escolhendo && (
    <SeletorInsumo
      titulo="O que levou no lugar?"
      subtitulo={`No lugar de ${item.nome}`}
      insumos={opcoes}
      textoVazio="Cadastre o produto que levou no lugar e volte aqui."
      aoEscolher={escolher}
      aoFechar={() => (sub ? setEscolhendo(false) : aoFechar())}
    />
  )
  if (!sub) return seletor || null

  return (
    <>
      <Folha
        titulo={`Trocar ${item.nome}`}
        aoFechar={aoFechar}
        rodape={<Rodape form={idForm} aoCancelar={aoFechar} rotulo="Confirmar troca" />}
      >
        <form id={idForm} onSubmit={confirmar} noValidate className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <p className="font-semibold">Levou no lugar</p>
            <button
              type="button"
              onClick={() => setEscolhendo(true)}
              className="flex min-h-14 items-center gap-3 rounded-2xl border border-borda bg-superficie px-4 py-3 text-left active:bg-marca-clara"
            >
              <ArrowLeftRight className="size-5 shrink-0 text-marca" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-semibold">{sub.nome}</span>
              <span className="shrink-0 text-marca">Mudar</span>
            </button>
          </div>
          <Passos rotulo="Quantas embalagens pegou?" valor={c.qtd} aoMudar={c.setQtd} erro={c.erros.qtd} sufixo={`de ${c.textoEmb}`} />
          <CampoEmbalagem
            qtd={c.embQtd}
            unidade={c.embUn}
            aoMudarQtd={c.setEmbQtd}
            aoMudarUnidade={c.setEmbUn}
            aberto={c.embAberto}
            aoAbrir={() => c.setEmbAberto(true)}
            erro={c.erros.emb}
          />
          <CampoPreco valor={c.preco} aoMudar={c.setPreco} faixa={c.faixa} embalagem={c.textoEmb} erro={c.erros.preco} />
          <Subtotal valor={c.subtotal} />
          <div className="flex flex-col gap-2">
            <p className="font-semibold">Por que trocou? (opcional)</p>
            <Fichas rotulo="Por que trocou" opcoes={[...MOTIVOS_TROCA, OUTRO]} valor={ficha} aoMudar={setFicha} />
            {ficha === OUTRO && (
              <Entrada rotulo="Qual o motivo?" value={outro} onChange={(e) => setOutro(e.target.value)} autoFocus maxLength={120} />
            )}
          </div>
        </form>
      </Folha>
      {seletor}
    </>
  )
}

// ---- Não levei ------------------------------------------------------------------------------

export function FolhaNao({
  item,
  aoConfirmar,
  aoFechar,
}: {
  item: DadosItemCompra
  aoConfirmar: (item: DadosItemCompra) => void
  aoFechar: () => void
}) {
  const m0 = motivoInicial(item.status === 'nao' ? item.motivo : null, MOTIVOS_NAO)
  const [ficha, setFicha] = useState<string | null>(m0.ficha)
  const [outro, setOutro] = useState(m0.outro)
  const idForm = useId()
  const motivo = ficha === OUTRO ? outro.trim() : ficha
  const valido = !!motivo

  function confirmar(e: FormEvent) {
    e.preventDefault()
    if (!motivo) return
    aoConfirmar({ ...item, status: 'nao', motivo, qtd_comprada: null, preco_pago: null, sub_insumo_id: null, sub_nome: null })
  }

  return (
    <Folha
      titulo={item.nome}
      subtitulo="Por que este item não vai?"
      aoFechar={aoFechar}
      rodape={<Rodape form={idForm} aoCancelar={aoFechar} rotulo="Confirmar" desativado={!valido} />}
    >
      <form id={idForm} onSubmit={confirmar} noValidate className="flex flex-col gap-4">
        <Fichas rotulo="Motivo" opcoes={[...MOTIVOS_NAO, OUTRO]} valor={ficha} aoMudar={setFicha} />
        {ficha === OUTRO && (
          <Entrada rotulo="Qual o motivo?" value={outro} onChange={(e) => setOutro(e.target.value)} autoFocus maxLength={120} />
        )}
      </form>
    </Folha>
  )
}

// ---- Item já marcado ------------------------------------------------------------------------

export function FolhaFeito({
  item,
  aoAlterar,
  aoVoltar,
  aoFechar,
}: {
  item: DadosItemCompra
  aoAlterar: () => void
  aoVoltar: () => void
  aoFechar: () => void
}) {
  const qtd = item.qtd_comprada != null ? textoQtd(item.qtd_comprada, item) : ''
  const preco = item.preco_pago != null ? ` a ${moeda(item.preco_pago)} cada` : ''
  const info =
    item.status === 'comprado'
      ? `No carrinho: ${qtd}${preco}`
      : item.status === 'substituido'
        ? `Trocado por ${item.sub_nome ?? '?'}: ${qtd}${preco}${item.motivo ? ` · ${item.motivo}` : ''}`
        : `Não levei: ${item.motivo ?? ''}`
  const rotuloAlterar =
    item.status === 'comprado' ? 'Alterar quantidade ou preço' : item.status === 'substituido' ? 'Alterar a troca' : 'Mudar o motivo'
  return (
    <Folha
      titulo={item.nome}
      subtitulo={
        <>
          {info}
          {item.marcado_por ? ` · por ${item.marcado_por}` : ''}
        </>
      }
      aoFechar={aoFechar}
    >
      <div className="flex flex-col gap-3">
        <Botao className="w-full" onClick={aoAlterar}>
          {rotuloAlterar}
        </Botao>
        <Botao variante="secundario" className="w-full" onClick={aoVoltar}>
          Voltar para "Faltam"
        </Botao>
      </div>
    </Folha>
  )
}

// ---- Seu nome -------------------------------------------------------------------------------

export function FolhaNome({ inicial, aoSalvar, aoFechar }: { inicial: string; aoSalvar: (nome: string) => void; aoFechar: () => void }) {
  const [nome, setNome] = useState(inicial)
  const idForm = useId()
  return (
    <Folha
      titulo="Como você se chama?"
      subtitulo="Aparece nos itens que você marcar, para os dois saberem quem pegou o quê."
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao variante="secundario" className="flex-1" onClick={aoFechar}>
            Agora não
          </Botao>
          <Botao type="submit" form={idForm} className="flex-[2]" disabled={!nome.trim()}>
            Salvar
          </Botao>
        </>
      }
    >
      <form
        id={idForm}
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (nome.trim()) aoSalvar(nome.trim())
        }}
      >
        <Entrada rotulo="Seu nome" placeholder="Ex.: Ana" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={30} autoComplete="given-name" />
      </form>
    </Folha>
  )
}
