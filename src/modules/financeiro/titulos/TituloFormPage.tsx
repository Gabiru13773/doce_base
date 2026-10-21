import { ArrowLeft, ChevronRight } from 'lucide-react'
import { useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAviso } from '../../../components/Aviso'
import { BarraAcao, Botao, Campo, Carregando, Cartao, Entrada, EntradaNumero, Erro, Pilulas, TituloPagina, Vazio } from '../../../components/ui'
import { novoId } from '../../../lib/db'
import { baixasPorTitulo, parcelar, repetirMensal, situacaoTitulo } from '../../../lib/financeiro'
import { lerNumero, moeda, paraCampo } from '../../../lib/format'
import {
  hoje,
  useCategoriasFin,
  useContasFin,
  useLancamentos,
  useRemoverTitulo,
  useRestaurarTitulo,
  useSalvarTitulos,
  useTitulos,
  type DadosTitulo,
  type Lancamento,
  type TipoTitulo,
  type Titulo,
} from '../api'
import { SeletorCategoria, SeletorConta } from '../componentes/Seletores'
import { DarBaixa, useDesfazerBaixa } from './DarBaixa'
import { dataBr, mensagemDe, PALAVRAS, seloSituacao, textoVencimento } from './util'

type Repetir = 'nao' | 'parcelado' | 'mensal'

const OPCOES_REPETIR: { valor: Repetir; rotulo: string }[] = [
  { valor: 'nao', rotulo: 'Não repete' },
  { valor: 'parcelado', rotulo: 'Parcelado' },
  { valor: 'mensal', rotulo: 'Todo mês' },
]

export default function TituloFormPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const editando = !!id && id !== 'nova'
  const { data: titulos, isLoading, isError, error, refetch } = useTitulos()

  if (!editando) {
    const tipo: TipoTitulo = params.get('tipo') === 'receber' ? 'receber' : 'pagar'
    return <Formulario key={`nova-${tipo}`} tipoInicial={tipo} />
  }

  if (isLoading) return <Carregando />
  if (isError) return <Erro mensagem={mensagemDe(error)} tentarDeNovo={() => refetch()} />

  const titulo = titulos?.find((t) => t.id === id)
  if (!titulo) {
    return (
      <>
        <Voltar tipo="pagar" />
        <Vazio
          titulo="Conta não encontrada"
          texto="Ela pode ter sido apagada."
          acao={
            <Link to="/financeiro/contas" className="inline-flex min-h-12 items-center rounded-2xl px-5 font-semibold text-marca active:bg-marca-clara">
              Ver todas as contas
            </Link>
          }
        />
      </>
    )
  }

  // key: recomeça o formulário se trocar de conta (ex.: link para outra parcela).
  return <Formulario key={titulo.id} original={titulo} tipoInicial={titulo.tipo} />
}

function Voltar({ tipo }: { tipo: TipoTitulo }) {
  return (
    <Link
      to={`/financeiro/contas?tipo=${tipo}`}
      className="-ml-2 mb-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-suave active:bg-marca-clara"
    >
      <ArrowLeft className="size-5" aria-hidden />
      Voltar
    </Link>
  )
}

interface Erros {
  descricao?: string
  valor?: string
  vencimento?: string
  vezes?: string
  categoria?: string
}

const classeTexto =
  'w-full rounded-xl border border-borda bg-superficie px-4 py-3 text-base outline-none focus:border-marca focus:ring-2 focus:ring-marca/20'

