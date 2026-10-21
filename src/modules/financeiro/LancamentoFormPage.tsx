import { FileText, Link2 } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useAviso } from '../../components/Aviso'
import { BarraAcao, Botao, Campo, Carregando, Cartao, Entrada, Erro, Pilulas, TituloPagina, Vazio } from '../../components/ui'
import { novoId } from '../../lib/db'
import { lerNumero, moeda, paraCampo } from '../../lib/format'
import {
  FORMAS_PAGAMENTO,
  hoje,
  useCategoriasFin,
  useContasFin,
  useLancamentos,
  useRemoverLancamento,
  useRestaurarLancamento,
  useSalvarLancamentos,
  useTitulos,
  type CategoriaFin,
  type ContaFin,
  type Lancamento,
  type TipoLancamento,
} from './api'
import { Voltar } from './componentes/Comum'
import { SeletorCategoria, SeletorConta, nomeCategoria } from './componentes/Seletores'
import { dataBr, gravarUltimaConta, lerUltimaConta, mensagemDe, useVoltar } from './util'

const TIPOS: { valor: TipoLancamento; rotulo: string }[] = [
  { valor: 'entrada', rotulo: 'Entrada' },
  { valor: 'saida', rotulo: 'Saída' },
  { valor: 'transferencia', rotulo: 'Transferência' },
]

const VOLTAR_PADRAO = '/financeiro/extrato'

export default function LancamentoFormPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const contas = useContasFin()
  const categorias = useCategoriasFin()
  const lancamentos = useLancamentos()

  const consultas = [contas, categorias, ...(id ? [lancamentos] : [])]
  if (consultas.some((c) => c.isLoading)) return <Carregando />
  const comErro = consultas.find((c) => c.isError)
  if (comErro) return <Erro mensagem={mensagemDe(comErro.error)} tentarDeNovo={() => consultas.forEach((c) => void c.refetch())} />

  const listaContas = contas.data ?? []
  if (!listaContas.some((c) => c.ativo)) {
    return (
      <>
        <TituloPagina titulo="Lançar" />
        <Vazio
          titulo="Primeiro, cadastre onde fica o dinheiro"
          texto="Para anotar uma entrada ou saída, o app precisa saber de qual conta é (ex.: Nubank, Caixa da loja)."
          acao={
            <Link
              to="/financeiro/bancos/nova"
              className="flex min-h-12 items-center justify-center rounded-2xl bg-marca px-5 font-semibold text-white shadow-sm active:bg-marca-escura"
            >
              Cadastrar conta
            </Link>
          }
        />
      </>
    )
  }

  if (id) {
    const original = lancamentos.data?.find((l) => l.id === id)
    if (!original) {
      return (
        <>
          <Voltar padrao={VOLTAR_PADRAO} />
          <Vazio
            titulo="Lançamento não encontrado"
            texto="Ele pode ter sido apagado."
            acao={
              <Link to={VOLTAR_PADRAO} className="inline-flex min-h-12 items-center rounded-2xl px-5 font-semibold text-marca active:bg-marca-clara">
                Ver lançamentos
              </Link>
            }
          />
        </>
      )
    }
    return (
      <Formulario
        key={original.id}
        original={original}
        contas={listaContas}
        categorias={categorias.data ?? []}
        pessoas={pessoasUsadas(lancamentos.data ?? [])}
      />
    )
  }

  const tipoUrl = params.get('tipo')
  const tipoInicial: TipoLancamento = TIPOS.some((t) => t.valor === tipoUrl) ? (tipoUrl as TipoLancamento) : 'saida'
  return (
    <Formulario
      key={`novo-${tipoInicial}`}
      tipoInicial={tipoInicial}
      contas={listaContas}
      categorias={categorias.data ?? []}
      pessoas={pessoasUsadas(lancamentos.data ?? [])}
    />
  )
}

