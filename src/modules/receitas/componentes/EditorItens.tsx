import { Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Botao } from '../../../components/ui'
import { lerNumero, moeda, paraCampo } from '../../../lib/format'
import { textoQuantidade, unidadeBaseReceita, type Contexto, type ItemReceita, type LinhaCusto } from '../../../lib/receitas'
import { ROTULO_BASE, unidadeBase, type UnidadeBase } from '../../../lib/unidades'
import type { Insumo } from '../../insumos/api'
import type { Receita } from '../api'
import { SeletorItem } from './SeletorItem'

const chaveDe = (i: Pick<ItemReceita, 'tipo' | 'id'>) => `${i.tipo}:${i.id}`

/** Lê a quantidade digitada; aceita "1," enquanto a pessoa ainda digita. Inválido conta como 0. */
function lerQuantidade(texto: string): number {
  const n = lerNumero(texto.replace(/[,.]$/, ''))
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export function EditorItens({
  itens,
  aoMudar,
  linhas,
  insumos,
  receitas,
  receitaAtualId,
  contexto,
  erro,
}: {
  itens: ItemReceita[]
  aoMudar: (itens: ItemReceita[]) => void
  linhas: LinhaCusto[]
  insumos: Insumo[]
  receitas: Receita[]
  receitaAtualId: string | null
  contexto: Contexto | null
  erro?: string
}) {
  const [seletorAberto, setSeletorAberto] = useState(false)
  // Texto digitado em cada linha (por item), para não "comer" a vírgula de "1,".
  const [textos, setTextos] = useState<Record<string, string>>({})
  const campos = useRef(new Map<string, HTMLInputElement>())
  const [focarChave, setFocarChave] = useState<string | null>(null)

  const insumosPorId = useMemo(() => new Map(insumos.map((i) => [i.id, i])), [insumos])
  const receitasPorId = useMemo(() => new Map(receitas.map((r) => [r.id, r])), [receitas])

  // Foca o campo de quantidade da linha recém-adicionada.
  useEffect(() => {
    if (!focarChave) return
    const campo = campos.current.get(focarChave)
    if (campo) {
      campo.focus()
      campo.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setFocarChave(null)
    }
  }, [focarChave, itens])

  /** Nome e unidade base do item, procurando nas listas ativas, no contexto e, por fim, na linha de custo. */
  function descrever(item: ItemReceita, linha: LinhaCusto | undefined): { nome: string; unidade: UnidadeBase } {
    if (item.tipo === 'insumo') {
      const ins = insumosPorId.get(item.id)
      if (ins) return { nome: ins.nome, unidade: unidadeBase(ins.unidade_compra) }
      const calc = contexto?.insumos.get(item.id)
      if (calc) return { nome: calc.nome, unidade: unidadeBase(calc.unidadeCompra) }
    } else {
      const rec = receitasPorId.get(item.id) ?? contexto?.receitas.get(item.id)
      if (rec) return { nome: rec.nome, unidade: unidadeBaseReceita(rec) }
    }
    return { nome: linha?.nome ?? 'Item apagado', unidade: linha?.unidade ?? 'un' }
  }

  function textoDe(item: ItemReceita): string {
    const t = textos[chaveDe(item)]
    // Usa o texto digitado enquanto ele ainda representa a quantidade atual.
    if (t !== undefined && lerQuantidade(t) === item.quantidade) return t
    return item.quantidade ? paraCampo(item.quantidade) : ''
  }

  function mudarQuantidade(indice: number, texto: string) {
    const item = itens[indice]
    setTextos((atual) => ({ ...atual, [chaveDe(item)]: texto }))
    aoMudar(itens.map((it, i) => (i === indice ? { ...it, quantidade: lerQuantidade(texto) } : it)))
  }

  function remover(indice: number) {
    const chave = chaveDe(itens[indice])
    setTextos(({ [chave]: _removido, ...resto }) => resto)
    aoMudar(itens.filter((_, i) => i !== indice))
  }

  function escolher(novo: { tipo: 'insumo' | 'receita'; id: string }) {
    setSeletorAberto(false)
    const chave = chaveDe(novo)
    if (itens.some((i) => chaveDe(i) === chave)) return
    aoMudar([...itens, { tipo: novo.tipo, id: novo.id, quantidade: 0 }])
    setFocarChave(chave)
  }

  const total = linhas.reduce((s, l) => s + (Number.isFinite(l.custo) ? l.custo : 0), 0)

  return (
    <div className="flex flex-col gap-3">
      {itens.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-borda bg-superficie px-4 py-6 text-center text-suave">
          Adicione os ingredientes e as receitas base (massa, recheio, calda) que entram nesta receita.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {itens.map((item, i) => {
            const chave = chaveDe(item)
            const linha = linhas[i]
            const { nome, unidade } = descrever(item, linha)
            const rotuloUnidade = ROTULO_BASE[unidade]
            const grande = unidade !== 'un' && item.quantidade >= 1000
            return (
              <li key={chave} className="rounded-2xl border border-borda bg-superficie p-3">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 pt-2.5 font-semibold leading-tight">
                    {nome}
                    {item.tipo === 'receita' && (
                      <span className="ml-2 inline-block rounded-full bg-laranja-clara px-2 py-0.5 align-middle text-xs font-semibold text-laranja">
                        receita
                      </span>
                    )}
                  </p>
                  <button
                    type="button"
                    aria-label={`Remover ${nome}`}
                    onClick={() => remover(i)}
                    className="-mt-0.5 -mr-1 flex size-11 shrink-0 items-center justify-center rounded-xl text-suave active:bg-perigo-claro active:text-perigo"
                  >
                    <Trash2 className="size-5" aria-hidden />
                  </button>
                </div>

                <div className="mt-1 flex items-center gap-3">
                  <div className="relative w-36 shrink-0">
                    <input
                      ref={(el) => {
                        if (el) campos.current.set(chave, el)
                        else campos.current.delete(chave)
                      }}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      enterKeyHint="done"
                      placeholder="0"
                      aria-label={`Quantidade de ${nome} em ${rotuloUnidade}`}
                      value={textoDe(item)}
                      onChange={(e) => mudarQuantidade(i, e.target.value)}
                      className="min-h-12 w-full rounded-xl border border-borda bg-creme pr-12 pl-3 text-right text-base outline-none focus:border-marca focus:bg-superficie focus:ring-2 focus:ring-marca/20"
                    />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-suave">{rotuloUnidade}</span>
                  </div>
                  <p className="ml-auto text-right font-bold text-tinta">{linha ? moeda(linha.custo) : '—'}</p>
                </div>

                {grande && <p className="mt-1 text-sm text-suave">= {textoQuantidade(item.quantidade, unidade)}</p>}
                {linha?.problema && <p className="mt-1 text-sm font-medium text-perigo">{linha.problema}</p>}
              </li>
            )
          })}
        </ul>
      )}

      {itens.length > 0 && (
        <div className="flex items-center justify-between rounded-2xl bg-marca-clara px-4 py-3">
          <span className="font-semibold">Total dos ingredientes</span>
          <span className="text-lg font-bold text-marca">{moeda(total)}</span>
        </div>
      )}

      {erro && <p className="text-sm font-medium text-perigo">{erro}</p>}

      <Botao variante="secundario" className="w-full" onClick={() => setSeletorAberto(true)}>
        + Adicionar ingrediente
      </Botao>

      <SeletorItem
        aberto={seletorAberto}
        aoFechar={() => setSeletorAberto(false)}
        aoEscolher={escolher}
        insumos={insumos}
        receitas={receitas}
        receitaAtualId={receitaAtualId}
        contexto={contexto}
        jaUsados={itens}
      />
    </div>
  )
}
