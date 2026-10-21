import { ArrowLeft, CloudOff, CloudUpload, Check, MoreVertical, Pencil, Plus, ScanBarcode, Trash2, UserRound } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/Autenticacao'
import { useAviso } from '../../components/Aviso'
import { BarraAcao, Botao, Busca, Carregando, Erro, Vazio } from '../../components/ui'
import { levou, resumoCompra, totalItem, type ResumoCompra } from '../../lib/compras'
import { moeda } from '../../lib/format'
import { dataBr } from '../financeiro/util'
import { useInsumos, type Insumo } from '../insumos/api'
import {
  gravarMeuNome,
  itemDoInsumo,
  lerMeuNome,
  useCompras,
  useFilaCompra,
  useHistoricoPorInsumo,
  useItensCompra,
  useMarcarItem,
  useRemoverCompra,
  type Compra,
  type DadosItemCompra,
  type ItemCompra,
} from './api'
import { CartaoItem, type AcaoItem } from './componentes/CartaoItem'
import { Folha } from './componentes/Folha'
import { FolhaFeito, FolhaNao, FolhaNome, FolhaPegar, FolhaTrocar } from './componentes/FolhasItem'
import { nomeDoEmail, simplificar, textoQtd } from './componentes/formato'
import { LeitorCodigo, leitorDisponivel } from './componentes/LeitorCodigo'
import { SeletorInsumo } from './componentes/SeletorInsumo'

// Fazer a compra no mercado: marcar Peguei / Trocar / Não levei em cada item.
// Os dois celulares abrem a mesma compra e veem as marcações um do outro (atualiza a cada 4 s).

type Aba = 'faltam' | 'carrinho' | 'nao'

type FolhaAberta =
  | { tipo: 'pegar'; item: DadosItemCompra; edicao: boolean; novo: boolean }
  | { tipo: 'trocar'; item: DadosItemCompra; edicao: boolean }
  | { tipo: 'nao'; item: DadosItemCompra }
  | { tipo: 'feito'; id: string }
  | { tipo: 'fora'; codigo?: string }
  | { tipo: 'menu' }
  | { tipo: 'apagar' }
  | null

const linkBotao =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-marca px-5 font-semibold text-white active:bg-marca-escura'

export default function FazerCompraPage() {
  const { id } = useParams()
  const compras = useCompras()
  const compra = compras.data?.find((c) => c.id === id)
  const itens = useItensCompra(compra?.id, compra?.status === 'aberta')

  if (compras.isLoading || (compra && itens.isLoading)) return <Carregando />
  if (compras.error) return <Erro mensagem={compras.error.message} tentarDeNovo={() => compras.refetch()} />
  if (!compra) {
    return (
      <>
        <LinkCompras />
        <Vazio
          titulo="Compra não encontrada"
          texto="Ela pode ter sido apagada no outro celular."
          acao={
            <Link to="/compras" className={linkBotao}>
              Ver as compras
            </Link>
          }
        />
      </>
    )
  }
  if (itens.error) return <Erro mensagem={itens.error.message} tentarDeNovo={() => itens.refetch()} />
  if (compra.status === 'finalizada') return <CompraFinalizada compra={compra} itens={itens.data ?? []} />
  return <CompraAberta compra={compra} itens={itens.data ?? []} />
}

function LinkCompras({ historico = false }: { historico?: boolean }) {
  return (
    <Link
      to={historico ? '/compras/historico' : '/compras'}
      className="-ml-2 mb-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-suave active:bg-marca-clara"
    >
      <ArrowLeft className="size-5" aria-hidden />
      {historico ? 'Histórico' : 'Compras'}
    </Link>
  )
}

function subtituloCompra(c: Compra) {
  return [c.local, dataBr(c.data)].filter(Boolean).join(' · ')
}

// ---- Compra aberta --------------------------------------------------------------------------

