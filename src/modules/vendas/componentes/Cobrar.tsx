import { Banknote, Bike, CreditCard, Plus, QrCode, X, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { Botao, classeEntrada } from '../../../components/ui'
import { centavos } from '../../../lib/compras'
import { lerNumero, moeda, paraCampo } from '../../../lib/format'
import { FORMAS, faltaPagar, formasDoCanal, juntarPagamentos, troco, type Canal, type FormaPagamento, type Pagamento } from '../../../lib/vendas'
import { Folha } from '../../compras/componentes/Folha'

// Folha de cobrar: escolhe a forma de pagamento (ou divide em mais de uma), calcula o troco
// do dinheiro e confirma a venda.

const ICONE: Record<FormaPagamento, LucideIcon> = {
  pix: QrCode,
  dinheiro: Banknote,
  debito: CreditCard,
  credito: CreditCard,
  ifood: Bike,
}

const rotuloForma = (f: FormaPagamento) => FORMAS.find((x) => x.valor === f)?.rotulo ?? f

interface Parte {
  chave: number
  forma: FormaPagamento
  texto: string
}

export interface ResultadoCobranca {
  /** a parte do dinheiro é a que ficou na venda (não o que foi recebido) */
  pagamentos: Pagamento[]
  troco: number
  cliente: string
  observacao: string
}

export function FolhaCobrar({
  total,
  canal,
  aoConfirmar,
  aoFechar,
  erro,
}: {
  total: number
  canal: Canal
  aoConfirmar: (r: ResultadoCobranca) => void
  aoFechar: () => void
  /** a venda foi recusada na conferência final (mostra e mantém a folha aberta) */
  erro?: string | null
}) {
  const formas = formasDoCanal(canal)
  const [partes, setPartes] = useState<Parte[]>(() => (formas.length === 1 ? [{ chave: 1, forma: formas[0], texto: paraCampo(total) }] : []))
  const [dividir, setDividir] = useState(false)
  const [recebido, setRecebido] = useState('')
  const [cliente, setCliente] = useState('')
  const [observacao, setObservacao] = useState('')
  const [extras, setExtras] = useState(canal !== 'balcao')

  const valorDe = (t: string) => {
    const n = lerNumero(t)
    return Number.isFinite(n) && n > 0 ? centavos(n) : 0
  }
  const linhas = partes.map((p) => ({ ...p, valor: dividir ? valorDe(p.texto) : total }))
  const pagos: Pagamento[] = linhas.map((l) => ({ forma: l.forma, valor: l.valor }))
  const falta = faltaPagar(total, pagos)
  const temDinheiro = linhas.some((l) => l.forma === 'dinheiro')
  const dinheiroDigitado = centavos(linhas.filter((l) => l.forma === 'dinheiro').reduce((s, l) => s + l.valor, 0))
  // Passou do total: se o dinheiro cobre a sobra, ela vira troco.
  const excesso = falta < 0 ? -falta : 0
  const sobraViraTroco = excesso > 0 && dinheiroDigitado >= excesso
  const dinheiroNaVenda = centavos(dinheiroDigitado - (sobraViraTroco ? excesso : 0))
  const recebidoLido = lerNumero(recebido)
  const recebidoVazio = recebido.trim() === ''
  const recebidoInvalido = !recebidoVazio && !(Number.isFinite(recebidoLido) && recebidoLido >= 0)
  const recebidoNum = recebidoVazio || recebidoInvalido ? dinheiroDigitado : centavos(recebidoLido)
  const trocoVenda = temDinheiro ? troco(recebidoNum, dinheiroNaVenda) : 0
  const recebeuMenos = temDinheiro && !recebidoInvalido && recebidoNum < dinheiroNaVenda

  let problema: string | null = null
  if (total > 0 && linhas.length === 0) problema = 'Escolha como o cliente pagou'
  else if (falta > 0) problema = `Falta ${moeda(falta)}`
  else if (excesso > 0 && !sobraViraTroco) problema = `Passou ${moeda(excesso)} do total`
  else if (recebidoInvalido) problema = 'Confira o valor recebido'
  else if (recebeuMenos) problema = `Recebeu menos que ${moeda(dinheiroNaVenda)}`

  function escolher(forma: FormaPagamento) {
    if (!dividir) {
      setPartes([{ chave: Date.now(), forma, texto: paraCampo(total) }])
      return
    }
    setPartes((ps) => [...ps, { chave: Date.now(), forma, texto: falta > 0 ? paraCampo(falta) : '' }])
  }

  function comecarDivisao() {
    setDividir(true)
    setPartes((ps) => ps.map((p) => ({ ...p, texto: paraCampo(total) })))
  }

  function confirmar() {
    if (problema) return
    const pagamentos = juntarPagamentos([
      ...pagos.filter((p) => p.forma !== 'dinheiro'),
      ...(temDinheiro ? [{ forma: 'dinheiro' as const, valor: dinheiroNaVenda }] : []),
    ])
    aoConfirmar({ pagamentos, troco: trocoVenda, cliente, observacao })
  }

  const notas = [5, 10, 20, 50, 100, 200].filter((n) => n > dinheiroNaVenda).slice(0, 4)
  const selecionada = !dividir && linhas.length === 1 ? linhas[0].forma : null

  return (
    <Folha
      titulo={`Cobrar ${moeda(total)}`}
      aoFechar={aoFechar}
      rodape={
        <div className="flex w-full flex-col gap-2">
          {erro && (
            <p className="text-center font-semibold text-perigo" role="alert">
              {erro}
            </p>
          )}
          {problema && linhas.length > 0 && (
            <p className="text-center font-semibold text-alerta" aria-live="polite">
              {problema}
            </p>
          )}
          <div className="flex gap-3">
            <Botao variante="secundario" className="flex-1" onClick={aoFechar}>
              Voltar
            </Botao>
            <Botao className="min-h-14 flex-[2] text-lg" disabled={!!problema} onClick={confirmar}>
              {trocoVenda > 0 ? `Confirmar · troco ${moeda(trocoVenda)}` : 'Confirmar venda'}
            </Botao>
          </div>
        </div>
      }
    >
      <section className="flex flex-col gap-3">
        <h3 className="font-semibold">{dividir ? 'Adicionar outra forma' : 'Como o cliente pagou?'}</h3>
        <div className="grid grid-cols-2 gap-2">
          {formas.map((f, i) => {
            const Icone = ICONE[f]
            const ativa = selecionada === f
            return (
              <button
                key={f}
                type="button"
                onClick={() => escolher(f)}
                aria-pressed={dividir ? undefined : ativa}
                data-foco-inicial={i === 0 ? '' : undefined}
                className={`flex min-h-16 items-center justify-center gap-2 rounded-2xl border-2 px-3 text-lg font-semibold transition-colors ${
                  formas.length === 1 ? 'col-span-2' : ''
                } ${ativa ? 'border-marca bg-marca text-white' : 'border-borda bg-superficie text-tinta active:bg-marca-clara'}`}
              >
                {dividir ? <Plus className="size-5" aria-hidden /> : <Icone className="size-6" aria-hidden />}
                {rotuloForma(f)}
              </button>
            )
          })}
        </div>
        {!dividir && formas.length > 1 && linhas.length === 1 && (
          <button type="button" onClick={comecarDivisao} className="-ml-2 min-h-12 self-start rounded-xl px-2 font-semibold text-marca active:bg-marca-clara">
            + Pagou com mais de uma forma
          </button>
        )}
      </section>

      {dividir && (
        <section className="flex flex-col gap-2" aria-label="Formas de pagamento">
          {linhas.length === 0 && <p className="text-suave">Toque numa forma acima para adicionar.</p>}
          {linhas.map((l) => {
            const ruim = l.texto.trim() !== '' && !Number.isFinite(lerNumero(l.texto))
            return (
              <div key={l.chave} className="flex items-center gap-2">
                <label htmlFor={`parte-${l.chave}`} className="w-24 shrink-0 font-semibold">
                  {rotuloForma(l.forma)}
                </label>
                <div className="relative flex flex-1 items-center">
                  <span className="pointer-events-none absolute left-4 text-suave">R$</span>
                  <input
                    id={`parte-${l.chave}`}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={l.texto}
                    onChange={(e) => setPartes((ps) => ps.map((p) => (p.chave === l.chave ? { ...p, texto: e.target.value } : p)))}
                    placeholder="0,00"
                    aria-invalid={ruim || undefined}
                    className={`${classeEntrada} pl-11 ${ruim ? 'border-perigo' : ''}`}
                  />
                </div>
                <button
                  type="button"
                  aria-label={`Tirar ${rotuloForma(l.forma)}`}
                  onClick={() => setPartes((ps) => ps.filter((p) => p.chave !== l.chave))}
                  className="flex size-12 shrink-0 items-center justify-center rounded-full text-suave active:bg-marca-clara"
                >
                  <X className="size-5" aria-hidden />
                </button>
              </div>
            )
          })}
          {linhas.length > 0 && (
            <p className={`font-semibold ${falta > 0 ? 'text-alerta' : excesso > 0 && !sobraViraTroco ? 'text-perigo' : 'text-ok'}`}>
              {falta > 0
                ? `Falta ${moeda(falta)}`
                : excesso > 0
                  ? sobraViraTroco
                    ? `${moeda(excesso)} a mais em dinheiro: vira troco`
                    : `Passou ${moeda(excesso)} do total`
                  : 'Valor certo ✓'}
            </p>
          )}
        </section>
      )}

      {temDinheiro && (
        <section className="flex flex-col gap-3 rounded-2xl border border-borda bg-superficie p-4">
          <label htmlFor="recebido-pdv" className="font-semibold">
            Quanto recebeu em dinheiro?
          </label>
          <div className="relative flex items-center">
            <span className="pointer-events-none absolute left-4 text-suave">R$</span>
            <input
              id="recebido-pdv"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={recebido}
              onChange={(e) => setRecebido(e.target.value)}
              placeholder={paraCampo(dinheiroNaVenda) || '0,00'}
              aria-invalid={recebidoInvalido || recebeuMenos || undefined}
              className={`${classeEntrada} pl-11 text-lg ${recebidoInvalido || recebeuMenos ? 'border-perigo' : ''}`}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setRecebido(paraCampo(dinheiroNaVenda))}
              className="min-h-12 rounded-full border border-borda bg-creme px-4 font-semibold active:bg-marca-clara"
            >
              Exato
            </button>
            {notas.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRecebido(String(n))}
                className="min-h-12 rounded-full border border-borda bg-creme px-4 font-semibold active:bg-marca-clara"
              >
                R$ {n}
              </button>
            ))}
          </div>
          <div className="flex items-baseline justify-between rounded-xl bg-ok-claro px-4 py-3" aria-live="polite">
            <span className="text-lg font-semibold text-ok">Troco</span>
            <span className="text-3xl font-bold text-ok tabular-nums">{moeda(trocoVenda)}</span>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        {!extras ? (
          <button type="button" onClick={() => setExtras(true)} className="-ml-2 min-h-12 self-start rounded-xl px-2 font-semibold text-marca active:bg-marca-clara">
            + Nome do cliente ou observação
          </button>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cliente-pdv" className="font-semibold">
                Cliente <span className="font-normal text-suave">(opcional)</span>
              </label>
              <input
                id="cliente-pdv"
                type="text"
                autoComplete="off"
                value={cliente}
                onChange={(e) => setCliente(e.target.value)}
                placeholder="Nome de quem comprou"
                className={classeEntrada}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="obs-pdv" className="font-semibold">
                Observação <span className="font-normal text-suave">(opcional)</span>
              </label>
              <input
                id="obs-pdv"
                type="text"
                autoComplete="off"
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder="Ex.: retirar às 17h, sem lacinho"
                className={classeEntrada}
              />
            </div>
          </>
        )}
      </section>
    </Folha>
  )
}
