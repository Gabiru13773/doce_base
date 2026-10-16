import { useState } from 'react'
import { useAviso } from '../../components/Aviso'
import { BarraAcao, Botao, Carregando, Cartao, EntradaNumero, Erro, Selecao, TituloPagina } from '../../components/ui'
import { lerNumero, moeda, paraCampo, pct } from '../../lib/format'
import {
  ARREDONDAMENTOS,
  arredondarPreco,
  margemReal,
  precoPorMarkupDivisor,
  somaPercentuais,
  type Arredondamento,
  type ConfigPrecificacao,
} from '../../lib/precificacao'
import { useConfigPrecificacao, useSalvarConfigPrecificacao } from './api'

const CUSTO_EXEMPLO = 30

export default function ConfigPage() {
  const config = useConfigPrecificacao()

  return (
    <div>
      <TituloPagina titulo="Preços e margens" subtitulo="Usados para calcular o preço de venda das receitas" />
      {config.isPending ? (
        <Carregando />
      ) : config.isError ? (
        <Erro mensagem={config.error.message} tentarDeNovo={() => config.refetch()} />
      ) : (
        // O formulário só monta quando os dados chegam, para já nascer preenchido.
        <Formulario inicial={config.data} />
      )}
    </div>
  )
}

function Formulario({ inicial }: { inicial: ConfigPrecificacao }) {
  const salvar = useSalvarConfigPrecificacao()
  const aviso = useAviso()

  const [valorHora, setValorHora] = useState(paraCampo(inicial.valorHora))
  const [custosFixos, setCustosFixos] = useState(paraCampo(inicial.pctCustosFixos))
  const [taxas, setTaxas] = useState(paraCampo(inicial.pctTaxas))
  const [margem, setMargem] = useState(paraCampo(inicial.pctMargem))
  const [arredondamento, setArredondamento] = useState<Arredondamento>(inicial.arredondamento)

  const n = {
    valorHora: lerNumero(valorHora),
    pctCustosFixos: lerNumero(custosFixos),
    pctTaxas: lerNumero(taxas),
    pctMargem: lerNumero(margem),
  }

  // Mensagens de erro por campo (só aparecem quando há algo digitado errado ou vazio).
  const erroPct = (v: number) => (Number.isNaN(v) ? 'Digite um número (pode ser 0)' : v < 0 ? 'Não pode ser negativo' : undefined)
  const erros = {
    valorHora: Number.isNaN(n.valorHora) ? 'Digite um valor' : n.valorHora <= 0 ? 'Precisa ser maior que zero' : undefined,
    pctCustosFixos: erroPct(n.pctCustosFixos),
    pctTaxas: erroPct(n.pctTaxas),
    pctMargem: erroPct(n.pctMargem),
  }
  const camposOk = !erros.valorHora && !erros.pctCustosFixos && !erros.pctTaxas && !erros.pctMargem

  const percentuaisOk = !erroPct(n.pctCustosFixos) && !erroPct(n.pctTaxas) && !erroPct(n.pctMargem)
  const soma = percentuaisOk ? somaPercentuais(n) : NaN
  const passouDe100 = percentuaisOk && soma >= 100

  // Exemplo ao vivo com uma receita de R$ 30,00
  const precoBruto = percentuaisOk ? precoPorMarkupDivisor(CUSTO_EXEMPLO, n) : null
  const preco = precoBruto === null ? null : arredondarPreco(precoBruto, arredondamento)
  const sobra = preco === null ? null : margemReal(preco, CUSTO_EXEMPLO, n)

  const podeSalvar = camposOk && !passouDe100 && !salvar.isPending

  function aoSalvar() {
    if (!podeSalvar) return
    salvar.mutate(
      { ...n, arredondamento },
      { onSuccess: () => aviso({ texto: 'Preços e margens salvos ✓' }) },
    )
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        aoSalvar()
      }}
    >
      <EntradaNumero
        rotulo="Quanto vale sua hora de trabalho?"
        prefixo="R$"
        ajuda="Entra no custo pelo tempo de preparo"
        value={valorHora}
        onChange={(e) => setValorHora(e.target.value)}
        erro={erros.valorHora}
      />
      <EntradaNumero
        rotulo="Custos fixos"
        sufixo="%"
        ajuda="Aluguel, gás, energia, internet… divididos nas vendas"
        value={custosFixos}
        onChange={(e) => setCustosFixos(e.target.value)}
        erro={erros.pctCustosFixos}
      />
      <EntradaNumero
        rotulo="Taxas de venda"
        sufixo="%"
        ajuda="Maquininha, iFood, aplicativos"
        value={taxas}
        onChange={(e) => setTaxas(e.target.value)}
        erro={erros.pctTaxas}
      />
      <EntradaNumero
        rotulo="Lucro desejado"
        sufixo="%"
        value={margem}
        onChange={(e) => setMargem(e.target.value)}
        erro={erros.pctMargem}
      />
      <Selecao
        rotulo="Arredondar o preço"
        valor={arredondamento}
        aoMudar={(v) => setArredondamento(v as Arredondamento)}
        opcoes={ARREDONDAMENTOS}
      />

      <Cartao className="border-transparent bg-marca-clara">
        <h2 className="mb-1 font-bold">Exemplo</h2>
        {passouDe100 ? (
          <p className="font-medium text-perigo">Custos fixos + taxas + lucro precisam somar menos de 100%</p>
        ) : preco === null || sobra === null ? (
          <p className="text-suave">Preencha os percentuais para ver o exemplo.</p>
        ) : (
          <>
            <p>
              Se uma receita custar {moeda(CUSTO_EXEMPLO)} (ingredientes + mão de obra), o preço sugerido será{' '}
              <strong className="text-lg text-marca-escura">{moeda(preco)}</strong>
            </p>
            <p className="mt-2 text-sm text-suave">
              Sobra de lucro: <strong className="text-tinta">{moeda(sobra.lucro)}</strong> ({pct(sobra.pctMargem)})
            </p>
          </>
        )}
      </Cartao>

      <details className="rounded-2xl border border-borda bg-superficie p-4">
        <summary className="-m-4 flex min-h-12 cursor-pointer items-center p-4 font-semibold text-marca">
          Como o preço é calculado?
        </summary>
        <div className="mt-3 flex flex-col gap-2 text-[15px] text-suave">
          <p>
            Primeiro somamos o custo da receita: ingredientes, embalagens e o tempo de preparo (pelo valor da sua hora).
          </p>
          <p>
            As taxas da maquininha e os custos fixos são cobrados em cima do <strong>preço de venda</strong>, não do
            custo. Por isso o app <strong>divide</strong> o custo em vez de multiplicar:
          </p>
          <p className="rounded-xl bg-creme px-3 py-2 text-tinta">
            Preço = custo ÷ (100% − custos fixos − taxas − lucro)
          </p>
          <p>
            Exemplo: com 20% de custos fixos, 5% de taxas e 25% de lucro, sobram 50% do preço para cobrir o custo. Uma
            receita de R$ 30,00 vira R$ 30,00 ÷ 0,50 = R$ 60,00. Desses R$ 60,00, saem R$ 12,00 de custos fixos, R$ 3,00 de
            taxas, R$ 30,00 de custo e sobram R$ 15,00 de lucro, que são os 25% que você queria.
          </p>
          <p>
            Se apenas multiplicasse (R$ 30,00 + 50% = R$ 45,00), as taxas e os custos fixos comeriam parte do seu lucro.
          </p>
        </div>
      </details>

      {salvar.isError && <Erro mensagem={salvar.error.message} tentarDeNovo={aoSalvar} />}

      <BarraAcao>
        <Botao type="submit" className="flex-1" disabled={!podeSalvar}>
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </Botao>
      </BarraAcao>
    </form>
  )
}