function CompraAberta({ compra, itens }: { compra: Compra; itens: ItemCompra[] }) {
  const navegar = useNavigate()
  const avisar = useAviso()
  const { usuario } = useAuth()
  const { data: insumos } = useInsumos()
  const { data: historico } = useHistoricoPorInsumo()
  const marcar = useMarcarItem()
  const remover = useRemoverCompra()

  const [aba, setAba] = useState<Aba>('faltam')
  const [busca, setBusca] = useState('')
  const [folha, setFolha] = useState<FolhaAberta>(null)
  const [lendo, setLendo] = useState(false)
  const [nome, setNome] = useState(lerMeuNome)
  const [pedirNome, setPedirNome] = useState(() => !lerMeuNome())
  const [podeLer] = useState(leitorDisponivel)

  const resumo = useMemo(() => resumoCompra(itens), [itens])
  const itemPorId = useMemo(() => new Map(itens.map((i) => [i.id, i])), [itens])
  const insumoPorId = useMemo(() => new Map((insumos ?? []).map((i) => [i.id, i])), [insumos])
  const insumoPorCodigo = useMemo(() => {
    const m = new Map<string, Insumo>()
    for (const i of insumos ?? []) if (i.codigo_barras?.trim()) m.set(i.codigo_barras.trim(), i)
    return m
  }, [insumos])
  const naLista = useMemo(() => new Set(itens.map((i) => i.insumo_id).filter(Boolean)), [itens])
  const foraDaLista = useMemo(() => (insumos ?? []).filter((i) => !naLista.has(i.id)), [insumos, naLista])

  // Os botões dos cartões leem o item mais recente por aqui (callback estável para o memo dos cartões).
  const itemRef = useRef(itemPorId)
  useEffect(() => {
    itemRef.current = itemPorId
  })

  const aoAcao = useCallback((idItem: string, acao: AcaoItem) => {
    const item = itemRef.current.get(idItem)
    if (!item) return
    if (acao === 'pegar') setFolha({ tipo: 'pegar', item, edicao: false, novo: false })
    else if (acao === 'trocar') setFolha({ tipo: 'trocar', item, edicao: false })
    else if (acao === 'nao') setFolha({ tipo: 'nao', item })
    else setFolha({ tipo: 'feito', id: idItem })
  }, [])

  function gravar(novo: DadosItemCompra, anterior: DadosItemCompra | null, texto: string) {
    marcar({ ...novo, marcado_por: novo.status === 'pendente' ? null : nome || null })
    setFolha(null)
    avisar({ texto, desfazer: anterior ? () => marcar(anterior) : undefined })
  }

  function textoMarcacao(i: DadosItemCompra) {
    if (i.status === 'comprado') return `${i.nome} no carrinho ✓`
    if (i.status === 'substituido') return `Troca anotada: ${i.sub_nome} ✓`
    if (i.status === 'nao') return `${i.nome}: não levei`
    return `${i.nome} voltou para Faltam`
  }

  function confirmarItem(novo: DadosItemCompra, eraNovo = false) {
    gravar(novo, eraNovo ? null : (itemPorId.get(novo.id) ?? null), textoMarcacao(novo))
  }

  function voltarParaFaltam(item: ItemCompra) {
    // Na troca, a embalagem era a do produto levado: volta a do insumo da lista.
    const ins = item.status === 'substituido' && item.insumo_id ? insumoPorId.get(item.insumo_id) : undefined
    confirmarItem({
      ...item,
      status: 'pendente',
      qtd_comprada: null,
      preco_pago: null,
      motivo: null,
      sub_insumo_id: null,
      sub_nome: null,
      ...(ins ? { embalagem_qtd: ins.qtd_compra, embalagem_unidade: ins.unidade_compra } : {}),
    })
  }

  function abrirItem(item: ItemCompra) {
    setFolha(item.status === 'pendente' ? { tipo: 'pegar', item, edicao: false, novo: false } : { tipo: 'feito', id: item.id })
  }

  function novoForaDaLista(insumo: Insumo) {
    const ordem = itens.reduce((m, i) => Math.max(m, i.ordem), 0) + 1
    setFolha({ tipo: 'pegar', item: itemDoInsumo(compra.id, insumo, 1, ordem, true), edicao: false, novo: true })
  }

  function aoLerCodigo(codigo: string) {
    setLendo(false)
    const insumo = insumoPorCodigo.get(codigo.trim())
    if (insumo) {
      const item = itens.find((i) => i.insumo_id === insumo.id)
      if (item) abrirItem(item)
      else novoForaDaLista(insumo)
      return
    }
    setFolha({ tipo: 'fora', codigo: codigo.trim() })
  }

  async function apagar() {
    try {
      await remover.mutateAsync(compra.id)
      navegar('/compras', { replace: true })
      avisar({ texto: 'Compra apagada' })
    } catch {
      // o erro aparece na folha pelo estado da mutação
    }
  }

  const visiveis = useMemo(() => {
    const termo = simplificar(busca)
    const digitos = busca.trim()
    return itens.filter((i) => {
      const naAba = aba === 'faltam' ? i.status === 'pendente' : aba === 'carrinho' ? levou(i) : i.status === 'nao'
      if (!naAba) return false
      if (!termo) return true
      if (simplificar(i.nome).includes(termo) || simplificar(i.sub_nome).includes(termo)) return true
      const cod = i.insumo_id ? insumoPorId.get(i.insumo_id)?.codigo_barras : null
      return !!cod && cod.includes(digitos)
    })
  }, [itens, aba, busca, insumoPorId])

  const feito = folha?.tipo === 'feito' ? itemPorId.get(folha.id) : undefined

  return (
    <>
      <LinkCompras />
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold break-words">{compra.nome}</h1>
          <p className="text-suave">{subtituloCompra(compra)}</p>
        </div>
        <button
          type="button"
          aria-label="Mais opções da compra"
          onClick={() => setFolha({ tipo: 'menu' })}
          className="flex size-12 shrink-0 items-center justify-center rounded-2xl text-marca active:bg-marca-clara"
        >
          <MoreVertical className="size-6" aria-hidden />
        </button>
      </header>

      <Progresso resumo={resumo} compraId={compra.id} />

      <div className="sticky top-0 z-10 -mx-4 mb-3 flex flex-col gap-3 bg-creme/95 px-4 pt-2 pb-2 backdrop-blur">
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <Busca valor={busca} aoMudar={setBusca} placeholder="Buscar item ou código" />
          </div>
          {podeLer && (
            <button
              type="button"
              aria-label="Ler código de barras"
              onClick={() => setLendo(true)}
              className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-borda bg-superficie text-marca active:bg-marca-clara"
            >
              <ScanBarcode className="size-6" aria-hidden />
            </button>
          )}
        </div>
        <div role="tablist" aria-label="Itens da compra" className="grid grid-cols-3 gap-1 rounded-2xl border border-borda bg-superficie p-1">
          {(
            [
              ['faltam', 'Faltam', resumo.pendentes],
              ['carrinho', 'Carrinho', resumo.carrinho],
              ['nao', 'Não levei', resumo.nao],
            ] as const
          ).map(([valor, rotulo, n]) => {
            const ativo = valor === aba
            return (
              <button
                key={valor}
                type="button"
                role="tab"
                aria-selected={ativo}
                onClick={() => setAba(valor)}
                className={`flex min-h-12 flex-col items-center justify-center rounded-xl leading-tight font-semibold transition-colors ${
                  ativo ? 'bg-marca text-white shadow-sm' : 'text-tinta active:bg-marca-clara'
                }`}
              >
                <span className="text-lg tabular-nums">{n}</span>
                <span className="text-sm">{rotulo}</span>
              </button>
            )
          })}
        </div>
      </div>

      {visiveis.length === 0 ? (
        <Vazio {...vazioDaAba(aba, busca, resumo)} acao={vazioAcao(aba, busca, resumo, compra.id, () => setBusca(''))} />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Itens">
          {visiveis.map((i) => (
            <li key={i.id}>
              <CartaoItem
                item={i}
                historico={historico?.get((i.status === 'substituido' ? i.sub_insumo_id : i.insumo_id) ?? '')}
                aoAcao={aoAcao}
              />
            </li>
          ))}
        </ul>
      )}

      <BarraAcao>
        <Botao variante="secundario" onClick={() => setFolha({ tipo: 'fora' })} className="shrink-0 px-4">
          <Plus className="size-5" aria-hidden />
          Fora da lista
        </Botao>
        <Botao className="flex-1" onClick={() => navegar(`/compras/${compra.id}/finalizar`)}>
          Finalizar
        </Botao>
      </BarraAcao>

      {/* ---- Folhas ---- */}
      {folha?.tipo === 'pegar' && (
        <FolhaPegar
          key={folha.item.id}
          item={folha.item}
          historico={folha.item.insumo_id ? historico?.get(folha.item.insumo_id) : undefined}
          edicao={folha.edicao}
          aoConfirmar={(novo) => confirmarItem(novo, folha.novo)}
          aoFechar={() => setFolha(null)}
        />
      )}
      {folha?.tipo === 'trocar' && (
        <FolhaTrocar
          key={folha.item.id}
          item={folha.item}
          insumos={insumos ?? []}
          historicoPorInsumo={historico}
          edicao={folha.edicao}
          aoConfirmar={(novo) => confirmarItem(novo)}
          aoFechar={() => setFolha(null)}
        />
      )}
      {folha?.tipo === 'nao' && (
        <FolhaNao key={folha.item.id} item={folha.item} aoConfirmar={(novo) => confirmarItem(novo)} aoFechar={() => setFolha(null)} />
      )}
      {folha?.tipo === 'feito' && feito && (
        <FolhaFeito
          item={feito}
          aoFechar={() => setFolha(null)}
          aoVoltar={() => voltarParaFaltam(feito)}
          aoAlterar={() =>
            setFolha(
              feito.status === 'substituido'
                ? { tipo: 'trocar', item: feito, edicao: true }
                : feito.status === 'nao'
                  ? { tipo: 'nao', item: feito }
                  : { tipo: 'pegar', item: feito, edicao: true, novo: false },
            )
          }
        />
      )}
      {folha?.tipo === 'fora' && (
        <SeletorInsumo
          titulo="Item fora da lista"
          subtitulo={
            folha.codigo
              ? `Código ${folha.codigo} não cadastrado. Escolha o insumo ou cadastre um novo.`
              : 'Algo que resolveu levar e não estava na lista.'
          }
          insumos={foraDaLista}
          textoVazio="Todos os insumos cadastrados já estão na lista. Cadastre um novo, se precisar."
          aoEscolher={novoForaDaLista}
          aoFechar={() => setFolha(null)}
        />
      )}
      {folha?.tipo === 'menu' && (
        <Folha titulo="Opções da compra" aoFechar={() => setFolha(null)}>
          <div className="flex flex-col gap-3">
            <Botao variante="secundario" className="w-full" onClick={() => navegar(`/compras/${compra.id}/lista`)}>
              <Pencil className="size-5" aria-hidden />
              Editar lista
            </Botao>
            <Botao
              variante="secundario"
              className="w-full"
              onClick={() => {
                setFolha(null)
                setPedirNome(true)
              }}
            >
              <UserRound className="size-5" aria-hidden />
              {nome ? `Mudar meu nome (${nome})` : 'Dizer meu nome'}
            </Botao>
            <Botao variante="perigo" className="w-full" onClick={() => setFolha({ tipo: 'apagar' })}>
              <Trash2 className="size-5" aria-hidden />
              Apagar compra
            </Botao>
          </div>
        </Folha>
      )}
      {folha?.tipo === 'apagar' && (
        <Folha
          titulo="Apagar esta compra?"
          aoFechar={() => setFolha(null)}
          rodape={
            <>
              <Botao variante="secundario" className="flex-1" onClick={() => setFolha(null)}>
                Cancelar
              </Botao>
              <Botao variante="perigo" className="flex-1" onClick={apagar} disabled={remover.isPending}>
                {remover.isPending ? 'Apagando…' : 'Apagar'}
              </Botao>
            </>
          }
        >
          <p>
            A lista "{compra.nome}" e tudo o que foi marcado nela somem dos dois celulares. Não dá para desfazer.
          </p>
          {remover.isError && <Erro mensagem={remover.error.message} />}
        </Folha>
      )}
      {pedirNome && !folha && (
        <FolhaNome
          inicial={nome || nomeDoEmail(usuario)}
          aoFechar={() => setPedirNome(false)}
          aoSalvar={(n) => {
            gravarMeuNome(n)
            setNome(n)
            setPedirNome(false)
          }}
        />
      )}
      {podeLer && <LeitorCodigo aberto={lendo} aoLer={aoLerCodigo} aoFechar={() => setLendo(false)} />}
    </>
  )
}

