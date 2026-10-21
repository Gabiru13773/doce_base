import { ChevronDown, ScanBarcode } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Busca, Carregando, Erro, Pilulas, TituloPagina, Vazio } from '../../components/ui'
import { faixaPrecos } from '../../lib/compras'
import { moeda } from '../../lib/format'
import { dataBr, mensagemDe } from '../financeiro/util'
import { CATEGORIAS, useInsumos, type CategoriaInsumo, type Insumo } from '../insumos/api'
import { useHistoricoPorInsumo, type PrecoGuardado } from './api'
import { LeitorCodigo, leitorDisponivel } from './componentes/LeitorCodigo'
import { PrecosReferencia } from './componentes/PrecosReferencia'
import { simplificar, textoEmbalagem } from './componentes/formato'

// Consulta rápida no corredor do mercado: "quanto paguei nisso da última vez?".
// Busca pelo nome ou lendo o código de barras.

export default function PrecosPage() {
  const { data: insumos, isLoading, isError, error, refetch } = useInsumos()
  const { data: historico } = useHistoricoPorInsumo()
  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState<CategoriaInsumo | 'todas'>('todas')
  const [aberto, setAberto] = useState<string | null>(null)
  const [lendo, setLendo] = useState(false)
  const podeLer = useMemo(() => leitorDisponivel(), [])

  const visiveis = useMemo(() => {
    const termo = simplificar(busca)
    const digitos = busca.replace(/\D/g, '')
    return (insumos ?? []).filter((i) => {
      if (categoria !== 'todas' && i.categoria !== categoria) return false
      if (!termo) return true
      if (simplificar(i.nome).includes(termo) || simplificar(i.marca).includes(termo)) return true
      return digitos.length >= 3 && !!i.codigo_barras?.includes(digitos)
    })
  }, [insumos, busca, categoria])

  function aoLer(codigo: string) {
    setLendo(false)
    setBusca(codigo)
    setCategoria('todas')
    const achado = insumos?.find((i) => i.codigo_barras === codigo)
    if (achado) setAberto(achado.id)
  }

  if (isLoading) return <Carregando />
  if (isError) return <Erro mensagem={mensagemDe(error)} tentarDeNovo={() => refetch()} />

  return (
    <>
      <TituloPagina titulo="Preços" subtitulo="Quanto vocês já pagaram em cada item" />

      <div className="sticky top-[3.6rem] z-10 -mx-4 mb-3 flex flex-col gap-3 bg-creme/95 px-4 pt-1 pb-2 backdrop-blur md:top-0">
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
        <div className="-mx-4 overflow-x-auto px-4 [&>div]:flex-nowrap">
          <Pilulas
            rotulo="Categoria"
            valor={categoria}
            aoMudar={setCategoria}
            opcoes={[{ valor: 'todas', rotulo: 'Todas' }, ...CATEGORIAS.map((c) => ({ valor: c.valor, rotulo: c.rotulo }))]}
          />
        </div>
      </div>

      {(insumos ?? []).length === 0 ? (
        <Vazio
          titulo="Nenhum insumo cadastrado"
          texto="Cadastre os insumos para ver os preços pagos em cada compra."
          acao={
            <Link to="/insumos/novo" className="flex min-h-12 items-center justify-center rounded-2xl bg-marca px-5 font-semibold text-white">
              Cadastrar insumo
            </Link>
          }
        />
      ) : visiveis.length === 0 ? (
        <Vazio titulo="Nada encontrado" texto={busca ? `Nenhum insumo com "${busca}".` : 'Nenhum insumo nesta categoria.'} />
      ) : (
        <ul className="flex flex-col gap-2">
          {visiveis.map((i) => (
            <li key={i.id}>
              <CartaoPreco
                insumo={i}
                historico={historico?.[i.id] ?? []}
                aberto={aberto === i.id}
                alternar={() => setAberto(aberto === i.id ? null : i.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <LeitorCodigo aberto={lendo} aoLer={aoLer} aoFechar={() => setLendo(false)} />
    </>
  )
}

function CartaoPreco({
  insumo: i,
  historico,
  aberto,
  alternar,
}: {
  insumo: Insumo
  historico: PrecoGuardado[]
  aberto: boolean
  alternar: () => void
}) {
  const faixa = faixaPrecos(historico, { qtd: i.qtd_compra, unidade: i.unidade_compra })
  const recentes = useMemo(() => [...historico].sort((a, b) => b.registrado_em.localeCompare(a.registrado_em)).slice(0, 8), [historico])
  const ultima = recentes[0]

  return (
    <div className="rounded-2xl border border-borda bg-superficie shadow-sm">
      <button
        type="button"
        onClick={alternar}
        aria-expanded={aberto}
        className="flex w-full items-start gap-3 rounded-2xl px-4 py-3 text-left active:bg-marca-clara"
      >
        <div className="min-w-0 flex-1">
          <p className="font-semibold break-words">{i.nome}</p>
          <p className="text-sm text-suave">
            {textoEmbalagem(i.qtd_compra, i.unidade_compra)}
            {i.marca ? ` · ${i.marca}` : ''}
          </p>
          {faixa ? (
            <PrecosReferencia faixa={faixa} className="mt-1" />
          ) : (
            <p className="mt-1 text-sm text-suave">Ainda sem preço de compra</p>
          )}
          {ultima?.local && (
            <p className="text-xs text-suave">
              Última vez: {ultima.local}, {dataBr(ultima.registrado_em.slice(0, 10))}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-lg font-bold tabular-nums">{moeda(i.preco_compra)}</span>
          <span className="text-xs text-suave">custo atual</span>
          <ChevronDown className={`size-5 text-suave transition-transform ${aberto ? 'rotate-180' : ''}`} aria-hidden />
        </div>
      </button>

      {aberto && (
        <div className="border-t border-borda px-4 py-3">
          {recentes.length === 0 ? (
            <p className="text-sm text-suave">Nenhum preço registrado ainda.</p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label={`Preços pagos em ${i.nome}`}>
              {recentes.map((p) => (
                <li key={p.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="tabular-nums">{dataBr(p.registrado_em.slice(0, 10))}</span>
                    <span className="text-suave">
                      {' · '}
                      {textoEmbalagem(p.qtd_compra, p.unidade_compra)}
                      {p.local ? ` · ${p.local}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{moeda(p.preco_compra)}</span>
                </li>
              ))}
            </ul>
          )}
          <Link to={`/insumos/${i.id}`} className="mt-3 inline-flex min-h-11 items-center font-semibold text-marca underline underline-offset-4">
            Abrir o insumo
          </Link>
        </div>
      )}
    </div>
  )
}
