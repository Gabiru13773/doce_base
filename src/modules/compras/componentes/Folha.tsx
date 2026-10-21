import { X } from 'lucide-react'
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'

// Folha que sobe do rodapé (no computador, janela no meio da tela). Fecha com o fundo, o
// botão Fechar ou Esc. Pode haver uma folha por cima da outra (ex.: escolher o produto da
// troca): o Esc fecha só a de cima.

const SELETOR_FOCAVEL = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'

const pilha: object[] = []

export function Folha({
  titulo,
  subtitulo,
  aoFechar,
  children,
  rodape,
  telaCheia = false,
  cabecalhoExtra,
}: {
  titulo: string
  subtitulo?: ReactNode
  aoFechar: () => void
  children: ReactNode
  /** botões fixos embaixo (Cancelar / Confirmar) */
  rodape?: ReactNode
  /** ocupa a tela toda no celular (listas para escolher) */
  telaCheia?: boolean
  /** fica no cabeçalho, abaixo do título (ex.: busca) */
  cabecalhoExtra?: ReactNode
}) {
  const idTitulo = useId()
  const painel = useRef<HTMLDivElement>(null)
  const fecharRef = useRef(aoFechar)
  useEffect(() => {
    fecharRef.current = aoFechar
  })

  // Trava a rolagem do fundo, foca o primeiro campo, fecha com Esc e devolve o foco ao fechar.
  useEffect(() => {
    const eu = {}
    pilha.push(eu)
    const anterior = document.activeElement as HTMLElement | null
    const overflowAntes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const p = painel.current
    const alvo =
      p?.querySelector<HTMLElement>('[data-foco-inicial]') ??
      p?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ??
      p?.querySelector<HTMLElement>(SELETOR_FOCAVEL)
    alvo?.focus()
    function aoTeclar(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape' && pilha[pilha.length - 1] === eu) {
        e.preventDefault()
        fecharRef.current()
      }
    }
    document.addEventListener('keydown', aoTeclar)
    return () => {
      document.removeEventListener('keydown', aoTeclar)
      const i = pilha.indexOf(eu)
      if (i >= 0) pilha.splice(i, 1)
      document.body.style.overflow = overflowAntes
      if (anterior && document.contains(anterior)) anterior.focus()
    }
  }, [])

  function prenderFoco(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab' || !painel.current) return
    const focaveis = Array.from(painel.current.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL))
    if (focaveis.length === 0) return
    const primeiro = focaveis[0]
    const ultimo = focaveis[focaveis.length - 1]
    if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault()
      ultimo.focus()
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault()
      primeiro.focus()
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center md:items-center md:bg-tinta/40 md:p-6 ${
        telaCheia ? 'items-stretch' : 'items-end bg-tinta/40'
      }`}
      onClick={aoFechar}
    >
      <div
        ref={painel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        onKeyDown={prenderFoco}
        onClick={(e) => e.stopPropagation()}
        className={`flex w-full flex-col bg-creme shadow-xl md:max-w-lg md:rounded-3xl ${
          telaCheia ? 'h-full md:h-[min(42rem,90vh)] md:overflow-hidden' : 'max-h-[92dvh] rounded-t-3xl'
        }`}
      >
        <header
          className={`flex flex-col gap-3 border-b border-borda px-4 pb-3 ${
            telaCheia ? 'bg-superficie pt-[max(0.75rem,env(safe-area-inset-top))]' : 'pt-4'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={idTitulo} className="text-xl font-bold break-words">
                {titulo}
              </h2>
              {subtitulo && <p className="text-suave">{subtitulo}</p>}
            </div>
            <button
              type="button"
              onClick={aoFechar}
              className="inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-2xl px-3 font-semibold text-marca active:bg-marca-clara"
            >
              <X className="size-6" aria-hidden />
              Fechar
            </button>
          </div>
          {cabecalhoExtra}
        </header>
        <div className={`flex flex-col gap-5 overflow-y-auto overscroll-contain px-4 py-4 ${telaCheia ? 'flex-1' : ''} ${rodape ? '' : 'safe-bottom'}`}>
          {children}
        </div>
        {rodape && <div className="safe-bottom flex gap-3 border-t border-borda px-4 pt-3 pb-3">{rodape}</div>}
      </div>
    </div>
  )
}

/** Fichas de escolha (motivos). `valor` null = nenhuma escolhida. */
export function Fichas({
  opcoes,
  valor,
  aoMudar,
  rotulo,
}: {
  opcoes: string[]
  valor: string | null
  aoMudar: (v: string | null) => void
  rotulo: string
}) {
  return (
    <div role="group" aria-label={rotulo} className="flex flex-wrap gap-2">
      {opcoes.map((o) => {
        const ativo = o === valor
        return (
          <button
            key={o}
            type="button"
            aria-pressed={ativo}
            onClick={() => aoMudar(ativo ? null : o)}
            className={`min-h-12 rounded-full border px-4 font-medium transition-colors ${
              ativo ? 'border-marca bg-marca text-white' : 'border-borda bg-superficie text-tinta active:bg-marca-clara'
            }`}
          >
            {o}
          </button>
        )
      })}
    </div>
  )
}