function vazioDaAba(aba: Aba, busca: string, r: ResumoCompra): { titulo: string; texto?: string } {
  if (busca.trim()) return { titulo: 'Nada encontrado', texto: 'Nenhum item com esse nome nesta aba. Veja as outras abas ou tente outra palavra.' }
  if (r.itens === 0) return { titulo: 'A lista está vazia', texto: 'Monte a lista com os insumos que precisa comprar.' }
  if (aba === 'faltam') return { titulo: 'Tudo conferido!', texto: 'Todos os itens foram resolvidos. Toque em "Finalizar compra" quando passar no caixa.' }
  if (aba === 'carrinho') return { titulo: 'Nada no carrinho ainda', texto: 'Os itens marcados com "Peguei" ou "Trocar" aparecem aqui.' }
  return { titulo: 'Nenhum item deixado de lado', texto: 'Os itens marcados com "Não levei" aparecem aqui, com o motivo.' }
}

function vazioAcao(aba: Aba, busca: string, r: ResumoCompra, compraId: string, limpar: () => void) {
  if (busca.trim()) {
    return (
      <Botao variante="secundario" onClick={limpar}>
        Limpar busca
      </Botao>
    )
  }
  if (r.itens === 0 && aba === 'faltam') {
    return (
      <Link to={`/compras/${compraId}/lista`} className={linkBotao}>
        Montar a lista
      </Link>
    )
  }
  return undefined
}

