import { ChefHat, ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Pilulas } from '../../../components/ui'
import { somarDias } from '../../../lib/financeiro'
import { numero } from '../../../lib/format'
import { paraProduzir } from '../../../lib/pedidos'
import type { Pedido } from '../api'

// "Para produzir": soma dos itens dos pedidos confirmados (ainda não prontos) com entrega até
// amanhã ou nos próximos 7 dias. Recolhível; lembra neste aparelho se estava aberto.

type Prazo = 'amanha' | 'semana'

const CHAVE_ABERTO = 'euforia:pedidos-produzir-aberto'

function lerAberto(): boolean {
  try {
    return localStorage.getItem(CHAVE_ABERTO) !== 'nao'
  } catch {
    return true
  }
}

function gravarAberto(v: boolean) {
  try {
    localStorage.setItem(CHAVE_ABERTO, v ? 'sim' : 'nao')
  } catch {
    // sem armazenamento: só não lembra
  }
}

export function PedidoProduzir({ pedidos, hoje }: { pedidos: Pedido[]; hoje: string }) {
  const [aberto, setAberto] = useState(lerAberto)
  const [prazo, setPrazo] = useState<Prazo>('amanha')
  const ate = somarDias(hoje, prazo === 'amanha' ? 1 : 7)
  const linhas = useMemo(() => paraProduzir(pedidos, ate), [pedidos, ate])

  function alternar() {
    setAberto(!aberto)
    gravarAberto(!aberto)
  }

  return (
    <section className="rounded-2xl border border-borda bg-superficie">
      <button
        type="button"
        onClick={alternar}
        aria-expanded={aberto}
        className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left active:bg-marca-clara"
      >
        <ChefHat className="size-6 shrink-0 text-marca" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-bold">Para produzir</span>
          {!aberto && (
            <span className="block text-sm text-suave">
              {linhas.length === 0 ? 'Nada pendente' : `${linhas.length} ${linhas.length === 1 ? 'item' : 'itens'}`} ·{' '}
              {prazo === 'amanha' ? 'até amanhã' : 'próximos 7 dias'}
            </span>
          )}
        </span>
        <ChevronDown className={`size-6 shrink-0 text-suave transition-transform ${aberto ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {aberto && (
        <div className="flex flex-col gap-3 px-4 pb-4">
          <Pilulas
            rotulo="Prazo"
            valor={prazo}
            aoMudar={setPrazo}
            opcoes={[
              { valor: 'amanha', rotulo: 'Até amanhã' },
              { valor: 'semana', rotulo: '7 dias' },
            ]}
          />
          {linhas.length === 0 ? (
            <p className="text-suave">
              Nenhum pedido confirmado para {prazo === 'amanha' ? 'hoje ou amanhã' : 'os próximos 7 dias'}. Os já marcados como prontos não
              entram aqui.
            </p>
          ) : (
            <ul className="divide-y divide-borda">
              {linhas.map((l) => (
                <li key={l.chave} className="flex items-baseline gap-3 py-2">
                  <span className="w-12 shrink-0 text-right text-lg font-bold">{numero(l.qtd, 3)}×</span>
                  <span className="min-w-0 flex-1 break-words">
                    {l.nome}
                    {l.pedidos > 1 && <span className="text-sm text-suave"> · em {l.pedidos} pedidos</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
