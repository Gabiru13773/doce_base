import {
  ArrowLeftRight,
  BarChart3,
  ChefHat,
  CookingPot,
  Gift,
  Home,
  Menu,
  Package,
  PlusCircle,
  History,
  ListPlus,
  ClipboardList,
  ClipboardPen,
  LockKeyhole,
  Settings2,
  ShoppingCart,
  Store,
  Tags,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { Suspense, useEffect } from 'react'
import { log } from '../lib/log'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ProtecaoErro } from './ProtecaoErro'
import { Carregando, MenuOculto } from './ui'

// Quatro áreas no mesmo app: Produção (cozinha), Vendas (balcão), Compras (mercado) e Financeiro.
// Cada uma tem o seu menu; no celular, no máximo 5 itens (no computador o lateral pode ter mais).

interface ItemMenu {
  para: string
  rotulo: string
  icone: LucideIcon
  /** Outras telas em que o item fica marcado (ex.: "Mais" no celular, para telas abertas a partir dele). */
  tambem?: string[]
}

const MENU_PRODUCAO: ItemMenu[] = [
  { para: '/', rotulo: 'Início', icone: Home },
  { para: '/producao', rotulo: 'Produzir', icone: CookingPot },
  { para: '/receitas', rotulo: 'Receitas', icone: ChefHat },
  { para: '/estoque', rotulo: 'Estoque', icone: Package },
  { para: '/mais', rotulo: 'Mais', icone: Menu, tambem: ['/produtos', '/insumos', '/config', '/diagnostico'] },
]

// No computador sobra espaço: o menu lateral mostra também os Produtos (no celular ficam em "Mais").
const MENU_PRODUCAO_LATERAL: ItemMenu[] = [
  ...MENU_PRODUCAO.slice(0, 3),
  { para: '/produtos', rotulo: 'Produtos', icone: Gift },
  ...MENU_PRODUCAO.slice(3),
]

const MENU_FINANCEIRO: ItemMenu[] = [
  { para: '/financeiro', rotulo: 'Resumo', icone: Wallet },
  { para: '/financeiro/lancar', rotulo: 'Lançar', icone: PlusCircle },
  { para: '/financeiro/contas', rotulo: 'Contas', icone: ArrowLeftRight },
  { para: '/financeiro/relatorios', rotulo: 'Relatórios', icone: BarChart3 },
  {
    para: '/financeiro/mais',
    rotulo: 'Mais',
    icone: Menu,
    tambem: ['/financeiro/extrato', '/financeiro/bancos', '/financeiro/categorias', '/financeiro/importar', '/financeiro/lancamentos'],
  },
]

// Compras: feita para o celular, no mercado.
const MENU_COMPRAS: ItemMenu[] = [
  { para: '/compras', rotulo: 'Comprar', icone: ShoppingCart },
  { para: '/compras/nova', rotulo: 'Nova lista', icone: ListPlus },
  { para: '/compras/precos', rotulo: 'Preços', icone: Tags },
  { para: '/compras/historico', rotulo: 'Histórico', icone: History },
]

// Vendas: a tela de vender serve no celular e no tablet/computador do balcão.
// No celular, Ajustes sai do menu (abre pelo Caixa) para caberem Pedidos e Clientes.
const MENU_VENDAS: ItemMenu[] = [
  { para: '/vendas', rotulo: 'Vender', icone: Store },
  { para: '/vendas/pedidos', rotulo: 'Pedidos', icone: ClipboardPen },
  { para: '/vendas/clientes', rotulo: 'Clientes', icone: Users },
  { para: '/vendas/dia', rotulo: 'Do dia', icone: ClipboardList },
  { para: '/vendas/caixa', rotulo: 'Caixa', icone: LockKeyhole, tambem: ['/vendas/ajustes'] },
]

const MENU_VENDAS_LATERAL: ItemMenu[] = [
  ...MENU_VENDAS.slice(0, 3),
  { para: '/vendas/dia', rotulo: 'Vendas do dia', icone: ClipboardList },
  { para: '/vendas/caixa', rotulo: 'Fechar caixa', icone: LockKeyhole },
  { para: '/vendas/ajustes', rotulo: 'Ajustes', icone: Settings2 },
]

type Area = 'producao' | 'vendas' | 'compras' | 'financeiro'

const MENUS: Record<Area, { celular: ItemMenu[]; lateral: ItemMenu[] }> = {
  producao: { celular: MENU_PRODUCAO, lateral: MENU_PRODUCAO_LATERAL },
  vendas: { celular: MENU_VENDAS, lateral: MENU_VENDAS_LATERAL },
  compras: { celular: MENU_COMPRAS, lateral: MENU_COMPRAS },
  financeiro: { celular: MENU_FINANCEIRO, lateral: MENU_FINANCEIRO },
}

const TELAS_DO_MENU_COMPRAS = new Set(['nova', 'precos', 'historico'])

/**
 * "Modo mercado": dentro de uma compra (fazendo ou finalizando), o celular usa a tela toda para
 * a lista: some o topo e o menu de baixo (a própria tela tem o botão de voltar).
 */
function modoMercado(pathname: string): boolean {
  const partes = pathname.split('/').filter(Boolean)
  if (partes[0] !== 'compras' || partes.length < 2 || TELAS_DO_MENU_COMPRAS.has(partes[1])) return false
  return partes.length === 2 || (partes.length === 3 && partes[2] === 'finalizar')
}

/** "Modo PDV": na tela de vender o celular também usa a tela toda (a tela tem o botão para sair). */
function modoPdv(pathname: string): boolean {
  return pathname === '/vendas' || pathname === '/vendas/'
}