/** "12 de 30 itens", barra, total do carrinho e se as marcações já subiram. */
function Progresso({ resumo, compraId }: { resumo: ResumoCompra; compraId: string }) {
  const { aguardando, erro, enviarAgora } = useFilaCompra(compraId)
  const [enviando, setEnviando] = useState(false)
  const pct = resumo.itens > 0 ? Math.round((resumo.feitos / resumo.itens) * 100) : 0

  async function enviar() {
    setEnviando(true)
    try {
      await enviarAgora()
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section aria-label="Andamento da compra" className="mb-1 flex flex-col gap-2 rounded-2xl border border-borda bg-superficie p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-semibold tabular-nums">
          {resumo.feitos} de {resumo.itens} {resumo.itens === 1 ? 'item' : 'itens'}
        </p>
        <p className="text-right">
          <span className="block text-sm text-suave">No carrinho</span>
          <span className="text-xl font-bold tabular-nums">{moeda(resumo.total)}</span>
        </p>
      </div>
      <div
        className="h-3 overflow-hidden rounded-full bg-borda"
        role="progressbar"
        aria-label="Itens resolvidos"
        aria-valuemin={0}
        aria-valuemax={resumo.itens}
        aria-valuenow={resumo.feitos}
      >
        <div className="h-full rounded-full bg-marca transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      {resumo.semPreco > 0 && (
        <p className="text-sm text-alerta">
          {resumo.semPreco} {resumo.semPreco === 1 ? 'item sem preço' : 'itens sem preço'} (não {resumo.semPreco === 1 ? 'entra' : 'entram'} no total)
        </p>
      )}
      <div aria-live="polite" className="text-sm">
        {aguardando > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`flex items-center gap-1.5 ${erro ? 'text-alerta' : 'text-suave'}`}>
              <CloudOff className="size-4 shrink-0" aria-hidden />
              {aguardando} {aguardando === 1 ? 'marcação por enviar' : 'marcações por enviar'}
              {erro ? ` · ${erro}` : ''}
            </span>
            <button
              type="button"
              onClick={enviar}
              disabled={enviando}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 font-semibold text-marca active:bg-marca-clara disabled:opacity-50"
            >
              <CloudUpload className="size-4" aria-hidden />
              {enviando ? 'Enviando…' : 'Enviar agora'}
            </button>
          </div>
        ) : erro ? (
          <span className="flex items-center gap-1.5 text-alerta">
            <CloudOff className="size-4 shrink-0" aria-hidden />
            {erro}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-ok">
            <Check className="size-4 shrink-0" aria-hidden />
            Sincronizado
          </span>
        )}
      </div>
    </section>
  )
}

