import { ChevronRight, FileUp, Landmark, PlusCircle } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Carregando, Cartao, Erro, TituloPagina } from '../../components/ui'
import { baixasPorTitulo, saldoConta, situacaoTitulo, somarDias } from '../../lib/financeiro'
import { moeda } from '../../lib/format'
import { TIPOS_CONTA, hoje, useContasFin, useLancamentos, useTitulos, type ContaFin, type Lancamento, type TipoTitulo, type Titulo } from './api'
import { mensagemDe, nomeMes } from './util'

const classeBotao =
  'flex min-h-14 items-center justify-center gap-2 rounded-2xl px-5 text-center font-semibold shadow-sm'

export default function ResumoPage() {
  const contas = useContasFin()
  const lancamentos = useLancamentos()

  const carregando = contas.isLoading || lancamentos.isLoading
  const erro = contas.error ?? lancamentos.error

  return (
    <>
      <TituloPagina titulo="Financeiro" subtitulo="O caixa da confeitaria, sem complicação." />
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
      ) : (contas.data ?? []).length === 0 ? (
        <PrimeiroUso />
      ) : (
        <Painel contas={contas.data ?? []} lancamentos={lancamentos.data ?? []} />
      )}
    </>
  )
}

function PrimeiroUso() {
  return (
    <Cartao className="flex flex-col gap-4 border-marca/20 bg-marca-clara">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-superficie text-marca">
        <Landmark className="size-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold text-marca-escura">Comece cadastrando onde fica o dinheiro</h2>
        <p>
          Pode ser a conta do banco (ex.: <strong>Nubank</strong>) e o dinheiro da gaveta (ex.: <strong>Caixa da loja</strong>).
          Depois é só anotar o que entra e o que sai.
        </p>
      </div>
      <Link to="/financeiro/bancos/nova" className={`${classeBotao} bg-marca text-white active:bg-marca-escura`}>
        Cadastrar a primeira conta
      </Link>
    </Cartao>
  )
}

