import { ChevronRight } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { BarraAcao, Botao, Carregando, Erro, TituloPagina, Vazio } from '../../components/ui'
import { saldoConta } from '../../lib/financeiro'
import { moeda } from '../../lib/format'
import { TIPOS_CONTA, hoje, useContasFin, useLancamentos, type ContaFin, type Lancamento } from './api'
import { mensagemDe } from './util'

export default function ContasBancariasPage() {
  const navegar = useNavigate()
  const contas = useContasFin()
  const lancamentos = useLancamentos()

  const carregando = contas.isLoading || lancamentos.isLoading
  const erro = contas.error ?? lancamentos.error
  const lista = contas.data ?? []
  const ativas = lista.filter((c) => c.ativo)
  const desativadas = lista.filter((c) => !c.ativo)

  return (
    <>
      <TituloPagina titulo="Contas bancárias" subtitulo="Onde o dinheiro fica: bancos, caixa e carteiras" />

      {carregando ? (
        <Carregando />
      ) : erro ? (
        <Erro
          mensagem={mensagemDe(erro)}
          tentarDeNovo={() => {
            void contas.refetch()
            void lancamentos.refetch()
          }}
        />
      ) : lista.length === 0 ? (
        <Vazio
          titulo="Nenhuma conta ainda"
          texto="Cadastre a conta do banco (ex.: Nubank) e o dinheiro da gaveta (ex.: Caixa da loja)."
          acao={<Botao onClick={() => navegar('/financeiro/bancos/nova')}>Cadastrar a primeira</Botao>}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <Lista contas={ativas} lancamentos={lancamentos.data ?? []} />
          {desativadas.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-lg font-bold">Desativadas</h2>
              <Lista contas={desativadas} lancamentos={lancamentos.data ?? []} />
            </section>
          )}
        </div>
      )}

      <BarraAcao>
        <Botao className="flex-1" onClick={() => navegar('/financeiro/bancos/nova')}>
          + Nova conta
        </Botao>
      </BarraAcao>
    </>
  )
}

function Lista({ contas, lancamentos }: { contas: ContaFin[]; lancamentos: Lancamento[] }) {
  const dia = hoje()
  return (
    <ul className="flex flex-col gap-2">
      {contas.map((c) => {
        // saldo de hoje: lançamentos com data futura (agendados) ainda não contam
        const saldo = saldoConta(c, lancamentos, dia)
        return (
          <li key={c.id}>
            <Link
              to={`/financeiro/bancos/${c.id}`}
              className={`flex min-h-16 items-center gap-3 rounded-2xl border border-borda bg-superficie px-4 py-3 active:bg-marca-clara ${c.ativo ? '' : 'opacity-70'}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{c.nome}</span>
                <span className="block truncate text-sm text-suave">{TIPOS_CONTA.find((t) => t.valor === c.tipo)?.rotulo}</span>
              </span>
              <span className={`shrink-0 font-bold ${saldo < 0 ? 'text-perigo' : ''}`}>{moeda(saldo)}</span>
              <ChevronRight className="size-5 shrink-0 text-suave" aria-hidden />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
