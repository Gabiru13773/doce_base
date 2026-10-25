import { ChevronRight, Lock, LockOpen } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Cartao } from '../../../components/ui'
import { moeda } from '../../../lib/format'
import { CANAIS, FORMAS, type Canal, type FormaPagamento, type ResumoDia } from '../../../lib/vendas'
import { diaPorExtenso } from '../../financeiro/util'
import type { Fechamento } from '../api'
import { hora } from './ListaVendas'

// Resumo do dia (cartões), situação do caixa e a lista dos últimos fechamentos.

/** O que fica guardado em caixa_fechamentos.totais. */
export type TotaisFechamento = ResumoDia & { esperado: number; diferenca: number | null }

const n = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

function lerRegistro<K extends string>(v: unknown, chaves: readonly K[]): Record<K, number> {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const r = {} as Record<K, number>
  for (const k of chaves) r[k] = n(o[k])
  return r
}

const CHAVES_FORMA = FORMAS.map((f) => f.valor)
const CHAVES_CANAL = CANAIS.map((c) => c.valor)

/** Lê os totais guardados no fechamento (JSON), com zero no que faltar. */
export function lerTotais(t: Record<string, unknown>): TotaisFechamento {
  return {
    vendas: n(t.vendas),
    canceladas: n(t.canceladas),
    total: n(t.total),
    descontos: n(t.descontos),
    taxas: n(t.taxas),
    ticketMedio: n(t.ticketMedio),
    porForma: lerRegistro<FormaPagamento>(t.porForma, CHAVES_FORMA),
    porCanal: lerRegistro<Canal>(t.porCanal, CHAVES_CANAL),
    taxasPorForma: lerRegistro<FormaPagamento>(t.taxasPorForma, CHAVES_FORMA),
    esperado: n(t.esperado),
    diferenca: t.diferenca == null ? null : n(t.diferenca),
  }
}

export function ResumoCartoes({ resumo }: { resumo: ResumoDia }) {
  const formas = FORMAS.filter((f) => resumo.porForma[f.valor] > 0)
  const canais = CANAIS.filter((c) => resumo.porCanal[c.valor] > 0)
  return (
    <div className="flex flex-col gap-3">
      {/* "Vendido" ocupa a linha toda: em 3 colunas o valor quebrava no celular */}
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <Numero rotulo="Vendido" valor={moeda(resumo.total)} destaque />
        </div>
        <Numero rotulo={resumo.vendas === 1 ? 'Venda' : 'Vendas'} valor={String(resumo.vendas)} />
        <Numero rotulo="Ticket médio" valor={moeda(resumo.ticketMedio)} />
      </div>
      {(formas.length > 0 || canais.length > 0) && (
        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
          <Cartao className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold text-suave">Como pagaram</h3>
            {formas.map((f) => (
              <p key={f.valor} className="flex justify-between gap-2">
                <span>{f.rotulo}</span>
                <span className="font-semibold">{moeda(resumo.porForma[f.valor])}</span>
              </p>
            ))}
          </Cartao>
          <Cartao className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold text-suave">Onde venderam</h3>
            {canais.map((c) => (
              <p key={c.valor} className="flex justify-between gap-2">
                <span>{c.rotulo}</span>
                <span className="font-semibold">{moeda(resumo.porCanal[c.valor])}</span>
              </p>
            ))}
          </Cartao>
        </div>
      )}
      {(resumo.descontos > 0 || resumo.taxas > 0 || resumo.canceladas > 0) && (
        <p className="px-1 text-sm text-suave">
          {[
            resumo.descontos > 0 && `Descontos: ${moeda(resumo.descontos)}`,
            resumo.taxas > 0 && `Taxas estimadas: ${moeda(resumo.taxas)}`,
            resumo.canceladas > 0 && `${resumo.canceladas} ${resumo.canceladas === 1 ? 'cancelada' : 'canceladas'}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </div>
  )
}

function Numero({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className={`flex flex-col rounded-2xl border border-borda p-3 ${destaque ? 'bg-marca-clara' : 'bg-superficie'}`}>
      <span className="text-sm text-suave">{rotulo}</span>
      <span className={`text-lg leading-tight font-bold break-words ${destaque ? 'text-marca' : ''}`}>{valor}</span>
    </div>
  )
}

/** "Caixa aberto" ou "Caixa fechado em 25/10 às 18:30 por Ana". */
export function StatusCaixa({ fechamento }: { fechamento: Fechamento | undefined }) {
  if (!fechamento)
    return (
      <p className="flex items-center gap-2 rounded-2xl bg-ok-claro px-4 py-3 font-semibold text-ok">
        <LockOpen className="size-5 shrink-0" aria-hidden />
        Caixa aberto
      </p>
    )
  const criado = new Date(fechamento.criado_em)
  const quando = Number.isNaN(criado.getTime())
    ? ''
    : `${criado.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${hora(fechamento.criado_em)}`
  return (
    <p className="flex items-center gap-2 rounded-2xl bg-borda/60 px-4 py-3 font-semibold">
      <Lock className="size-5 shrink-0" aria-hidden />
      <span>
        Caixa fechado{quando && ` em ${quando}`}
        {fechamento.feito_por && <span className="font-normal"> por {fechamento.feito_por}</span>}
      </span>
    </p>
  )
}

/** Sobra (verde), falta (vermelho) ou "certinho". */
export function TextoDiferenca({ valor }: { valor: number }) {
  if (valor === 0) return <span className="font-semibold text-ok">Certinho</span>
  return valor > 0 ? (
    <span className="font-semibold text-ok">Sobrou {moeda(valor)}</span>
  ) : (
    <span className="font-semibold text-perigo">Faltou {moeda(-valor)}</span>
  )
}

export function FechamentosRecentes({ fechamentos, hoje, atual }: { fechamentos: Fechamento[]; hoje: string; atual?: string }) {
  const lista = fechamentos.slice(0, 10)
  if (lista.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-bold">Últimos fechamentos</h2>
      <ul className="divide-y divide-borda overflow-hidden rounded-2xl border border-borda bg-superficie">
        {lista.map((f) => {
          const t = lerTotais(f.totais)
          return (
            <li key={f.id}>
              <Link
                to={`/vendas/caixa?data=${f.data}`}
                aria-current={f.data === atual ? 'page' : undefined}
                className={`flex min-h-14 items-center gap-3 px-4 py-3 active:bg-marca-clara ${f.data === atual ? 'bg-marca-clara/40' : ''}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold first-letter:uppercase">{diaPorExtenso(f.data, hoje)}</span>
                  <span className="block text-sm">
                    {t.diferenca == null ? <span className="text-suave">Gaveta não contada</span> : <TextoDiferenca valor={t.diferenca} />}
                  </span>
                </span>
                <span className="shrink-0 font-bold">{moeda(t.total)}</span>
                <ChevronRight className="size-5 shrink-0 text-suave" aria-hidden />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
