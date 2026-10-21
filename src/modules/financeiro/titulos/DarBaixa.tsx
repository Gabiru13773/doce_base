import { X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAviso } from '../../../components/Aviso'
import { Botao, Entrada, EntradaNumero, Erro, Pilulas } from '../../../components/ui'
import { novoId } from '../../../lib/db'
import { baixasPorTitulo, situacaoTitulo } from '../../../lib/financeiro'
import { lerNumero, moeda, paraCampo } from '../../../lib/format'
import {
  FORMAS_PAGAMENTO,
  hoje,
  useContasFin,
  useLancamentos,
  useRemoverLancamento,
  useRestaurarLancamento,
  useSalvarLancamentos,
  type Lancamento,
  type Titulo,
} from '../api'
import { SeletorConta } from '../componentes/Seletores'
import { descricaoBaixa, mensagemDe, PALAVRAS, ultimaContaUsada } from './util'

const SELETOR_FOCAVEL = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'

/**
 * Janela para "dar baixa" (marcar como paga/recebida) numa conta a pagar ou a receber.
 * Grava um lançamento ligado ao título; aceita pagamento em parte.
 * No celular abre como uma folha que sobe do rodapé; no computador, no meio da tela.
 */
export function DarBaixa({ titulo, aberto, aoFechar }: { titulo: Titulo; aberto: boolean; aoFechar: () => void }) {
  if (!aberto) return null
  // key: cada abertura começa com os valores padrão.
  return <Painel key={titulo.id} titulo={titulo} aoFechar={aoFechar} />
}

/** Apaga uma baixa e mostra o aviso com Desfazer (que devolve o mesmo lançamento). */
export function useDesfazerBaixa() {
  const avisar = useAviso()
  const remover = useRemoverLancamento()
  const restaurar = useRestaurarLancamento()
  return {
    // mutateAsync (e não um onSuccess no mutate, que não roda se a tela fechar antes de terminar).
    desfazer: (l: Lancamento) =>
      remover
        .mutateAsync(l.id)
        .then(() => avisar({ texto: `Baixa de ${moeda(l.valor)} desfeita`, desfazer: () => restaurar.mutate(l) }))
        .catch(() => {
          // o erro aparece na tela pelo estado da mutação
        }),
    pendente: remover.isPending,
    erro: remover.isError ? mensagemDe(remover.error) : null,
  }
}

