import { Camera, ImageOff, X } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Botao } from '../../../components/ui'
import { Folha } from '../../compras/componentes/Folha'
import { enviarFoto, useUrlFoto } from '../api'

// Fotos de referência do pedido (o bolo que a cliente mandou, o tema da festa…).
// Remover aqui só tira da lista: quem salva o pedido decide se apaga do armazenamento.

export function FotosPedido({ pedidoId, fotos, aoMudar }: { pedidoId: string; fotos: string[]; aoMudar?: (fotos: string[]) => void }) {
  const [aberta, setAberta] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(0)
  const [erro, setErro] = useState<string | null>(null)
  const campo = useRef<HTMLInputElement>(null)
  // As fotos sobem uma a uma; a lista pode mudar no meio (outra foto removida), então
  // cada envio acrescenta à lista mais recente, não à de quando começou.
  const atuais = useRef(fotos)
  useEffect(() => {
    atuais.current = fotos
  }, [fotos])

  if (!aoMudar && fotos.length === 0) return null

  async function escolher(e: ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(e.target.files ?? [])
    e.target.value = '' // deixa escolher a mesma foto de novo
    if (!aoMudar || arquivos.length === 0) return
    setErro(null)
    setEnviando((n) => n + arquivos.length)
    let falhas = 0
    let ultimoErro = ''
    for (const arquivo of arquivos) {
      try {
        const foto = await enviarFoto(pedidoId, arquivo)
        atuais.current = [...atuais.current, foto]
        aoMudar(atuais.current)
      } catch (err) {
        falhas++
        ultimoErro = err instanceof Error ? err.message : 'tente novamente'
      } finally {
        setEnviando((n) => n - 1)
      }
    }
    if (falhas > 0) setErro(falhas === 1 ? ultimoErro : `${falhas} fotos não foram enviadas. ${ultimoErro}`)
  }

  function remover(foto: string) {
    if (!aoMudar) return
    atuais.current = atuais.current.filter((f) => f !== foto)
    aoMudar(atuais.current)
  }

  return (
    <div className="flex flex-col gap-3">
      {(fotos.length > 0 || enviando > 0) && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {fotos.map((f, i) => (
            <li key={f} className="relative">
              <Miniatura foto={f} numero={i + 1} aoAbrir={() => setAberta(f)} />
              {aoMudar && (
                <button
                  type="button"
                  onClick={() => remover(f)}
                  aria-label={`Tirar a foto ${i + 1}`}
                  className="absolute top-1 right-1 flex size-10 items-center justify-center rounded-full bg-tinta/70 text-white active:bg-tinta"
                >
                  <X className="size-5" aria-hidden />
                </button>
              )}
            </li>
          ))}
          {Array.from({ length: enviando }, (_, i) => (
            <li key={`enviando-${i}`} className="flex aspect-square animate-pulse items-center justify-center rounded-xl bg-borda/60 text-sm text-suave">
              Enviando…
            </li>
          ))}
        </ul>
      )}

      {aoMudar && (
        <>
          {/* sem "capture": no celular o sistema pergunta se é câmera ou galeria */}
          <input ref={campo} type="file" accept="image/*" multiple className="hidden" onChange={escolher} />
          <Botao variante="secundario" onClick={() => campo.current?.click()} disabled={enviando > 0}>
            <Camera className="size-5" aria-hidden />
            {enviando > 0 ? 'Enviando…' : fotos.length > 0 ? 'Adicionar mais fotos' : 'Adicionar foto'}
          </Botao>
          {erro && <p className="rounded-2xl bg-perigo-claro p-3 text-sm font-medium text-perigo">{erro}</p>}
        </>
      )}

      {aberta && <FolhaFoto foto={aberta} aoFechar={() => setAberta(null)} />}
    </div>
  )
}

function Miniatura({ foto, numero, aoAbrir }: { foto: string; numero: number; aoAbrir: () => void }) {
  const url = useUrlFoto(foto)
  const [quebrou, setQuebrou] = useState(false)
  const caixa = 'flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-borda bg-superficie'

  if (url.isPending) return <div className={`${caixa} animate-pulse bg-borda/60`} aria-label="Carregando foto" />
  if (url.isError || quebrou)
    return (
      <button
        type="button"
        onClick={() => {
          setQuebrou(false)
          url.refetch()
        }}
        className={`${caixa} flex-col gap-1 px-1 text-center text-xs text-suave active:bg-marca-clara`}
      >
        <ImageOff className="size-6" aria-hidden />
        Não abriu. Tocar para tentar de novo
      </button>
    )
  return (
    <button type="button" onClick={aoAbrir} className={`${caixa} active:opacity-80`} aria-label={`Ver a foto ${numero}`}>
      <img src={url.data} alt="" loading="lazy" className="size-full object-cover" onError={() => setQuebrou(true)} />
    </button>
  )
}

function FolhaFoto({ foto, aoFechar }: { foto: string; aoFechar: () => void }) {
  const url = useUrlFoto(foto)
  return (
    <Folha titulo="Foto de referência" aoFechar={aoFechar}>
      {url.isPending ? (
        <div className="aspect-square w-full animate-pulse rounded-2xl bg-borda/60" />
      ) : url.isError ? (
        <p className="rounded-2xl bg-perigo-claro p-3 text-perigo">{url.error.message}</p>
      ) : (
        <img src={url.data} alt="Foto de referência do pedido" className="max-h-[70dvh] w-full rounded-2xl object-contain" />
      )}
    </Folha>
  )
}
