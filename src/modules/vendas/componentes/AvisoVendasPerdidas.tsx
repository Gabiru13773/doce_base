import { AlertTriangle } from 'lucide-react'
import { useFilaVendas } from '../api'

/** Vendas que o banco recusou ao subir: fica na tela até alguém dispensar (não some sozinho). */
export function AvisoVendasPerdidas() {
  const { perdidas, dispensarPerdidas } = useFilaVendas()
  if (perdidas.length === 0) return null
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-2xl border border-perigo/30 bg-perigo-claro px-4 py-3 text-perigo">
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-5 shrink-0" aria-hidden />
        {perdidas.length === 1 ? 'Uma venda precisa de atenção' : `${perdidas.length} vendas precisam de atenção`}
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        {perdidas.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
      <p className="text-sm">Confira e, se precisar, lance a venda de novo.</p>
      <button type="button" onClick={dispensarPerdidas} className="min-h-11 self-start rounded-xl px-2 font-semibold underline underline-offset-4">
        Entendi
      </button>
    </div>
  )
}
