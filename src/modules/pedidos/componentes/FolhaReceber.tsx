import { useState } from 'react'
import { Botao, EntradaNumero } from '../../../components/ui'
import { centavos } from '../../../lib/compras'
import { lerNumero, moeda, paraCampo, pct } from '../../../lib/format'
import { sinalSugerido } from '../../../lib/pedidos'
import { Folha } from '../../compras/componentes/Folha'

// Quanto receber agora de um pedido (sinal ou o resto). Depois vem a folha de cobrar do PDV,
// que escolhe a forma de pagamento e calcula o troco.

export function FolhaReceber({
  total,
  pago,
  falta,
  pctSinal,
  aoContinuar,
  aoFechar,
}: {
  total: number
  pago: number
  falta: number
  pctSinal: number
  aoContinuar: (valor: number) => void
  aoFechar: () => void
}) {
  const nadaPago = pago <= 0
  const sinal = nadaPago ? sinalSugerido(total, pctSinal, falta) : 0
  const [texto, setTexto] = useState(() => paraCampo(sinal > 0 ? sinal : falta))
  const [tentou, setTentou] = useState(false)

  const lido = lerNumero(texto)
  const valor = Number.isFinite(lido) ? centavos(lido) : NaN
  const erro = !(valor > 0) ? 'Informe o valor' : valor > falta ? `Passa do que falta (${moeda(falta)})` : undefined

  function continuar() {
    setTentou(true)
    if (!erro) aoContinuar(valor)
  }

  const atalhos = [
    ...(sinal > 0 && sinal < falta ? [{ rotulo: `Sinal ${pct(pctSinal)}`, valor: sinal }] : []),
    { rotulo: nadaPago ? 'Tudo' : 'Tudo que falta', valor: falta },
  ]

  return (
    <Folha
      titulo={nadaPago ? 'Receber sinal' : 'Receber pagamento'}
      subtitulo={`Total ${moeda(total)}${pago > 0 ? ` · já pago ${moeda(pago)} · falta ${moeda(falta)}` : ''}`}
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao variante="secundario" className="flex-1" onClick={aoFechar}>
            Voltar
          </Botao>
          <Botao className="flex-1" onClick={continuar}>
            Cobrar {valor > 0 && !erro ? moeda(valor) : ''}
          </Botao>
        </>
      }
    >
      <div className="flex flex-wrap gap-2" role="group" aria-label="Valores prontos">
        {atalhos.map((a) => {
          const ativo = valor === a.valor
          return (
            <button
              key={a.rotulo}
              type="button"
              aria-pressed={ativo}
              onClick={() => setTexto(paraCampo(a.valor))}
              className={`flex min-h-12 flex-col items-start justify-center rounded-2xl border px-4 py-1 text-left transition-colors ${
                ativo ? 'border-marca bg-marca text-white' : 'border-borda bg-superficie active:bg-marca-clara'
              }`}
            >
              <span className="text-sm">{a.rotulo}</span>
              <span className="font-bold">{moeda(a.valor)}</span>
            </button>
          )
        })}
      </div>
      <EntradaNumero
        rotulo="Valor a receber agora"
        prefixo="R$"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && continuar()}
        erro={tentou ? erro : undefined}
        ajuda={nadaPago ? 'O resto é recebido na entrega.' : undefined}
      />
    </Folha>
  )
}
