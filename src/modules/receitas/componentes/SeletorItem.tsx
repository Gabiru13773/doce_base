import { Check, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { Busca, Pilulas, Vazio } from '../../../components/ui'
import { custoAmigavel } from '../../../lib/custos'
import { moeda } from '../../../lib/format'
import { calcularCusto, criariaCiclo, rendimentoBase, textoRendimento, unidadeVenda, type Contexto, type ItemReceita } from '../../../lib/receitas'
import { CATEGORIAS, type CategoriaInsumo, type Insumo } from '../../insumos/api'
import type { Receita } from '../api'

type Aba = 'insumo' | 'receita'

/** Textos da janela; o padrão é o das receitas ("Adicionar ingrediente", "Receitas base"). */
export interface TextosSeletor {
  titulo: string
  abaInsumos: string
  abaReceitas: string
  buscaInsumo: string
  buscaReceita: string
  vazioReceitas: { titulo: string; texto: string; link?: { para: string; rotulo: string } }
}

const TEXTOS_PADRAO: TextosSeletor = {
  titulo: 'Adicionar ingrediente',
  abaInsumos: 'Insumos',
  abaReceitas: 'Receitas base',
  buscaInsumo: 'Buscar insumo',
  buscaReceita: 'Buscar receita base',
  vazioReceitas: {
    titulo: 'Nenhuma receita base disponível',
    texto: 'Receitas como massa, recheio ou calda aparecem aqui depois de cadastradas, para usar dentro de outras.',
  },
}

/** Minúsculas e sem acentos, para a busca achar "acucar" em "Açúcar". */
function simplificar(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

const SELETOR_FOCAVEL = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface Opcao {
  tipo: Aba
  id: string
  nome: string
  detalhe: string
  usado: boolean
}

export function SeletorItem({
  aberto,
  aoFechar,
  aoEscolher,
  insumos,
  receitas,
  receitaAtualId,
  contexto,
  jaUsados,
  textos,
  abaInicial,
  categoriasPrimeiro,
  ordemAbas = 'insumo',
}: {
  aberto: boolean
  aoFechar: () => void
  aoEscolher: (item: { tipo: 'insumo' | 'receita'; id: string }) => void
  insumos: Insumo[]
  receitas: Receita[]
  receitaAtualId: string | null
  contexto: Contexto | null
  jaUsados: ItemReceita[]
  /** Troca alguns textos (ex.: no cadastro de produtos). */
  textos?: Partial<TextosSeletor>
  /** Aba mostrada sempre que a janela abre (sem isso, fica a última usada). */
  abaInicial?: Aba
  /** Insumos destas categorias aparecem primeiro, com o nome da categoria (ex.: embalagens). */
  categoriasPrimeiro?: CategoriaInsumo[]
  /** Qual aba aparece primeiro nas pílulas. */
  ordemAbas?: Aba
}) {
  const t = { ...TEXTOS_PADRAO, ...textos }
  const abas: { valor: Aba; rotulo: string }[] = [
    { valor: 'insumo', rotulo: t.abaInsumos },
    { valor: 'receita', rotulo: t.abaReceitas },
  ]
  if (ordemAbas === 'receita') abas.reverse()
  const [aba, setAba] = useState<Aba>(abaInicial ?? 'insumo')
  const abaInicialRef = useRef(abaInicial)
  useEffect(() => {
    abaInicialRef.current = abaInicial
  })
  const [busca, setBusca] = useState('')
  const painel = useRef<HTMLDivElement>(null)
  // Guarda aoFechar mais recente sem refazer o efeito a cada render do pai.
  const fecharRef = useRef(aoFechar)
  useEffect(() => {
    fecharRef.current = aoFechar
  })

  // Ao abrir: limpa a busca, trava a rolagem do fundo, foca a busca e fecha com Esc.
  // Ao fechar: devolve o foco para onde estava.
  useEffect(() => {
    if (!aberto) return
    setBusca('')
    if (abaInicialRef.current) setAba(abaInicialRef.current)
    const anterior = document.activeElement as HTMLElement | null
    const overflowAntes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    painel.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()

    function aoTeclar(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        fecharRef.current()
      }
    }
    document.addEventListener('keydown', aoTeclar)
    return () => {
      document.removeEventListener('keydown', aoTeclar)
      document.body.style.overflow = overflowAntes
      if (anterior && document.contains(anterior)) anterior.focus()
    }
  }, [aberto])

  const usados = useMemo(() => new Set(jaUsados.map((i) => `${i.tipo}:${i.id}`)), [jaUsados])

  const opcoesInsumo = useMemo<Opcao[]>(() => {
    const destaque = categoriasPrimeiro ?? []
    const posicao = (i: Insumo) => {
      const p = destaque.indexOf(i.categoria)
      return p === -1 ? destaque.length : p
    }
    // sort é estável: dentro de cada grupo, continua a ordem alfabética.
    const ordenados = destaque.length ? [...insumos].sort((a, b) => posicao(a) - posicao(b)) : insumos
    return ordenados.map((i) => {
      const c = custoAmigavel({ qtdCompra: Number(i.qtd_compra), unidadeCompra: i.unidade_compra, precoCompra: Number(i.preco_compra) })
      const preco = `${moeda(c.valor)}/${c.por}`
      const categoria = destaque.length ? CATEGORIAS.find((k) => k.valor === i.categoria)?.rotulo : undefined
      return {
        tipo: 'insumo',
        id: i.id,
        nome: i.nome,
        detalhe: categoria ? `${categoria} · ${preco}` : preco,
        usado: usados.has(`insumo:${i.id}`),
      }
    })
  }, [insumos, usados, categoriasPrimeiro])

  // Só mostra receitas que podem entrar nesta sem criar ciclo (nem ela mesma).
  const opcoesReceita = useMemo<Opcao[]>(() => {
    if (!aberto) return []
    const atual = receitaAtualId ?? '__nova__'
    return receitas
      .filter((r) => r.id !== receitaAtualId && !(contexto && criariaCiclo(atual, r.id, contexto.receitas)))
      .map((r) => {
        const partes = [rendimentoBase(r) > 0 ? `rende ${textoRendimento(r)}` : 'sem rendimento informado']
        if (contexto && contexto.receitas.has(r.id) && rendimentoBase(r) > 0) {
          const { rotulo, fator } = unidadeVenda(r)
          partes.push(`${moeda(calcularCusto(r.id, contexto).custoPorBase * fator)}/${rotulo}`)
        }
        return { tipo: 'receita', id: r.id, nome: r.nome, detalhe: partes.join(' · '), usado: usados.has(`receita:${r.id}`) }
      })
  }, [aberto, receitas, receitaAtualId, contexto, usados])

  const termo = simplificar(busca)
  const lista = (aba === 'insumo' ? opcoesInsumo : opcoesReceita).filter((o) => !termo || simplificar(o.nome).includes(termo))

  // Mantém o Tab dentro da janela enquanto ela está aberta.
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

  if (!aberto) return null

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center md:items-center md:bg-tinta/40 md:p-6" onClick={aoFechar}>
      <div
        ref={painel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="seletor-item-titulo"
        onKeyDown={prenderFoco}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col bg-creme md:h-[min(42rem,90vh)] md:max-w-lg md:overflow-hidden md:rounded-3xl md:shadow-xl"
      >
        <header className="flex flex-col gap-3 border-b border-borda bg-superficie px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="seletor-item-titulo" className="text-xl font-bold">
              {t.titulo}
            </h2>
            <button
              type="button"
              onClick={aoFechar}
              className="inline-flex min-h-12 items-center gap-1.5 rounded-2xl px-3 font-semibold text-marca active:bg-marca-clara"
            >
              <X className="size-6" aria-hidden />
              Fechar
            </button>
          </div>
          <Pilulas rotulo="O que adicionar" valor={aba} aoMudar={setAba} opcoes={abas} />
          <Busca
            valor={busca}
            aoMudar={setBusca}
            placeholder={aba === 'insumo' ? t.buscaInsumo : t.buscaReceita}
          />
        </header>

        <div className="safe-bottom flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {aba === 'insumo' && insumos.length === 0 ? (
            <Vazio
              titulo="Nenhum insumo cadastrado"
              texto="Cadastre primeiro o que você compra (leite condensado, ovos, caixinhas…)."
              acao={
                <Link
                  to="/insumos/novo"
                  className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-marca px-5 font-semibold text-white active:bg-marca-escura"
                >
                  Cadastrar insumo
                </Link>
              }
            />
          ) : aba === 'receita' && opcoesReceita.length === 0 ? (
            <Vazio
              titulo={t.vazioReceitas.titulo}
              texto={t.vazioReceitas.texto}
              acao={
                t.vazioReceitas.link && (
                  <Link
                    to={t.vazioReceitas.link.para}
                    className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-marca px-5 font-semibold text-white active:bg-marca-escura"
                  >
                    {t.vazioReceitas.link.rotulo}
                  </Link>
                )
              }
            />
          ) : lista.length === 0 ? (
            <Vazio titulo="Nada encontrado" texto="Tente outra palavra." />
          ) : (
            <ul className="flex flex-col gap-2">
              {lista.map((o) => (
                <li key={`${o.tipo}:${o.id}`}>
                  <button
                    type="button"
                    disabled={o.usado}
                    onClick={() => aoEscolher({ tipo: o.tipo, id: o.id })}
                    className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-borda bg-superficie px-4 py-3 text-left active:bg-marca-clara disabled:bg-creme disabled:opacity-60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{o.nome}</span>
                      <span className="block truncate text-sm text-suave">{o.detalhe}</span>
                    </span>
                    {o.usado && (
                      <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-ok">
                        <Check className="size-4" aria-hidden />
                        já adicionado
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