function Formulario({ original, tipoInicial }: { original?: Titulo; tipoInicial: TipoTitulo }) {
  const navegar = useNavigate()
  const avisar = useAviso()
  const idDatalist = useId()
  const idObs = useId()

  const { data: titulos } = useTitulos()
  const { data: lancamentos } = useLancamentos()
  const { data: categorias } = useCategoriasFin()
  const { data: contas } = useContasFin()
  const salvar = useSalvarTitulos()
  const remover = useRemoverTitulo()
  const restaurar = useRestaurarTitulo()
  const desfazerBaixa = useDesfazerBaixa()
  // Ids dos registros novos, gerados uma vez por formulário: se a gravação for repetida (toque
  // duplo, rede que caiu depois de gravar), atualiza as mesmas linhas em vez de duplicar.
  const [grupoNovo] = useState(() => novoId())
  const idsParcelas = useRef<string[]>([])
  const idParcela = (i: number) => (idsParcelas.current[i] ??= novoId())

  const [tipo, setTipo] = useState<TipoTitulo>(tipoInicial)
  const [descricao, setDescricao] = useState(original?.descricao ?? '')
  const [pessoa, setPessoa] = useState(original?.pessoa ?? '')
  const [categoriaId, setCategoriaId] = useState<string | null>(original?.categoria_id ?? null)
  const [valor, setValor] = useState(paraCampo(original?.valor))
  const [vencimento, setVencimento] = useState(original?.vencimento ?? '')
  const [emissao, setEmissao] = useState(original?.emissao ?? hoje())
  const [contaId, setContaId] = useState<string | null>(original?.conta_id ?? null)
  const [notaFiscal, setNotaFiscal] = useState(original?.nota_fiscal ?? '')
  const [observacao, setObservacao] = useState(original?.observacao ?? '')
  const [repetir, setRepetir] = useState<Repetir>('nao')
  const [vezes, setVezes] = useState('')
  const [maisAberto, setMaisAberto] = useState(!!(original?.conta_id || original?.nota_fiscal || original?.observacao))
  const [tentou, setTentou] = useState(false)
  const [baixaAberta, setBaixaAberta] = useState(false)

  const palavras = PALAVRAS[tipo]
  const dia = hoje()

  // Baixas desta conta (lançamentos ligados a ela), da mais antiga para a mais nova.
  const baixas = useMemo(
    () => (original ? (lancamentos ?? []).filter((l) => l.titulo_id === original.id).sort((a, b) => a.data.localeCompare(b.data)) : []),
    [lancamentos, original],
  )
  const mapaBaixas = useMemo(() => baixasPorTitulo(lancamentos ?? [], titulos ?? []), [lancamentos, titulos])
  const sit = original ? situacaoTitulo(original, mapaBaixas, dia) : null

  // Nomes já usados, para sugerir enquanto digita.
  const nomes = useMemo(() => {
    const s = new Set<string>()
    for (const t of titulos ?? []) if (t.tipo === tipo && t.pessoa) s.add(t.pessoa)
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [titulos, tipo])

  const irmas = useMemo(
    () =>
      original?.grupo_id
        ? (titulos ?? []).filter((t) => t.grupo_id === original.grupo_id).sort((a, b) => a.vencimento.localeCompare(b.vencimento))
        : [],
    [titulos, original],
  )

  const valorNum = lerNumero(valor)
  const vezesNum = lerNumero(vezes)
  const repete = !original && repetir !== 'nao'

  const erros: Erros = {}
  if (!descricao.trim()) erros.descricao = 'Escreva o que é esta conta'
  if (!(valorNum > 0)) erros.valor = 'Informe um valor maior que zero'
  else if (sit && Math.round(valorNum * 100) < Math.round(sit.pago * 100))
    erros.valor = `Já ${tipo === 'pagar' ? 'foi pago' : 'foi recebido'} ${moeda(sit.pago)}; o valor não pode ser menor`
  if (!vencimento) erros.vencimento = 'Escolha a data de vencimento'
  if (repete && !(Number.isInteger(vezesNum) && vezesNum >= 2 && vezesNum <= 60))
    erros.vezes = 'Escolha um número de 2 a 60'
  else if (repete && repetir === 'parcelado' && valorNum > 0 && Math.round(valorNum * 100) < vezesNum)
    erros.vezes = `${moeda(valorNum)} não dá para dividir em ${vezesNum} vezes (cada parcela precisa ter pelo menos 1 centavo)`
  const temErro = Object.keys(erros).length > 0
  const mostrar: Erros = tentou ? erros : {}

  // Contas que serão criadas (prévia para conferir antes de salvar).
  const geradas = useMemo(() => {
    if (!(valorNum > 0) || !vencimento) return []
    if (!repete) return [{ parcela: null as string | null, valor: Math.round(valorNum * 100) / 100, vencimento }]
    if (!(Number.isInteger(vezesNum) && vezesNum >= 2 && vezesNum <= 60)) return []
    return repetir === 'parcelado' ? parcelar(valorNum, vezesNum, vencimento) : repetirMensal(valorNum, vezesNum, vencimento)
  }, [valorNum, vencimento, repete, repetir, vezesNum])

  function mudarTipo(t: TipoTitulo) {
    setTipo(t)
    const cat = categorias?.find((c) => c.id === categoriaId)
    if (cat && cat.tipo !== (t === 'pagar' ? 'saida' : 'entrada')) setCategoriaId(null)
  }

  async function aoSalvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (temErro) return
    const base = {
      tipo,
      descricao: descricao.trim(),
      pessoa: pessoa.trim() || null,
      categoria_id: categoriaId,
      conta_id: contaId,
      emissao: emissao || dia,
      nota_fiscal: notaFiscal.trim() || null,
      observacao: observacao.trim() || null,
    }
    let lista: DadosTitulo[]
    if (original) {
      lista = [{ ...base, id: original.id, valor: valorNum, vencimento, grupo_id: original.grupo_id, parcela: original.parcela }]
    } else {
      const grupo = geradas.length > 1 ? grupoNovo : null
      lista = geradas.map((g, i) => ({ ...base, id: idParcela(i), valor: g.valor, vencimento: g.vencimento, parcela: g.parcela, grupo_id: grupo }))
    }
    try {
      await salvar.mutateAsync({ novos: !original, lista })
      avisar({ texto: lista.length > 1 ? `${lista.length} contas criadas ✓` : 'Conta salva ✓' })
      navegar(`/financeiro/contas?tipo=${tipo}`)
    } catch {
      // O erro aparece na tela pelo estado da mutação.
    }
  }

  async function aoApagar() {
    if (!original) return
    const copia = original
    const baixasCopia: Lancamento[] = baixas
    try {
      // mutateAsync (e não um onSuccess no mutate): continua valendo mesmo se a tela fechar antes.
      await remover.mutateAsync(copia.id)
    } catch {
      return // o erro aparece na tela pelo estado da mutação
    }
    navegar(`/financeiro/contas?tipo=${copia.tipo}`)
    avisar({
      texto:
        baixasCopia.length > 0
          ? `Conta apagada. ${baixasCopia.length === 1 ? 'O pagamento dela continua' : 'Os pagamentos dela continuam'} nas entradas e saídas.`
          : 'Conta apagada',
      // Volta a conta e liga de novo os pagamentos (no banco, o vínculo some ao apagar), tudo na
      // mesma mutação: esta tela já fechou quando a pessoa toca em Desfazer.
      desfazer: () => restaurar.mutate({ titulo: copia, baixas: baixasCopia }),
    })
  }

  const nomeConta = (id: string) => contas?.find((c) => c.id === id)?.nome ?? 'Conta apagada'

  return (
    <>
      <form onSubmit={aoSalvar} noValidate>
        <Voltar tipo={tipo} />
        <TituloPagina
          titulo={original ? original.descricao : palavras.nova}
          subtitulo={original?.parcela ? `Parcela ${original.parcela}` : undefined}
        />

        <div className="flex flex-col gap-6">
          {original && sit && (
            <Cartao className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`rounded-full px-3 py-1 text-sm font-semibold ${seloSituacao(sit.situacao, original.tipo).classe}`}>
                  {seloSituacao(sit.situacao, original.tipo).texto}
                </span>
                <span className={`text-sm ${sit.situacao === 'atrasado' ? 'font-semibold text-perigo' : 'text-suave'}`}>
                  {sit.situacao === 'pago'
                  ? `vencia em ${dataBr(original.vencimento)}`
                  : sit.situacao === 'vence_hoje'
                    ? dataBr(original.vencimento)
                    : textoVencimento(original.vencimento, dia)}
                </span>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <dt className="text-sm text-suave">Valor</dt>
                  <dd className="font-bold">{moeda(original.valor)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-suave">{original.tipo === 'pagar' ? 'Pago' : 'Recebido'}</dt>
                  <dd className="font-bold text-ok">{moeda(sit.pago)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-suave">Falta</dt>
                  <dd className={`font-bold ${sit.falta > 0 && sit.situacao === 'atrasado' ? 'text-perigo' : ''}`}>{moeda(sit.falta)}</dd>
                </div>
              </dl>
              {sit.falta > 0 && (
                <Botao onClick={() => setBaixaAberta(true)}>
                  {original.tipo === 'pagar' ? 'Dar baixa (pagar)' : 'Dar baixa (receber)'}
                </Botao>
              )}

              {baixas.length > 0 && (
                <div className="flex flex-col gap-2 border-t border-borda pt-3">
                  <h2 className="font-bold">{original.tipo === 'pagar' ? 'Pagamentos' : 'Recebimentos'}</h2>
                  <ul className="flex flex-col divide-y divide-borda">
                    {baixas.map((l) => (
                      <li key={l.id} className="flex items-center gap-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">
                            {moeda(l.valor)} <span className="font-normal text-suave">em {dataBr(l.data)}</span>
                          </p>
                          <p className="truncate text-sm text-suave">
                            {[nomeConta(l.conta_id), l.forma_pagamento].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <Botao
                          variante="perigo"
                          className="shrink-0 px-3 text-[15px]"
                          disabled={desfazerBaixa.pendente}
                          onClick={() => desfazerBaixa.desfazer(l)}
                        >
                          Desfazer baixa
                        </Botao>
                      </li>
                    ))}
                  </ul>
                  {desfazerBaixa.erro && <Erro mensagem={desfazerBaixa.erro} />}
                </div>
              )}
            </Cartao>
          )}

          <div className="flex flex-col gap-1.5">
            <p className="font-semibold">Tipo</p>
            {original && baixas.length > 0 ? (
              <p className="text-suave">
                {tipo === 'pagar' ? 'Conta a pagar' : 'Conta a receber'} (não muda porque já tem {tipo === 'pagar' ? 'pagamento' : 'recebimento'})
              </p>
            ) : (
              <Pilulas
                rotulo="Tipo"
                valor={tipo}
                aoMudar={mudarTipo}
                opcoes={[
                  { valor: 'pagar', rotulo: 'A pagar' },
                  { valor: 'receber', rotulo: 'A receber' },
                ]}
              />
            )}
          </div>

          <Entrada
            rotulo="Descrição"
            placeholder={palavras.exemploDescricao}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            erro={mostrar.descricao}
            autoFocus={!original}
            autoCapitalize="sentences"
          />

          <Entrada
            rotulo={palavras.pessoa}
            placeholder={palavras.exemploPessoa}
            value={pessoa}
            onChange={(e) => setPessoa(e.target.value)}
            list={idDatalist}
            autoCapitalize="words"
            autoComplete="off"
          />
          <datalist id={idDatalist}>
            {nomes.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>

          <SeletorCategoria
            tipo={tipo === 'pagar' ? 'saida' : 'entrada'}
            categorias={categorias ?? []}
            valor={categoriaId}
            aoMudar={setCategoriaId}
            ajuda="Ajuda a ver no fim do mês com o que o dinheiro foi gasto (ou de onde veio)"
          />

          {!original && (
            <div className="flex flex-col gap-1.5">
              <p className="font-semibold">Repetir</p>
              <Pilulas rotulo="Repetir" valor={repetir} aoMudar={setRepetir} opcoes={OPCOES_REPETIR} />
              <p className="text-sm text-suave">
                {repetir === 'parcelado'
                  ? 'O valor total é dividido nas parcelas, uma por mês.'
                  : repetir === 'mensal'
                    ? 'O mesmo valor todo mês, como aluguel ou internet.'
                    : 'Uma conta só.'}
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 items-start gap-4 min-[420px]:grid-cols-2">
            <EntradaNumero
              rotulo={repete && repetir === 'parcelado' ? 'Valor total' : repete ? 'Valor por mês' : 'Valor'}
              prefixo="R$"
              placeholder="Ex.: 150,00"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              erro={mostrar.valor}
            />
            <Entrada
              rotulo={repete ? '1º vencimento' : 'Vencimento'}
              type="date"
              value={vencimento}
              onChange={(e) => setVencimento(e.target.value)}
              erro={mostrar.vencimento}
            />
          </div>

          {repete && (
            <EntradaNumero
              rotulo={repetir === 'parcelado' ? 'Em quantas vezes?' : 'Por quantos meses?'}
              inputMode="numeric"
              placeholder={repetir === 'parcelado' ? 'Ex.: 3' : 'Ex.: 12'}
              sufixo={repetir === 'parcelado' ? 'vezes' : 'meses'}
              value={vezes}
              onChange={(e) => setVezes(e.target.value)}
              erro={mostrar.vezes}
            />
          )}

          {repete && geradas.length > 1 && <Previa geradas={geradas} />}

          <details
            open={maisAberto}
            onToggle={(e) => setMaisAberto(e.currentTarget.open)}
            className="rounded-2xl border border-borda bg-superficie"
          >
            <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold text-marca">Mais detalhes</summary>
            <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
              <Entrada
                rotulo="Data de emissão"
                type="date"
                value={emissao}
                onChange={(e) => setEmissao(e.target.value)}
                ajuda="Quando a conta foi feita (compra, pedido)"
              />
              <SeletorConta
                rotulo={tipo === 'pagar' ? 'Vai sair de qual conta?' : 'Vai entrar em qual conta?'}
                contas={contas ?? []}
                valor={contaId}
                aoMudar={setContaId}
                vazio="Ainda não sei"
                ajuda="Já vem escolhida na hora de dar baixa"
              />
              <Entrada rotulo="Nota fiscal" value={notaFiscal} onChange={(e) => setNotaFiscal(e.target.value)} inputMode="text" />
              <Campo rotulo="Observação" id={idObs}>
                <textarea id={idObs} rows={3} value={observacao} onChange={(e) => setObservacao(e.target.value)} className={classeTexto} />
              </Campo>
            </div>
          </details>

          {salvar.isError && <Erro mensagem={mensagemDe(salvar.error)} />}

          {irmas.length > 1 && original && (
            <section className="flex flex-col gap-2">
              <h2 className="text-lg font-bold">Parcelas desta conta</h2>
              <ul className="divide-y divide-borda overflow-hidden rounded-2xl border border-borda bg-superficie">
                {irmas.map((t) => {
                  const s = situacaoTitulo(t, mapaBaixas, dia)
                  const selo = seloSituacao(s.situacao, t.tipo)
                  const atual = t.id === original.id
                  return (
                    <li key={t.id}>
                      <Link
                        to={`/financeiro/contas/${t.id}`}
                        aria-current={atual ? 'page' : undefined}
                        className={`flex min-h-14 items-center gap-3 px-4 py-2 active:bg-marca-clara ${atual ? 'bg-marca-clara/60' : ''}`}
                      >
                        <span className="w-14 shrink-0 text-sm text-suave">{t.parcela ?? ''}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">{dataBr(t.vencimento)}</span>
                          <span className={`inline-block rounded-full px-2 text-sm font-semibold ${selo.classe}`}>{selo.texto}</span>
                        </span>
                        <span className="shrink-0 font-bold">{moeda(t.valor)}</span>
                        <ChevronRight className="size-5 shrink-0 text-suave" aria-hidden />
                      </Link>
                    </li>
                  )
                })}
              </ul>
              <p className="text-sm text-suave">Mudanças aqui valem só para esta parcela.</p>
            </section>
          )}

          {original && (
            <div className="flex flex-col gap-3 pt-4">
              {remover.isError && <Erro mensagem={mensagemDe(remover.error)} />}
              {baixas.length > 0 && (
                <p className="text-sm text-suave">
                  Se apagar, {baixas.length === 1 ? 'o pagamento já anotado continua' : 'os pagamentos já anotados continuam'} nas
                  entradas e saídas.
                </p>
              )}
              <Botao variante="perigo" onClick={aoApagar} disabled={remover.isPending}>
                {remover.isPending ? 'Apagando…' : 'Apagar conta'}
              </Botao>
            </div>
          )}
        </div>

        <BarraAcao>
          <Botao type="submit" className="flex-1" disabled={salvar.isPending}>
            {salvar.isPending ? 'Salvando…' : repete && geradas.length > 1 ? `Salvar ${geradas.length} contas` : 'Salvar'}
          </Botao>
        </BarraAcao>
      </form>
      {/* Fora do formulário: a janela tem o próprio formulário (não pode ficar um dentro do outro). */}
      {original && <DarBaixa titulo={original} aberto={baixaAberta} aoFechar={() => setBaixaAberta(false)} />}
    </>
  )
}

function Previa({ geradas }: { geradas: { parcela: string | null; valor: number; vencimento: string }[] }) {
  const total = geradas.reduce((s, g) => s + g.valor, 0)
  return (
    <section aria-live="polite" className="flex flex-col gap-2">
      <h2 className="font-bold">
        Vão ser criadas {geradas.length} contas · total {moeda(total)}
      </h2>
      <ol className="max-h-80 divide-y divide-borda overflow-y-auto rounded-2xl border border-borda bg-superficie">
        {geradas.map((g, i) => (
          <li key={i} className="flex items-center gap-3 px-4 py-2">
            <span className="w-12 shrink-0 text-sm text-suave">{g.parcela ?? `${i + 1}º`}</span>
            <span className="flex-1">{dataBr(g.vencimento)}</span>
            <span className="font-semibold">{moeda(g.valor)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
