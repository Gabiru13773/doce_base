import { useId } from 'react'
import { Campo, classeEntrada } from '../../../components/ui'
import type { CategoriaFin, ContaFin, TipoCategoria } from '../api'

/**
 * Categoria do plano de contas, agrupada por Grupo (lista nativa: no celular abre a roda de opções).
 * Mostra só as do tipo pedido (entrada ou saída) e ativas; uma desativada já escolhida continua aparecendo.
 */
export function SeletorCategoria({
  rotulo = 'Categoria',
  tipo,
  categorias,
  valor,
  aoMudar,
  erro,
  ajuda,
}: {
  rotulo?: string
  tipo: TipoCategoria
  categorias: CategoriaFin[]
  valor: string | null
  aoMudar: (id: string | null) => void
  erro?: string
  ajuda?: string
}) {
  const id = useId()
  const visiveis = categorias.filter((c) => c.tipo === tipo && (c.ativo || c.id === valor))
  const grupos = new Map<string, CategoriaFin[]>()
  for (const c of visiveis) grupos.set(c.grupo, [...(grupos.get(c.grupo) ?? []), c])
  return (
    <Campo rotulo={rotulo} id={id} erro={erro} ajuda={ajuda}>
      <select
        id={id}
        className={`${classeEntrada} ${erro ? 'border-perigo' : ''}`}
        value={valor ?? ''}
        onChange={(e) => aoMudar(e.target.value || null)}
        aria-invalid={erro ? true : undefined}
      >
        <option value="">Escolha…</option>
        {[...grupos].map(([grupo, lista]) => (
          <optgroup key={grupo} label={grupo}>
            {lista.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
                {c.ativo ? '' : ' (desativada)'}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </Campo>
  )
}

/** Conta (banco/caixa). Mostra as ativas; uma desativada já escolhida continua aparecendo. */
export function SeletorConta({
  rotulo = 'Conta',
  contas,
  valor,
  aoMudar,
  erro,
  ajuda,
  vazio = 'Escolha…',
  excluir,
}: {
  rotulo?: string
  contas: ContaFin[]
  valor: string | null
  aoMudar: (id: string | null) => void
  erro?: string
  ajuda?: string
  vazio?: string
  /** Conta que não pode ser escolhida (ex.: a de origem numa transferência). */
  excluir?: string | null
}) {
  const id = useId()
  const visiveis = contas.filter((c) => (c.ativo || c.id === valor) && c.id !== excluir)
  return (
    <Campo rotulo={rotulo} id={id} erro={erro} ajuda={ajuda}>
      <select
        id={id}
        className={`${classeEntrada} ${erro ? 'border-perigo' : ''}`}
        value={valor ?? ''}
        onChange={(e) => aoMudar(e.target.value || null)}
        aria-invalid={erro ? true : undefined}
      >
        <option value="">{vazio}</option>
        {visiveis.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
          </option>
        ))}
      </select>
    </Campo>
  )
}

/** Nome da categoria para listas ("Ingredientes e insumos"), ou um texto padrão. */
export function nomeCategoria(categorias: CategoriaFin[], id: string | null, padrao = 'Sem categoria') {
  return (id && categorias.find((c) => c.id === id)?.nome) || padrao
}
