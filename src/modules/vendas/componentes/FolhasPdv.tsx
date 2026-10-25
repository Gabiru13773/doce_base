import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Botao, EntradaNumero, Pilulas } from '../../../components/ui'
import { centavos } from '../../../lib/compras'
import { lerNumero, moeda, paraCampo } from '../../../lib/format'
import { CANAIS, descontoPct, type Canal } from '../../../lib/vendas'
import { Folha } from '../../compras/componentes/Folha'
import type { DescontoCarrinho, OpcaoProduto, OpcaoVariacao } from './carrinho'

// Folhas pequenas do PDV: escolher a variação, digitar o preço, desconto e troca de canal.

export function FolhaVariacao({
  opcao,
  preco,
  restam,
  aoEscolher,
  aoFechar,
}: {
  opcao: OpcaoProduto
  preco: (o: OpcaoVariacao) => number | null
  restam: (o: OpcaoVariacao) => number | null
  aoEscolher: (o: OpcaoVariacao) => void
  aoFechar: () => void
}) {
  return (
    <Folha titulo={opcao.produto.nome} subtitulo="Qual delas?" aoFechar={aoFechar}>
      <div className="grid gap-2">
        {opcao.variacoes.map((o) => {
          const p = preco(o)
          const r = restam(o)
          return (
            <button
              key={o.variacao.id}
              type="button"
              onClick={() => aoEscolher(o)}
              className="flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-borda bg-superficie px-4 py-3 text-left active:bg-marca-clara"
            >
              <span className="min-w-0">
                <span className="block text-lg font-semibold break-words">{o.variacao.nome || 'Padrão'}</span>
                {r !== null && <span className={`text-sm ${r === 0 ? 'text-perigo' : 'text-suave'}`}>{r === 0 ? 'acabou no estoque' : `restam ${r}`}</span>}
              </span>
              <span className={`shrink-0 text-lg font-bold ${p === null ? 'text-alerta' : 'text-marca'}`}>{p === null ? 'sem preço' : moeda(p)}</span>
            </button>
          )
        })}
      </div>
    </Folha>
  )
}

/** Preço digitado na hora (produto sem preço, ou preço combinado com o cliente). */
export function FolhaPreco({
  nome,
  inicial,
  semPreco,
  produtoId,
  aoConfirmar,
  aoFechar,
}: {
  nome: string
  inicial: number | null
  semPreco: boolean
  produtoId: string
  aoConfirmar: (preco: number) => void
  aoFechar: () => void
}) {
  const [texto, setTexto] = useState(paraCampo(inicial))
  const valor = lerNumero(texto)
  const ok = Number.isFinite(valor) && valor > 0

  function enviar(e: FormEvent) {
    e.preventDefault()
    if (ok) aoConfirmar(centavos(valor))
  }

  return (
    <Folha
      titulo={semPreco ? 'Qual o preço?' : 'Mudar o preço'}
      subtitulo={nome}
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao variante="secundario" className="flex-1" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao type="submit" form="form-preco-pdv" className="flex-[2]" disabled={!ok}>
            {semPreco ? 'Adicionar' : 'Usar este preço'}
          </Botao>
        </>
      }
    >
      <form id="form-preco-pdv" onSubmit={enviar} className="flex flex-col gap-3">
        <EntradaNumero
          rotulo="Preço de 1 unidade"
          prefixo="R$"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="0,00"
          erro={texto.trim() !== '' && !ok ? 'Digite um valor maior que zero, como 12,50' : undefined}
          ajuda={semPreco ? 'Este produto ainda não tem preço. O valor vale só para esta venda.' : 'Vale só para esta venda.'}
        />
        {semPreco && (
          <Link to={`/produtos/${produtoId}`} className="self-start text-sm font-semibold text-marca underline underline-offset-2">
            Definir o preço do produto
          </Link>
        )}
      </form>
    </Folha>
  )
}

