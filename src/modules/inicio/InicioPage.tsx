import { AlertTriangle, Calculator, ChefHat, ChevronRight, CloudOff, CookingPot, Gift, ListPlus, Package, ShoppingCart, type LucideIcon } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Cartao } from '../../components/ui'
import { precisaComprar } from '../../lib/estoque'
import { modoLocal } from '../../lib/supabase'
import { useCompras } from '../compras/api'
import { useSaldos } from '../estoque/api'
import { useInsumos } from '../insumos/api'
import { useProdutos } from '../produtos/api'
import { useReceitas } from '../receitas/api'

function saudacao(hora: number) {
  if (hora >= 5 && hora < 12) return 'Bom dia'
  if (hora >= 12 && hora < 18) return 'Boa tarde'
  return 'Boa noite'
}

interface Atalho {
  para: string
  titulo: string
  descricao: string
  icone: LucideIcon
}

export default function InicioPage() {
  const agora = new Date()
  // Ex.: "quinta-feira, 16 de outubro"
  const hoje = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })

  const insumos = useInsumos()
  const qtdInsumos = insumos.data?.filter((i) => i.ativo !== false).length
  const receitas = useReceitas()
  const qtdReceitas = receitas.data?.length
  const produtos = useProdutos()
  const compras = useCompras()
  // A mais recente em andamento (useCompras já vem da mais nova para a mais antiga).
  const compraAberta = compras.data?.find((c) => c.status === 'aberta')
  const qtdProdutos = produtos.data?.length
  const saldos = useSaldos()
  // Insumos abaixo do mínimo (ou com saldo negativo).
  const acabando = useMemo(() => {
    if (!insumos.data || !saldos.data) return 0
    const s = saldos.data.insumos
    return insumos.data.filter((i) => i.ativo !== false && precisaComprar(s[i.id], i.estoque_minimo)).length
  }, [insumos.data, saldos.data])
  // Primeiros passos somem só quando já houver insumos, receitas E produtos.
  const mostrarPrimeirosPassos =
    insumos.isSuccess &&
    receitas.isSuccess &&
    produtos.isSuccess &&
    (qtdInsumos === 0 || qtdReceitas === 0 || qtdProdutos === 0)

  const descricaoInsumos =
    qtdInsumos === undefined
      ? 'Ingredientes e embalagens'
      : qtdInsumos === 0
        ? 'Nenhum cadastrado ainda'
        : `${qtdInsumos} ${qtdInsumos === 1 ? 'cadastrado' : 'cadastrados'}`

  const descricaoReceitas =
    qtdReceitas === undefined
      ? 'Custo e preço'
      : qtdReceitas === 0
        ? 'Nenhuma ainda'
        : `${qtdReceitas} ${qtdReceitas === 1 ? 'cadastrada' : 'cadastradas'}`

  const descricaoProdutos =
    qtdProdutos === undefined
      ? 'Com embalagem e preço'
      : qtdProdutos === 0
        ? 'Nenhum ainda'
        : `${qtdProdutos} ${qtdProdutos === 1 ? 'cadastrado' : 'cadastrados'}`

  const atalhos: Atalho[] = [
    { para: '/producao/nova', titulo: 'Registrar produção', descricao: 'O que saiu do forno', icone: CookingPot },
    { para: '/insumos', titulo: 'Insumos', descricao: descricaoInsumos, icone: Package },
    { para: '/receitas', titulo: 'Receitas', descricao: descricaoReceitas, icone: ChefHat },
    { para: '/produtos', titulo: 'Produtos', descricao: descricaoProdutos, icone: Gift },
    { para: '/config/precos', titulo: 'Preços e margens', descricao: 'Hora, taxas e lucro', icone: Calculator },
  ]

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-bold">{saudacao(agora.getHours())}!</h1>
        <p className="text-suave first-letter:uppercase">{hoje}</p>
      </header>

      {modoLocal && (
        <div className="flex items-center gap-3 rounded-2xl bg-alerta-claro px-4 py-3 text-sm text-alerta">
          <CloudOff className="size-5 shrink-0" aria-hidden />
          <p className="flex-1">Modo local: os dados ficam só neste aparelho.</p>
          <Link to="/mais" className="-my-2 flex min-h-11 shrink-0 items-center font-semibold underline underline-offset-2">
            Como sincronizar
          </Link>
        </div>
      )}

      {compraAberta ? (
        <Link
          to={`/compras/${compraAberta.id}`}
          className="flex min-h-14 items-center gap-3 rounded-2xl border border-marca/30 bg-marca-clara px-4 py-3 active:bg-marca-clara/60"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-marca text-white">
            <ShoppingCart className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-marca-escura">Compra em andamento</span>
            <span className="block truncate font-semibold">{compraAberta.nome}</span>
          </span>
          <span className="shrink-0 font-semibold text-marca">Continuar</span>
          <ChevronRight className="size-5 shrink-0 text-marca" aria-hidden />
        </Link>
      ) : (
        compras.isSuccess && (
          <Link
            to="/compras/nova"
            className="-my-2 inline-flex min-h-12 items-center gap-2 self-start rounded-xl px-2 font-semibold text-marca active:bg-marca-clara"
          >
            <ShoppingCart className="size-5" aria-hidden />
            Fazer lista de compras
          </Link>
        )
      )}

      {acabando > 0 && (
        <section
          aria-label="Estoque acabando"
          className="flex flex-col gap-1 rounded-2xl border border-perigo/30 bg-perigo-claro/60 p-2"
        >
          <Link to="/estoque" className="flex min-h-12 items-center gap-3 rounded-xl px-2 py-1 active:bg-perigo-claro">
            <AlertTriangle className="size-6 shrink-0 text-perigo" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">
                {acabando} {acabando === 1 ? 'insumo acabando' : 'insumos acabando'}
              </span>
              <span className="block text-sm text-suave">Toque para ver o estoque</span>
            </span>
            <ChevronRight className="size-5 shrink-0 text-suave" aria-hidden />
          </Link>
          <Link
            to={compraAberta ? `/compras/${compraAberta.id}/lista?sugerir=1` : '/compras/nova?sugerir=1'}
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-superficie px-4 font-semibold text-marca active:bg-marca-clara"
          >
            <ListPlus className="size-5" aria-hidden />
            {compraAberta ? 'Pôr na lista de compras' : 'Montar lista de compras'}
          </Link>
        </section>
      )}

      <nav aria-label="Atalhos" className="grid grid-cols-2 gap-3 [&>a:last-child:nth-child(odd)]:col-span-2">
        {atalhos.map((a) => (
          <Link
            key={a.para}
            to={a.para}
            className="relative flex min-h-[104px] flex-col gap-2 rounded-2xl border border-borda bg-superficie p-4 shadow-sm transition-colors active:bg-marca-clara"
          >
            <span className="flex size-11 items-center justify-center rounded-xl bg-marca-clara text-marca">
              <a.icone className="size-6" aria-hidden />
            </span>
            <span className="leading-tight font-semibold">{a.titulo}</span>
            <span className="line-clamp-2 text-sm text-suave">{a.descricao}</span>
          </Link>
        ))}
      </nav>

      {mostrarPrimeirosPassos && (
        <Cartao>
          <h2 className="mb-1 text-lg font-bold">Primeiros passos</h2>
          <p className="mb-3 text-sm text-suave">Quatro passos para o app calcular seus preços.</p>
          <ol className="flex flex-col gap-2">
            <Passo numero={1} para="/config/precos" texto="Ajuste seus preços e margens" />
            <Passo numero={2} para="/insumos" texto="Cadastre seus insumos" apagado={!!qtdInsumos} />
            <Passo numero={3} para="/receitas/nova" texto="Cadastre suas receitas" apagado={!!qtdReceitas} />
            <Passo
              numero={4}
              para="/produtos/novo"
              texto="Cadastre seus produtos (receita + embalagem)"
              apagado={!!qtdProdutos}
            />
          </ol>
        </Cartao>
      )}
    </div>
  )
}

function Passo({ numero, para, texto, apagado }: { numero: number; para: string; texto: string; apagado?: boolean }) {
  return (
    <li>
      <Link
        to={para}
        className={`flex min-h-12 items-center gap-3 rounded-xl px-2 active:bg-marca-clara ${apagado ? 'text-suave' : ''}`}
      >
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            apagado ? 'bg-creme text-suave' : 'bg-marca text-white'
          }`}
        >
          {numero}
        </span>
        <span className="flex-1 font-medium">{texto}</span>
        <ChevronRight className="size-5 shrink-0 text-suave" aria-hidden />
      </Link>
    </li>
  )
}
