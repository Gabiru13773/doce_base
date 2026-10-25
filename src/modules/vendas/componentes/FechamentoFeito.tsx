import { ChevronRight } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAviso } from '../../../components/Aviso'
import { Botao, Carregando, Cartao, Erro } from '../../../components/ui'
import { baixasPorTitulo, situacaoTitulo } from '../../../lib/financeiro'
import { moeda } from '../../../lib/format'
import { Folha } from '../../compras/componentes/Folha'
import { useContasFin, useLancamentos, useTitulos } from '../../financeiro/api'
import { seloSituacao } from '../../financeiro/titulos/util'
import { dataBr, mensagemDe } from '../../financeiro/util'
import { useDesfazerFechamento, type Fechamento } from '../api'
import { lerTotais, ResumoCartoes, StatusCaixa, TextoDiferenca } from './FechamentoResumo'

// Caixa já fechado: o resumo guardado, o que foi para o Financeiro e o Reabrir caixa.

export function FechamentoFeito({ fechamento: f, hoje, vendasDepois }: { fechamento: Fechamento; hoje: string; vendasDepois: number }) {
  const avisar = useAviso()
  const desfazer = useDesfazerFechamento()
  const [confirmando, setConfirmando] = useState(false)
  const lancamentos = useLancamentos()
  const titulos = useTitulos()
  const contas = useContasFin()
  const t = useMemo(() => lerTotais(f.totais), [f.totais])

  const lancs = useMemo(() => (lancamentos.data ?? []).filter((l) => l.fechamento_id === f.id), [lancamentos.data, f.id])
  const tits = useMemo(() => (titulos.data ?? []).filter((x) => x.fechamento_id === f.id), [titulos.data, f.id])
  const situacoes = useMemo(() => {
    const baixas = baixasPorTitulo(lancamentos.data ?? [], tits)
    return tits.map((x) => situacaoTitulo(x, baixas, hoje))
  }, [lancamentos.data, tits, hoje])
  const nomeConta = (id: string | null) => (id && contas.data?.find((c) => c.id === id)?.nome) || 'Sem conta'

  async function reabrir() {
    try {
      await desfazer.mutateAsync(f)
      setConfirmando(false)
      avisar({ texto: 'Caixa reaberto ✓' })
    } catch {
      // aparece na folha
    }
  }

  const consultas = [lancamentos, titulos, contas]
  const comErro = consultas.find((c) => c.isError)

  return (
    <div className="flex flex-col gap-6">
      <StatusCaixa fechamento={f} />
      {vendasDepois > 0 && (
        <p className="rounded-2xl bg-alerta-claro px-4 py-3 text-[15px]">
          {vendasDepois === 1 ? '1 venda foi feita' : `${vendasDepois} vendas foram feitas`} depois do fechamento e não
          {vendasDepois === 1 ? ' entrou' : ' entraram'} no Financeiro. Reabra o caixa e feche de novo para incluir.
        </p>
      )}

      <ResumoCartoes resumo={t} />

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-bold">Gaveta</h2>
        <Cartao className="flex flex-col gap-1">
          <Linha rotulo="Fundo de troco">{moeda(f.fundo_troco ?? 0)}</Linha>
          <Linha rotulo="Vendas em dinheiro">{moeda(t.porForma.dinheiro)}</Linha>
          <Linha rotulo="Devia ter na gaveta">{moeda(t.esperado)}</Linha>
          <Linha rotulo="Contado">{f.dinheiro_contado == null ? 'Não contado' : moeda(f.dinheiro_contado)}</Linha>
          {t.diferenca != null && (
            <Linha rotulo="Diferença">
              <TextoDiferenca valor={t.diferenca} />
            </Linha>
          )}
        </Cartao>
        {f.observacao && <p className="px-1 text-suave">Observação: {f.observacao}</p>}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-bold">O que foi para o Financeiro</h2>
        {comErro ? (
          <Erro mensagem={mensagemDe(comErro.error)} tentarDeNovo={() => consultas.forEach((c) => void c.refetch())} />
        ) : consultas.some((c) => c.isLoading) ? (
          <Carregando />
        ) : lancs.length === 0 && tits.length === 0 ? (
          <p className="text-suave">Nada: o dia não teve vendas para lançar.</p>
        ) : (
          <ul className="divide-y divide-borda overflow-hidden rounded-2xl border border-borda bg-superficie">
            {lancs.map((l) => (
              <li key={l.id}>
                <Link to={`/financeiro/lancamentos/${l.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-marca-clara">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{l.descricao}</span>
                    <span className="block text-sm text-suave">Entrada em {nomeConta(l.conta_id)} · {dataBr(l.data)}</span>
                  </span>
                  <span className="shrink-0 font-bold text-ok">+ {moeda(l.valor)}</span>
                  <ChevronRight className="size-5 shrink-0 text-suave" aria-hidden />
                </Link>
              </li>
            ))}
            {tits.map((x, i) => {
              const selo = seloSituacao(situacoes[i].situacao, 'receber')
              return (
                <li key={x.id}>
                  <Link to={`/financeiro/contas/${x.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-marca-clara">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{x.descricao}</span>
                      <span className="block text-sm text-suave">
                        A receber em {nomeConta(x.conta_id)} · vence {dataBr(x.vencimento)}
                      </span>
                      <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${selo.classe}`}>{selo.texto}</span>
                    </span>
                    <span className="shrink-0 font-bold">{moeda(x.valor)}</span>
                    <ChevronRight className="size-5 shrink-0 text-suave" aria-hidden />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <Botao variante="perigo" onClick={() => setConfirmando(true)}>
        Reabrir caixa
      </Botao>

      {confirmando && (
        <Folha
          titulo="Reabrir o caixa?"
          subtitulo={dataBr(f.data)}
          aoFechar={() => setConfirmando(false)}
          rodape={
            <>
              <Botao variante="secundario" className="flex-1" onClick={() => setConfirmando(false)} disabled={desfazer.isPending}>
                Voltar
              </Botao>
              <Botao variante="perigo" className="flex-1" onClick={reabrir} disabled={desfazer.isPending}>
                {desfazer.isPending ? 'Reabrindo…' : 'Reabrir caixa'}
              </Botao>
            </>
          }
        >
          <p>
            O que este fechamento lançou no Financeiro (o dinheiro no caixa e as contas a receber) vai ser apagado, e as vendas do dia
            voltam a ficar abertas. Depois, é só fechar de novo.
          </p>
          {desfazer.isError && <Erro mensagem={mensagemDe(desfazer.error)} />}
        </Folha>
      )}
    </div>
  )
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <p className="flex items-center justify-between gap-3">
      <span className="text-suave">{rotulo}</span>
      <span className="font-semibold">{children}</span>
    </p>
  )
}
