import { ChefHat, ChevronRight, FileUp, Landmark, ListTree, ReceiptText, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Cartao, TituloPagina } from '../../components/ui'

const LINKS: { para: string; titulo: string; texto: string; icone: LucideIcon }[] = [
  { para: '/financeiro/extrato', titulo: 'Extrato', texto: 'Todos os lançamentos, mês a mês', icone: ReceiptText },
  { para: '/financeiro/importar', titulo: 'Importar extrato do banco', texto: 'Trazer as movimentações de um arquivo OFX', icone: FileUp },
  { para: '/financeiro/bancos', titulo: 'Contas bancárias', texto: 'Bancos, caixa da loja e carteiras, com saldo', icone: Landmark },
  { para: '/financeiro/categorias', titulo: 'Plano de contas', texto: 'As categorias de entradas e saídas', icone: ListTree },
]

export default function FinMaisPage() {
  return (
    <div className="flex flex-col gap-6">
      <TituloPagina titulo="Mais" />

      <nav className="flex flex-col gap-2" aria-label="Outras telas do financeiro">
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

      <Cartao className="flex items-start gap-3">
        <ChefHat className="mt-0.5 size-5 shrink-0 text-marca" aria-hidden />
        <p className="flex-1">
          Receitas, produtos, insumos e preços ficam na área <strong>Produção</strong>.{' '}
          <Link to="/" className="inline-flex min-h-11 items-center font-semibold text-marca">
            Ir para a Produção
          </Link>
        </p>
      </Cartao>
    </div>
  )
}
