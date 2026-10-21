import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2 } from 'lucide-react'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAviso } from '../../components/Aviso'
import { BarraAcao, Botao, Carregando, Cartao, Entrada, EntradaNumero, Erro, Pilulas, Selecao, TituloPagina, Vazio } from '../../components/ui'
import { historicoDaCompra, insumoComprado, levou, mudancasDeCusto, resumoCompra, totalItem, type MudancaCusto } from '../../lib/compras'
import { novoId } from '../../lib/db'
import { parcelar } from '../../lib/financeiro'
import { lerNumero, moeda, numero, paraCampo, pct } from '../../lib/format'
import type { UnidadeCompra } from '../../lib/unidades'
import { FORMAS_PAGAMENTO, useCategoriasFin, useContasFin, type CategoriaFin, type ContaFin, type DadosLancamento, type DadosTitulo } from '../financeiro/api'
import { Interruptor, Voltar } from '../financeiro/componentes/Comum'
import { SeletorCategoria, SeletorConta } from '../financeiro/componentes/Seletores'
import { dataBr, gravarUltimaConta, lerUltimaConta, mensagemDe, simplificar } from '../financeiro/util'
import { useInsumos, type Insumo } from '../insumos/api'
import { useCompras, useFilaCompra, useFinalizarCompra, useItensCompra, type Compra, type DadosItemCompra } from './api'

// Finalizar a compra: confere o carrinho, manda os preços para o histórico dos insumos,
// atualiza o custo (se a pessoa quiser) e lança no Financeiro (pago agora ou a pagar).

type Modo = 'agora' | 'depois'

const MAX_PARCELAS = 12

const linkClasse = 'inline-flex min-h-12 items-center rounded-2xl px-5 font-semibold text-marca active:bg-marca-clara'

export default function FinalizarCompraPage() {
  const { id } = useParams()
  const compras = useCompras()
  const itens = useItensCompra(id)
  const insumos = useInsumos()
  const categorias = useCategoriasFin()
  const contas = useContasFin()

  const consultas = [compras, itens, insumos, categorias, contas]
  if (consultas.some((c) => c.isLoading)) return <Carregando />
  const comErro = consultas.find((c) => c.isError)
  if (comErro) return <Erro mensagem={mensagemDe(comErro.error)} tentarDeNovo={() => consultas.forEach((c) => void c.refetch())} />

  const compra = compras.data?.find((c) => c.id === id)
  if (!compra) {
    return (
      <>
        <Voltar padrao="/compras" />
        <Vazio
          titulo="Compra não encontrada"
          texto="Ela pode ter sido apagada."
          acao={
            <Link to="/compras" className={linkClasse}>
              Ver compras
            </Link>
          }
        />
      </>
    )
  }

  if (compra.status === 'finalizada') {
    return (
      <>
        <Voltar padrao={`/compras/${compra.id}`} />
        <TituloPagina titulo="Finalizar compra" subtitulo={compra.nome} />
        <Vazio
          titulo="Esta compra já foi finalizada"
          texto={compra.total != null ? `Total pago: ${moeda(compra.total)}` : undefined}
          acao={
            <Link to={`/compras/${compra.id}`} className={linkClasse}>
              Ver a compra
            </Link>
          }
        />
      </>
    )
  }

  const lista = itens.data ?? []
  if (!lista.some(levou)) {
    return (
      <>
        <Voltar padrao={`/compras/${compra.id}`} />
        <TituloPagina titulo="Finalizar compra" subtitulo={compra.nome} />
        <Vazio
          titulo="Nada no carrinho"
          texto="Marque o que pegou (Peguei ou Trocar) antes de finalizar."
          acao={
            <Link to={`/compras/${compra.id}`} className={linkClasse}>
              Voltar para a lista
            </Link>
          }
        />
      </>
    )
  }

  return (
    <Formulario
      key={compra.id}
      compra={compra}
      itens={lista}
      insumos={insumos.data ?? []}
      categorias={categorias.data ?? []}
      contas={contas.data ?? []}
    />
  )
}

