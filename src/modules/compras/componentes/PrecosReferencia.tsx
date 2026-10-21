import type { FaixaPrecos } from '../../../lib/compras'
import { moeda } from '../../../lib/format'

/** "Último R$ · Menor R$ · Maior R$" (preços já pagos, por embalagem). */
export function PrecosReferencia({ faixa, className = '' }: { faixa: FaixaPrecos | null; className?: string }) {
  if (!faixa) return null
  return (
    <p className={`text-sm text-suave ${className}`}>
      Último <b className="font-semibold text-tinta tabular-nums">{moeda(faixa.ultimo)}</b>
      {faixa.vezes > 1 && (
        <>
          {' · '}Menor <b className="font-semibold text-ok tabular-nums">{moeda(faixa.menor)}</b>
          {' · '}Maior <b className="font-semibold text-tinta tabular-nums">{moeda(faixa.maior)}</b>
        </>
      )}
    </p>
  )
}
