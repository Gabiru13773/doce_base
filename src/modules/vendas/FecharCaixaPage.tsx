import { AlertTriangle, Banknote, Landmark, Settings2 } from 'lucide-react'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAviso } from '../../components/Aviso'
import { BarraAcao, Botao, Carregando, Cartao, Entrada, EntradaNumero, Erro, TituloPagina, Vazio } from '../../components/ui'
import { centavos } from '../../lib/compras'
import { novoId } from '../../lib/db'
import { lerNumero, moeda, paraCampo } from '../../lib/format'
import { dinheiroEsperado, planoFechamento, resumoDia, type ConfigPdv } from '../../lib/vendas'
import { lerMeuNome } from '../compras/api'
import { hoje as hojeFin, useCategoriasFin, useContasFin, type CategoriaFin, type ContaFin, type TipoConta } from '../financeiro/api'
import { Voltar } from '../financeiro/componentes/Comum'
import { SeletorCategoria, SeletorConta } from '../financeiro/componentes/Seletores'
import { dataBr, diaPorExtenso, mensagemDe, simplificar } from '../financeiro/util'
import { useConfigPdv, useFechamentos, useFecharCaixa, useFilaVendas, useVendasDoDia, type DadosFechamentoCaixa, type Venda } from './api'
import { FechamentoFeito } from './componentes/FechamentoFeito'
import { FechamentosRecentes, ResumoCartoes, TextoDiferenca, type TotaisFechamento } from './componentes/FechamentoResumo'
import { rotuloForma } from './componentes/ListaVendas'

// Fechamento do caixa do dia: confere a gaveta e manda os totais para o Financeiro
// (dinheiro entra no caixa; Pix, cartão e iFood viram contas a receber pelo valor líquido).
// Os pagamentos de pedidos (sinal, restante) são vendas como as outras e entram aqui no dia em que
// foram recebidos.

const DATA_OK = /^\d{4}-\d{2}-\d{2}$/

type FormaTitulo = 'pix' | 'debito' | 'credito' | 'ifood'

const PESSOA: Record<FormaTitulo, string | null> = { pix: null, debito: 'Maquininha', credito: 'Maquininha', ifood: 'iFood' }

export default function FecharCaixaPage() {
  const [params] = useSearchParams()
  const hoje = hojeFin()
  const pedida = params.get('data')
  const data = pedida && DATA_OK.test(pedida) ? pedida : hoje

  const vendas = useVendasDoDia(data)
  const config = useConfigPdv()
  const fechamentos = useFechamentos()
  const categorias = useCategoriasFin()
  const contas = useContasFin()
  const fechar = useFecharCaixa()

  const consultas = [vendas, config, fechamentos, categorias, contas]
  const comErro = consultas.find((c) => c.isError)
  const carregando = consultas.some((c) => c.isLoading)

  const fechamento = fechamentos.data?.find((f) => f.data === data)
  // Se a gravação falhou no meio, o fechamento pode já existir: continua no formulário para tentar de novo.
  const falhouAqui = fechar.isError && !!fechamento && fechar.variables?.fechamento.id === fechamento.id
  const lista = vendas.data ?? []

  let corpo: ReactNode
  if (comErro) corpo = <Erro mensagem={mensagemDe(comErro.error)} tentarDeNovo={() => consultas.forEach((c) => void c.refetch())} />
  else if (carregando || !config.data) corpo = <Carregando />
  else if (fechamento && !falhouAqui) {
    const depois = lista.filter((v) => v.status === 'concluida' && v.fechamento_id !== fechamento.id).length
    corpo = <FechamentoFeito fechamento={fechamento} hoje={hoje} vendasDepois={depois} />
  } else
    corpo = (
      <Formulario
        key={data}
        data={data}
        hoje={hoje}
        vendas={lista}
        config={config.data}
        categorias={categorias.data ?? []}
        contas={contas.data ?? []}
        fechar={fechar}
        idExistente={falhouAqui ? fechamento?.id : undefined}
      />
    )

  return (
    <>
      <Voltar padrao={`/vendas/dia?data=${data}`} />
      <TituloPagina titulo="Caixa do dia" subtitulo={diaPorExtenso(data, hoje)} />
      <div className="flex flex-col gap-8 pb-24">
        {corpo}
        <FechamentosRecentes fechamentos={fechamentos.data ?? []} hoje={hoje} atual={data} />
        {/* No celular os Ajustes não estão no menu: ficam aqui, à mão de quem fecha o caixa. */}
        <Link
          to="/vendas/ajustes"
          className="inline-flex min-h-12 items-center gap-2 self-start rounded-xl px-2 font-semibold text-suave active:bg-marca-clara"
        >
          <Settings2 className="size-5" aria-hidden />
          Ajustes do PDV
        </Link>
      </div>
    </>
  )
}

