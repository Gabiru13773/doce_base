import { Calculator, ChefHat, ChevronRight, CloudOff, CookingPot, Package, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Cartao } from '../../components/ui'
import { modoLocal } from '../../lib/supabase'
import { useInsumos } from '../insumos/api'

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
  emBreve?: boolean
}

export default function InicioPage() {
  const agora = new Date()
  // Ex.: "quinta-feira, 16 de outubro"
  const hoje = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })

  const insumos = useInsumos()
  const qtdInsumos = insumos.data?.filter((i) => i.ativo !== false).length
  const semInsumos = insumos.isSuccess && qtdInsumos === 0

  const descricaoInsumos =
    qtdInsumos === undefined
      ? 'Ingredientes e embalagens'
      : qtdInsumos === 0
        ? 'Nenhum cadastrado ainda'
        : `${qtdInsumos} ${qtdInsumos === 1 ? 'cadastrado' : 'cadastrados'}`

  const atalhos: Atalho[] = [
    { para: '/producao', titulo: 'Registrar produção', descricao: 'O que saiu do forno', icone: CookingPot, emBreve: true },
    { para: '/insumos', titulo: 'Insumos', descricao: descricaoInsumos, icone: Package },
    { para: '/receitas', titulo: 'Receitas', descricao: 'Custo e preço', icone: ChefHat, emBreve: true },
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

      <nav aria-label="Atalhos" className="grid grid-cols-2 gap-3">
        {atalhos.map((a) => (
          <Link
            key={a.para}
            to={a.para}
            className="relative flex min-h-[104px] flex-col gap-2 rounded-2xl border border-borda bg-superficie p-4 shadow-sm transition-colors active:bg-marca-clara"
          >
            {a.emBreve && (
              <span className="absolute top-3 right-3 rounded-full bg-creme px-2 py-0.5 text-xs font-medium text-suave">
                em breve
              </span>
            )}
            <span className="flex size-11 items-center justify-center rounded-xl bg-marca-clara text-marca">
              <a.icone className="size-6" aria-hidden />
            </span>
            <span className="leading-tight font-semibold">{a.titulo}</span>
            <span className="truncate text-sm text-suave">{a.descricao}</span>
          </Link>
        ))}
      </nav>

      {semInsumos && (
        <Cartao>
          <h2 className="mb-1 text-lg font-bold">Primeiros passos</h2>
          <p className="mb-3 text-sm text-suave">Três passos para o app calcular seus preços.</p>
          <ol className="flex flex-col gap-2">
            <Passo numero={1} para="/config/precos" texto="Ajuste seus preços e margens" />
            <Passo numero={2} para="/insumos" texto="Cadastre seus insumos" />
            <Passo numero={3} para="/receitas" texto="Em breve: cadastre suas receitas" apagado />
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
