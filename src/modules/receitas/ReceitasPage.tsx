import { ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BarraAcao, Botao, Busca, Carregando, Erro, Pilulas, TituloPagina, Vazio } from '../../components/ui'
import { moeda } from '../../lib/format'
import { calcularCusto, precificar, textoRendimento, type ResultadoPreco } from '../../lib/receitas'
import { CATEGORIAS_RECEITA, useContextoCalculo, type CategoriaReceita, type Receita } from './api'

type Filtro = 'todas' | CategoriaReceita

/** Minúsculas e sem acentos, para a busca achar "pao de mel" em "Pão de Mel". */
function simplificar(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

interface LinhaLista {
  receita: Receita
  preco: ResultadoPreco
  revisar: boolean
}

export default function ReceitasPage() {
  const navegar = useNavigate()
  const { contexto, config, receitasAtivas, insumosAtivos, carregando, erro, tentarDeNovo } = useContextoCalculo()
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todas')

  // Custo e preço de todas as receitas de uma vez (o contexto já tem tudo carregado).
  const linhas = useMemo<LinhaLista[]>(() => {
    if (!contexto || !config) return []
    // O contexto guarda as receitas completas (inclusive as apagadas); a lista mostra só as ativas.
    return ([...contexto.receitas.values()] as Receita[])
      .filter((r) => r.ativo !== false)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .map((receita) => {
        const custo = calcularCusto(receita.id, contexto)
        return { receita, preco: precificar(receita, custo.custoDireto, config), revisar: custo.problemas.length > 0 }
      })
  }, [contexto, config])

  // Só mostra as categorias que têm receita.
  const opcoesFiltro = useMemo(() => {
    const usadas = new Set(linhas.map((l) => l.receita.categoria))
    return [
      { valor: 'todas' as Filtro, rotulo: 'Todas' },
      ...CATEGORIAS_RECEITA.filter((c) => usadas.has(c.valor)).map((c) => ({ valor: c.valor as Filtro, rotulo: c.rotulo })),
    ]
  }, [linhas])

  const filtroEfetivo: Filtro = opcoesFiltro.some((o) => o.valor === filtro) ? filtro : 'todas'

  const filtradas = useMemo(() => {
    const termo = simplificar(busca)
    return linhas.filter((l) => {
      if (filtroEfetivo !== 'todas' && l.receita.categoria !== filtroEfetivo) return false
      return !termo || simplificar(l.receita.nome).includes(termo)
    })
  }, [linhas, busca, filtroEfetivo])

  const semCadastro = !carregando && !erro && receitasAtivas.length === 0
  const semInsumos = insumosAtivos.length === 0

  return (
    <>
      <TituloPagina titulo="Receitas" subtitulo="Custo e preço de venda de cada receita" />

      {carregando ? (
        <Carregando />
      ) : erro ? (
        <Erro mensagem={erro instanceof Error ? erro.message : 'erro ao carregar'} tentarDeNovo={tentarDeNovo} />
      ) : semCadastro ? (
        semInsumos ? (
          <Vazio
            titulo="Cadastre seus insumos primeiro"
            texto="As receitas usam os insumos (leite condensado, chocolate, ovos…) para calcular o custo. Comece por eles."
            acao={
              <div className="flex w-full max-w-xs flex-col gap-2">
                <Botao onClick={() => navegar('/insumos/novo')}>Cadastrar insumos</Botao>
                <Botao variante="texto" onClick={() => navegar('/receitas/nova')}>
                  Cadastrar receita mesmo assim
                </Botao>
              </div>
            }
          />
        ) : (
          <Vazio
            titulo="Nenhuma receita ainda"
            texto="Cadastre uma receita e o app calcula o custo e o preço de venda sozinho."
            acao={<Botao onClick={() => navegar('/receitas/nova')}>Cadastrar a primeira</Botao>}
          />
        )
      ) : (
        <div className="flex flex-col gap-4">
          <Busca valor={busca} aoMudar={setBusca} placeholder="Buscar receita" />
          {opcoesFiltro.length > 2 && (
            <div className="-mx-4 overflow-x-auto px-4 pb-1 [&>div]:w-max [&>div]:flex-nowrap">
              <Pilulas rotulo="Filtrar por categoria" valor={filtroEfetivo} aoMudar={setFiltro} opcoes={opcoesFiltro} />
            </div>
          )}

          {filtradas.length === 0 ? (
            <Vazio
              titulo="Nada encontrado"
              texto="Tente outra palavra ou escolha “Todas”."
              acao={
                <Botao
                  variante="secundario"
                  onClick={() => {
                    setBusca('')
                    setFiltro('todas')
                  }}
                >
                  Limpar busca
                </Botao>
              }
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {filtradas.map((l) => (
                <li key={l.receita.id}>
                  <CartaoReceita linha={l} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <BarraAcao>
        <Botao className="flex-1" onClick={() => navegar('/receitas/nova')}>
          + Nova receita
        </Botao>
      </BarraAcao>
    </>
  )
}

function Selo({ texto, tom }: { texto: string; tom: 'alerta' | 'perigo' }) {
  const cor = tom === 'alerta' ? 'bg-alerta-claro text-alerta' : 'bg-perigo-claro text-perigo'
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${cor}`}>{texto}</span>
}

function CartaoReceita({ linha: { receita: r, preco, revisar } }: { linha: LinhaLista }) {
  return (
    <Link
      to={`/receitas/${r.id}`}
      className="flex min-h-[72px] items-center gap-3 rounded-2xl border border-borda bg-superficie px-4 py-3 active:bg-marca-clara"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold">{r.nome}</p>
          {revisar && <Selo texto="revisar" tom="alerta" />}
          {preco.abaixoDoCusto && <Selo texto="prejuízo" tom="perigo" />}
        </div>
        <p className="truncate text-sm text-suave">
          rende {textoRendimento(r)} · custo {moeda(preco.custoPorUnidade)}/{preco.unidade}
        </p>
      </div>
      {preco.pvFinal === null ? (
        <p className="shrink-0 text-right text-sm font-semibold text-alerta">sem preço</p>
      ) : (
        <p className="shrink-0 text-right text-lg font-bold text-marca">
          {moeda(preco.pvFinal)}
          <span className="text-sm font-semibold">/{preco.unidade}</span>
        </p>
      )}
      <ChevronRight className="size-5 shrink-0 text-suave" aria-hidden />
    </Link>
  )
}
