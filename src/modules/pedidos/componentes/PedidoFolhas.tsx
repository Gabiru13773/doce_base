import { useState } from 'react'
import { useAviso } from '../../../components/Aviso'
import { Botao, Entrada } from '../../../components/ui'
import { moeda } from '../../../lib/format'
import { Fichas, Folha } from '../../compras/componentes/Folha'
import { mensagemDe } from '../../financeiro/util'
import { useCancelarPedido, type Pedido } from '../api'

// Folhas da tela do pedido: confirmar uma ação e cancelar o pedido (com motivo).

export function FolhaConfirmarPedido({
  titulo,
  texto,
  botao,
  perigo = false,
  pendente,
  erro,
  aoConfirmar,
  aoFechar,
}: {
  titulo: string
  texto: string
  botao: string
  perigo?: boolean
  pendente: boolean
  erro?: string | null
  aoConfirmar: () => void
  aoFechar: () => void
}) {
  return (
    <Folha
      titulo={titulo}
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao variante="secundario" className="flex-1" onClick={aoFechar} disabled={pendente}>
            Voltar
          </Botao>
          <Botao variante={perigo ? 'perigo' : 'principal'} className="flex-1" onClick={aoConfirmar} disabled={pendente} data-foco-inicial>
            {pendente ? 'Aguarde…' : botao}
          </Botao>
        </>
      }
    >
      <p>{texto}</p>
      {erro && <p className="rounded-2xl bg-perigo-claro px-4 py-3 font-medium text-perigo">Não deu certo: {erro}</p>}
    </Folha>
  )
}

const MOTIVOS = ['Cliente desistiu', 'Lançado errado', 'Outro']

export function FolhaCancelarPedido({ pedido, pago, aoFechar }: { pedido: Pedido; pago: number; aoFechar: () => void }) {
  const avisar = useAviso()
  const cancelar = useCancelarPedido()
  const [motivo, setMotivo] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [tentou, setTentou] = useState(false)

  const textoFinal = motivo === 'Outro' ? texto.trim() : motivo ? [motivo, texto.trim()].filter(Boolean).join(' — ') : ''
  const erroMotivo = !motivo ? 'Escolha o motivo' : motivo === 'Outro' && !texto.trim() ? 'Conte o motivo' : undefined

  async function confirmar() {
    setTentou(true)
    if (erroMotivo) return
    try {
      await cancelar.mutateAsync({ pedido, motivo: textoFinal })
      avisar({ texto: 'Pedido cancelado' })
      aoFechar()
    } catch {
      // aparece na folha
    }
  }

  return (
    <Folha
      titulo="Cancelar pedido"
      subtitulo={pedido.cliente_nome}
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao variante="secundario" className="flex-1" onClick={aoFechar} disabled={cancelar.isPending}>
            Voltar
          </Botao>
          <Botao variante="perigo" className="flex-1" onClick={confirmar} disabled={cancelar.isPending}>
            {cancelar.isPending ? 'Cancelando…' : 'Cancelar pedido'}
          </Botao>
        </>
      }
    >
      {pago > 0 && (
        <p className="rounded-2xl bg-alerta-claro px-4 py-3">
          O {pago < pedido.total ? 'sinal' : 'pagamento'} de {moeda(pago)} continua no caixa. Se devolveu ao cliente, cancele o pagamento na
          tela do pedido.
        </p>
      )}
      <div className="flex flex-col gap-2">
        <p className="font-semibold">Por que cancelar?</p>
        <Fichas rotulo="Motivo" opcoes={MOTIVOS} valor={motivo} aoMudar={setMotivo} />
        {tentou && erroMotivo && !motivo && <p className="text-sm font-medium text-perigo">{erroMotivo}</p>}
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
