import { Plus } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAviso } from '../../components/Aviso'
import { BarraAcao, Botao, Carregando, Cartao, EntradaNumero, Erro, TituloPagina } from '../../components/ui'
import { centavos } from '../../lib/compras'
import { lerNumero, moeda, paraCampo, pct } from '../../lib/format'
import { precoNoCanal, type ConfigPdv } from '../../lib/vendas'
import { useContasFin, type ContaFin } from '../financeiro/api'
import { Voltar } from '../financeiro/componentes/Comum'
import { SeletorConta } from '../financeiro/componentes/Seletores'
import { mensagemDe } from '../financeiro/util'
import { useConfigPdv, useSalvarConfigPdv } from './api'

// Ajustes do PDV (/vendas/ajustes): taxas da maquininha e do iFood, prazos de recebimento,
// contas onde o dinheiro entra, o fundo de troco da gaveta e o sinal sugerido dos pedidos.

const PRECO_EXEMPLO = 10
const NOVA_CONTA = '/financeiro/bancos/nova'

export default function AjustesPdvPage() {
  const config = useConfigPdv()
  const contas = useContasFin()

  return (
    <div>
      <Voltar padrao="/vendas" />
      <TituloPagina titulo="Ajustes do PDV" subtitulo="Taxas, prazos e contas usados nas vendas e no fechamento do caixa" />
      {/* Espera a versão atual da nuvem: com o cache atrasado, o formulário começaria com valores
          antigos e, ao salvar, gravaria esses valores de volta. Sem internet (busca pausada), não espera. */}
      {config.isPending || contas.isPending || (!config.isFetchedAfterMount && config.fetchStatus === 'fetching') ? (
        <Carregando />
      ) : config.isError ? (
        <Erro mensagem={mensagemDe(config.error)} tentarDeNovo={() => void config.refetch()} />
      ) : contas.isError ? (
        <Erro mensagem={mensagemDe(contas.error)} tentarDeNovo={() => void contas.refetch()} />
      ) : (
        // O formulário só monta quando os dados chegam, para já nascer preenchido.
        <Formulario inicial={config.data} contas={contas.data} />
      )}
    </div>
  )
}

type CampoNum =
  | 'taxa_debito'
  | 'taxa_credito'
  | 'taxa_pix'
  | 'comissao_ifood'
  | 'acrescimo_ifood'
  | 'prazo_debito'
  | 'prazo_credito'
  | 'prazo_ifood'
  | 'fundo_troco'
  | 'pct_sinal'

const PCTS = ['taxa_debito', 'taxa_credito', 'taxa_pix', 'comissao_ifood', 'acrescimo_ifood', 'pct_sinal'] as const
const PRAZOS = ['prazo_debito', 'prazo_credito', 'prazo_ifood'] as const

function erroPct(t: string): string | undefined {
  const n = lerNumero(t)
  if (Number.isNaN(n)) return 'Digite um número (pode ser 0)'
  if (n < 0 || n > 100) return 'Use um número de 0 a 100'
  return undefined
}

function erroPrazo(t: string): string | undefined {
  const n = lerNumero(t)
  if (Number.isNaN(n)) return 'Digite os dias (pode ser 0)'
  if (!Number.isInteger(n)) return 'Use dias inteiros (ex.: 30)'
  if (n < 0 || n > 120) return 'Use de 0 a 120 dias'
  return undefined
}

function erroFundo(t: string): string | undefined {
  if (!t.trim()) return undefined
  const n = lerNumero(t)
  if (Number.isNaN(n)) return 'Valor inválido. Ex.: 50,00'
  if (n < 0) return 'Não pode ser negativo'
  return undefined
}

/** Conta do caixa físico sugerida quando ainda não foi escolhida: a primeira do tipo "caixa". */
function contaCaixaPadrao(inicial: ConfigPdv, contas: ContaFin[]): string | null {
  if (inicial.conta_caixa_id) return inicial.conta_caixa_id
  return contas.find((c) => c.ativo && c.tipo === 'caixa')?.id ?? null
}

