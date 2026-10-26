import { CheckCircle2, CloudUpload } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useAviso } from '../../../components/Aviso'
import { Botao, Carregando, Entrada, Erro } from '../../../components/ui'
import { moeda } from '../../../lib/format'
import type { SituacaoPagamento } from '../../../lib/pedidos'
import { Fichas, Folha } from '../../compras/componentes/Folha'
import { dataBr, mensagemDe } from '../../financeiro/util'
import { useCancelarVenda, type Venda } from '../../vendas/api'
import { hora, rotuloForma } from '../../vendas/componentes/ListaVendas'

// Pagamentos do pedido (vendas do PDV com pedido_id): quanto foi pago, quanto falta e a lista,
// com o Cancelar (ex.: sinal devolvido ao cliente).

export function PagamentosPedido({
  vendas,
  carregando,
  erro,
  tentarDeNovo,
  situacao,
  total,
  acao,
}: {
  vendas: Venda[] | undefined
  carregando: boolean
  erro: unknown
  tentarDeNovo: () => void
  situacao: SituacaoPagamento
  total: number
  /** botão de receber (quando cabe) */
  acao?: ReactNode
}) {
  const [cancelando, setCancelando] = useState<Venda | null>(null)

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">Pagamento</h2>
      {!vendas && erro ? (
        <Erro mensagem={mensagemDe(erro)} tentarDeNovo={tentarDeNovo} />
      ) : !vendas && carregando ? (
        <Carregando />
      ) : (
        <>
          <ResumoPagamento situacao={situacao} total={total} />
          {acao}
          {vendas && vendas.length > 0 && (
            <ul className="divide-y divide-borda overflow-hidden rounded-2xl border border-borda bg-superficie">
              {vendas.map((v) => (
                <li key={v.id}>
                  <LinhaPagamento venda={v} aoCancelar={() => setCancelando(v)} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {cancelando && <FolhaCancelarPagamento venda={cancelando} aoFechar={() => setCancelando(null)} />}
    </section>
  )
}

function ResumoPagamento({ situacao: s, total }: { situacao: SituacaoPagamento; total: number }) {
  if (s.quitado)
    return (
      <div className="flex flex-col gap-1 rounded-2xl bg-ok-claro px-4 py-3 text-ok">
        <p className="flex items-center gap-2 text-lg font-bold">
          <CheckCircle2 className="size-5" aria-hidden />
          Pago {total > 0 ? moeda(s.pago) : ''}
        </p>
        {s.passou > 0 && <p className="font-medium text-alerta">Recebeu {moeda(s.passou)} a mais que o total do pedido.</p>}
      </div>
    )
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-alerta-claro px-4 py-3">
      <div>
        <p className="text-sm text-suave">{s.pago > 0 ? `Pago ${moeda(s.pago)}` : 'Nada pago ainda'}</p>
        <p className="text-lg font-bold text-alerta">Falta {moeda(s.falta)}</p>
      </div>
    </div>
  )
}

function LinhaPagamento({ venda: v, aoCancelar }: { venda: Venda; aoCancelar: () => void }) {
  const cancelada = v.status === 'cancelada'
  // "Sinal do pedido — Ana (entrega 24/10)" → "Sinal do pedido"
  const tipo = v.itens[0]?.nome.split(' — ')[0] || 'Pagamento'
  const formas =
    v.pagamentos.length > 1
      ? v.pagamentos.map((p) => `${rotuloForma(p.forma)} ${moeda(p.valor)}`).join(' + ')
      : v.pagamentos.map((p) => rotuloForma(p.forma)).join('')
  return (
    <div className={`flex items-start gap-3 px-4 py-3 ${cancelada ? 'opacity-70' : ''}`}>
      <div className="min-w-0 flex-1">
        <p className={`font-semibold ${cancelada ? 'line-through' : ''}`}>
          {tipo} · {moeda(v.total)}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-suave">
          <span>
            {dataBr(v.data)} às {hora(v.criado_em)}
          </span>
          <span>· {formas}</span>
          {v.troco > 0 && <span>· troco {moeda(v.troco)}</span>}
          {v.feito_por && <span>· {v.feito_por}</span>}
          {v.pendente && (
            <span className="inline-flex items-center gap-1 rounded-full bg-alerta-claro px-2 text-alerta">
              <CloudUpload className="size-3.5" aria-hidden />
              por enviar
            </span>
          )}
        </p>
        {cancelada && <p className="mt-1 text-sm font-medium text-perigo">Cancelado: {v.motivo_cancelamento}</p>}
      </div>
      {!cancelada && (
        <Botao variante="texto" className="shrink-0 px-3 text-perigo" onClick={aoCancelar}>
          Cancelar
        </Botao>
      )}
    </div>
  )
}

const MOTIVOS = ['Devolvido ao cliente', 'Lançado errado', 'Outro']

function FolhaCancelarPagamento({ venda, aoFechar }: { venda: Venda; aoFechar: () => void }) {
  const avisar = useAviso()
  const cancelar = useCancelarVenda()
  const [motivo, setMotivo] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [tentou, setTentou] = useState(false)

  const textoFinal = motivo === 'Outro' ? texto.trim() : motivo ? [motivo, texto.trim()].filter(Boolean).join(' — ') : ''
  const erroMotivo = !motivo ? 'Escolha o motivo' : motivo === 'Outro' && !texto.trim() ? 'Conte o motivo' : undefined

  async function confirmar() {
    setTentou(true)
    if (erroMotivo) return
    try {
      await cancelar.mutateAsync({ venda, motivo: textoFinal })
      avisar({ texto: 'Pagamento cancelado ✓' })
      aoFechar()
    } catch {
      // aparece na folha
    }
  }

  return (
    <Folha
      titulo={`Cancelar pagamento de ${moeda(venda.total)}`}
      subtitulo={`${dataBr(venda.data)} às ${hora(venda.criado_em)}`}
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao variante="secundario" className="flex-1" onClick={aoFechar} disabled={cancelar.isPending}>
            Voltar
          </Botao>
          <Botao variante="perigo" className="flex-1" onClick={confirmar} disabled={cancelar.isPending}>
            {cancelar.isPending ? 'Cancelando…' : 'Cancelar pagamento'}
          </Botao>
        </>
      }
    >
      <p>O valor sai das vendas do dia {dataBr(venda.data)} e volta a faltar no pedido.</p>
      <div className="flex flex-col gap-2">
        <p className="font-semibold">Por quê?</p>
        <Fichas rotulo="Motivo" opcoes={MOTIVOS} valor={motivo} aoMudar={setMotivo} />
        {tentou && !motivo && <p className="text-sm font-medium text-perigo">{erroMotivo}</p>}
      </div>
      {motivo && (
        <Entrada
          rotulo={motivo === 'Outro' ? 'Motivo' : 'Detalhe (opcional)'}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          erro={tentou && motivo === 'Outro' ? erroMotivo : undefined}
        />
      )}
      {cancelar.isError && (
        <p className="rounded-2xl bg-perigo-claro px-4 py-3 font-medium text-perigo">Não deu certo: {mensagemDe(cancelar.error)}</p>
      )}
    </Folha>
  )
}
