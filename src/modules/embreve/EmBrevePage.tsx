import { Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { Cartao, TituloPagina } from '../../components/ui'

/** Tela de módulo que ainda vai chegar: mostra o que ele vai fazer. */
export default function EmBrevePage({ titulo, itens, children }: { titulo: string; itens: string[]; children?: ReactNode }) {
  return (
    <>
      <TituloPagina titulo={titulo} />
      <Cartao className="flex flex-col gap-4">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-marca-clara px-3 py-1 text-sm font-semibold text-marca">
          <Sparkles className="size-4" aria-hidden />
          Em breve
        </span>
        <p className="font-semibold">O que vai ter aqui:</p>
        <ul className="flex flex-col gap-3">
          {itens.map((item) => (
            <li key={item} className="flex gap-3">
              <span className="mt-2 size-2 shrink-0 rounded-full bg-marca" aria-hidden />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        {children}
      </Cartao>
    </>
  )
}