function Painel({ contas, lancamentos }: { contas: ContaFin[]; lancamentos: Lancamento[] }) {
  const ativas = contas.filter((c) => c.ativo)
  // Saldo de hoje: lançamentos com data futura (agendados) ainda não contam; aparecem como "previsto".
  const dia = hoje()
  const saldos = ativas.map((c) => ({ conta: c, saldo: saldoConta(c, lancamentos, dia), previsto: saldoConta(c, lancamentos) }))
  const total = Math.round(saldos.reduce((s, x) => s + x.saldo, 0) * 100) / 100
  const totalPrevisto = Math.round(saldos.reduce((s, x) => s + x.previsto, 0) * 100) / 100

  const mes = hoje().slice(0, 7)
  const doMes = lancamentos.filter((l) => l.data.startsWith(mes))
  const entradas = doMes.filter((l) => l.tipo === 'entrada').reduce((s, l) => s + l.valor, 0)
  const saidas = doMes.filter((l) => l.tipo === 'saida').reduce((s, l) => s + l.valor, 0)
  const resultado = Math.round((entradas - saidas) * 100) / 100

  return (
    <div className="flex flex-col gap-6">
      {/* Saldo */}
      <section aria-labelledby="t-saldo" className="flex flex-col gap-2">
        <Cartao className="flex flex-col gap-1">
          <h2 id="t-saldo" className="text-suave">
            Saldo total hoje
          </h2>
          <p className={`text-3xl font-bold ${total < 0 ? 'text-perigo' : 'text-tinta'}`}>{moeda(total)}</p>
          {totalPrevisto !== total && (
            <p className="text-sm text-suave">Previsto com os lançamentos de datas futuras: {moeda(totalPrevisto)}</p>
          )}
        </Cartao>
        <ul className="flex flex-col gap-2">
          {saldos.map(({ conta, saldo, previsto }) => (
            <li key={conta.id}>
              <Link
                to={`/financeiro/extrato?conta=${conta.id}`}
                className="flex min-h-14 items-center gap-3 rounded-2xl border border-borda bg-superficie px-4 py-3 active:bg-marca-clara"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{conta.nome}</span>
                  <span className="block truncate text-sm text-suave">{TIPOS_CONTA.find((t) => t.valor === conta.tipo)?.rotulo}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={`block font-bold ${saldo < 0 ? 'text-perigo' : ''}`}>{moeda(saldo)}</span>
                  {previsto !== saldo && <span className="block text-sm text-suave">previsto {moeda(previsto)}</span>}
                </span>
                <ChevronRight className="size-5 shrink-0 text-suave" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
        <Link to="/financeiro/bancos" className="self-start rounded-xl px-2 py-2.5 font-semibold text-marca active:bg-marca-clara">
          Cadastrar ou mudar contas
        </Link>
      </section>

      {/* Ações principais */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link to="/financeiro/lancar" className={`${classeBotao} bg-marca text-white active:bg-marca-escura`}>
          <PlusCircle className="size-5 shrink-0" aria-hidden />
          Lançar entrada ou saída
        </Link>
        <Link to="/financeiro/importar" className={`${classeBotao} border border-borda bg-superficie text-marca active:bg-marca-clara`}>
          <FileUp className="size-5 shrink-0" aria-hidden />
          Importar extrato (OFX)
        </Link>
      </div>

      <Vencimentos lancamentos={lancamentos} />

      {/* Mês atual */}
      <section aria-labelledby="t-mes" className="flex flex-col gap-2">
        <h2 id="t-mes" className="text-lg font-bold first-letter:uppercase">
          {nomeMes(mes)}
        </h2>
        <Cartao className="flex flex-col divide-y divide-borda py-1">
          <Linha rotulo="Entrou" valor={moeda(entradas)} cor="text-ok" />
          <Linha rotulo="Saiu" valor={moeda(saidas)} cor="text-perigo" />
          <Linha
            rotulo={resultado >= 0 ? 'Sobrou' : 'Faltou'}
            valor={moeda(Math.abs(resultado))}
            cor={resultado >= 0 ? 'text-ok' : 'text-perigo'}
            forte
          />
        </Cartao>
        <p className="text-sm text-suave">Transferências entre suas contas não entram nessa conta.</p>
        <Link to="/financeiro/extrato" className="self-start rounded-xl px-2 py-2.5 font-semibold text-marca active:bg-marca-clara">
          Ver todos os lançamentos do mês
        </Link>
      </section>
    </div>
  )
}

function Linha({ rotulo, valor, cor, forte }: { rotulo: string; valor: string; cor: string; forte?: boolean }) {
  return (
    <p className={`flex min-h-11 items-center justify-between gap-3 ${forte ? 'text-lg font-bold' : ''}`}>
      <span>{rotulo}</span>
      <span className={`font-bold ${cor}`}>{valor}</span>
    </p>
  )
}

interface Soma {
  qtd: number
  total: number
}
type Faixas = Record<'atrasado' | 'hoje' | 'semana', Soma>

const vazio = (): Faixas => ({ atrasado: { qtd: 0, total: 0 }, hoje: { qtd: 0, total: 0 }, semana: { qtd: 0, total: 0 } })

function resumirTitulos(titulos: Titulo[], lancamentos: Lancamento[]): Record<TipoTitulo, Faixas> {
  const dia = hoje()
  const limite = somarDias(dia, 7)
  const baixas = baixasPorTitulo(lancamentos, titulos)
  const r: Record<TipoTitulo, Faixas> = { pagar: vazio(), receber: vazio() }
  for (const t of titulos) {
    const s = situacaoTitulo(t, baixas, dia)
    if (s.situacao === 'pago') continue
    const faixa = s.situacao === 'atrasado' ? 'atrasado' : s.situacao === 'vence_hoje' ? 'hoje' : t.vencimento <= limite ? 'semana' : null
    if (!faixa) continue
    r[t.tipo][faixa].qtd += 1
    r[t.tipo][faixa].total += s.falta
  }
  return r
}

function Vencimentos({ lancamentos }: { lancamentos: Lancamento[] }) {
  const titulos = useTitulos()
  const resumo = useMemo(() => resumirTitulos(titulos.data ?? [], lancamentos), [titulos.data, lancamentos])
  if (titulos.isLoading || titulos.isError) return null

  const nada = (['pagar', 'receber'] as const).every((t) => Object.values(resumo[t]).every((f) => f.qtd === 0))

  return (
    <section aria-labelledby="t-venc" className="flex flex-col gap-2">
      <h2 id="t-venc" className="text-lg font-bold">
        Para hoje e atrasadas
      </h2>
      {nada ? (
        <Cartao>
          <p className="text-suave">Nenhuma conta a pagar ou a receber vencida ou vencendo nos próximos 7 dias.</p>
        </Cartao>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <BlocoVenc titulo="A pagar" faixas={resumo.pagar} />
          <BlocoVenc titulo="A receber" faixas={resumo.receber} />
        </div>
      )}
      <Link to="/financeiro/contas" className="self-start rounded-xl px-2 py-2.5 font-semibold text-marca active:bg-marca-clara">
        Ver contas a pagar e receber
      </Link>
    </section>
  )
}

function BlocoVenc({ titulo, faixas }: { titulo: string; faixas: Faixas }) {
  const linhas: { chave: keyof Faixas; rotulo: string; cor: string }[] = [
    { chave: 'atrasado', rotulo: 'Atrasadas', cor: 'text-perigo' },
    { chave: 'hoje', rotulo: 'Vencem hoje', cor: 'text-alerta' },
    { chave: 'semana', rotulo: 'Próximos 7 dias', cor: 'text-tinta' },
  ]
  return (
    <Link to="/financeiro/contas" className="flex flex-col gap-1 rounded-2xl border border-borda bg-superficie p-4 active:bg-marca-clara">
      <span className="font-bold">{titulo}</span>
      {linhas.map(({ chave, rotulo, cor }) => {
        const f = faixas[chave]
        return (
          <span key={chave} className="flex min-h-9 items-center justify-between gap-3">
            <span className={f.qtd ? '' : 'text-suave'}>
              {rotulo} {f.qtd > 0 && <span className="text-suave">({f.qtd})</span>}
            </span>
            <span className={`font-semibold ${f.qtd ? cor : 'text-suave'}`}>{f.qtd ? moeda(f.total) : '—'}</span>
          </span>
        )
      })}
    </Link>
  )
}
