import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Busca, Vazio } from '../../../components/ui'
import { rendimentoBase, textoRendimento } from '../../../lib/receitas'
import { Folha } from '../../compras/componentes/Folha'
import { simplificar } from '../../compras/componentes/formato'
import type { Receita } from '../../receitas/api'
import { textoPreparado } from './formato'

/** Escolher a receita que foi produzida (busca pelo nome), mostrando quanto rende e quanto tem pronto. */
export function SeletorReceita({
  receitas,
  saldos,
  aoEscolher,
  aoFechar,
}: {
  receitas: Receita[]
  saldos: Record<string, number>
  aoEscolher: (r: Receita) => void
  aoFechar: () => void
}) {
  const [busca, setBusca] = useState('')
  const indice = useMemo(() => receitas.map((r) => ({ receita: r, nome: simplificar(r.nome) })), [receitas])
  const termo = simplificar(busca)
  const lista = termo ? indice.filter((x) => x.nome.includes(termo)) : indice

  return (
    <Folha
      titulo="O que você produziu?"
      aoFechar={aoFechar}
      telaCheia
      cabecalhoExtra={<Busca valor={busca} aoMudar={setBusca} placeholder="Buscar receita" />}
    >
      {receitas.length === 0 ? (
        <Vazio titulo="Nenhuma receita cadastrada" texto="Cadastre a receita (ingredientes e quanto rende) para registrar a produção." />
      ) : lista.length === 0 ? (
        <Vazio titulo="Nada encontrado" texto="Tente outra palavra." />
      ) : (
        <ul className="flex flex-col gap-2">
          {lista.map(({ receita: r }) => {
            const saldo = saldos[r.id] ?? 0
            const detalhe = [
              rendimentoBase(r) > 0 ? `rende ${textoRendimento(r)}` : 'sem rendimento informado',
              saldo !== 0 ? `tem ${textoPreparado(saldo, r)} pronto` : null,
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => aoEscolher(r)}
                  className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-borda bg-superficie px-4 py-3 text-left active:bg-marca-clara"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{r.nome}</span>
                    <span className="block truncate text-sm text-suave">{detalhe}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <Link
        to="/receitas/nova"
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-dashed border-borda px-4 font-semibold text-marca active:bg-marca-clara"
      >
        <Plus className="size-5" aria-hidden />
        Cadastrar receita nova
      </Link>
    </Folha>
  )
}
