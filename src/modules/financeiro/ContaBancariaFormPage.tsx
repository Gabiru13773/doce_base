import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAviso } from '../../components/Aviso'
import { BarraAcao, Botao, Carregando, Cartao, Entrada, EntradaNumero, Erro, Pilulas, TituloPagina, Vazio } from '../../components/ui'
import { saldoConta } from '../../lib/financeiro'
import { lerNumero, moeda, paraCampo } from '../../lib/format'
import { TIPOS_CONTA, hoje, useContasFin, useLancamentos, useSalvarContaFin, type ContaFin, type TipoConta } from './api'
import { Interruptor, Voltar } from './componentes/Comum'
import { mensagemDe, simplificar, useVoltar } from './util'

const VOLTAR_PADRAO = '/financeiro/bancos'

export default function ContaBancariaFormPage() {
  const { id } = useParams()
  const contas = useContasFin()

  if (contas.isLoading) return <Carregando />
  if (contas.isError) return <Erro mensagem={mensagemDe(contas.error)} tentarDeNovo={() => void contas.refetch()} />

  const lista = contas.data ?? []
  if (!id) return <Formulario contas={lista} />

  const original = lista.find((c) => c.id === id)
  if (!original) {
    return (
      <>
        <Voltar padrao={VOLTAR_PADRAO} />
        <Vazio
          titulo="Conta não encontrada"
          acao={
            <Link to={VOLTAR_PADRAO} className="inline-flex min-h-12 items-center rounded-2xl px-5 font-semibold text-marca active:bg-marca-clara">
              Ver todas as contas
            </Link>
          }
        />
      </>
    )
  }
  return <Formulario key={original.id} original={original} contas={lista} />
}

interface Erros {
  nome?: string
  saldo?: string
  data?: string
}

function Formulario({ original, contas }: { original?: ContaFin; contas: ContaFin[] }) {
  const voltar = useVoltar(VOLTAR_PADRAO)
  const avisar = useAviso()
  const salvar = useSalvarContaFin()
  const lancamentos = useLancamentos()

  const [nome, setNome] = useState(original?.nome ?? '')
  const [tipo, setTipo] = useState<TipoConta>(original?.tipo ?? 'banco')
  const [saldo, setSaldo] = useState(original ? paraCampo(original.saldo_inicial) : '')
  const [saldoEm, setSaldoEm] = useState(original?.saldo_em ?? hoje())
  const [ativo, setAtivo] = useState(original?.ativo ?? true)
  const [tentou, setTentou] = useState(false)

  const saldoNum = saldo.trim() ? lerNumero(saldo) : 0
  const erros: Erros = {}
  if (!nome.trim()) erros.nome = 'Dê um nome para a conta'
  else if (contas.some((c) => c.id !== original?.id && simplificar(c.nome) === simplificar(nome)))
    erros.nome = 'Já existe uma conta com esse nome'
  if (!Number.isFinite(saldoNum)) erros.saldo = 'Valor inválido. Ex.: 1.250,00 ou -80,00'
  if (!saldoEm) erros.data = 'Informe a data'
  const temErro = Object.keys(erros).length > 0
  const mostrar: Erros = tentou ? erros : {}

  async function aoSalvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (temErro) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    try {
      await salvar.mutateAsync({ id: original?.id, nome, tipo, saldo_inicial: saldoNum, saldo_em: saldoEm, ativo })
      avisar({ texto: 'Conta salva ✓' })
      voltar()
    } catch {
      // O erro aparece na tela pelo estado da mutação.
    }
  }

  const saldoAtual = original && lancamentos.data ? saldoConta(original, lancamentos.data) : null

  return (
    <form onSubmit={aoSalvar} noValidate>
      <Voltar padrao={VOLTAR_PADRAO} />
      <TituloPagina titulo={original ? original.nome : 'Nova conta'} />

      <div className="flex flex-col gap-6">
        {saldoAtual !== null && original && (
          <Cartao className="flex flex-wrap items-center justify-between gap-3">
            <span>
              <span className="block text-suave">Saldo hoje</span>
              <span className={`text-2xl font-bold ${saldoAtual < 0 ? 'text-perigo' : ''}`}>{moeda(saldoAtual)}</span>
            </span>
            <Link
              to={`/financeiro/extrato?conta=${original.id}`}
              className="inline-flex min-h-11 items-center rounded-xl px-3 font-semibold text-marca active:bg-marca-clara"
            >
              Ver extrato
            </Link>
          </Cartao>
        )}

        <Entrada
          rotulo="Nome"
          placeholder="Ex.: Nubank, Caixa da loja"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          erro={mostrar.nome}
          autoFocus={!original}
          autoCapitalize="words"
        />

        <div className="flex flex-col gap-1.5">
          <p className="font-semibold">Tipo</p>
          <Pilulas rotulo="Tipo de conta" valor={tipo} aoMudar={setTipo} opcoes={TIPOS_CONTA} />
        </div>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 text-lg font-bold">Saldo para começar</legend>
          <EntradaNumero
            rotulo="Saldo inicial"
            prefixo="R$"
            placeholder="0,00"
            value={saldo}
            onChange={(e) => setSaldo(e.target.value)}
            erro={mostrar.saldo}
            ajuda="Se estava no vermelho, use o sinal de menos (ex.: -80,00)."
          />
          <Entrada
            rotulo="Saldo em"
            type="date"
            value={saldoEm}
            onChange={(e) => setSaldoEm(e.target.value)}
            erro={mostrar.data}
            ajuda="O saldo que aparecia no banco nesse dia. Lançamentos de antes dessa data não mudam o saldo."
          />
        </fieldset>

        {original && (
          <Interruptor
            ligado={ativo}
            aoMudar={setAtivo}
            rotulo={ativo ? 'Conta em uso' : 'Conta desativada'}
            texto="Desligue se não usa mais esta conta. Ela some das listas, mas os lançamentos antigos continuam."
          />
        )}

        {salvar.isError && <Erro mensagem={mensagemDe(salvar.error)} />}
      </div>

      <BarraAcao>
        <Botao type="submit" className="flex-1" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </Botao>
      </BarraAcao>
    </form>
  )
}
