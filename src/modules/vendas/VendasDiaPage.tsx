import { CloudUpload, Lock } from 'lucide-react'
import { AvisoVendasPerdidas } from './componentes/AvisoVendasPerdidas'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BarraAcao, Carregando, Erro, TituloPagina, Vazio } from '../../components/ui'
import { resumoDia } from '../../lib/vendas'
import { hoje as hojeFin } from '../financeiro/api'
import { diaPorExtenso, mensagemDe } from '../financeiro/util'
import { useConfigPdv, useFechamentos, useFilaVendas, useVendasDoDia } from './api'
import { ListaVendas, SeletorDia } from './componentes/ListaVendas'
import { DetalheVenda } from './componentes/ListaVendasDetalhe'
import { ResumoCartoes, StatusCaixa } from './componentes/FechamentoResumo'

// Vendas de um dia: resumo, situação do caixa e a lista (toque para ver detalhes ou cancelar).

const DATA_OK = /^\d{4}-\d{2}-\d{2}$/

export default function VendasDiaPage() {
  const [params, setParams] = useSearchParams()
  const hoje = hojeFin()
  const pedida = params.get('data')
  const data = pedida && DATA_OK.test(pedida) ? pedida : hoje
  const [abertaId, setAbertaId] = useState<string | null>(null)

  const vendas = useVendasDoDia(data)
  const config = useConfigPdv()
  const fechamentos = useFechamentos()
  const fila = useFilaVendas()

  function mudarDia(d: string) {
    const p = new URLSearchParams(params)
    if (d === hoje) p.delete('data')
    else p.set('data', d)
    setParams(p, { replace: true })
    setAbertaId(null)
  }

  const lista = useMemo(() => vendas.data ?? [], [vendas.data])
  const resumo = useMemo(() => (config.data ? resumoDia(lista, config.data) : null), [lista, config.data])
  const fechamento = fechamentos.data?.find((f) => f.data === data)
  const foraDoFechamento = fechamento ? lista.filter((v) => v.status === 'concluida' && v.fechamento_id !== fechamento.id).length : 0
  const aberta = abertaId ? lista.find((v) => v.id === abertaId) : undefined

  const consultas = [vendas, config, fechamentos]
  const comErro = consultas.find((c) => c.isError)

  return (
    <>
      <TituloPagina titulo="Vendas do dia" subtitulo={diaPorExtenso(data, hoje)} />
      <div className="flex flex-col gap-5 pb-24">
        <SeletorDia data={data} hoje={hoje} aoMudar={mudarDia} />
        <AvisoVendasPerdidas />

        {fila.aguardando > 0 && (
          <p className="flex items-start gap-2 rounded-2xl bg-alerta-claro px-4 py-3 text-[15px]">
            <CloudUpload className="mt-0.5 size-5 shrink-0 text-alerta" aria-hidden />
            <span>
              {fila.aguardando === 1 ? '1 venda deste aparelho ainda não subiu' : `${fila.aguardando} vendas deste aparelho ainda não subiram`}{' '}
              para a internet. Elas já aparecem aqui e sobem sozinhas.
              {fila.erro && <span className="block text-sm text-suave">Último erro: {fila.erro}</span>}
            </span>
          </p>
        )}

        {comErro ? (
          <Erro mensagem={mensagemDe(comErro.error)} tentarDeNovo={() => consultas.forEach((c) => void c.refetch())} />
        ) : consultas.some((c) => c.isLoading) || !resumo ? (
          <Carregando />
        ) : (
          <>
            <StatusCaixa fechamento={fechamento} />
            {foraDoFechamento > 0 && (
              <p className="rounded-2xl bg-alerta-claro px-4 py-3 text-[15px]">
                {foraDoFechamento === 1 ? '1 venda foi feita' : `${foraDoFechamento} vendas foram feitas`} depois do fechamento e não
                {foraDoFechamento === 1 ? ' entrou' : ' entraram'} no Financeiro. Reabra o caixa e feche de novo para incluir.
              </p>
            )}
            <ResumoCartoes resumo={resumo} />

            <section className="flex flex-col gap-2">
              <h2 className="text-lg font-bold">Vendas</h2>
              {lista.length === 0 ? (
                <Vazio titulo="Nenhuma venda neste dia" texto="As vendas feitas no balcão aparecem aqui." />
              ) : (
                <ListaVendas vendas={lista} aoAbrir={(v) => setAbertaId(v.id)} />
              )}
            </section>
          </>
        )}
      </div>

      <BarraAcao>
        <Link
          to={`/vendas/caixa?data=${data}`}
          className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-marca px-5 font-semibold text-white shadow-sm active:bg-marca-escura"
        >
          <Lock className="size-5" aria-hidden />
          {fechamento ? 'Ver fechamento do caixa' : 'Fechar caixa'}
        </Link>
      </BarraAcao>

      {aberta && <DetalheVenda key={aberta.id} venda={aberta} aoFechar={() => setAbertaId(null)} />}
    </>
  )
}