// ---- Ajudantes ------------------------------------------------------------------------------

/** A conta do ajuste do PDV (se ainda ativa) ou a única ativa do tipo pedido. */
function contaPadrao(contas: ContaFin[], doAjuste: string | null, tipo: TipoConta): string | null {
  const ativas = contas.filter((c) => c.ativo)
  if (doAjuste && ativas.some((c) => c.id === doAjuste)) return doAjuste
  const doTipo = ativas.filter((c) => c.tipo === tipo)
  return tipo === 'caixa' ? (doTipo[0]?.id ?? null) : doTipo.length === 1 ? doTipo[0].id : null
}

function categoriaPorNome(categorias: CategoriaFin[], nome: string): string | null {
  return categorias.find((c) => c.tipo === 'entrada' && c.ativo && simplificar(c.nome) === simplificar(nome))?.id ?? null
}

/** Texto vazio = 0; senão o número (NaN quando inválido). */
function lerValor(t: string): number {
  return t.trim() === '' ? 0 : lerNumero(t)
}

interface Erros {
  fundo?: string
  contado?: string
  caixa?: string
  banco?: string
}

// ---- Formulário -----------------------------------------------------------------------------

function Formulario({
  data,
  hoje,
  vendas,
  config,
  categorias,
  contas,
  fechar,
  idExistente,
}: {
  data: string
  hoje: string
  vendas: Venda[]
  config: ConfigPdv
  categorias: CategoriaFin[]
  contas: ContaFin[]
  fechar: ReturnType<typeof useFecharCaixa>
  idExistente?: string
}) {
  const avisar = useAviso()
  const fila = useFilaVendas()

  // Ids gerados uma vez por tela: tentar de novo atualiza as mesmas linhas em vez de duplicar.
  const [idFechamento] = useState(() => idExistente ?? novoId())
  const [idLancamento] = useState(() => novoId())
  const [idsTitulo] = useState<Record<FormaTitulo, string>>(() => ({ pix: novoId(), debito: novoId(), credito: novoId(), ifood: novoId() }))

  const [fundo, setFundo] = useState(() => paraCampo(config.fundo_troco))
  const [contado, setContado] = useState('')
  const [observacao, setObservacao] = useState('')
  const [contaCaixa, setContaCaixa] = useState(() => contaPadrao(contas, config.conta_caixa_id, 'caixa'))
  const [contaBanco, setContaBanco] = useState(() => contaPadrao(contas, config.conta_banco_id, 'banco'))
  const [catVendas, setCatVendas] = useState(() => categoriaPorNome(categorias, 'Vendas no balcão'))
  const [catIfood, setCatIfood] = useState(() => categoriaPorNome(categorias, 'iFood e aplicativos'))
  const [tentou, setTentou] = useState(false)

  // Só as vendas que ainda não entraram num fechamento (ou neste, numa tentativa que parou no meio).
  const abertas = useMemo(() => vendas.filter((v) => !v.fechamento_id || v.fechamento_id === idFechamento), [vendas, idFechamento])
  const concluidas = useMemo(() => abertas.filter((v) => v.status === 'concluida'), [abertas])
  const resumo = useMemo(() => resumoDia(abertas, config), [abertas, config])
  const plano = useMemo(() => planoFechamento(resumo, config, data), [resumo, config, data])

  const fundoNum = lerValor(fundo)
  const contadoNum = contado.trim() === '' ? null : lerNumero(contado)
  const esperado = dinheiroEsperado(resumo, Number.isFinite(fundoNum) ? fundoNum : 0)
  const diferenca = contadoNum != null && Number.isFinite(contadoNum) ? centavos(contadoNum - esperado) : null

  const ativas = contas.filter((c) => c.ativo)
  const caixaDoAjuste = !!config.conta_caixa_id && ativas.some((c) => c.id === config.conta_caixa_id)
  const bancoDoAjuste = !!config.conta_banco_id && ativas.some((c) => c.id === config.conta_banco_id)
  const nomeConta = (id: string | null) => contas.find((c) => c.id === id)?.nome ?? ''
  const temIfood = plano.titulos.some((t) => t.forma === 'ifood')
  const temBalcao = plano.lancamentos.length > 0 || plano.titulos.some((t) => t.forma !== 'ifood')
  const futuro = data > hoje
  const vazio = concluidas.length === 0

  const erros: Erros = {}
  if (!Number.isFinite(fundoNum) || fundoNum < 0) erros.fundo = 'Valor inválido. Ex.: 100,00'
  if (contadoNum != null && (!Number.isFinite(contadoNum) || contadoNum < 0)) erros.contado = 'Valor inválido. Ex.: 352,50'
  if (plano.lancamentos.length > 0 && !contaCaixa) erros.caixa = 'Escolha a conta do dinheiro (caixa)'
  if (plano.titulos.length > 0 && !contaBanco) erros.banco = 'Escolha o banco onde o dinheiro cai'
  const temErro = Object.keys(erros).length > 0
  const mostrar: Erros = tentou ? erros : {}

  async function aoFechar(e: FormEvent) {
    e.preventDefault()
    if (vazio) return
    setTentou(true)
    if (temErro) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    const totais: TotaisFechamento = { ...resumo, esperado, diferenca }
    const dados: DadosFechamentoCaixa = {
      fechamento: {
        id: idFechamento,
        data,
        totais: { ...totais },
        fundo_troco: centavos(fundoNum),
        dinheiro_contado: contadoNum,
        observacao: observacao.trim() || null,
        feito_por: lerMeuNome() || null,
      },
      vendas: concluidas,
      lancamentos: plano.lancamentos.map((l) => ({
        id: idLancamento,
        tipo: 'entrada',
        data: l.data,
        descricao: l.descricao,
        pessoa: null,
        categoria_id: catVendas,
        conta_id: contaCaixa as string,
        conta_destino_id: null,
        valor: l.valor,
        forma_pagamento: 'Dinheiro',
        titulo_id: null,
        ofx_fitid: null,
        ofx_conta_id: null,
        observacao: null,
      })),
      titulos: plano.titulos.map((t) => ({
        id: idsTitulo[t.forma],
        tipo: 'receber',
        descricao: t.descricao,
        pessoa: PESSOA[t.forma],
        categoria_id: t.forma === 'ifood' ? catIfood : catVendas,
        conta_id: contaBanco,
        valor: t.valor,
        emissao: data,
        vencimento: t.vencimento,
        grupo_id: null,
        parcela: null,
        nota_fiscal: null,
        observacao: `Bruto ${moeda(t.bruto)} · taxa ${moeda(t.taxa)}`,
        forma_pdv: t.forma,
      })),
    }
    try {
      await fechar.mutateAsync(dados)
      avisar({ texto: 'Caixa fechado ✓' })
    } catch {
      // O erro aparece na tela pelo estado da mutação.
    }
  }

  return (
    <form onSubmit={aoFechar} noValidate className="flex flex-col gap-8">
      {futuro && <Alerta>Este dia ainda não chegou. Confira se escolheu a data certa.</Alerta>}
      {fila.aguardando > 0 && (
        <Alerta>
          {fila.aguardando === 1 ? '1 venda deste aparelho ainda não subiu' : `${fila.aguardando} vendas deste aparelho ainda não subiram`} para
          a internet. Ao fechar, o app tenta enviar antes.
        </Alerta>
      )}
      {idExistente && <Alerta>O fechamento não terminou de gravar. Confira e toque em Fechar caixa de novo.</Alerta>}

      {vazio ? (
        <Vazio
          titulo="Nenhuma venda para fechar"
          texto={abertas.length > 0 ? 'As vendas deste dia foram canceladas.' : 'Quando houver vendas neste dia, o caixa pode ser fechado.'}
          acao={
            <Link to={`/vendas/dia?data=${data}`} className="inline-flex min-h-12 items-center rounded-2xl px-5 font-semibold text-marca active:bg-marca-clara">
              Ver vendas do dia
            </Link>
          }
        />
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold">Resumo do dia</h2>
            <ResumoCartoes resumo={resumo} />
          </section>

          {/* Gaveta */}
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-bold">Conferir a gaveta</h2>
            <div className="grid grid-cols-1 items-start gap-4 min-[420px]:grid-cols-2">
              <EntradaNumero
                rotulo="Fundo de troco"
                prefixo="R$"
                value={fundo}
                onChange={(e) => setFundo(e.target.value)}
                erro={mostrar.fundo}
                ajuda="O dinheiro que já estava na gaveta de manhã"
              />
              <EntradaNumero
                rotulo="Quanto tem na gaveta?"
                prefixo="R$"
                value={contado}
                onChange={(e) => setContado(e.target.value)}
                erro={mostrar.contado}
                ajuda="Conte tudo, com o fundo de troco"
              />
            </div>
            <Cartao className="flex flex-col gap-1">
              <Linha rotulo="Fundo de troco">{moeda(Number.isFinite(fundoNum) ? fundoNum : 0)}</Linha>
              <Linha rotulo="Vendas em dinheiro">+ {moeda(resumo.porForma.dinheiro)}</Linha>
              <Linha rotulo="Devia ter na gaveta" forte>
                {moeda(esperado)}
              </Linha>
              {diferenca != null && (
                <Linha rotulo="Diferença" forte>
                  <TextoDiferenca valor={diferenca} />
                </Linha>
              )}
            </Cartao>
          </section>

          {/* Financeiro */}
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-bold">O que vai para o Financeiro</h2>
            {ativas.length === 0 ? (
              <Cartao className="flex flex-col gap-3">
                <p>Para mandar as vendas para o Financeiro, cadastre as contas: o caixa (dinheiro) e o banco onde caem o Pix e o cartão.</p>
                <Link
                  to="/financeiro/bancos/nova"
                  className="flex min-h-12 items-center justify-center rounded-2xl bg-marca px-5 font-semibold text-white shadow-sm active:bg-marca-escura"
                >
                  Cadastrar conta
                </Link>
                {(mostrar.caixa || mostrar.banco) && (
                  <p className="text-sm font-medium text-perigo" tabIndex={-1} aria-invalid="true">
                    Sem conta cadastrada não dá para fechar o caixa.
                  </p>
                )}
              </Cartao>
            ) : (
              <>
                {plano.lancamentos.map((l) => (
                  <Cartao key="dinheiro" className="flex flex-col gap-3">
                    <div className="flex items-start gap-3">
                      <Banknote className="mt-0.5 size-6 shrink-0 text-ok" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">Dinheiro: entra no caixa hoje</p>
                        <p className="text-sm text-suave">{l.descricao}</p>
                        {caixaDoAjuste && <p className="text-sm text-suave">Na conta {nomeConta(contaCaixa)}</p>}
                      </div>
                      <span className="shrink-0 font-bold text-ok">+ {moeda(l.valor)}</span>
                    </div>
                    {!caixaDoAjuste && (
                      <SeletorConta rotulo="Em qual conta?" contas={contas} valor={contaCaixa} aoMudar={setContaCaixa} erro={mostrar.caixa} />
                    )}
                  </Cartao>
                ))}

                {plano.titulos.length > 0 && (
                  <Cartao className="flex flex-col gap-3">
                    <div className="flex items-start gap-3">
                      <Landmark className="mt-0.5 size-6 shrink-0 text-marca" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">Contas a receber</p>
                        <p className="text-sm text-suave">
                          O que cai no banco depois, já sem a taxa. Ao importar o extrato, o crédito do banco dá baixa nelas.
                          {bancoDoAjuste && ` Banco: ${nomeConta(contaBanco)}.`}
                        </p>
                      </div>
                    </div>
                    <ul className="divide-y divide-borda rounded-2xl border border-borda">
                      {plano.titulos.map((t) => (
                        <li key={t.forma} className="flex items-start gap-3 px-3 py-2">
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold">{rotuloForma(t.forma)}</span>
                            <span className="block text-sm text-suave">
                              {moeda(t.bruto)}
                              {t.taxa > 0 && ` − taxa ${moeda(t.taxa)}`} · cai em {dataBr(t.vencimento)}
                            </span>
                          </span>
                          <span className="shrink-0 font-bold">{moeda(t.valor)}</span>
                        </li>
                      ))}
                    </ul>
                    {!bancoDoAjuste && (
                      <SeletorConta
                        rotulo="Em qual banco cai?"
                        contas={contas}
                        valor={contaBanco}
                        aoMudar={setContaBanco}
                        erro={mostrar.banco}
                      />
                    )}
                  </Cartao>
                )}

                {temBalcao && (
                  <SeletorCategoria tipo="entrada" rotulo="Categoria das vendas" categorias={categorias} valor={catVendas} aoMudar={setCatVendas} />
                )}
                {temIfood && (
                  <SeletorCategoria tipo="entrada" rotulo="Categoria do iFood" categorias={categorias} valor={catIfood} aoMudar={setCatIfood} />
                )}
                {(!caixaDoAjuste || !bancoDoAjuste) && (
                  <p className="text-sm text-suave">
                    Dica: escolha as contas em{' '}
                    <Link to="/vendas/ajustes" className="font-semibold text-marca underline">
                      Ajustes do caixa
                    </Link>{' '}
                    para não precisar escolher todo dia.
                  </p>
                )}
              </>
            )}
          </section>

          <Entrada rotulo="Observação (opcional)" value={observacao} onChange={(e) => setObservacao(e.target.value)} />

          {fechar.isError && <Erro mensagem={mensagemDe(fechar.error)} />}

          <BarraAcao>
            <Botao type="submit" className="flex-1" disabled={fechar.isPending}>
              {fechar.isPending ? 'Fechando…' : 'Fechar caixa do dia'}
            </Botao>
          </BarraAcao>
        </>
      )}
    </form>
  )
}

function Alerta({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-2xl bg-alerta-claro px-4 py-3 text-[15px]">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-alerta" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

function Linha({ rotulo, children, forte }: { rotulo: string; children: ReactNode; forte?: boolean }) {
  return (
    <p className={`flex items-center justify-between gap-3 ${forte ? 'font-bold' : ''}`}>
      <span className={forte ? '' : 'text-suave'}>{rotulo}</span>
      <span className="font-semibold">{children}</span>
    </p>
  )
}
