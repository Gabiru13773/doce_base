import { Package, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Botao } from '../../../components/ui'
import { lerNumero, moeda, numero, paraCampo } from '../../../lib/format'
import {
  plural,
  rendimentoBase,
  textoQuantidade,
  textoRendimento,
  unidadeBaseReceita,
  type Contexto,
  type ItemReceita,
  type LinhaCusto,
  type ReceitaCalculo,
} from '../../../lib/receitas'
import { ROTULO_BASE, unidadeBase, type UnidadeBase } from '../../../lib/unidades'
import type { CategoriaInsumo, Insumo } from '../../insumos/api'
import type { Receita } from '../../receitas/api'
import { SeletorItem } from '../../receitas/componentes/SeletorItem'

// "O que vai neste produto": receitas prontas (em fatias, unidades, g ou ml)
// e insumos (embalagens, extras), com o custo de cada linha.

const chaveDe = (i: Pick<ItemReceita, 'tipo' | 'id'>) => `${i.tipo}:${i.id}`

/** Embalagens e materiais aparecem primeiro na lista de insumos. */
const CATEGORIAS_PRIMEIRO: CategoriaInsumo[] = ['embalagem', 'material']

/** Lê a quantidade digitada; aceita "1," enquanto a pessoa ainda digita. Inválido conta como 0. */
function lerQuantidade(texto: string): number {
  const n = lerNumero(texto.replace(/[,.]$/, ''))
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** Rótulo da unidade ao lado do campo: "fatias", "bolo", "g", "ml", "un". */
function rotuloUnidade(receita: ReceitaCalculo | undefined, unidade: UnidadeBase, qtd: number): string {
  if (receita && receita.rendimento_unidade === 'un') return plural(receita.rendimento_nome || 'unidade', qtd)
  return ROTULO_BASE[unidade]
}

/** "receita inteira", "metade da receita", "2 receitas", "30% da receita". */
function fracaoReceita(qtd: number, base: number): string | null {
  if (!(base > 0) || !(qtd > 0)) return null
  const f = qtd / base
  if (Math.abs(f - 1) < 0.001) return 'a receita inteira'
  if (Math.abs(f - 0.5) < 0.001) return 'metade da receita'
  if (f > 1 && Math.abs(f - Math.round(f)) < 0.001) return `${Math.round(f)} receitas inteiras`
  return `${numero(f * 100, 0)}% da receita`
}

export function EditorItensProduto({
  itens,
  aoMudar,
  linhas,
  insumos,
  receitas,
  contexto,
  erro,
}: {
  itens: ItemReceita[]
  aoMudar: (itens: ItemReceita[]) => void
  linhas: LinhaCusto[]
  insumos: Insumo[]
  receitas: Receita[]
  contexto: Contexto
  erro?: string
}) {
  const [seletor, setSeletor] = useState<'receita' | 'insumo' | null>(null)
  // Texto digitado em cada linha (por item), para não "comer" a vírgula de "1,".
  const [textos, setTextos] = useState<Record<string, string>>({})
  const campos = useRef(new Map<string, HTMLInputElement>())
  const [focarChave, setFocarChave] = useState<string | null>(null)

  const insumosPorId = useMemo(() => new Map(insumos.map((i) => [i.id, i])), [insumos])

  useEffect(() => {
    if (!focarChave) return
    const campo = campos.current.get(focarChave)
    if (campo) {
      campo.focus()
      campo.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setFocarChave(null)
    }
  }, [focarChave, itens])

  function descrever(item: ItemReceita, linha: LinhaCusto | undefined) {
    if (item.tipo === 'insumo') {
      const ativo = insumosPorId.get(item.id)
      if (ativo) return { nome: ativo.nome, unidade: unidadeBase(ativo.unidade_compra), receita: undefined, categoria: ativo.categoria }
      const calc = contexto.insumos.get(item.id)
      if (calc) return { nome: calc.nome, unidade: unidadeBase(calc.unidadeCompra), receita: undefined, categoria: undefined }
    } else {
      const rec = contexto.receitas.get(item.id)
      if (rec) return { nome: rec.nome, unidade: unidadeBaseReceita(rec), receita: rec, categoria: undefined }
    }
    return {
      nome: linha?.nome ?? 'Item apagado',
      unidade: linha?.unidade ?? ('un' as UnidadeBase),
      receita: undefined,
      categoria: undefined,
    }
  }

  function textoDe(item: ItemReceita): string {
    const t = textos[chaveDe(item)]
    if (t !== undefined && lerQuantidade(t) === item.quantidade) return t
    return item.quantidade ? paraCampo(item.quantidade) : ''
  }

  function mudarQuantidade(indice: number, texto: string) {
    const item = itens[indice]
    setTextos((atual) => ({ ...atual, [chaveDe(item)]: texto }))
    aoMudar(itens.map((it, i) => (i === indice ? { ...it, quantidade: lerQuantidade(texto) } : it)))
  }

  function definirQuantidade(indice: number, qtd: number) {
    const item = itens[indice]
    setTextos((atual) => ({ ...atual, [chaveDe(item)]: paraCampo(qtd) }))
    aoMudar(itens.map((it, i) => (i === indice ? { ...it, quantidade: qtd } : it)))
  }

  function remover(indice: number) {
    const chave = chaveDe(itens[indice])
    setTextos(({ [chave]: _removido, ...resto }) => resto)
    aoMudar(itens.filter((_, i) => i !== indice))
  }

  function escolher(novo: { tipo: 'insumo' | 'receita'; id: string }) {
    setSeletor(null)
    const chave = chaveDe(novo)
    if (itens.some((i) => chaveDe(i) === chave)) return
    // Receita entra inteira (o caso mais comum: 1 bolo); embalagem entra com 1 unidade.
    let quantidade = 0
    if (novo.tipo === 'receita') {
      const r = contexto.receitas.get(novo.id)
      quantidade = r ? rendimentoBase(r) : 0
    } else {
      const ins = insumosPorId.get(novo.id)
      quantidade = ins && unidadeBase(ins.unidade_compra) === 'un' ? 1 : 0
    }
    aoMudar([...itens, { tipo: novo.tipo, id: novo.id, quantidade }])
    setFocarChave(chave)
  }

  const total = linhas.reduce((s, l) => s + (Number.isFinite(l.custo) ? l.custo : 0), 0)

  return (
    <div className="flex flex-col gap-3">
      {itens.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-borda bg-superficie px-4 py-6 text-center text-suave">
          Adicione a receita pronta (ex.: o bolo) e a embalagem (prato, caixa, bandeja…).
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {itens.map((item, i) => {
            const chave = chaveDe(item)
            const linha = linhas[i]
            const { nome, unidade, receita, categoria } = descrever(item, linha)
            const sufixo = rotuloUnidade(receita, unidade, item.quantidade)
            const base = receita ? rendimentoBase(receita) : 0
            const fracao = receita ? fracaoReceita(item.quantidade, base) : null
            const inteira = base > 0 && Math.abs(item.quantidade - base) < 0.001
            const grande = !receita && unidade !== 'un' && item.quantidade >= 1000
            return (
              <li key={chave} className="rounded-2xl border border-borda bg-superficie p-3">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 pt-2.5 leading-tight font-semibold">
                    {nome}
                    {item.tipo === 'receita' ? (
                      <span className="ml-2 inline-block rounded-full bg-laranja-clara px-2 py-0.5 align-middle text-xs font-semibold text-laranja">
                        receita
                      </span>
                    ) : (
                      categoria &&
                      categoria !== 'ingrediente' && (
                        <span className="ml-2 inline-block rounded-full bg-marca-clara px-2 py-0.5 align-middle text-xs font-semibold text-marca">
                          {categoria}
                        </span>
                      )
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
                  <div className="relative w-40 shrink-0">
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
                      aria-label={`Quantidade de ${nome} (${sufixo})`}
                      value={textoDe(item)}
                      onChange={(e) => mudarQuantidade(i, e.target.value)}
                      className="min-h-12 w-full rounded-xl border border-borda bg-creme pr-[4.75rem] pl-3 text-right text-base outline-none focus:border-marca focus:bg-superficie focus:ring-2 focus:ring-marca/20"
                    />
                    <span className="pointer-events-none absolute top-1/2 right-3 max-w-[4.25rem] -translate-y-1/2 truncate text-suave">
                      {sufixo}
                    </span>
                  </div>
                  <p className="ml-auto text-right font-bold text-tinta tabular-nums">{linha ? moeda(linha.custo) : '—'}</p>
                </div>

                {receita && base > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    {inteira ? (
                      <p className="text-sm text-suave">É a receita inteira ({textoRendimento(receita)})</p>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => definirQuantidade(i, base)}
                          className="min-h-11 rounded-full border border-borda bg-creme px-4 text-[15px] font-medium text-marca active:bg-marca-clara"
                        >
                          Receita inteira ({textoRendimento(receita)})
                        </button>
                        {fracao && <p className="text-sm text-suave">= {fracao}</p>}
                      </>
                    )}
                  </div>
                )}
                {grande && <p className="mt-1 text-sm text-suave">= {textoQuantidade(item.quantidade, unidade)}</p>}
                {linha?.problema && <p className="mt-1 text-sm font-medium text-perigo">{linha.problema}</p>}
              </li>
            )
          })}
        </ul>
      )}

      {itens.length > 0 && (
        <div className="flex items-center justify-between rounded-2xl bg-marca-clara px-4 py-3">
          <span className="font-semibold">Total dos itens</span>
          <span className="text-lg font-bold text-marca tabular-nums">{moeda(total)}</span>
        </div>
      )}

      {erro && <p className="text-sm font-medium text-perigo">{erro}</p>}

      <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
        <Botao variante="secundario" onClick={() => setSeletor('receita')}>
          + Receita
        </Botao>
        <Botao variante="secundario" onClick={() => setSeletor('insumo')}>
          <Package className="size-5" aria-hidden />
          Embalagem ou extra
        </Botao>
      </div>

      <SeletorItem
        aberto={seletor !== null}
        aoFechar={() => setSeletor(null)}
        aoEscolher={escolher}
        insumos={insumos}
        receitas={receitas}
        receitaAtualId={null}
        contexto={contexto}
        jaUsados={itens}
        abaInicial={seletor ?? undefined}
        ordemAbas="receita"
        categoriasPrimeiro={CATEGORIAS_PRIMEIRO}
        textos={{
          titulo: 'O que vai no produto',
          abaReceitas: 'Receitas',
          abaInsumos: 'Embalagens e extras',
          buscaInsumo: 'Buscar embalagem ou insumo',
          buscaReceita: 'Buscar receita',
          vazioReceitas: {
            titulo: 'Nenhuma receita cadastrada',
            texto: 'Cadastre primeiro a receita (ex.: Bolo de chocolate, rende 10 fatias). Depois ela aparece aqui.',
            link: { para: '/receitas/nova', rotulo: 'Cadastrar receita' },
          },
        }}
      />
    </div>
  )
}
