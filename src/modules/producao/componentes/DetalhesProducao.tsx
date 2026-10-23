import { Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { useAviso } from '../../../components/Aviso'
import { Botao, Carregando, Erro } from '../../../components/ui'
import { moeda } from '../../../lib/format'
import type { Contexto } from '../../../lib/receitas'
import { Folha } from '../../compras/componentes/Folha'
import { useApagarProducao, useMovimentos, useRestaurarProducao, type Producao } from '../../estoque/api'
import { dataBr, mensagemDe } from '../../financeiro/util'
import { descreverItem, textoLotes, textoPreparado } from './formato'

/** Folha com o que a produção mexeu no estoque, e o botão para apagá-la (com Desfazer). */
export function DetalhesProducao({ producao: p, contexto, aoFechar }: { producao: Producao; contexto: Contexto | null; aoFechar: () => void }) {
  const movimentos = useMovimentos()
  const apagar = useApagarProducao()
  const restaurar = useRestaurarProducao()
  const avisar = useAviso()
  const receita = contexto?.receitas.get(p.receita_id)

  const linhas = useMemo(
    () =>
      (movimentos.data ?? [])
        .filter((m) => m.producao_id === p.id && m.quantidade !== 0)
        .map((m) => {
          const tipo = m.item_tipo
          const id = (tipo === 'insumo' ? m.insumo_id : m.receita_id) ?? ''
          return { chave: m.id, tipo, quantidade: m.quantidade, ...descreverItem(tipo, id, contexto) }
        })
        .sort((a, b) => (a.tipo === b.tipo ? a.nome.localeCompare(b.nome, 'pt-BR') : a.tipo === 'receita' ? -1 : 1)),
    [movimentos.data, p.id, contexto],
  )
  const entrou = linhas.filter((l) => l.quantidade > 0)
  const saiu = linhas.filter((l) => l.quantidade < 0)

  async function aoApagar() {
    try {
      const apagado = await apagar.mutateAsync(p)
      aoFechar()
      avisar({
        texto: 'Produção apagada: o estoque voltou ao que era',
        desfazer: () => restaurar.mutate(apagado, { onError: (e) => avisar({ texto: `Não deu para desfazer: ${mensagemDe(e)}` }) }),
      })
    } catch {
      // O erro aparece na folha pelo estado da mutação.
    }
  }

  return (
    <Folha
      titulo={receita?.nome ?? 'Receita apagada'}
      subtitulo={[dataBr(p.data), p.feito_por ? `por ${p.feito_por}` : null].filter(Boolean).join(' · ')}
      aoFechar={aoFechar}
      rodape={
        <Botao variante="perigo" className="flex-1" onClick={aoApagar} disabled={apagar.isPending}>
          <Trash2 className="size-5" aria-hidden />
          {apagar.isPending ? 'Apagando…' : 'Apagar produção'}
        </Botao>
      }
    >
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-borda bg-superficie p-3">
          <dt className="text-sm text-suave">Feito</dt>
          <dd className="font-semibold">
            {textoLotes(p.lotes)} → {textoPreparado(p.rendimento, receita)}
          </dd>
        </div>
        <div className="rounded-2xl border border-borda bg-superficie p-3">
          <dt className="text-sm text-suave">Custo</dt>
          <dd className="font-semibold">{p.custo_total != null ? moeda(p.custo_total) : '—'}</dd>
        </div>
      </dl>
      {p.observacao && <p className="rounded-2xl bg-marca-clara/50 px-4 py-3">{p.observacao}</p>}

      {movimentos.isPending ? (
        <Carregando />
      ) : movimentos.isError ? (
        <Erro mensagem={mensagemDe(movimentos.error)} tentarDeNovo={() => void movimentos.refetch()} />
      ) : (
        <>
          <Lista titulo="Entrou no estoque" linhas={entrou} vazio="Nada entrou." sinal="+" cor="text-ok" />
          <Lista titulo="Saiu do estoque" linhas={saiu} vazio="Nada saiu." sinal="−" cor="text-perigo" />
        </>
      )}

      {apagar.isError && <Erro mensagem={mensagemDe(apagar.error)} />}
      <p className="text-sm text-suave">Apagar a produção devolve ao estoque o que saiu e tira o que entrou.</p>
    </Folha>
  )
}

function Lista({
  titulo,
  linhas,
  vazio,
  sinal,
  cor,
}: {
  titulo: string
  linhas: { chave: string; tipo: 'insumo' | 'receita'; nome: string; quantidade: number; texto: (q: number) => string }[]
  vazio: string
  sinal: string
  cor: string
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-bold">{titulo}</h3>
      {linhas.length === 0 ? (
        <p className="text-suave">{vazio}</p>
      ) : (
        <ul className="divide-y divide-borda overflow-hidden rounded-2xl border border-borda bg-superficie">
          {linhas.map((l) => (
            <li key={l.chave} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                {l.nome}
                {l.tipo === 'receita' && <span className="ml-1 text-sm text-suave">(pronto)</span>}
              </span>
              <span className={`shrink-0 font-semibold ${cor}`}>
                {sinal} {l.texto(Math.abs(l.quantidade))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
