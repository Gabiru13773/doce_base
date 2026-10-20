import { ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BarraAcao, Botao, Busca, Carregando, Erro, Pilulas, TituloPagina, Vazio } from '../../components/ui'
import { moeda } from '../../lib/format'
import { custoVariacao, precificarVariacao } from '../../lib/produtos'
import type { ResultadoPreco } from '../../lib/receitas'
import { useContextoCalculo } from '../receitas/api'
import { CATEGORIAS_PRODUTO, useProdutos, type CategoriaProduto, type Produto, type Variacao } from './api'

type Filtro = 'todos' | CategoriaProduto

/** Minúsculas e sem acentos, para a busca achar "bolo de cenoura" em "Bolo de Cenoura". */
function simplificar(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

interface LinhaVariacao {
  variacao: Variacao
  preco: ResultadoPreco
}

interface LinhaLista {
  produto: Produto
  /** Só as variações ativas (as escondidas não aparecem na lista). */
  variacoes: LinhaVariacao[]
  prejuizo: boolean
  revisar: boolean
}

export default function ProdutosPage() {
  const navegar = useNavigate()
  const produtos = useProdutos()
  const calculo = useContextoCalculo()
  const { contexto, config } = calculo
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')

  const carregando = produtos.isPending || calculo.carregando
  const erro = produtos.error ?? calculo.erro
  const tentarDeNovo = () => {
    produtos.refetch()
    calculo.tentarDeNovo()
  }

  // Custo e preço de cada variação ativa, de todos os produtos de uma vez.
  const linhas = useMemo<LinhaLista[]>(() => {
    if (!produtos.data || !contexto || !config) return []
    return [...produtos.data]
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .map((produto) => {
        let revisar = false
        const variacoes = produto.variacoes
          .filter((v) => v.ativo !== false)
          .map((variacao) => {
            const custo = custoVariacao(variacao, contexto)
            if (custo.problemas.length > 0) revisar = true
            return { variacao, preco: precificarVariacao(variacao, custo.custoDireto, config) }
          })
        return { produto, variacoes, revisar, prejuizo: variacoes.some((v) => perde(v.preco)) }
      })
  }, [produtos.data, contexto, config])

  // Só mostra as categorias que têm produto.
  const opcoesFiltro = useMemo(() => {
    const usadas = new Set(linhas.map((l) => l.produto.categoria))
    return [
      { valor: 'todos' as Filtro, rotulo: 'Todos' },
      ...CATEGORIAS_PRODUTO.filter((c) => usadas.has(c.valor)).map((c) => ({ valor: c.valor as Filtro, rotulo: c.rotulo })),
    ]
  }, [linhas])

  const filtroEfetivo: Filtro = opcoesFiltro.some((o) => o.valor === filtro) ? filtro : 'todos'

  const filtradas = useMemo(() => {
    const termo = simplificar(busca)
    return linhas.filter((l) => {
      if (filtroEfetivo !== 'todos' && l.produto.categoria !== filtroEfetivo) return false
      if (!termo) return true
      return (
        simplificar(l.produto.nome).includes(termo) || l.variacoes.some((v) => simplificar(v.variacao.nome).includes(termo))
      )
    })
  }, [linhas, busca, filtroEfetivo])

  const semCadastro = !carregando && !erro && linhas.length === 0
  const semReceitas = calculo.receitasAtivas.length === 0

  return (
    <>
      <TituloPagina titulo="Produtos" subtitulo="O que você vende, com embalagem e preço" />

      {carregando ? (
        <Carregando />
      ) : erro ? (
        <Erro mensagem={erro instanceof Error ? erro.message : 'erro ao carregar'} tentarDeNovo={tentarDeNovo} />
      ) : semCadastro ? (
        semReceitas ? (
          <Vazio
            titulo="Cadastre suas receitas primeiro"
            texto="Um produto é a receita pronta para vender, com a embalagem. Ex.: o mesmo bolo pode ser vendido no prato MDF ou na bandeja, cada um com seu preço. Comece pelas receitas."
            acao={
              <div className="flex w-full max-w-xs flex-col gap-2">
                <Botao onClick={() => navegar('/receitas/nova')}>Cadastrar receitas</Botao>
                <Botao variante="texto" onClick={() => navegar('/produtos/novo')}>
                  Cadastrar produto mesmo assim
                </Botao>
              </div>
            }
          />
        ) : (
          <Vazio
            titulo="Nenhum produto ainda"
            texto="Um produto é a receita pronta para vender, com a embalagem. O mesmo bolo pode ser vendido no prato MDF ou na bandeja: cada um com seu preço."
            acao={<Botao onClick={() => navegar('/produtos/novo')}>Cadastrar o primeiro</Botao>}
          />
        )
      ) : (
        <div className="flex flex-col gap-4">
          <Busca valor={busca} aoMudar={setBusca} placeholder="Buscar produto" />
          {opcoesFiltro.length > 2 && (
            <div className="-mx-4 overflow-x-auto px-4 pb-1 [&>div]:w-max [&>div]:flex-nowrap">
              <Pilulas rotulo="Filtrar por categoria" valor={filtroEfetivo} aoMudar={setFiltro} opcoes={opcoesFiltro} />
            </div>
          )}

          {filtradas.length === 0 ? (
            <Vazio
              titulo="Nada encontrado"
              texto="Tente outra palavra ou escolha “Todos”."
              acao={
                <Botao
                  variante="secundario"
                  onClick={() => {
                    setBusca('')
                    setFiltro('todos')
                  }}
                >
                  Limpar busca
                </Botao>
              }
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {filtradas.map((l) => (
                <li key={l.produto.id}>
                  <CartaoProduto linha={l} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <BarraAcao>
        <Botao className="flex-1" onClick={() => navegar('/produtos/novo')}>
          + Novo produto
        </Botao>
      </BarraAcao>
    </>
  )
}

function Selo({ texto, tom }: { texto: string; tom: 'alerta' | 'perigo' }) {
  const cor = tom === 'alerta' ? 'bg-alerta-claro text-alerta' : 'bg-perigo-claro text-perigo'
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${cor}`}>{texto}</span>
}

/** Preço que não cobre o custo, ou que depois de custos fixos e taxas dá prejuízo. */
function perde(p: ResultadoPreco) {
  return p.pvFinal !== null && (p.abaixoDoCusto || p.lucroPorUnidade < 0)
}

function Preco({ preco, grande }: { preco: ResultadoPreco; grande?: boolean }) {
  if (preco.pvFinal === null) return <span className="text-sm font-semibold text-alerta">sem preço</span>
  return (
    <span className={`${grande ? 'text-lg font-bold' : 'font-semibold'} ${perde(preco) ? 'text-perigo' : 'text-marca'}`}>
      {moeda(preco.pvFinal)}
    </span>
  )
}

function CartaoProduto({ linha: { produto: p, variacoes, prejuizo, revisar } }: { linha: LinhaLista }) {
  const categoria = CATEGORIAS_PRODUTO.find((c) => c.valor === p.categoria)?.rotulo
  const unica = variacoes.length === 1 ? variacoes[0] : null

  return (
    <Link
      to={`/produtos/${p.id}`}
      className="flex min-h-[72px] items-center gap-3 rounded-2xl border border-borda bg-superficie px-4 py-3 active:bg-marca-clara"
    >
      <div className="min-w-0 flex-1">
        {/* Os selos descem para a linha de baixo quando o nome é comprido (celular). */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="max-w-full min-w-0 truncate font-semibold">{p.nome}</p>
          {revisar && <Selo texto="revisar" tom="alerta" />}
          {prejuizo && <Selo texto="prejuízo" tom="perigo" />}
        </div>
        {variacoes.length === 0 ? (
          <p className="text-sm text-suave">Nenhuma opção ativa</p>
        ) : unica ? (
          <p className="truncate text-sm text-suave">
            {[categoria, unica.variacao.nome].filter(Boolean).join(' · ')}
          </p>
        ) : (
          <ul className="mt-1 flex flex-col gap-0.5 text-sm">
            {variacoes.map(({ variacao, preco }) => (
              <li key={variacao.id} className="flex min-w-0 items-baseline gap-1">
                <span className="truncate text-suave">{variacao.nome || 'Sem nome'}</span>
                <span className="shrink-0 text-suave" aria-hidden>
                  ·
                </span>
                <span className="shrink-0">
                  <Preco preco={preco} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {unica && (
        <p className="shrink-0 text-right">
          <Preco preco={unica.preco} grande />
        </p>
      )}
      <ChevronRight className="size-5 shrink-0 text-suave" aria-hidden />
    </Link>
  )
}