// ---- Ajudantes ------------------------------------------------------------------------------

const NOME_UNIDADE: Record<UnidadeCompra, [string, string]> = {
  g: ['g', 'g'],
  kg: ['kg', 'kg'],
  ml: ['ml', 'ml'],
  l: ['L', 'L'],
  un: ['unidade', 'unidades'],
  dz: ['dúzia', 'dúzias'],
}

/** 1 kg, 500 g, 12 unidades */
function textoEmbalagem(qtd: number, unidade: UnidadeCompra) {
  const [um, varios] = NOME_UNIDADE[unidade] ?? [unidade, unidade]
  return `${numero(qtd, 3)} ${qtd === 1 ? um : varios}`
}

/** Conta que já vem escolhida: a última usada (se ainda ativa) ou a única que existe. */
function contaPadrao(contas: ContaFin[]): string | null {
  const ativas = contas.filter((c) => c.ativo)
  const ultima = lerUltimaConta()
  if (ultima && ativas.some((c) => c.id === ultima)) return ultima
  return ativas.length === 1 ? ativas[0].id : null
}

/** "Embalagens" quando tudo no carrinho é embalagem; senão "Ingredientes e insumos" (se existirem). */
function categoriaPadrao(categorias: CategoriaFin[], soEmbalagem: boolean): string | null {
  const saidas = categorias.filter((c) => c.tipo === 'saida' && c.ativo)
  const achar = (nome: string) => saidas.find((c) => simplificar(c.nome) === simplificar(nome))?.id
  return (soEmbalagem ? achar('Embalagens') : undefined) ?? achar('Ingredientes e insumos') ?? null
}

interface Erros {
  total?: string
  conta?: string
  vencimento?: string
  parcelas?: string
}

// ---- Formulário -----------------------------------------------------------------------------