function Formulario({ inicial, contas }: { inicial: ConfigPdv; contas: ContaFin[] }) {
  const salvar = useSalvarConfigPdv()
  const avisar = useAviso()

  const [campos, setCampos] = useState<Record<CampoNum, string>>(() => ({
    taxa_debito: paraCampo(inicial.taxa_debito),
    taxa_credito: paraCampo(inicial.taxa_credito),
    taxa_pix: paraCampo(inicial.taxa_pix),
    comissao_ifood: paraCampo(inicial.comissao_ifood),
    acrescimo_ifood: paraCampo(inicial.acrescimo_ifood),
    prazo_debito: paraCampo(inicial.prazo_debito),
    prazo_credito: paraCampo(inicial.prazo_credito),
    prazo_ifood: paraCampo(inicial.prazo_ifood),
    fundo_troco: inicial.fundo_troco > 0 ? paraCampo(inicial.fundo_troco) : '',
    pct_sinal: paraCampo(inicial.pct_sinal),
  }))
  const [contaCaixa, setContaCaixa] = useState<string | null>(() => contaCaixaPadrao(inicial, contas))
  const [contaBanco, setContaBanco] = useState<string | null>(inicial.conta_banco_id)
  const [tentou, setTentou] = useState(false)

  const mudar = (k: CampoNum) => (e: { target: { value: string } }) => setCampos((c) => ({ ...c, [k]: e.target.value }))

  const erros: Partial<Record<CampoNum, string>> = {}
  for (const k of PCTS) erros[k] = erroPct(campos[k])
  for (const k of PRAZOS) erros[k] = erroPrazo(campos[k])
  erros.fundo_troco = erroFundo(campos.fundo_troco)
  const temErro = Object.values(erros).some(Boolean)
  const mostrar: Partial<Record<CampoNum, string>> = tentou ? erros : {}

  // Exemplos ao vivo
  const acrescimo = lerNumero(campos.acrescimo_ifood)
  const precoIfood = erros.acrescimo_ifood ? null : precoNoCanal(PRECO_EXEMPLO, null, 'ifood', acrescimo)
  const comissao = lerNumero(campos.comissao_ifood)
  const ficaIfood = erros.comissao_ifood || precoIfood === null ? null : centavos(precoIfood * (1 - comissao / 100))

  const temContas = contas.some((c) => c.ativo)

  async function aoSalvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (temErro) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    const p = (k: CampoNum) => Math.round(lerNumero(campos[k]) * 100) / 100
    const d = (k: CampoNum) => Math.round(lerNumero(campos[k]))
    try {
      await salvar.mutateAsync({
        taxa_debito: p('taxa_debito'),
        taxa_credito: p('taxa_credito'),
        taxa_pix: p('taxa_pix'),
        comissao_ifood: p('comissao_ifood'),
        acrescimo_ifood: p('acrescimo_ifood'),
        prazo_debito: d('prazo_debito'),
        prazo_credito: d('prazo_credito'),
        prazo_ifood: d('prazo_ifood'),
        conta_caixa_id: contaCaixa,
        conta_banco_id: contaBanco,
        fundo_troco: campos.fundo_troco.trim() ? centavos(lerNumero(campos.fundo_troco)) : 0,
        pct_sinal: p('pct_sinal'),
      })
      avisar({ texto: 'Ajustes do PDV salvos ✓' })
    } catch {
      // O erro aparece na tela pelo estado da mutação.
    }
  }

  return (
    <form onSubmit={aoSalvar} noValidate className="flex flex-col gap-8">
      <Secao titulo="Taxas da maquininha" texto="Quanto a maquininha (ou o banco) cobra de cada venda.">
        <EntradaNumero rotulo="Débito" sufixo="%" placeholder="Ex.: 1,99" value={campos.taxa_debito} onChange={mudar('taxa_debito')} erro={mostrar.taxa_debito} />
        <EntradaNumero rotulo="Crédito" sufixo="%" placeholder="Ex.: 4,99" value={campos.taxa_credito} onChange={mudar('taxa_credito')} erro={mostrar.taxa_credito} />
        <EntradaNumero
          rotulo="Pix"
          sufixo="%"
          placeholder="0"
          value={campos.taxa_pix}
          onChange={mudar('taxa_pix')}
          erro={mostrar.taxa_pix}
          ajuda="Se o Pix cai direto no banco sem taxa, deixe 0."
        />
      </Secao>

      <Secao titulo="iFood">
        <EntradaNumero
          rotulo="Comissão do iFood"
          sufixo="%"
          placeholder="Ex.: 23"
          value={campos.comissao_ifood}
          onChange={mudar('comissao_ifood')}
          erro={mostrar.comissao_ifood}
          ajuda="Quanto o iFood fica de cada pedido (comissão + taxa de pagamento)."
        />
        <EntradaNumero
          rotulo="Preço no iFood: quanto a mais sobre o balcão"
          prefixo="+"
          sufixo="%"
          placeholder="0"
          value={campos.acrescimo_ifood}
          onChange={mudar('acrescimo_ifood')}
          erro={mostrar.acrescimo_ifood}
          ajuda="Vale para os produtos sem preço do iFood próprio (dá para pôr um em cada produto)."
        />
        <Cartao className="border-transparent bg-marca-clara">
          <h3 className="mb-1 font-bold">Exemplo</h3>
          {precoIfood === null ? (
            <p className="text-suave">Preencha o acréscimo para ver o exemplo.</p>
          ) : (
            <>
              <p>
                Bolo {moeda(PRECO_EXEMPLO)} no balcão → <strong className="text-lg text-marca-escura">{moeda(precoIfood)}</strong> no iFood
              </p>
              {ficaIfood !== null && (
                <p className="mt-1 text-sm text-suave">
                  Depois da comissão ({pct(comissao)}), ficam <strong className="text-tinta">{moeda(ficaIfood)}</strong> para você.
                </p>
              )}
            </>
          )}
        </Cartao>
      </Secao>

      <Secao titulo="Quando o dinheiro cai na conta" texto="Em quantos dias depois da venda. Use 0 se cai no mesmo dia.">
        <EntradaNumero rotulo="Débito" sufixo="dias" inputMode="numeric" placeholder="Ex.: 1" value={campos.prazo_debito} onChange={mudar('prazo_debito')} erro={mostrar.prazo_debito} />
        <EntradaNumero rotulo="Crédito" sufixo="dias" inputMode="numeric" placeholder="Ex.: 30" value={campos.prazo_credito} onChange={mudar('prazo_credito')} erro={mostrar.prazo_credito} />
        <EntradaNumero rotulo="iFood" sufixo="dias" inputMode="numeric" placeholder="Ex.: 7" value={campos.prazo_ifood} onChange={mudar('prazo_ifood')} erro={mostrar.prazo_ifood} />
      </Secao>

      <Secao titulo="Contas" texto="Para onde vai o dinheiro quando você fecha o caixa do dia.">
        {!temContas ? (
          <Cartao className="flex flex-col gap-2 border-laranja/30 bg-laranja-clara">
            <p className="font-semibold">Você ainda não tem contas cadastradas</p>
            <p>Cadastre o caixa da loja e o banco (ou a maquininha) para o fechamento lançar tudo no Financeiro.</p>
            <LinkNovaConta />
          </Cartao>
        ) : (
          <>
            <SeletorConta
              rotulo="Caixa físico (a gaveta)"
              contas={contas}
              valor={contaCaixa}
              aoMudar={setContaCaixa}
              vazio="Nenhuma"
              ajuda="Onde entram as vendas em dinheiro."
            />
            <SeletorConta
              rotulo="Banco ou maquininha"
              contas={contas}
              valor={contaBanco}
              aoMudar={setContaBanco}
              vazio="Nenhuma"
              ajuda="Onde caem Pix, cartão e iFood."
            />
            <LinkNovaConta outra />
          </>
        )}
      </Secao>

      <Secao titulo="Fundo de troco">
        <EntradaNumero
          rotulo="Dinheiro que fica na gaveta"
          prefixo="R$"
          placeholder="0,00"
          value={campos.fundo_troco}
          onChange={mudar('fundo_troco')}
          erro={mostrar.fundo_troco}
          ajuda="O troco que já está no caixa quando o dia começa. Entra na conta do dinheiro esperado no fechamento."
        />
      </Secao>

      <Secao titulo="Pedidos">
        <EntradaNumero
          rotulo="Sinal dos pedidos"
          sufixo="%"
          placeholder="Ex.: 50"
          value={campos.pct_sinal}
          onChange={mudar('pct_sinal')}
          erro={mostrar.pct_sinal}
          ajuda="Quanto do total pedir de sinal ao anotar uma encomenda (dá para mudar em cada pedido). Use 0 para não sugerir sinal."
        />
      </Secao>

      {tentou && temErro && <p className="text-sm font-medium text-perigo">Falta arrumar alguns campos antes de salvar.</p>}
      {salvar.isError && <Erro mensagem={mensagemDe(salvar.error)} />}

      <BarraAcao>
        <Botao type="submit" className="flex-1" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </Botao>
      </BarraAcao>
    </form>
  )
}

function Secao({ titulo, texto, children }: { titulo: string; texto?: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-1 text-lg font-bold">{titulo}</legend>
      {texto && <p className="-mt-2 text-suave">{texto}</p>}
      {children}
    </fieldset>
  )
}

function LinkNovaConta({ outra = false }: { outra?: boolean }) {
  return (
    <Link
      to={NOVA_CONTA}
      className="inline-flex min-h-12 items-center gap-2 self-start rounded-xl px-2 font-semibold text-marca active:bg-marca-clara"
    >
      <Plus className="size-5" aria-hidden />
      {outra ? 'Cadastrar outra conta' : 'Cadastrar conta'}
    </Link>
  )
}