function Painel({ titulo, aoFechar }: { titulo: Titulo; aoFechar: () => void }) {
  const avisar = useAviso()
  const { data: lancamentos } = useLancamentos()
  const { data: contas, isLoading: carregandoContas } = useContasFin()
  const salvar = useSalvarLancamentos()
  const remover = useRemoverLancamento()
  const palavras = PALAVRAS[titulo.tipo]

  const dia = hoje()
  const sit = useMemo(
    () => situacaoTitulo(titulo, baixasPorTitulo(lancamentos ?? [], [titulo]), dia),
    [titulo, lancamentos, dia],
  )
  // Id do lançamento, gerado uma vez por abertura da janela: se a gravação for repetida
  // (toque duplo, rede que caiu depois de gravar), atualiza a mesma baixa em vez de duplicar.
  const [idNovo] = useState(() => novoId())
  const contasAtivas = (contas ?? []).filter((c) => c.ativo)
  const contaPadrao = (() => {
    const ids = new Set(contasAtivas.map((c) => c.id))
    if (titulo.conta_id && ids.has(titulo.conta_id)) return titulo.conta_id
    const ultima = ultimaContaUsada(lancamentos)
    if (ultima && ids.has(ultima)) return ultima
    return contasAtivas.length === 1 ? contasAtivas[0].id : null
  })()
  const formaPadrao = (() => {
    let ultima: Lancamento | null = null
    for (const l of lancamentos ?? []) if (l.titulo_id && l.forma_pagamento && (!ultima || l.criado_em > ultima.criado_em)) ultima = l
    return ultima?.forma_pagamento ?? 'Pix'
  })()

  const [valor, setValor] = useState(paraCampo(sit.falta))
  const [data, setData] = useState(dia)
  // null = ainda não mexeu: usa a conta padrão (que pode chegar depois do carregamento).
  const [contaEscolhida, setContaEscolhida] = useState<string | null | undefined>(undefined)
  const [forma, setForma] = useState<string | undefined>(undefined)
  const [tentou, setTentou] = useState(false)
  const contaId = contaEscolhida === undefined ? contaPadrao : contaEscolhida
  const formaAtual = forma ?? formaPadrao

  const valorNum = lerNumero(valor)
  const erros: { valor?: string; data?: string; conta?: string } = {}
  if (!(valorNum > 0)) erros.valor = 'Informe o valor'
  else if (Math.round(valorNum * 100) > Math.round(sit.falta * 100))
    erros.valor = `Passa do que falta (${moeda(sit.falta)}). Se teve juros, mude antes o valor da conta.`
  if (!data) erros.data = 'Escolha a data'
  if (!contaId) erros.conta = titulo.tipo === 'pagar' ? 'De onde saiu o dinheiro?' : 'Para onde foi o dinheiro?'
  const temErro = Object.keys(erros).length > 0
  const mostrar = tentou ? erros : {}

  const painel = useRef<HTMLDivElement>(null)
  const fecharRef = useRef(aoFechar)
  useEffect(() => {
    fecharRef.current = aoFechar
  })

  // Trava a rolagem do fundo, fecha com Esc e devolve o foco ao fechar.
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null
    const overflowAntes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    painel.current?.querySelector<HTMLElement>('[data-foco-inicial]')?.focus()
    function aoTeclar(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        fecharRef.current()
      }
    }
    document.addEventListener('keydown', aoTeclar)
    return () => {
      document.removeEventListener('keydown', aoTeclar)
      document.body.style.overflow = overflowAntes
      if (anterior && document.contains(anterior)) anterior.focus()
    }
  }, [])

  function prenderFoco(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab' || !painel.current) return
    const focaveis = Array.from(painel.current.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL))
    if (focaveis.length === 0) return
    const primeiro = focaveis[0]
    const ultimo = focaveis[focaveis.length - 1]
    if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault()
      ultimo.focus()
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault()
      primeiro.focus()
    }
  }

  async function confirmar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (temErro || !contaId) return
    try {
      const [salvo] = await salvar.mutateAsync({
        novos: true,
        lista: [
        {
          id: idNovo,
          tipo: titulo.tipo === 'pagar' ? 'saida' : 'entrada',
          data,
          valor: valorNum,
          conta_id: contaId,
          conta_destino_id: null,
          categoria_id: titulo.categoria_id,
          descricao: descricaoBaixa(titulo),
          pessoa: titulo.pessoa,
          titulo_id: titulo.id,
          forma_pagamento: formaAtual || null,
          ofx_fitid: null,
          ofx_conta_id: null,
          observacao: null,
        },
        ],
      })
      const total = Math.round(valorNum * 100) === Math.round(sit.falta * 100)
      const texto =
        titulo.tipo === 'pagar'
          ? total
            ? 'Conta paga ✓'
            : `Pagamento de ${moeda(valorNum)} anotado ✓`
          : total
            ? 'Conta recebida ✓'
            : `Recebimento de ${moeda(valorNum)} anotado ✓`
      aoFechar()
      avisar({ texto, desfazer: () => remover.mutate(salvo.id) })
    } catch {
      // O erro aparece na janela pelo estado da mutação.
    }
  }

  const semContas = !carregandoContas && contasAtivas.length === 0
  const idTitulo = `baixa-${titulo.id}`

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-tinta/40 md:items-center md:p-6" onClick={aoFechar}>
      <div
        ref={painel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        onKeyDown={prenderFoco}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-creme shadow-xl md:max-w-lg md:rounded-3xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-borda px-4 pt-4 pb-3">
          <div className="min-w-0">
            <h2 id={idTitulo} className="text-xl font-bold">
              {titulo.tipo === 'pagar' ? 'Pagar conta' : 'Receber conta'}
            </h2>
            <p className="truncate text-suave">
              {descricaoBaixa(titulo)}
              {titulo.pessoa ? ` · ${titulo.pessoa}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            className="inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-2xl px-3 font-semibold text-marca active:bg-marca-clara"
          >
            <X className="size-6" aria-hidden />
            Fechar
          </button>
        </header>

        {semContas ? (
          <div className="safe-bottom flex flex-col gap-4 overflow-y-auto px-4 py-5">
            <p>
              Para marcar como {palavras.feito.toLowerCase()}, o app precisa saber{' '}
              {titulo.tipo === 'pagar' ? 'de onde saiu o dinheiro' : 'para onde foi o dinheiro'} (conta no banco, caixa ou
              carteira digital).
            </p>
            <p className="text-suave">Cadastre uma conta primeiro. É rapidinho.</p>
            <Link
              to="/financeiro/bancos/nova"
              className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-marca px-5 font-semibold text-white active:bg-marca-escura"
            >
              Cadastrar conta do banco ou caixa
            </Link>
          </div>
        ) : (
          <form onSubmit={confirmar} noValidate className="safe-bottom flex flex-col gap-5 overflow-y-auto px-4 py-4">
            <div className="flex items-baseline justify-between gap-3 rounded-2xl bg-superficie px-4 py-3">
              <span className="text-suave">{sit.pago > 0 ? 'Ainda falta' : 'Valor da conta'}</span>
              <span className="text-lg font-bold">{moeda(sit.falta)}</span>
            </div>

            <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
              <EntradaNumero
                rotulo={titulo.tipo === 'pagar' ? 'Quanto pagou' : 'Quanto recebeu'}
                prefixo="R$"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                erro={mostrar.valor}
                ajuda={valorNum > 0 && valorNum < sit.falta ? `Fica faltando ${moeda(sit.falta - valorNum)}` : undefined}
                data-foco-inicial
              />
              <Entrada
                rotulo="Data"
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                erro={mostrar.data}
              />
            </div>

            <SeletorConta
              rotulo={titulo.tipo === 'pagar' ? 'Saiu de qual conta?' : 'Entrou em qual conta?'}
              contas={contas ?? []}
              valor={contaId}
              aoMudar={setContaEscolhida}
              erro={mostrar.conta}
            />

            <div className="flex flex-col gap-1.5">
              <p className="font-semibold">Forma de pagamento</p>
              <Pilulas
                rotulo="Forma de pagamento"
                valor={formaAtual}
                aoMudar={setForma}
                opcoes={FORMAS_PAGAMENTO.map((f) => ({ valor: f, rotulo: f }))}
              />
            </div>

            {salvar.isError && <Erro mensagem={mensagemDe(salvar.error)} />}

            <Botao type="submit" className="w-full text-lg" disabled={salvar.isPending}>
              {salvar.isPending
                ? 'Salvando…'
                : `Confirmar ${titulo.tipo === 'pagar' ? 'pagamento' : 'recebimento'}${valorNum > 0 ? ` de ${moeda(valorNum)}` : ''}`}
            </Botao>
          </form>
        )}
      </div>
    </div>
  )
}