/** Clientes/fornecedores já usados, para sugerir enquanto digita. */
function pessoasUsadas(lancamentos: Lancamento[]): string[] {
  return [...new Set(lancamentos.map((l) => l.pessoa?.trim()).filter((p): p is string => !!p))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

/** Conta que já vem escolhida: a última usada (se ainda ativa) ou a única que existe. */
function contaPadrao(contas: ContaFin[]): string | null {
  const ativas = contas.filter((c) => c.ativo)
  const ultima = lerUltimaConta()
  if (ultima && ativas.some((c) => c.id === ultima)) return ultima
  return ativas.length === 1 ? ativas[0].id : null
}

interface Erros {
  valor?: string
  data?: string
  categoria?: string
  conta?: string
  destino?: string
}

function Formulario({
  original,
  tipoInicial = 'saida',
  contas,
  categorias,
  pessoas,
}: {
  original?: Lancamento
  tipoInicial?: TipoLancamento
  contas: ContaFin[]
  categorias: CategoriaFin[]
  pessoas: string[]
}) {
  const voltar = useVoltar(VOLTAR_PADRAO)
  const avisar = useAviso()
  const salvar = useSalvarLancamentos()
  const remover = useRemoverLancamento()
  const restaurar = useRestaurarLancamento()
  const idValor = useId()
  const idObs = useId()
  const idPessoas = useId()

  const [tipo, setTipo] = useState<TipoLancamento>(original?.tipo ?? tipoInicial)
  const [valor, setValor] = useState(original ? paraCampo(original.valor) : '')
  const [data, setData] = useState(original?.data ?? hoje())
  const [descricao, setDescricao] = useState(original?.descricao ?? '')
  const [categoriaId, setCategoriaId] = useState<string | null>(original?.categoria_id ?? null)
  const [contaId, setContaId] = useState<string | null>(original?.conta_id ?? contaPadrao(contas))
  const [destinoId, setDestinoId] = useState<string | null>(original?.conta_destino_id ?? null)
  const [pessoa, setPessoa] = useState(original?.pessoa ?? '')
  const [forma, setForma] = useState<string | null>(original?.forma_pagamento ?? null)
  const [observacao, setObservacao] = useState(original?.observacao ?? '')
  const [maisAberto, setMaisAberto] = useState(!!(original?.pessoa || original?.observacao))
  const [tentou, setTentou] = useState(false)
  // Id do lançamento novo, gerado uma vez por formulário: se a gravação for repetida (toque duplo,
  // rede que caiu depois de gravar), atualiza o mesmo lançamento em vez de duplicar.
  const [idNovo] = useState(() => novoId())

  const transferencia = tipo === 'transferencia'
  // Baixa de uma conta a pagar/receber: o tipo não muda (saída paga conta a pagar, entrada recebe
  // conta a receber; trocar faria uma entrada "pagar" uma conta a pagar).
  const tipoFixo = !!original?.titulo_id
  const valorNum = lerNumero(valor)

  function mudarTipo(t: TipoLancamento) {
    if (tipoFixo) return
    setTipo(t)
    // A categoria precisa ser do mesmo sentido (entrada ou saída).
    const cat = categorias.find((c) => c.id === categoriaId)
    if (cat && cat.tipo !== t) setCategoriaId(null)
    if (t !== 'transferencia') setDestinoId(null)
    // Transferência → entrada: o dinheiro entrou na conta de destino, não na de origem.
    if (tipo === 'transferencia' && t === 'entrada' && destinoId) setContaId(destinoId)
  }

  const erros: Erros = {}
  if (!(valorNum > 0)) erros.valor = valor.trim() ? 'Valor inválido. Ex.: 120,50' : 'Informe o valor'
  if (!data) erros.data = 'Informe a data'
  if (!transferencia && !categoriaId) erros.categoria = 'Escolha a categoria'
  if (!contaId) erros.conta = transferencia ? 'Escolha de qual conta saiu' : 'Escolha a conta'
  if (transferencia && !destinoId) erros.destino = 'Escolha para qual conta foi'
  if (transferencia && destinoId && destinoId === contaId) erros.destino = 'Escolha uma conta diferente da de origem'
  const temErro = Object.keys(erros).length > 0
  const mostrar: Erros = tentou ? erros : {}

  const titulos = useTitulos()
  const titulo = original?.titulo_id ? titulos.data?.find((t) => t.id === original.titulo_id) : undefined

  function descricaoFinal(): string {
    if (descricao.trim()) return descricao.trim()
    if (transferencia) {
      const de = contas.find((c) => c.id === contaId)?.nome
      const para = contas.find((c) => c.id === destinoId)?.nome
      return de && para ? `Transferência de ${de} para ${para}` : 'Transferência'
    }
    return nomeCategoria(categorias, categoriaId, tipo === 'entrada' ? 'Entrada' : 'Saída')
  }

  async function aoSalvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (temErro || !contaId) {
      // Leva o dedo/olho até o primeiro campo com problema.
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    try {
      await salvar.mutateAsync({
        novos: !original,
        lista: [
        {
          id: original?.id ?? idNovo,
          tipo,
          data,
          descricao: descricaoFinal(),
          pessoa: transferencia ? null : pessoa,
          categoria_id: transferencia ? null : categoriaId,
          conta_id: contaId,
          conta_destino_id: transferencia ? destinoId : null,
          valor: valorNum,
          forma_pagamento: forma,
          titulo_id: original?.titulo_id ?? null,
          ofx_fitid: original?.ofx_fitid ?? null,
          ofx_conta_id: original?.ofx_conta_id ?? null,
          observacao,
        },
        ],
      })
      gravarUltimaConta(contaId)
      avisar({ texto: original ? 'Lançamento salvo ✓' : `${TIPOS.find((t) => t.valor === tipo)?.rotulo} de ${moeda(valorNum)} anotada ✓` })
      voltar()
    } catch {
      // O erro aparece na tela pelo estado da mutação.
    }
  }

  async function aoApagar() {
    if (!original) return
    const copia = original
    try {
      // mutateAsync (e não um onSuccess no mutate, que não roda se a tela fechar antes de terminar).
      await remover.mutateAsync(copia.id)
    } catch {
      return // o erro aparece na tela pelo estado da mutação
    }
    voltar()
    avisar({ texto: 'Lançamento apagado', desfazer: () => restaurar.mutate(copia) })
  }

  return (
    <form onSubmit={aoSalvar} noValidate>
      <Voltar padrao={VOLTAR_PADRAO} />
      <TituloPagina titulo={original ? 'Editar lançamento' : 'Lançar'} />

      <div className="flex flex-col gap-6">
        {titulo && (
          <Cartao className="flex items-start gap-3 border-marca/20 bg-marca-clara">
            <Link2 className="mt-0.5 size-5 shrink-0 text-marca" aria-hidden />
            <p className="min-w-0 flex-1">
              Baixa de: <strong>{titulo.descricao}</strong>
              <span className="block text-sm text-suave">
                {titulo.tipo === 'pagar' ? 'Conta a pagar' : 'Conta a receber'} de {moeda(titulo.valor)}, vence em {dataBr(titulo.vencimento)}
              </span>
              <Link to={`/financeiro/contas/${titulo.id}`} className="mt-1 inline-flex min-h-11 items-center font-semibold text-marca">
                Ver a conta
              </Link>
            </p>
          </Cartao>
        )}
        {original?.ofx_fitid && (
          <p className="flex items-center gap-2 text-sm text-suave">
            <FileText className="size-4 shrink-0" aria-hidden />
            Veio do extrato do banco (importado de arquivo OFX).
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <p className="font-semibold">O que aconteceu?</p>
          {tipoFixo ? (
            <p className="text-suave">
              <strong className="text-tinta">{TIPOS.find((t) => t.valor === tipo)?.rotulo}</strong>
              {titulo ? ` · Baixa de: ${titulo.descricao}` : ' · Baixa de uma conta a pagar/receber'} (o tipo não muda)
            </p>
          ) : (
            <Pilulas rotulo="Tipo de lançamento" valor={tipo} aoMudar={mudarTipo} opcoes={TIPOS} />
          )}
        </div>

        <Campo rotulo="Valor" id={idValor} erro={mostrar.valor}>
          <div className="relative flex items-center">
            <span className="pointer-events-none absolute left-4 text-xl font-semibold text-suave">R$</span>
            <input
              id={idValor}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              autoFocus={!original}
              aria-invalid={mostrar.valor ? true : undefined}
              // estilo direto: a regra global "input { font: inherit }" venceria as classes de tamanho
              style={{ fontSize: '1.875rem', fontWeight: 700 }}
              className={`min-h-16 w-full rounded-xl border border-borda bg-superficie pr-4 pl-14 outline-none focus:border-marca focus:ring-2 focus:ring-marca/20 ${
                tipo === 'entrada' ? 'text-ok' : tipo === 'saida' ? 'text-perigo' : 'text-tinta'
              } ${mostrar.valor ? 'border-perigo' : ''}`}
            />
          </div>
        </Campo>

        <Entrada rotulo="Data" type="date" value={data} onChange={(e) => setData(e.target.value)} erro={mostrar.data} />

        {transferencia ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <SeletorConta rotulo="De (saiu de)" contas={contas} valor={contaId} aoMudar={setContaId} erro={mostrar.conta} excluir={destinoId} />
            <SeletorConta rotulo="Para (entrou em)" contas={contas} valor={destinoId} aoMudar={setDestinoId} erro={mostrar.destino} excluir={contaId} />
          </div>
        ) : (
          <>
            <SeletorCategoria tipo={tipo} categorias={categorias} valor={categoriaId} aoMudar={setCategoriaId} erro={mostrar.categoria} />
            <SeletorConta
              rotulo={tipo === 'entrada' ? 'Entrou em' : 'Saiu de'}
              contas={contas}
              valor={contaId}
              aoMudar={setContaId}
              erro={mostrar.conta}
            />
          </>
        )}

        <Entrada
          rotulo="Descrição"
          placeholder={transferencia ? 'Ex.: Troco para o caixa' : tipo === 'entrada' ? 'Ex.: Bolo de aniversário da Ana' : 'Ex.: Compra no atacado'}
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          autoCapitalize="sentences"
          ajuda={transferencia ? 'Opcional' : 'Opcional. Se deixar em branco, usamos o nome da categoria.'}
        />

        <div className="flex flex-col gap-1.5">
          <p className="font-semibold">
            Forma de pagamento <span className="font-normal text-suave">(opcional)</span>
          </p>
          <div role="radiogroup" aria-label="Forma de pagamento" className="flex flex-wrap gap-2">
            {FORMAS_PAGAMENTO.map((f) => {
              const ativo = forma === f
              return (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={ativo}
                  onClick={() => setForma(ativo ? null : f)}
                  className={`min-h-11 rounded-full border px-4 text-[15px] font-medium transition-colors ${
                    ativo ? 'border-marca bg-marca text-white' : 'border-borda bg-superficie text-tinta active:bg-marca-clara'
                  }`}
                >
                  {f}
                </button>
              )
            })}
          </div>
        </div>

        <details
          open={maisAberto}
          onToggle={(e) => setMaisAberto(e.currentTarget.open)}
          className="rounded-2xl border border-borda bg-superficie"
        >
          <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold text-marca">Mais detalhes</summary>
          <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
            {!transferencia && (
              <>
                <Entrada
                  rotulo={tipo === 'entrada' ? 'Cliente' : 'Fornecedor'}
                  placeholder={tipo === 'entrada' ? 'Quem pagou' : 'Para quem você pagou'}
                  value={pessoa}
                  onChange={(e) => setPessoa(e.target.value)}
                  list={idPessoas}
                  autoCapitalize="words"
                />
                <datalist id={idPessoas}>
                  {pessoas.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </>
            )}
            <Campo rotulo="Observação" id={idObs}>
              <textarea
                id={idObs}
                rows={3}
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                className="w-full rounded-xl border border-borda bg-superficie px-4 py-3 text-base outline-none focus:border-marca focus:ring-2 focus:ring-marca/20"
              />
            </Campo>
          </div>
        </details>

        {salvar.isError && <Erro mensagem={mensagemDe(salvar.error)} />}

        {original && (
          <div className="flex flex-col gap-3 pt-4">
            {remover.isError && <Erro mensagem={mensagemDe(remover.error)} />}
            <Botao variante="perigo" onClick={aoApagar} disabled={remover.isPending}>
              {remover.isPending ? 'Apagando…' : 'Apagar lançamento'}
            </Botao>
          </div>
        )}
      </div>

      <BarraAcao>
        <Botao type="submit" className="flex-1" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </Botao>
      </BarraAcao>
    </form>
  )
}
