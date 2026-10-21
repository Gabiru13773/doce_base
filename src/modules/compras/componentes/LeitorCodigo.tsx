import { Keyboard, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'

// Leitor de código de barras pela câmera (API BarcodeDetector do navegador).
// Funciona no Chrome do Android; onde não existe, o app mostra só o campo para digitar.

interface CodigoDetectado {
  rawValue: string
  format: string
}

interface Detector {
  detect(fonte: HTMLVideoElement): Promise<CodigoDetectado[]>
}

interface ClasseDetector {
  new (opcoes?: { formats: string[] }): Detector
  getSupportedFormats?: () => Promise<string[]>
}

const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf']

function classeDetector(): ClasseDetector | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { BarcodeDetector?: ClasseDetector }
  return w.BarcodeDetector ?? null
}

/** O aparelho consegue ler código de barras pela câmera? */
export function leitorDisponivel(): boolean {
  return !!classeDetector() && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

async function criarDetector(Classe: ClasseDetector): Promise<Detector> {
  let formatos = FORMATOS
  try {
    const suportados = (await Classe.getSupportedFormats?.()) ?? []
    const comuns = FORMATOS.filter((f) => suportados.includes(f))
    if (comuns.length) formatos = comuns
  } catch {
    // Sem a lista de formatos: tenta com todos.
  }
  return new Classe({ formats: formatos })
}

const soDigitos = (t: string) => t.replace(/\D/g, '')

const MSG_MIRAR = 'Aponte a câmera para o código de barras'
const MSG_ERRO_CAMERA = 'Não deu para abrir a câmera. Permita o uso da câmera nas configurações do navegador, ou digite o código.'

export function LeitorCodigo({
  aberto,
  aoLer,
  aoFechar,
}: {
  aberto: boolean
  aoLer: (codigo: string) => void
  aoFechar: () => void
}) {
  if (!aberto) return null
  // Portal: fica fora de qualquer <form> da página (form dentro de form não vale).
  return createPortal(<Leitor aoLer={aoLer} aoFechar={aoFechar} />, document.body)
}

function Leitor({ aoLer, aoFechar }: { aoLer: (codigo: string) => void; aoFechar: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fluxoRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const fecharRef = useRef<HTMLButtonElement>(null)
  // Guarda os callbacks mais recentes sem reiniciar a câmera a cada render do pai.
  const aoLerRef = useRef(aoLer)
  const aoFecharRef = useRef(aoFechar)
  useEffect(() => {
    aoLerRef.current = aoLer
    aoFecharRef.current = aoFechar
  })

  const [mensagem, setMensagem] = useState(MSG_MIRAR)
  const [digitando, setDigitando] = useState(false)
  const [digitado, setDigitado] = useState('')
  const [erroDigitado, setErroDigitado] = useState('')
  const idTitulo = useId()
  const idDigitar = useId()

  function pararCamera() {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    fluxoRef.current?.getTracks().forEach((t) => t.stop())
    fluxoRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  // Liga a câmera ao abrir e SEMPRE desliga ao fechar/desmontar.
  useEffect(() => {
    let cancelado = false
    const Classe = classeDetector()

    async function ligar() {
      if (!Classe || !navigator.mediaDevices?.getUserMedia) {
        setMensagem('Este aparelho não lê código pela câmera. Digite o código.')
        setDigitando(true)
        return
      }
      try {
        const fluxo = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false,
        })
        if (cancelado) {
          fluxo.getTracks().forEach((t) => t.stop())
          return
        }
        fluxoRef.current = fluxo
        const video = videoRef.current
        if (!video) return
        video.srcObject = fluxo
        await video.play()
        const detector = await criarDetector(Classe)
        if (cancelado) return
        let lendo = false
        timerRef.current = window.setInterval(async () => {
          if (lendo || !fluxoRef.current || video.readyState < 2) return
          lendo = true
          try {
            const achados = await detector.detect(video)
            const codigo = soDigitos(achados[0]?.rawValue ?? '')
            if (codigo.length >= 6 && fluxoRef.current) {
              try {
                navigator.vibrate?.(60)
              } catch {
                // Vibrar é só um extra.
              }
              pararCamera()
              aoLerRef.current(codigo)
            }
          } catch {
            // Quadro sem leitura: tenta no próximo.
          } finally {
            lendo = false
          }
        }, 300)
      } catch {
        if (!cancelado) {
          pararCamera()
          setMensagem(MSG_ERRO_CAMERA)
        }
      }
    }

    ligar()
    return () => {
      cancelado = true
      pararCamera()
    }
  }, [])

  // Esc fecha; foco vai para o botão Fechar ao abrir.
  useEffect(() => {
    fecharRef.current?.focus()
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        aoFecharRef.current()
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])

  function fechar() {
    pararCamera()
    aoFechar()
  }

  function confirmarDigitado(e: FormEvent) {
    e.preventDefault()
    // Eventos do React sobem pelo portal: não deixa disparar o envio do formulário da página.
    e.stopPropagation()
    const codigo = soDigitos(digitado)
    if (codigo.length < 6 || codigo.length > 14) {
      setErroDigitado('O código tem de 6 a 14 números')
      return
    }
    pararCamera()
    aoLer(codigo)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={idTitulo}
      className="fixed inset-0 z-[60] flex flex-col bg-black text-white"
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <h2 id={idTitulo} className="text-lg font-bold">
          Ler código de barras
        </h2>
        <button
          ref={fecharRef}
          type="button"
          onClick={fechar}
          className="inline-flex min-h-12 items-center gap-1 rounded-2xl px-4 font-semibold active:bg-white/15"
        >
          <X className="size-5" aria-hidden />
          Fechar
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 size-full object-cover" />
        {/* Moldura para mirar */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="aspect-[2/1] w-[78%] max-w-md rounded-2xl border-4 border-white/90 shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)]" />
        </div>
      </div>

      <div className="flex flex-col gap-3 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <p aria-live="polite" className="text-center text-base">
          {mensagem}
        </p>

        {digitando ? (
          <form onSubmit={confirmarDigitado} noValidate className="flex flex-col gap-2">
            <label htmlFor={idDigitar} className="font-semibold">
              Código de barras
            </label>
            <div className="flex gap-2">
              <input
                id={idDigitar}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                placeholder="Só os números"
                value={digitado}
                onChange={(e) => {
                  setDigitado(soDigitos(e.target.value).slice(0, 14))
                  setErroDigitado('')
                }}
                aria-invalid={erroDigitado ? true : undefined}
                className="min-h-12 min-w-0 flex-1 rounded-xl border border-white/30 bg-white px-4 text-base text-black outline-none focus:ring-2 focus:ring-white/60"
              />
              <button
                type="submit"
                className="inline-flex min-h-12 items-center rounded-2xl bg-white px-5 font-semibold text-black active:bg-white/80"
              >
                Usar
              </button>
            </div>
            {erroDigitado && <p className="text-sm font-medium text-red-300">{erroDigitado}</p>}
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setDigitando(true)}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/40 px-5 font-semibold active:bg-white/15"
          >
            <Keyboard className="size-5" aria-hidden />
            Digitar o código
          </button>
        )}
      </div>
    </div>
  )
}
