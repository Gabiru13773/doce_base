import { ChevronRight, CloudOff, Gift, Package, Percent, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/Autenticacao'
import { Botao, Cartao, TituloPagina } from '../../components/ui'
import { modoLocal } from '../../lib/supabase'

const LINKS: { para: string; titulo: string; texto: string; icone: LucideIcon }[] = [
  { para: '/produtos', titulo: 'Produtos', texto: 'O que você vende, com embalagem e preço', icone: Gift },
  { para: '/insumos', titulo: 'Insumos', texto: 'Ingredientes, embalagens e materiais', icone: Package },
  { para: '/config/precos', titulo: 'Preços e margens', texto: 'Valor da hora, custos fixos, taxas e lucro', icone: Percent },
]

export default function MaisPage() {
  const { usuario, sair } = useAuth()

  return (
    <div className="flex flex-col gap-6">
      <TituloPagina titulo="Mais" />

      <nav className="flex flex-col gap-2" aria-label="Outras telas">
        {LINKS.map(({ para, titulo, texto, icone: Icone }) => (
          <Link
            key={para}
            to={para}
            className="flex min-h-14 items-center gap-3 rounded-2xl border border-borda bg-superficie px-4 py-3 active:bg-marca-clara"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-marca-clara text-marca">
              <Icone className="size-5" aria-hidden />
            </span>
            <span className="flex-1">
              <span className="block font-semibold">{titulo}</span>
              <span className="text-sm text-suave">{texto}</span>
            </span>
            <ChevronRight className="size-5 shrink-0 text-suave" aria-hidden />
          </Link>
        ))}
      </nav>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-bold">Sincronização</h2>
        {modoLocal ? (
          <Cartao className="flex gap-3 border-alerta/30! bg-alerta-claro! text-alerta">
            <CloudOff className="mt-0.5 size-5 shrink-0" aria-hidden />
            <p>
              Seus dados estão salvos <strong>só neste aparelho</strong>. Quando a sincronização for ativada (passo a passo no
              guia de configuração do app), tudo passa a aparecer nos dois celulares.
            </p>
          </Cartao>
        ) : (
          <Cartao className="flex flex-col gap-3">
            <p>
              Conectado como <strong className="break-all">{usuario}</strong>
            </p>
            <Botao variante="secundario" onClick={() => void sair()}>
              Sair
            </Botao>
          </Cartao>
        )}
      </section>
    </div>
  )
}
