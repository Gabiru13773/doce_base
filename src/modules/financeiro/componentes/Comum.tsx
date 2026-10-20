import { ArrowLeft } from 'lucide-react'
import { moeda } from '../../../lib/format'
import { useVoltar } from '../util'

/** "← Voltar" no topo dos formulários: volta para a tela anterior (ou `padrao`). */
export function Voltar({ padrao }: { padrao: string }) {
  const voltar = useVoltar(padrao)
  return (
    <button
      type="button"
      onClick={voltar}
      className="-ml-2 mb-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-suave active:bg-marca-clara"
    >
      <ArrowLeft className="size-5" aria-hidden />
      Voltar
    </button>
  )
}

/** Chave liga/desliga com texto explicativo (linha inteira é clicável). */
export function Interruptor({
  ligado,
  aoMudar,
  rotulo,
  texto,
}: {
  ligado: boolean
  aoMudar: (v: boolean) => void
  rotulo: string
  texto?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      onClick={() => aoMudar(!ligado)}
      className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-borda bg-superficie px-4 py-3 text-left active:bg-marca-clara"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{rotulo}</span>
        {texto && <span className="block text-sm text-suave">{texto}</span>}
      </span>
      <span
        aria-hidden
        className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors ${ligado ? 'bg-marca' : 'bg-borda'}`}
      >
        <span className={`absolute size-6 rounded-full bg-white shadow transition-transform ${ligado ? 'translate-x-7' : 'translate-x-1'}`} />
      </span>
    </button>
  )
}

/** Valor com sinal e cor: + verde (entrou), − vermelho (saiu), sem sinal quando 0/neutro. */
export function ValorSinal({ valor, neutro, className = '' }: { valor: number; neutro?: boolean; className?: string }) {
  if (neutro) return <span className={`text-suave ${className}`}>{moeda(Math.abs(valor))}</span>
  const cor = valor > 0 ? 'text-ok' : valor < 0 ? 'text-perigo' : 'text-suave'
  const sinal = valor > 0 ? '+ ' : valor < 0 ? '− ' : ''
  return <span className={`${cor} ${className}`}>{`${sinal}${moeda(Math.abs(valor))}`}</span>
}
