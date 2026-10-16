import { CheckCircle2 } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

// Aviso curto no rodapé ("Insumo salvo ✓"), com botão Desfazer opcional.
// Preferimos avisar e permitir desfazer, em vez de pedir confirmação antes.

interface DadosAviso {
  texto: string
  desfazer?: () => void
}

const Contexto = createContext<(a: DadosAviso) => void>(() => {})

export function useAviso() {
  return useContext(Contexto)
}

export function ProvedorAviso({ children }: { children: ReactNode }) {
  const [aviso, setAviso] = useState<(DadosAviso & { chave: number }) | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const mostrar = useCallback((a: DadosAviso) => {
    window.clearTimeout(timer.current)
    setAviso({ ...a, chave: Date.now() })
    timer.current = window.setTimeout(() => setAviso(null), a.desfazer ? 6000 : 3000)
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <Contexto.Provider value={mostrar}>
      {children}
      <div
        aria-live="polite"
        className="no-print pointer-events-none fixed inset-x-0 bottom-[calc(9.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 md:bottom-24 md:left-60"
      >
        {aviso && (
          <div
            key={aviso.chave}
            className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-tinta px-4 py-3 text-white shadow-lg"
          >
            <CheckCircle2 className="size-5 shrink-0 text-green-300" aria-hidden />
            <span className="flex-1">{aviso.texto}</span>
            {aviso.desfazer && (
              <button
                type="button"
                className="min-h-10 rounded-xl px-3 font-semibold text-pink-200 active:bg-white/10"
                onClick={() => {
                  aviso.desfazer?.()
                  setAviso(null)
                }}
              >
                Desfazer
              </button>
            )}
          </div>
        )}
      </div>
    </Contexto.Provider>
  )
}