function Formulario({
  compra,
  itens,
  insumos,
  categorias,
  contas,
}: {
  compra: Compra
  itens: DadosItemCompra[]
  insumos: Insumo[]
  categorias: CategoriaFin[]
  contas: ContaFin[]
}) {
  const navegar = useNavigate()
  const avisar = useAviso()
  const finalizar = useFinalizarCompra()
  const fila = useFilaCompra(compra.id)

  const resumo = useMemo(() => resumoCompra(itens), [itens])
  const carrinho = useMemo(() => itens.filter(levou), [itens])
  const linhasHistorico = useMemo(() => historicoDaCompra(itens), [itens])
  const mudancas = useMemo(() => mudancasDeCusto(linhasHistorico, insumos), [linhasHistorico, insumos])

  // Ids gerados uma vez por tela: tentar de novo depois de uma falha no meio atualiza as mesmas
  // linhas em vez de duplicar (a gravação é por id).
  const [idsHistorico] = useState(() => new Map<string, string>())
  const [idLancamento] = useState(() => novoId())
  const [idsParcelas] = useState(() => Array.from({ length: MAX_PARCELAS }, () => novoId()))
  const [idGrupo] = useState(() => novoId())

  const [total, setTotal] = useState(() => paraCampo(resumo.total))
  const [naoAtualizar, setNaoAtualizar] = useState<Set<string>>(() => new Set())
  const [lancar, setLancar] = useState(true)
  const [modo, setModo] = useState<Modo>('agora')
  const [categoriaId, setCategoriaId] = useState<string | null>(() => {
    const ids = carrinho.map(insumoComprado)
    const soEmbalagem =
      ids.length > 0 && ids.every((i) => !!i && insumos.find((x) => x.id === i)?.categoria === 'embalagem')
    return categoriaPadrao(categorias, soEmbalagem)
  })
  const [contaId, setContaId] = useState<string | null>(() => contaPadrao(contas))
  const [forma, setForma] = useState<string | null>(null)
  const [data, setData] = useState(compra.data)
  const [vencimento, setVencimento] = useState('')
  const [vezes, setVezes] = useState('1')
  const [contaTitulo, setContaTitulo] = useState<string | null>(null)
  const [notaFiscal, setNotaFiscal] = useState('')
  const [tentou, setTentou] = useState(false)

  const temContas = contas.some((c) => c.ativo)
  const totalNum = lerNumero(total)
  const vezesNum = Number(vezes)
  const diferenca = Number.isFinite(totalNum) ? Math.round((totalNum - resumo.total) * 100) / 100 : 0

  const erros: Erros = {}
  if (!Number.isFinite(totalNum) || totalNum < 0) erros.total = total.trim() ? 'Valor inválido. Ex.: 120,50' : 'Informe o total pago'
  else if (lancar && !(totalNum > 0)) erros.total = 'Para lançar no Financeiro, o total precisa ser maior que zero'
  if (lancar && modo === 'agora' && !contaId) erros.conta = 'Escolha de qual conta saiu o dinheiro'
  if (lancar && modo === 'depois') {
    if (!vencimento) erros.vencimento = 'Escolha a data de vencimento'
    if (totalNum > 0 && Math.round(totalNum * 100) < vezesNum)
      erros.parcelas = `${moeda(totalNum)} não dá para dividir em ${vezesNum} vezes`
  }
  const temErro = Object.keys(erros).length > 0
  const mostrar: Erros = tentou ? erros : {}

  const parcelas = useMemo(
    () => (totalNum > 0 && vencimento ? parcelar(totalNum, vezesNum, vencimento) : []),
    [totalNum, vezesNum, vencimento],
  )

  function alternarAtualizar(insumoId: string) {
    setNaoAtualizar((s) => {
      const n = new Set(s)
      if (n.has(insumoId)) n.delete(insumoId)
      else n.add(insumoId)
      return n
    })
  }

  async function aoFinalizar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (temErro) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }

    const historico = linhasHistorico.map(({ item_id, ...l }) => {
      let idLinha = idsHistorico.get(item_id)
      if (!idLinha) {
        idLinha = novoId()
        idsHistorico.set(item_id, idLinha)
      }
      return { id: idLinha, ...l }
    })

    const insumosNovos: Insumo[] = []
    for (const m of mudancas) {
      if (naoAtualizar.has(m.insumo_id)) continue
      const ins = insumos.find((i) => i.id === m.insumo_id)
      if (ins) insumosNovos.push({ ...ins, qtd_compra: m.depois.qtd, unidade_compra: m.depois.unidade, preco_compra: m.depois.preco })
    }

    const descricao = `Compra: ${compra.nome}`
    const pessoa = compra.local?.trim() || null
    const lancamentos: (DadosLancamento & { id: string })[] = []
    const titulos: (DadosTitulo & { id: string })[] = []
    if (lancar && modo === 'agora' && contaId) {
      lancamentos.push({
        id: idLancamento,
        tipo: 'saida',
        data: data || compra.data,
        descricao,
        pessoa,
        categoria_id: categoriaId,
        conta_id: contaId,
        conta_destino_id: null,
        valor: totalNum,
        forma_pagamento: forma,
        titulo_id: null,
        ofx_fitid: null,
        ofx_conta_id: null,
        observacao: null,
      })
    }
    if (lancar && modo === 'depois') {
      const grupo = parcelas.length > 1 ? idGrupo : null
      parcelas.forEach((p, i) =>
        titulos.push({
          id: idsParcelas[i],
          tipo: 'pagar',
          descricao,
          pessoa,
          categoria_id: categoriaId,
          conta_id: contaTitulo,
          valor: p.valor,
          emissao: compra.data,
          vencimento: p.vencimento,
          grupo_id: grupo,
          parcela: p.parcela,
          nota_fiscal: notaFiscal.trim() || null,
          observacao: null,
        }),
      )
    }

    try {
      await finalizar.mutateAsync({ compra, total: totalNum, historico, insumos: insumosNovos, lancamentos, titulos })
      const contaUsada = lancar ? (modo === 'agora' ? contaId : contaTitulo) : null
      if (contaUsada) gravarUltimaConta(contaUsada)
      avisar({ texto: 'Compra finalizada ✓' })
      navegar(`/compras/${compra.id}`, { replace: true })
    } catch {
      // O erro aparece na tela pelo estado da mutação.
    }
  }

  const opcoesParcelas = Array.from({ length: MAX_PARCELAS }, (_, i) => {
    const n = i + 1
    const cada = totalNum > 0 ? ` de ${moeda(Math.floor((totalNum * 100) / n) / 100)}` : ''
    return { valor: String(n), rotulo: n === 1 ? 'À vista (1 vez)' : `${n} vezes${cada}` }
  })

  return (
    <form onSubmit={aoFinalizar} noValidate>
      <Voltar padrao={`/compras/${compra.id}`} />
      <TituloPagina
        titulo="Finalizar compra"
        subtitulo={[compra.nome, compra.local, dataBr(compra.data)].filter(Boolean).join(' · ')}
      />

      <div className="flex flex-col gap-8">
        {/* 1. Resumo */}
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">O que veio no carrinho</h2>

          {resumo.pendentes > 0 && (
            <Alerta>
              {resumo.pendentes === 1
                ? '1 item ainda está em Faltam — ele fica como não comprado.'
                : `${resumo.pendentes} itens ainda estão em Faltam — eles ficam como não comprados.`}
            </Alerta>
          )}
          {resumo.semPreco > 0 && (
            <Alerta>
              {resumo.semPreco === 1
                ? '1 item sem preço — não entra no total nem no histórico. '
                : `${resumo.semPreco} itens sem preço — não entram no total nem no histórico. `}
              <Link to={`/compras/${compra.id}`} className="font-semibold text-marca underline">
                Preencher o preço
              </Link>
            </Alerta>
          )}
          {fila.aguardando > 0 && (
            <Alerta>
              {fila.aguardando === 1 ? '1 marcação ainda não subiu' : `${fila.aguardando} marcações ainda não subiram`} para a
              internet. Ao finalizar, o app tenta enviar antes.
            </Alerta>
          )}

          <ul className="divide-y divide-borda overflow-hidden rounded-2xl border border-borda bg-superficie">
            {carrinho.map((i) => {
              const valor = totalItem(i)
              const trocado = i.status === 'substituido'
              return (
                <li key={i.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{trocado ? i.sub_nome || i.nome : i.nome}</p>
                    {trocado && <p className="text-sm text-suave">no lugar de {i.nome}</p>}
                    <p className="text-sm text-suave">
                      {numero(i.qtd_comprada ?? 0, 3)} × {textoEmbalagem(i.embalagem_qtd, i.embalagem_unidade)}
                      {i.preco_pago != null && ` · ${moeda(i.preco_pago)} cada`}
                    </p>
                  </div>
                  {valor != null ? (
                    <span className="shrink-0 font-bold">{moeda(valor)}</span>
                  ) : (
                    <span className="shrink-0 text-sm font-semibold text-perigo">sem preço</span>
                  )}
                </li>
              )
            })}
            <li className="flex items-center justify-between gap-3 bg-marca-clara/40 px-4 py-3">
              <span className="font-semibold">
                Soma dos itens ({resumo.carrinho} {resumo.carrinho === 1 ? 'item' : 'itens'})
              </span>
              <span className="font-bold">{moeda(resumo.total)}</span>
            </li>
          </ul>

          <EntradaNumero
            rotulo="Total pago (na nota)"
            prefixo="R$"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            erro={mostrar.total}
            ajuda={
              diferenca === 0
                ? 'Mude se teve desconto, frete ou taxa'
                : `${moeda(Math.abs(diferenca))} ${diferenca < 0 ? 'a menos que a soma (desconto)' : 'a mais que a soma (frete ou taxa)'}`
            }
          />
          {diferenca !== 0 && (
            <button type="button" onClick={() => setTotal(paraCampo(resumo.total))} className="self-start text-sm font-semibold text-marca underline">
              Voltar para a soma dos itens ({moeda(resumo.total)})
            </button>
          )}
        </section>

        {/* 2. Preços e custos */}
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">Preços e custos</h2>
          <p className="text-suave">
            Os preços pagos vão para o histórico de cada insumo
            {linhasHistorico.length > 0 ? ` (${linhasHistorico.length} ${linhasHistorico.length === 1 ? 'preço' : 'preços'}).` : '.'}
          </p>
          {mudancas.length > 0 ? (
            <>
              <p className="text-suave">
                Estes insumos mudaram de preço. Atualizando o custo, as receitas e os produtos passam a usar o preço novo.
              </p>
              <ul className="flex flex-col gap-2">
                {mudancas.map((m) => (
                  <LinhaMudanca key={m.insumo_id} m={m} ligado={!naoAtualizar.has(m.insumo_id)} aoMudar={() => alternarAtualizar(m.insumo_id)} />
                ))}
              </ul>
            </>
          ) : (
            linhasHistorico.length > 0 && <p className="text-suave">Nenhum custo muda: os preços são os mesmos já cadastrados.</p>
          )}
        </section>

        {/* 3. Financeiro */}
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-bold">Financeiro</h2>
          <Interruptor
            ligado={lancar}
            aoMudar={setLancar}
            rotulo="Lançar no Financeiro"
            texto={lancar ? 'A compra entra nas saídas ou nas contas a pagar' : 'A compra não aparece no Financeiro'}
          />

          {lancar && (
            <>
              <Pilulas
                rotulo="Como pagou"
                valor={modo}
                aoMudar={setModo}
                opcoes={[
                  { valor: 'agora', rotulo: 'Paguei agora' },
                  { valor: 'depois', rotulo: 'Vou pagar depois' },
                ]}
              />

              {modo === 'agora' ? (
                temContas ? (
                  <>
                    <SeletorConta
                      rotulo="Saiu de qual conta?"
                      contas={contas}
                      valor={contaId}
                      aoMudar={setContaId}
                      erro={mostrar.conta}
                    />
                    <Selecao
                      rotulo="Forma de pagamento"
                      valor={forma ?? ''}
                      aoMudar={(v) => setForma(v || null)}
                      opcoes={[{ valor: '', rotulo: 'Escolha…' }, ...FORMAS_PAGAMENTO.map((f) => ({ valor: f, rotulo: f }))]}
                    />
                    <Entrada rotulo="Data do pagamento" type="date" value={data} onChange={(e) => setData(e.target.value)} />
                  </>
                ) : (
                  <Cartao className="flex flex-col gap-3">
                    <p>
                      Para anotar o pagamento, o app precisa saber de qual conta saiu o dinheiro (ex.: Nubank, Caixa da loja).
                    </p>
                    <Link
                      to="/financeiro/bancos/nova"
                      className="flex min-h-12 items-center justify-center rounded-2xl bg-marca px-5 font-semibold text-white shadow-sm active:bg-marca-escura"
                    >
                      Cadastrar conta
                    </Link>
                    {/* sem conta não dá para validar; marca o erro aqui para o foco achar */}
                    {mostrar.conta && (
                      <p className="text-sm font-medium text-perigo" tabIndex={-1} aria-invalid="true">
                        {mostrar.conta}
                      </p>
                    )}
                  </Cartao>
                )
              ) : (
                <>
                  <div className="grid grid-cols-1 items-start gap-4 min-[420px]:grid-cols-2">
                    <Entrada
                      rotulo={vezesNum > 1 ? '1º vencimento' : 'Vencimento'}
                      type="date"
                      value={vencimento}
                      onChange={(e) => setVencimento(e.target.value)}
                      erro={mostrar.vencimento}
                    />
                    <Selecao rotulo="Parcelas" valor={vezes} aoMudar={setVezes} opcoes={opcoesParcelas} />
                  </div>
                  {mostrar.parcelas && <p className="text-sm font-medium text-perigo">{mostrar.parcelas}</p>}
                  {parcelas.length > 1 && <Previa parcelas={parcelas} />}
                  <SeletorConta
                    rotulo="Vai sair de qual conta?"
                    contas={contas}
                    valor={contaTitulo}
                    aoMudar={setContaTitulo}
                    vazio="Ainda não sei"
                    ajuda="Já vem escolhida na hora de dar baixa"
                  />
                  <Entrada rotulo="Nota fiscal (opcional)" value={notaFiscal} onChange={(e) => setNotaFiscal(e.target.value)} />
                </>
              )}

              <SeletorCategoria
                tipo="saida"
                categorias={categorias}
                valor={categoriaId}
                aoMudar={setCategoriaId}
                ajuda="Ajuda a ver no fim do mês com o que o dinheiro foi gasto"
              />
            </>
          )}
        </section>

        {finalizar.isError && <Erro mensagem={mensagemDe(finalizar.error)} />}
      </div>

      <BarraAcao>
        <Botao type="submit" className="flex-1" disabled={finalizar.isPending}>
          {finalizar.isPending ? 'Finalizando…' : 'Finalizar compra'}
        </Botao>
      </BarraAcao>
    </form>
  )
}

