import { ChevronRight, CookingPot, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Carregando, Erro, TituloPagina, Vazio } from '../../components/ui'
import { moeda } from '../../lib/format'
import type { Contexto } from '../../lib/receitas'
import { useProducoes, useSaldos, type Producao } from '../estoque/api'
import { hoje } from '../financeiro/api'
import { dataBr, mensagemDe } from '../financeiro/util'
import { useContextoCalculo } from '../receitas/api'
import { DetalhesProducao } from './componentes/DetalhesProducao'
import { rotuloDia, textoLotes, textoPreparado } from './componentes/formato'

// Tela "Produzir": registrar o que foi feito, ver as últimas produções e o que está acabando.

const botaoPrincipal =
  'flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-marca px-5 text-lg font-semibold text-white shadow-sm active:bg-marca-escura'

export default function ProducaoPage() {
  const producoes = useProducoes()
  const calc = useContextoCalculo()
  const saldos = useSaldos()
  const [aberta, setAberta] = useState<Producao | null>(null)

  const dia = hoje()
  const grupos = useMemo(() => {
    const mapa = new Map<string, Producao[]>()
    for (const p of producoes.data ?? []) {
      const lista = mapa.get(p.data) ?? []
      lista.push(p)
      mapa.set(p.data, lista)
    }
    return [...mapa]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([data, lista]) => ({ data, lista: lista.sort((a, b) => b.criado_em.localeCompare(a.criado_em)) }))
  }, [producoes.data])

  // Preparados com mínimo definido que estão abaixo dele.
  const paraProduzir = useMemo(() => {
    const prontos = saldos.data?.receitas
    if (!prontos) return []
    return calc.receitasAtivas
      .filter((r) => r.estoque_minimo != null && r.estoque_minimo > 0 && (prontos[r.id] ?? 0) < r.estoque_minimo)
      .map((r) => ({ receita: r, saldo: prontos[r.id] ?? 0, minimo: r.estoque_minimo as number }))
  }, [calc.receitasAtivas, saldos.data])

  const carregando = producoes.isPending || calc.carregando
  const erro = producoes.error ?? calc.erro

  return (
    <>
      <TituloPagina titulo="Produzir" />

      <Link to="/producao/nova" className={botaoPrincipal}>
        <Plus className="size-6" aria-hidden />
        Registrar produção
      </Link>

      {paraProduzir.length > 0 && (
        <section className="mt-6 flex flex-col gap-2" aria-labelledby="para-produzir">
          <h2 id="para-produzir" className="text-lg font-bold">
            Para produzir
          </h2>
          <p className="text-sm text-suave">Estes preparados estão abaixo do mínimo que você definiu.</p>
          <ul className="divide-y divide-borda overflow-hidden rounded-2xl border border-borda bg-superficie">
            {paraProduzir.map(({ receita: r, saldo, minimo }) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.nome}</p>
                  <p className={`text-sm ${saldo < 0 ? 'font-semibold text-perigo' : 'text-suave'}`}>
                    tem {textoPreparado(saldo, r)} · mínimo {textoPreparado(minimo, r)}
                  </p>
                </div>
                <Link
                  to={`/producao/nova?receita=${encodeURIComponent(r.id)}`}
                  className="inline-flex min-h-12 shrink-0 items-center rounded-2xl border border-borda px-4 font-semibold text-marca active:bg-marca-clara"
                >
                  Produzir
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6 flex flex-col gap-3" aria-labelledby="ultimas">
        <h2 id="ultimas" className="text-lg font-bold">
          Últimas produções
        </h2>
        {carregando ? (
          <Carregando />
        ) : erro ? (
          <Erro
            mensagem={mensagemDe(erro)}
            tentarDeNovo={() => {
              void producoes.refetch()
              calc.tentarDeNovo()
            }}
          />
        ) : grupos.length === 0 ? (
          <Vazio
            titulo="Nenhuma produção registrada"
            texto="Fez um bolo, um recheio, uma fornada de doces? Registre aqui: o estoque recebe o que foi feito (ex.: 1 bolo = 10 fatias) e os insumos usados saem sozinhos."
          />
        ) : (
          grupos.map((g) => (
            <div key={g.data} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold tracking-wide text-suave uppercase">{rotuloDia(g.data, dia, dataBr)}</h3>
              <ul className="flex flex-col gap-2">
                {g.lista.map((p) => (
                  <li key={p.id}>
                    <LinhaProducao producao={p} contexto={calc.contexto} aoAbrir={() => setAberta(p)} />
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {aberta && <DetalhesProducao producao={aberta} contexto={calc.contexto} aoFechar={() => setAberta(null)} />}
    </>
  )
}

function LinhaProducao({ producao: p, contexto, aoAbrir }: { producao: Producao; contexto: Contexto | null; aoAbrir: () => void }) {
  const r = contexto?.receitas.get(p.receita_id)
  return (
    <button
      type="button"
      onClick={aoAbrir}
      className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-borda bg-superficie px-4 py-3 text-left active:bg-marca-clara"
    >
      <CookingPot className="size-6 shrink-0 text-marca" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{r?.nome ?? 'Receita apagada'}</span>
        <span className="block text-sm text-suave">
          {textoLotes(p.lotes)} → {textoPreparado(p.rendimento, r)}
          {p.feito_por ? ` · por ${p.feito_por}` : ''}
        </span>
      </span>
      {p.custo_total != null && <span className="shrink-0 font-semibold">{moeda(p.custo_total)}</span>}
      <ChevronRight className="size-5 shrink-0 text-suave" aria-hidden />
    </button>
  )
}
