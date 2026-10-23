import { ChevronRight, ClipboardList } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { BarraAcao, Botao, Busca, Carregando, Erro, Pilulas, TituloPagina, Vazio } from '../../components/ui'
import { custoPorUnidadeBase } from '../../lib/custos'
import { moeda } from '../../lib/format'
import { calcularCusto } from '../../lib/receitas'
import { simplificar } from '../compras/componentes/formato'
import { mensagemDe } from '../financeiro/util'
import { useInsumos } from '../insumos/api'
import { useContextoCalculo, useReceitas } from '../receitas/api'
import { useSaldos } from './api'
import { caminhoItem, itemDeInsumo, itemDeReceita, textoEmbalagens, textoQtdItem, textoSaldo, type ItemEstoque } from './componentes/itens'
import { SeloSituacao } from './componentes/SeloSituacao'

// O que tem em estoque: insumos e preparados prontos (recheio, bolo, fatias…).

type Aba = 'insumos' | 'preparados'
type Filtro = 'todos' | 'acabando' | 'zerados'

const FILTROS: { valor: Filtro; rotulo: string }[] = [
  { valor: 'todos', rotulo: 'Todos' },
  { valor: 'acabando', rotulo: 'Acabando' },
  { valor: 'zerados', rotulo: 'Zerados' },
]

// Mesma regra de precisaComprar: abaixo do mínimo (zerado conta se tiver mínimo) ou negativo; nunca contado não entra.
const acabando = (i: ItemEstoque) => i.situacao === 'acabando' || i.situacao === 'negativo' || (i.situacao === 'zerado' && i.minimo != null)