// ---- Compra finalizada (só leitura) ---------------------------------------------------------

function CompraFinalizada({ compra, itens }: { compra: Compra; itens: ItemCompra[] }) {
  const resumo = useMemo(() => resumoCompra(itens), [itens])
  const comprados = itens.filter(levou)
  const nao = itens.filter((i) => i.status === 'nao')
  const semMarcar = itens.filter((i) => i.status === 'pendente')

  return (
    <>
      <LinkCompras historico />
      <header className="mb-4">
        <h1 className="text-2xl font-bold break-words">{compra.nome}</h1>
        <p className="text-suave">{subtituloCompra(compra)}</p>
      </header>

      <section className="mb-4 flex items-baseline justify-between gap-3 rounded-2xl border border-borda bg-superficie p-4">
        <div>
          <p className="font-semibold">Compra finalizada</p>
          {compra.finalizada_em && <p className="text-sm text-suave">em {dataBr(compra.finalizada_em.slice(0, 10))}</p>}
        </div>
        <p className="text-right">
          <span className="block text-sm text-suave">Total pago</span>
          <span className="text-2xl font-bold tabular-nums">{moeda(compra.total ?? resumo.total)}</span>
        </p>
      </section>

      <div className="flex flex-col gap-5">
        {comprados.length > 0 && (
          <section aria-labelledby="fin-comprados">
            <h2 id="fin-comprados" className="mb-2 text-lg font-bold">
              Comprados ({comprados.length})
            </h2>
            <ul className="divide-y divide-borda rounded-2xl border border-borda bg-superficie">
              {comprados.map((i) => {
                const sub = totalItem(i)
                return (
                  <li key={i.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-semibold break-words">{i.status === 'substituido' ? (i.sub_nome ?? i.nome) : i.nome}</p>
                      {i.status === 'substituido' && <p className="text-sm text-suave">trocado: no lugar de {i.nome}</p>}
                      <p className="text-sm text-suave tabular-nums">
                        {i.qtd_comprada != null ? textoQtd(i.qtd_comprada, i) : ''}
                        {i.preco_pago != null ? ` · ${moeda(i.preco_pago)} cada` : ' · sem preço'}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums">{sub != null ? moeda(sub) : '—'}</span>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {nao.length > 0 && (
          <section aria-labelledby="fin-nao">
            <h2 id="fin-nao" className="mb-2 text-lg font-bold">
              Não levados ({nao.length})
            </h2>
            <ul className="divide-y divide-borda rounded-2xl border border-borda bg-superficie">
              {nao.map((i) => (
                <li key={i.id} className="px-4 py-3">
                  <p className="font-semibold break-words">{i.nome}</p>
                  {i.motivo && <p className="text-sm text-suave">{i.motivo}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {semMarcar.length > 0 && (
          <section aria-labelledby="fin-sem">
            <h2 id="fin-sem" className="mb-2 text-lg font-bold">
              Ficaram sem marcar ({semMarcar.length})
            </h2>
            <ul className="divide-y divide-borda rounded-2xl border border-borda bg-superficie">
              {semMarcar.map((i) => (
                <li key={i.id} className="px-4 py-3 font-semibold break-words">
                  {i.nome}
                </li>
              ))}
            </ul>
          </section>
        )}

        {itens.length === 0 && <Vazio titulo="Esta compra não tinha itens" />}

        <p className="text-sm text-suave">Os preços desta compra foram guardados no histórico de cada insumo.</p>
      </div>
    </>
  )
}