function areaDe(pathname: string): Area {
  for (const a of ['financeiro', 'compras', 'vendas'] as const) if (pathname === `/${a}` || pathname.startsWith(`/${a}/`)) return a
  return 'producao'
}

export default function Layout() {
  const { pathname, search } = useLocation()
  const area = areaDe(pathname)
  // cada tela aberta entra no registro (ajuda a saber o que a pessoa fez antes de um erro)
  useEffect(() => log.info('tela', `Abriu ${pathname}${search}`), [pathname, search])
  const { celular: menu, lateral: menuLateral } = MENUS[area]
  const pdv = modoPdv(pathname)
  const mercado = modoMercado(pathname) || pdv
  const raiz = area === 'producao' ? '/' : `/${area}`
  const marcadoPorOutraTela = (item: ItemMenu) => !!item.tambem?.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  return (
    <MenuOculto.Provider value={mercado}>
      <div className="min-h-dvh md:pl-60 print:pl-0">
        {/* Menu lateral (computador) */}
        <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col gap-6 border-r border-borda bg-superficie p-4 md:flex">
          <Marca />
          <TrocaArea area={area} grade />
          <nav className="flex flex-col gap-1" aria-label="Menu principal">
            {menuLateral.map((item) => (
              <NavLink
                key={item.para}
                to={item.para}
                end={item.para === raiz}
                className={({ isActive }) =>
                  `flex min-h-12 items-center gap-3 rounded-xl px-3 font-medium ${
                    isActive || (area === 'financeiro' && marcadoPorOutraTela(item)) ? 'bg-marca-clara text-marca' : 'text-tinta hover:bg-creme'
                  }`
                }
              >
                <item.icone className="size-5" aria-hidden />
                {item.rotulo}
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* Topo (celular) */}
        {!mercado && (
          <header className="no-print sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-borda bg-creme/95 px-4 py-2 backdrop-blur md:hidden">
            <Marca simboloSome />
            <TrocaArea area={area} />
          </header>
        )}

        <main
          className={`mx-auto px-4 print:max-w-none print:p-0 ${
            pdv
              ? 'max-w-7xl pt-[max(0.75rem,env(safe-area-inset-top))] pb-36 md:pt-6 lg:pb-8'
              : `max-w-2xl md:pt-8 md:pb-28 ${mercado ? 'pt-[max(0.75rem,env(safe-area-inset-top))] pb-32' : 'pt-4 pb-44'}`
          }`}
        >
          <ProtecaoErro chave={pathname}>
            <Suspense fallback={<Carregando />}>
              <Outlet />
            </Suspense>
          </ProtecaoErro>
        </main>

        {/* Menu inferior (celular) */}
        {!mercado && (
          <nav
            aria-label="Menu principal"
            className="no-print safe-bottom fixed inset-x-0 bottom-0 z-30 grid border-t border-borda bg-superficie md:hidden"
            style={{ gridTemplateColumns: `repeat(${menu.length}, minmax(0, 1fr))` }}
          >
            {menu.map((item) => (
              <NavLink
                key={item.para}
                to={item.para}
                end={item.para === raiz}
                className={({ isActive }) =>
                  `flex h-[4.5rem] flex-col items-center justify-center gap-1 px-1 text-center text-xs leading-tight font-medium ${isActive || marcadoPorOutraTela(item) ? 'text-marca' : 'text-suave'}`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`flex h-8 w-14 items-center justify-center rounded-full ${isActive || marcadoPorOutraTela(item) ? 'bg-marca-clara' : ''}`}
                    >
                      <item.icone className="size-6" aria-hidden />
                    </span>
                    {item.rotulo}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        )}
      </div>
    </MenuOculto.Provider>
  )
}

function Marca({ simboloSome = false }: { simboloSome?: boolean }) {
  // Em telas bem estreitas (menos de 400 px) o topo fica só com as áreas, para caberem as quatro.
  return (
    <Link to="/" className={`flex min-w-0 shrink items-center gap-2 ${simboloSome ? 'max-[399px]:hidden' : ''}`} aria-label="Início">
      <img src="/logo-simbolo.png" alt="" width="48" height="36" className="h-9 w-auto" />
      <img src="/logo-nome.webp" alt="Euforia Confeitaria" width="320" height="106" className="h-8 w-auto max-[599px]:hidden" />
    </Link>
  )
}

const AREAS: { area: Area; para: string; rotulo: string }[] = [
  { area: 'producao', para: '/', rotulo: 'Produção' },
  { area: 'vendas', para: '/vendas', rotulo: 'Vendas' },
  { area: 'compras', para: '/compras', rotulo: 'Compras' },
  { area: 'financeiro', para: '/financeiro', rotulo: 'Finanças' },
]

/** Troca de área. `grade`: 2 × 2 (menu lateral, que é estreito para quatro lado a lado). */
function TrocaArea({ area, grade = false }: { area: Area; grade?: boolean }) {
  return (
    <div
      className={`min-w-0 bg-marca-clara p-1 ${grade ? 'grid grid-cols-2 gap-1 rounded-2xl' : 'flex rounded-full max-[399px]:flex-1'}`}
      role="tablist"
      aria-label="Área do app"
    >
      {AREAS.map((a) => (
        <Link
          key={a.area}
          to={a.para}
          role="tab"
          aria-selected={area === a.area}
          className={`flex min-h-10 grow items-center justify-center rounded-full px-2.5 text-sm font-semibold whitespace-nowrap max-[439px]:px-1.5 max-[439px]:text-[13px] ${
            area === a.area ? 'bg-superficie text-marca shadow-sm' : 'text-marca-escura'
          }`}
        >
          {a.rotulo}
        </Link>
      ))}
    </div>
  )
}