export default function EstoquePage() {
  const navegar = useNavigate()
  const [params, setParams] = useSearchParams()
  const aba: Aba = params.get('aba') === 'preparados' ? 'preparados' : 'insumos'
  const filtro: Filtro = params.get('filtro') === 'acabando' ? 'acabando' : params.get('filtro') === 'zerados' ? 'zerados' : 'todos'
  const busca = params.get('busca') ?? ''

  function mudar(novo: { aba?: Aba; filtro?: Filtro; busca?: string }) {
    const p = new URLSearchParams(params)
    const aplicar = (chave: string, v: string | undefined, padrao: string) => {
      if (v === undefined) return
      if (v === padrao) p.delete(chave)
      else p.set(chave, v)
    }
    aplicar('aba', novo.aba, 'insumos')
    aplicar('filtro', novo.filtro, 'todos')
    aplicar('busca', novo.busca, '')
    setParams(p, { replace: true })
  }

  const insumos = useInsumos()
  const receitas = useReceitas()
  const saldos = useSaldos()
  const { contexto } = useContextoCalculo()

  const itensInsumos = useMemo(
    () => (insumos.data ?? []).map((i) => itemDeInsumo(i, saldos.data?.insumos[i.id])),
    [insumos.data, saldos.data],
  )
  // Preparados: só os que já tiveram movimento ou têm mínimo definido.
  const itensPreparados = useMemo(
    () =>
      (receitas.data ?? [])
        .filter((r) => saldos.data?.receitas[r.id] !== undefined || (r.estoque_minimo ?? 0) > 0)
        .map((r) => itemDeReceita(r, saldos.data?.receitas[r.id])),
    [receitas.data, saldos.data],
  )

  const valor = useMemo(() => {
    let total = 0
    for (const i of insumos.data ?? []) {
      const s = saldos.data?.insumos[i.id] ?? 0
      if (s > 0) total += s * custoPorUnidadeBase({ qtdCompra: i.qtd_compra, unidadeCompra: i.unidade_compra, precoCompra: i.preco_compra })
    }
    if (!contexto) return { total, comPreparados: false }
    for (const p of itensPreparados) if (p.saldo > 0) total += p.saldo * calcularCusto(p.id, contexto).custoPorBase
    return { total, comPreparados: true }
  }, [insumos.data, saldos.data, contexto, itensPreparados])

  const qtdAcabando = { insumos: itensInsumos.filter(acabando).length, preparados: itensPreparados.filter(acabando).length }
  const totalAcabando = qtdAcabando.insumos + qtdAcabando.preparados

  const lista = aba === 'insumos' ? itensInsumos : itensPreparados
  const visiveis = useMemo(() => {
    const termo = simplificar(busca)
    return lista.filter((i) => {
      if (filtro === 'acabando' && !acabando(i)) return false
      if (filtro === 'zerados' && i.saldo > 0) return false
      return !termo || simplificar(i.nome).includes(termo)
    })
  }, [lista, filtro, busca])

  function verAcabando() {
    const outra: Aba = aba === 'insumos' ? 'preparados' : 'insumos'
    const vaiPara = qtdAcabando[aba] === 0 && qtdAcabando[outra] > 0 ? outra : aba
    mudar({ filtro: 'acabando', aba: vaiPara, busca: '' })
  }

  const carregando = insumos.isLoading || receitas.isLoading || saldos.isLoading
  const erro = insumos.error ?? receitas.error ?? saldos.error
  const semMovimentos = (saldos.data && Object.keys(saldos.data.insumos).length === 0 && Object.keys(saldos.data.receitas).length === 0) ?? false

  const botaoContar = (
    <BarraAcao>
      <Botao className="flex-1" onClick={() => navegar('/estoque/contagem')}>
        <ClipboardList className="size-5" aria-hidden />
        Contar estoque
      </Botao>
    </BarraAcao>
  )

  if (carregando) return <Carregando />
  if (erro)
    return (
      <Erro
        mensagem={mensagemDe(erro)}
        tentarDeNovo={() => {
          insumos.refetch()
          receitas.refetch()
          saldos.refetch()
        }}
      />
    )

  if ((insumos.data ?? []).length === 0)
    return (
      <>
        <TituloPagina titulo="Estoque" />
        <Vazio
          titulo="Nenhum insumo cadastrado"
          texto="Primeiro cadastre o que vocês compram (leite condensado, caixinhas…). Depois é só contar quanto tem."
          acao={<Botao onClick={() => navegar('/insumos/novo')}>Cadastrar insumo</Botao>}
        />
      </>
    )

  if (semMovimentos)
    return (
      <>
        <TituloPagina titulo="Estoque" />
        <Vazio
          titulo="Primeiro passo: a contagem inicial"
          texto="Conte quanto vocês têm de cada insumo hoje e anote no app. Depois disso, as compras e as produções atualizam o estoque sozinhas."
          acao={<Botao onClick={() => navegar('/estoque/contagem')}>Fazer a contagem inicial</Botao>}
        />
      </>
    )

  return (
    <>
      <TituloPagina titulo="Estoque" subtitulo="O que tem guardado agora" />

      <div className="mb-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={verAcabando}
          aria-pressed={filtro === 'acabando'}
          className={`flex min-h-20 flex-col items-start justify-center rounded-2xl border px-4 py-3 text-left active:bg-marca-clara ${
            totalAcabando > 0 ? 'border-alerta/30 bg-alerta-claro' : 'border-borda bg-superficie'
          }`}
        >
          <span className={`text-sm font-medium ${totalAcabando > 0 ? 'text-alerta' : 'text-suave'}`}>Acabando</span>
          <span className={`text-2xl font-bold ${totalAcabando > 0 ? 'text-alerta' : ''}`}>{totalAcabando}</span>
          <span className="text-xs text-suave">{totalAcabando > 0 ? 'Toque para ver' : 'Nada abaixo do mínimo'}</span>
        </button>
        <div className="flex min-h-20 flex-col justify-center rounded-2xl border border-borda bg-superficie px-4 py-3">
          <span className="text-sm font-medium text-suave">Valor em estoque</span>
          <span className="text-2xl font-bold text-marca">{moeda(valor.total)}</span>
          <span className="text-xs text-suave">{valor.comPreparados ? 'insumos + preparados' : 'só insumos'}</span>
        </div>
      </div>

      <div className="sticky top-[3.6rem] z-10 -mx-4 mb-3 flex flex-col gap-3 bg-creme/95 px-4 pt-1 pb-2 backdrop-blur md:top-0">
        <Pilulas
          rotulo="O que ver"
          valor={aba}
          aoMudar={(v) => mudar({ aba: v })}
          opcoes={[
            { valor: 'insumos', rotulo: `Insumos (${itensInsumos.length})` },
            { valor: 'preparados', rotulo: `Preparados (${itensPreparados.length})` },
          ]}
        />
        <Busca valor={busca} aoMudar={(v) => mudar({ busca: v })} placeholder={aba === 'insumos' ? 'Buscar insumo' : 'Buscar preparado'} />
        <div className="-mx-4 overflow-x-auto px-4 [&>div]:flex-nowrap">
          <Pilulas rotulo="Filtrar" valor={filtro} aoMudar={(v) => mudar({ filtro: v })} opcoes={FILTROS} />
        </div>
      </div>

      {visiveis.length === 0 ? (
        aba === 'preparados' && itensPreparados.length === 0 ? (
          <Vazio
            titulo="Nenhum preparado em estoque"
            texto="Aparece aqui o que vocês produzirem (recheio, massa, bolo, fatias…). Registre uma produção ou conte o que tem pronto."
            acao={
              <Botao variante="secundario" onClick={() => navegar('/producao')}>
                Ir para Produção
              </Botao>
            }
          />
        ) : (
          <Vazio
            titulo={filtro === 'acabando' ? 'Nada acabando aqui' : filtro === 'zerados' ? 'Nada zerado aqui' : 'Nada encontrado'}
            texto={busca ? 'Tente outra palavra.' : undefined}
            acao={
              <Botao variante="secundario" onClick={() => mudar({ filtro: 'todos', busca: '' })}>
                Ver todos
              </Botao>
            }
          />
        )
      ) : (
        <ul className="flex flex-col gap-2">
          {visiveis.map((i) => (
            <li key={i.id}>
              <LinhaItem item={i} />
            </li>
          ))}
        </ul>
      )}

      {aba === 'preparados' && itensPreparados.length > 0 && (
        <p className="mt-4 text-center text-sm text-suave">Aparece aqui o que vocês produzirem. Os outros ficam escondidos até ter estoque.</p>
      )}

      {botaoContar}
    </>
  )
}

function LinhaItem({ item: i }: { item: ItemEstoque }) {
  const pacotes = textoEmbalagens(i)
  const detalhes = [pacotes, i.minimo != null ? `mínimo ${textoQtdItem(i.minimo, i)}` : null].filter(Boolean).join(' · ')
  return (
    <Link
      to={caminhoItem(i)}
      className="flex min-h-16 items-center gap-3 rounded-2xl border border-borda bg-superficie px-4 py-3 active:bg-marca-clara"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{i.nome}</p>
        <p className={`font-bold ${i.saldo < 0 ? 'text-perigo' : i.saldo === 0 ? 'text-suave' : 'text-tinta'}`}>{textoSaldo(i)}</p>
        {detalhes && <p className="truncate text-sm text-suave">{detalhes}</p>}
        {i.situacao === 'negativo' && <p className="text-sm text-suave">Saiu mais do que entrou</p>}
      </div>
      <SeloSituacao situacao={i.situacao} />
      <ChevronRight className="size-5 shrink-0 text-suave" aria-hidden />
    </Link>
  )
}