export function FolhaDesconto({
  subtotal,
  inicial,
  aoConfirmar,
  aoFechar,
}: {
  subtotal: number
  inicial: DescontoCarrinho
  aoConfirmar: (d: DescontoCarrinho) => void
  aoFechar: () => void
}) {
  const [tipo, setTipo] = useState<DescontoCarrinho['tipo']>(inicial.tipo)
  const [texto, setTexto] = useState(inicial.valor > 0 ? paraCampo(inicial.valor) : '')
  const lido = lerNumero(texto)
  const valor = Number.isFinite(lido) && lido > 0 ? lido : 0
  const invalido = texto.trim() !== '' && (!Number.isFinite(lido) || lido < 0)
  const emReais = tipo === 'pct' ? descontoPct(subtotal, valor) : Math.min(centavos(valor), subtotal)
  const grande = tipo === 'pct' ? valor > 100 : valor > subtotal

  function enviar(e: FormEvent) {
    e.preventDefault()
    if (!invalido) aoConfirmar({ tipo, valor: tipo === 'pct' ? Math.min(valor, 100) : Math.min(centavos(valor), subtotal) })
  }

  return (
    <Folha
      titulo="Desconto"
      subtitulo={`Compra de ${moeda(subtotal)}`}
      aoFechar={aoFechar}
      rodape={
        <>
          {inicial.valor > 0 && (
            <Botao variante="perigo" className="flex-1" onClick={() => aoConfirmar({ tipo, valor: 0 })}>
              Tirar
            </Botao>
          )}
          <Botao type="submit" form="form-desconto-pdv" className="flex-[2]" disabled={invalido}>
            {emReais > 0 ? `Dar ${moeda(emReais)}` : 'Sem desconto'}
          </Botao>
        </>
      }
    >
      <form id="form-desconto-pdv" onSubmit={enviar} className="flex flex-col gap-4">
        <Pilulas
          rotulo="Tipo de desconto"
          valor={tipo}
          aoMudar={setTipo}
          opcoes={[
            { valor: 'reais', rotulo: 'Em reais (R$)' },
            { valor: 'pct', rotulo: 'Em porcentagem (%)' },
          ]}
        />
        <EntradaNumero
          rotulo={tipo === 'pct' ? 'Quantos %' : 'Quantos reais'}
          prefixo={tipo === 'reais' ? 'R$' : undefined}
          sufixo={tipo === 'pct' ? '%' : undefined}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={tipo === 'pct' ? '10' : '0,00'}
          erro={invalido ? 'Digite só números, como 5 ou 2,50' : undefined}
          ajuda={grande ? 'O desconto fica no máximo o valor da compra.' : undefined}
        />
        {tipo === 'pct' && (
          <div className="flex flex-wrap gap-2">
            {[5, 10, 15, 20].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setTexto(String(p))}
                className="min-h-12 rounded-full border border-borda bg-superficie px-5 font-semibold active:bg-marca-clara"
              >
                {p}%
              </button>
            ))}
          </div>
        )}
      </form>
    </Folha>
  )
}

export function FolhaTrocarCanal({ canal, aoConfirmar, aoFechar }: { canal: Canal; aoConfirmar: () => void; aoFechar: () => void }) {
  const rotulo = CANAIS.find((c) => c.valor === canal)?.rotulo ?? canal
  return (
    <Folha
      titulo={`Mudar para ${rotulo}?`}
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao variante="secundario" className="flex-1" onClick={aoFechar}>
            Não mudar
          </Botao>
          <Botao className="flex-1" onClick={aoConfirmar} data-foco-inicial>
            Mudar
          </Botao>
        </>
      }
    >
      <p>
        Os preços do carrinho vão mudar para os do {rotulo}
        {canal === 'ifood' ? ' (no iFood o preço costuma ser maior).' : '.'} Preços digitados à mão continuam iguais.
      </p>
    </Folha>
  )
}
