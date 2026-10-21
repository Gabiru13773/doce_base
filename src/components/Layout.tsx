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
  ShoppingCart,
  Tags,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { Suspense } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Carregando, MenuOculto } from './ui'

// Três áreas separadas no mesmo app: Produção (cozinha), Compras (mercado) e Financeiro (caixa).
// Cada uma tem o seu menu de no máximo 5 itens.

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
  { para: '/mais', rotulo: 'Mais', icone: Menu, tambem: ['/produtos', '/insumos', '/config'] },
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

type Area = 'producao' | 'compras' | 'financeiro'

const MENUS: Record<Area, { celular: ItemMenu[]; lateral: ItemMenu[] }> = {
  producao: { celular: MENU_PRODUCAO, lateral: MENU_PRODUCAO_LATERAL },
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

export default function Layout() {
  const { pathname } = useLocation()
  const area: Area = pathname.startsWith('/financeiro') ? 'financeiro' : pathname.startsWith('/compras') ? 'compras' : 'producao'
  const { celular: menu, lateral: menuLateral } = MENUS[area]
  const mercado = modoMercado(pathname)
  const raiz = area === 'producao' ? '/' : `/${area}`
  const marcadoPorOutraTela = (item: ItemMenu) => !!item.tambem?.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  return (
    <MenuOculto.Provider value={mercado}>
      <div className="min-h-dvh md:pl-60 print:pl-0">
        {/* Menu lateral (computador) */}
        <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col gap-6 border-r border-borda bg-superficie p-4 md:flex">
          <Marca />
          <TrocaArea area={area} />
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
            <Marca />
            <TrocaArea area={area} />
          </header>
        )}

        <main
          className={`mx-auto max-w-2xl px-4 md:pt-8 md:pb-28 print:max-w-none print:p-0 ${
            mercado ? 'pt-[max(0.75rem,env(safe-area-inset-top))] pb-32' : 'pt-4 pb-44'
          }`}
        >
          <Suspense fallback={<Carregando />}>
            <Outlet />
          </Suspense>
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
                  `flex h-[4.5rem] flex-col items-center justify-center gap-1 text-xs font-medium ${isActive || marcadoPorOutraTela(item) ? 'text-marca' : 'text-suave'}`
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

function Marca() {
  return (
    <Link to="/" className="flex min-w-0 shrink items-center gap-2" aria-label="Início">
      <img src="/logo-simbolo.png" alt="" width="48" height="36" className="h-9 w-auto" />
      <img src="/logo-nome.webp" alt="Euforia Confeitaria" width="320" height="106" className="h-8 w-auto max-[519px]:hidden" />
    </Link>
  )
}

const AREAS: { area: Area; para: string; rotulo: string }[] = [
  { area: 'producao', para: '/', rotulo: 'Produção' },
  { area: 'compras', para: '/compras', rotulo: 'Compras' },
  { area: 'financeiro', para: '/financeiro', rotulo: 'Financeiro' },
]

function TrocaArea({ area }: { area: Area }) {
  return (
    <div className="flex min-w-0 rounded-full bg-marca-clara p-1" role="tablist" aria-label="Área do app">
      {AREAS.map((a) => (
        <Link
          key={a.area}
          to={a.para}
          role="tab"
          aria-selected={area === a.area}
          className={`flex min-h-10 flex-1 items-center justify-center rounded-full px-2.5 text-sm font-semibold whitespace-nowrap max-[389px]:px-2 max-[389px]:text-[13px] ${
            area === a.area ? 'bg-superficie text-marca shadow-sm' : 'text-marca-escura'
          }`}
        >
          {a.rotulo}
        </Link>
      ))}
    </div>
  )
}
