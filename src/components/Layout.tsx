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
  ShoppingCart,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { Suspense } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Carregando } from './ui'

// Duas áreas separadas no mesmo app: Produção (cozinha) e Financeiro (caixa).
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
  { para: '/mais', rotulo: 'Mais', icone: Menu, tambem: ['/produtos', '/insumos', '/config', '/compras'] },
]

// No computador sobra espaço: o menu lateral mostra também Produtos e Compras (no celular ficam em "Mais").
const MENU_PRODUCAO_LATERAL: ItemMenu[] = [
  ...MENU_PRODUCAO.slice(0, 3),
  { para: '/produtos', rotulo: 'Produtos', icone: Gift },
  { para: '/compras', rotulo: 'Compras', icone: ShoppingCart },
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

export default function Layout() {
  const { pathname } = useLocation()
  const financeiro = pathname.startsWith('/financeiro')
  const menu = financeiro ? MENU_FINANCEIRO : MENU_PRODUCAO
  const menuLateral = financeiro ? MENU_FINANCEIRO : MENU_PRODUCAO_LATERAL
  const marcadoPorOutraTela = (item: ItemMenu) => !!item.tambem?.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  return (
    <div className="min-h-dvh md:pl-60 print:pl-0">
      {/* Menu lateral (computador) */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col gap-6 border-r border-borda bg-superficie p-4 md:flex">
        <Marca />
        <TrocaArea financeiro={financeiro} />
        <nav className="flex flex-col gap-1" aria-label="Menu principal">
          {menuLateral.map((item) => (
            <NavLink
              key={item.para}
              to={item.para}
              end={item.para === '/' || item.para === '/financeiro'}
              className={({ isActive }) =>
                `flex min-h-12 items-center gap-3 rounded-xl px-3 font-medium ${
                  isActive || (financeiro && marcadoPorOutraTela(item)) ? 'bg-marca-clara text-marca' : 'text-tinta hover:bg-creme'
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
      <header className="no-print sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-borda bg-creme/95 px-4 py-2 backdrop-blur md:hidden">
        <Marca />
        <TrocaArea financeiro={financeiro} />
      </header>

      <main className="mx-auto max-w-2xl px-4 pt-4 pb-44 md:pt-8 md:pb-28 print:max-w-none print:p-0">
        <Suspense fallback={<Carregando />}>
          <Outlet />
        </Suspense>
      </main>

      {/* Menu inferior (celular) */}
      <nav
        aria-label="Menu principal"
        className="no-print safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-borda bg-superficie md:hidden"
      >
        {menu.map((item) => (
          <NavLink
            key={item.para}
            to={item.para}
            end={item.para === '/' || item.para === '/financeiro'}
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
    </div>
  )
}

function Marca() {
  return (
    <Link to="/" className="flex min-w-0 shrink items-center gap-2" aria-label="Início">
      <img src="/logo-simbolo.png" alt="" width="48" height="36" className="h-9 w-auto" />
      <img src="/logo-nome.webp" alt="Euforia Confeitaria" width="320" height="106" className="h-8 w-auto max-[379px]:hidden" />
    </Link>
  )
}

function TrocaArea({ financeiro }: { financeiro: boolean }) {
  const base = 'flex min-h-10 flex-1 items-center justify-center rounded-full px-3 text-sm font-semibold'
  return (
    <div className="flex rounded-full bg-marca-clara p-1" role="tablist" aria-label="Área do app">
      <Link to="/" role="tab" aria-selected={!financeiro} className={`${base} ${!financeiro ? 'bg-superficie text-marca shadow-sm' : 'text-marca-escura'}`}>
        Produção
      </Link>
      <Link
        to="/financeiro"
        role="tab"
        aria-selected={financeiro}
        className={`${base} ${financeiro ? 'bg-superficie text-marca shadow-sm' : 'text-marca-escura'}`}
      >
        Financeiro
      </Link>
    </div>
  )
}
