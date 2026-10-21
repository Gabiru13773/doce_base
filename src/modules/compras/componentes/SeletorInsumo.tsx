import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Busca, Vazio } from '../../../components/ui'
import type { Insumo } from '../../insumos/api'
import { Folha } from './Folha'
import { simplificar, textoEmbalagem } from './formato'

/** Escolher um insumo cadastrado (busca pelo nome ou código de barras). */
export function SeletorInsumo({
  titulo,
  subtitulo,
  insumos,
  aoEscolher,
  aoFechar,
  textoVazio = 'Cadastre primeiro o que você compra (leite condensado, ovos, caixinhas…).',
}: {
  textoVazio?: string
  titulo: string
  subtitulo?: string
  insumos: Insumo[]
  aoEscolher: (insumo: Insumo) => void
  aoFechar: () => void
}) {
  const [busca, setBusca] = useState('')
  const indice = useMemo(() => insumos.map((i) => ({ insumo: i, nome: simplificar(i.nome) })), [insumos])
  const termo = simplificar(busca)
  const lista = termo ? indice.filter((x) => x.nome.includes(termo) || (x.insumo.codigo_barras ?? '').includes(termo)) : indice

  return (
    <Folha
      titulo={titulo}
      subtitulo={subtitulo}
      aoFechar={aoFechar}
      telaCheia
      cabecalhoExtra={<Busca valor={busca} aoMudar={setBusca} placeholder="Buscar insumo" />}
    >
      {insumos.length === 0 ? (
        <Vazio titulo="Nenhum insumo para escolher" texto={textoVazio} />
      ) : lista.length === 0 ? (
        <Vazio titulo="Nada encontrado" texto="Tente outra palavra." />
      ) : (
        <ul className="flex flex-col gap-2">
          {lista.map(({ insumo: i }) => (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => aoEscolher(i)}
                className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-borda bg-superficie px-4 py-3 text-left active:bg-marca-clara"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{i.nome}</span>
                  <span className="block truncate text-sm text-suave">
                    Embalagem de {textoEmbalagem(i.qtd_compra, i.unidade_compra)}
                    {i.marca ? ` · ${i.marca}` : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Link
        to="/insumos/novo"
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-dashed border-borda px-4 font-semibold text-marca active:bg-marca-clara"
      >
        <Plus className="size-5" aria-hidden />
        Cadastrar insumo novo
      </Link>
    </Folha>
  )
}
