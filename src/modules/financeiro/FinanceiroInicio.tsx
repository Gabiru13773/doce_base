import { ArrowLeftRight, BarChart3, CalendarClock, LineChart, Sparkles, type LucideIcon } from 'lucide-react'
import { Cartao, TituloPagina } from '../../components/ui'

const NOVIDADES: { icone: LucideIcon; titulo: string; texto: string }[] = [
  { icone: ArrowLeftRight, titulo: 'Entradas e saídas', texto: 'Anotar cada venda e cada gasto em poucos toques.' },
  { icone: CalendarClock, titulo: 'Contas a pagar e receber', texto: 'Saber o que vence e quem ainda vai te pagar.' },
  { icone: LineChart, titulo: 'Fluxo de caixa', texto: 'Ver quanto dinheiro entra e sai, dia a dia.' },
  { icone: BarChart3, titulo: 'Resultado do mês (DRE)', texto: 'Descobrir quanto sobrou de verdade no fim do mês.' },
]

export default function FinanceiroInicio() {
  return (
    <>
      <TituloPagina titulo="Financeiro" subtitulo="O caixa da confeitaria, sem complicação." />
      <Cartao className="flex flex-col gap-4">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-marca-clara px-3 py-1 text-sm font-semibold text-marca">
          <Sparkles className="size-4" aria-hidden />
          Em breve
        </span>
        <p>
          Estamos preparando esta parte com carinho. Logo você vai poder cuidar do dinheiro da Euforia por aqui:
        </p>
        <ul className="flex flex-col gap-4">
          {NOVIDADES.map(({ icone: Icone, titulo, texto }) => (
            <li key={titulo} className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-creme text-marca">
                <Icone className="size-5" aria-hidden />
              </span>
              <span>
                <span className="block font-semibold">{titulo}</span>
                <span className="text-suave">{texto}</span>
              </span>
            </li>
          ))}
        </ul>
      </Cartao>
    </>
  )
}
