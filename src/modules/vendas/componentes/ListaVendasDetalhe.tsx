import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAviso } from '../../../components/Aviso'
import { Botao, Entrada, Erro } from '../../../components/ui'
import { moeda, numero } from '../../../lib/format'
import { Fichas, Folha } from '../../compras/componentes/Folha'
import { dataBr, mensagemDe } from '../../financeiro/util'
import { useCancelarVenda, type Venda } from '../api'
import { EtiquetaCanal, EtiquetaPedido, hora, rotuloForma } from './ListaVendas'

// Detalhes de uma venda, com o Cancelar venda (só enquanto o caixa do dia está aberto).

const MOTIVOS = ['Lançada errado', 'Cliente desistiu', 'Outro']

export function DetalheVenda({ venda: v, aoFechar }: { venda: Venda; aoFechar: () => void }) {
  const avisar = useAviso()
  const cancelar = useCancelarVenda()
  const [cancelando, setCancelando] = useState(false)
  const [motivo, setMotivo] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [tentou, setTentou] = useState(false)

  const cancelada = v.status === 'cancelada'
  const fechada = !!v.fechamento_id
  const textoFinal = motivo === 'Outro' ? texto.trim() : motivo ? [motivo, texto.trim()].filter(Boolean).join(' — ') : ''
  const erroMotivo = !motivo ? 'Escolha o motivo' : motivo === 'Outro' && !texto.trim() ? 'Conte o motivo' : undefined

  async function confirmar() {
    setTentou(true)
    if (erroMotivo) return
    try {
      await cancelar.mutateAsync({ venda: v, motivo: textoFinal })
      avisar({ texto: 'Venda cancelada ✓' })
      aoFechar()
    } catch {
      // aparece na folha
    }
  }

  const rodape = cancelada || fechada ? undefined : cancelando ? (
    <>
      <Botao variante="secundario" className="flex-1" onClick={() => setCancelando(false)} disabled={cancelar.isPending}>
        Voltar
      </Botao>
      <Botao variante="perigo" className="flex-1" onClick={confirmar} disabled={cancelar.isPending}>
        {cancelar.isPending ? 'Cancelando…' : 'Cancelar venda'}
      </Botao>
    </>
  ) : (
    <Botao variante="perigo" className="flex-1" onClick={() => setCancelando(true)}>
      Cancelar venda
    </Botao>
  )

  return (
    <Folha
      titulo={cancelada ? 'Venda cancelada' : `Venda de ${moeda(v.total)}`}
      subtitulo={`${dataBr(v.data)} às ${hora(v.criado_em)}${v.feito_por ? ` · ${v.feito_por}` : ''}`}
      aoFechar={aoFechar}
      rodape={rodape}
    >
      <div className="flex flex-wrap items-center gap-2">
        <EtiquetaCanal canal={v.canal} />
        {v.pedido_id && <EtiquetaPedido />}
        {v.cliente && <span className="text-suave">Cliente: {v.cliente}</span>}
      </div>

      {v.pedido_id && (
        <Link
          to={`/vendas/pedidos/${v.pedido_id}`}
          className="inline-flex min-h-12 items-center self-start rounded-xl px-2 font-semibold text-marca underline active:bg-marca-clara"
        >
          Ver pedido
        </Link>
      )}

      {cancelada && (
        <p className="rounded-2xl bg-perigo-claro px-4 py-3 text-perigo">
          <strong>Motivo:</strong> {v.motivo_cancelamento}
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="font-bold">Itens</h3>
        <ul className="divide-y divide-borda rounded-2xl border border-borda bg-superficie">
          {v.itens.map((i, n) => (
            <li key={n} className="flex items-start gap-3 px-4 py-2">
              <span className="min-w-0 flex-1">
                <span className="block">{i.nome}</span>
                <span className="block text-sm text-suave">
                  {numero(i.qtd, 3)} × {moeda(i.preco)}
                </span>
              </span>
              <span className="shrink-0 font-semibold">{moeda(i.qtd * i.preco)}</span>
            </li>
          ))}
        </ul>
        <dl className="flex flex-col gap-1 px-1">
          {v.desconto > 0 && (
            <>
              <Linha rotulo="Soma dos itens">{moeda(v.subtotal)}</Linha>
              <Linha rotulo="Desconto">− {moeda(v.desconto)}</Linha>
            </>
          )}
          <Linha rotulo="Total" forte>
            {moeda(v.total)}
          </Linha>
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-bold">Pagamento</h3>
        <dl className="flex flex-col gap-1 px-1">
          {v.pagamentos.map((p, n) => (
            <Linha key={n} rotulo={rotuloForma(p.forma)}>
              {moeda(p.valor)}
            </Linha>
          ))}
          {v.troco > 0 && <Linha rotulo="Troco">{moeda(v.troco)}</Linha>}
          {v.taxas > 0 && <Linha rotulo="Taxas (maquininha/iFood)">{moeda(v.taxas)}</Linha>}
        </dl>
      </section>

      {v.observacao && (
        <section className="flex flex-col gap-1">
          <h3 className="font-bold">Observação</h3>
          <p>{v.observacao}</p>
        </section>
      )}

      {!cancelada && fechada && (
        <p className="rounded-2xl bg-alerta-claro px-4 py-3 text-[15px]">
          O caixa deste dia já foi fechado, então a venda não pode ser cancelada.{' '}
          <Link to={`/vendas/caixa?data=${v.data}`} className="font-semibold text-marca underline">
            Reabrir o caixa
          </Link>{' '}
          para poder cancelar.
        </p>
      )}

      {!cancelada && !fechada && cancelando && (
        <section className="flex flex-col gap-3">
          <h3 className="font-bold">Por que cancelar?</h3>
          <Fichas rotulo="Motivo" opcoes={MOTIVOS} valor={motivo} aoMudar={setMotivo} />
          {motivo && (
            <Entrada
              rotulo={motivo === 'Outro' ? 'Qual o motivo?' : 'Quer explicar? (opcional)'}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              erro={tentou && motivo === 'Outro' && !texto.trim() ? 'Conte o motivo' : undefined}
            />
          )}
          {tentou && !motivo && <p className="text-sm font-medium text-perigo">Escolha o motivo</p>}
          <p className="text-sm text-suave">
            {v.pedido_id
              ? 'A venda continua na lista, riscada, e este pagamento deixa de contar no pedido.'
              : 'A venda continua na lista, riscada, e o que saiu do estoque volta.'}
          </p>
          {cancelar.isError && <Erro mensagem={mensagemDe(cancelar.error)} />}
        </section>
      )}
    </Folha>
  )
}

function Linha({ rotulo, children, forte }: { rotulo: string; children: ReactNode; forte?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${forte ? 'text-lg font-bold' : ''}`}>
      <dt className={forte ? '' : 'text-suave'}>{rotulo}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  )
}