function Alerta({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-2xl bg-perigo-claro/60 px-4 py-3 text-[15px]">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-perigo" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

function LinhaMudanca({ m, ligado, aoMudar }: { m: MudancaCusto; ligado: boolean; aoMudar: () => void }) {
  const mudouEmbalagem = m.antes.qtd !== m.depois.qtd || m.antes.unidade !== m.depois.unidade
  const subiu = m.variacaoPct > 0
  const desceu = m.variacaoPct < 0
  const cor = subiu ? 'text-perigo' : desceu ? 'text-ok' : 'text-suave'
  return (
    <li>
      <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl border border-borda bg-superficie px-4 py-3 active:bg-marca-clara">
        <input type="checkbox" checked={ligado} onChange={aoMudar} className="mt-1 size-6 shrink-0 accent-marca" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{m.nome}</span>
          {mudouEmbalagem ? (
            <span className="block text-[15px]">
              {textoEmbalagem(m.antes.qtd, m.antes.unidade)} por {moeda(m.antes.preco)} → {textoEmbalagem(m.depois.qtd, m.depois.unidade)}{' '}
              por <strong>{moeda(m.depois.preco)}</strong>
            </span>
          ) : (
            <span className="block text-[15px]">
              {textoEmbalagem(m.depois.qtd, m.depois.unidade)}: {moeda(m.antes.preco)} → <strong>{moeda(m.depois.preco)}</strong>
            </span>
          )}
          <span className={`mt-0.5 flex items-center gap-1 text-sm font-semibold ${cor}`}>
            {subiu && <ArrowUpRight className="size-4" aria-hidden />}
            {desceu && <ArrowDownRight className="size-4" aria-hidden />}
            {subiu ? `ficou ${pct(m.variacaoPct)} mais caro` : desceu ? `ficou ${pct(-m.variacaoPct)} mais barato` : mudouEmbalagem ? 'embalagem diferente' : 'mesmo custo'}
          </span>
          <span className="mt-1 flex items-center gap-1 text-sm text-suave">
            {ligado && <CheckCircle2 className="size-4 text-ok" aria-hidden />}
            {ligado ? 'Atualizar o custo do insumo' : 'Não atualizar (o preço só vai para o histórico)'}
          </span>
        </span>
      </label>
    </li>
  )
}

function Previa({ parcelas }: { parcelas: { parcela: string | null; valor: number; vencimento: string }[] }) {
  return (
    <section aria-live="polite" className="flex flex-col gap-2">
      <h3 className="font-bold">Vão ser criadas {parcelas.length} contas a pagar</h3>
      <ol className="divide-y divide-borda rounded-2xl border border-borda bg-superficie">
        {parcelas.map((p, i) => (
          <li key={i} className="flex items-center gap-3 px-4 py-2">
            <span className="w-12 shrink-0 text-sm text-suave">{p.parcela ?? `${i + 1}º`}</span>
            <span className="flex-1">{dataBr(p.vencimento)}</span>
            <span className="font-semibold">{moeda(p.valor)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
