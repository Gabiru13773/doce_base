import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Botao } from '../../../components/ui'

let proximoId = 0
const novoId = () => `passo-${++proximoId}`

export function EditorPassos({ passos, aoMudar }: { passos: string[]; aoMudar: (passos: string[]) => void }) {
  // Ids estáveis para cada passo (o texto pode se repetir e muda a cada tecla).
  const [ids, setIds] = useState<string[]>(() => passos.map(novoId))
  const [focarId, setFocarId] = useState<string | null>(null)
  const campos = useRef(new Map<string, HTMLTextAreaElement>())

  // Se a lista mudar de tamanho por fora (ex.: receita carregada), ajusta os ids.
  let idsAtuais = ids
  if (ids.length !== passos.length) {
    idsAtuais = passos.map((_, i) => ids[i] ?? novoId())
    setIds(idsAtuais)
  }

  useEffect(() => {
    if (!focarId) return
    const campo = campos.current.get(focarId)
    if (campo) {
      campo.focus()
      campo.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setFocarId(null)
    }
  }, [focarId, passos])

  function mudar(indice: number, texto: string) {
    aoMudar(passos.map((p, i) => (i === indice ? texto : p)))
  }

  function mover(indice: number, delta: -1 | 1) {
    const destino = indice + delta
    if (destino < 0 || destino >= passos.length) return
    const trocar = <T,>(lista: T[]) => {
      const nova = [...lista]
      ;[nova[indice], nova[destino]] = [nova[destino], nova[indice]]
      return nova
    }
    setIds(trocar(idsAtuais))
    aoMudar(trocar(passos))
  }

  function remover(indice: number) {
    setIds(idsAtuais.filter((_, i) => i !== indice))
    aoMudar(passos.filter((_, i) => i !== indice))
  }

  function adicionar() {
    const id = novoId()
    setIds([...idsAtuais, id])
    aoMudar([...passos, ''])
    setFocarId(id)
  }

  return (
    <div className="flex flex-col gap-3">
      {passos.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-borda bg-superficie px-4 py-6 text-center text-suave">
          Escreva o modo de preparo, um passo de cada vez. Isso vira a ficha técnica para treinar a equipe.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {passos.map((texto, i) => {
            const id = idsAtuais[i]
            return (
              <li key={id} className="flex gap-2 rounded-2xl border border-borda bg-superficie p-3">
                <span
                  className="mt-2 flex size-8 shrink-0 items-center justify-center rounded-full bg-marca-clara font-bold text-marca"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <CampoPasso
                    texto={texto}
                    rotulo={`Passo ${i + 1}`}
                    registrar={(el) => {
                      if (el) campos.current.set(id, el)
                      else campos.current.delete(id)
                    }}
                    aoMudar={(t) => mudar(i, t)}
                  />
                  <div className="mt-1 flex justify-end gap-1">
                    <BotaoIcone rotulo={`Subir passo ${i + 1}`} desativado={i === 0} aoClicar={() => mover(i, -1)}>
                      <ChevronUp className="size-5" aria-hidden />
                    </BotaoIcone>
                    <BotaoIcone
                      rotulo={`Descer passo ${i + 1}`}
                      desativado={i === passos.length - 1}
                      aoClicar={() => mover(i, 1)}
                    >
                      <ChevronDown className="size-5" aria-hidden />
                    </BotaoIcone>
                    <BotaoIcone rotulo={`Remover passo ${i + 1}`} perigo aoClicar={() => remover(i)}>
                      <Trash2 className="size-5" aria-hidden />
                    </BotaoIcone>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <Botao variante="secundario" className="w-full" onClick={adicionar}>
        + Adicionar passo
      </Botao>
    </div>
  )
}

/** Textarea que cresce conforme o texto. */
function CampoPasso({
  texto,
  rotulo,
  registrar,
  aoMudar,
}: {
  texto: string
  rotulo: string
  registrar: (el: HTMLTextAreaElement | null) => void
  aoMudar: (texto: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [texto])

  return (
    <textarea
      ref={(el) => {
        ref.current = el
        registrar(el)
      }}
      rows={2}
      aria-label={rotulo}
      placeholder="Ex.: Bata os ovos com o açúcar até ficar fofo."
      value={texto}
      onChange={(e) => aoMudar(e.target.value)}
      className="block min-h-12 w-full resize-none overflow-hidden rounded-xl border border-borda bg-creme px-3 py-2.5 text-base outline-none focus:border-marca focus:bg-superficie focus:ring-2 focus:ring-marca/20"
    />
  )
}

function BotaoIcone({
  rotulo,
  aoClicar,
  desativado,
  perigo,
  children,
}: {
  rotulo: string
  aoClicar: () => void
  desativado?: boolean
  perigo?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      disabled={desativado}
      onClick={aoClicar}
      className={`flex size-11 items-center justify-center rounded-xl text-suave disabled:opacity-30 ${
        perigo ? 'active:bg-perigo-claro active:text-perigo' : 'active:bg-marca-clara active:text-marca'
      }`}
    >
      {children}
    </button>
  )
}
