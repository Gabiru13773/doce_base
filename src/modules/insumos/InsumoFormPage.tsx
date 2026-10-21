import { ArrowLeft, ScanBarcode } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAviso } from '../../components/Aviso'
import {
  BarraAcao,
  Botao,
  Campo,
  Carregando,
  Cartao,
  Entrada,
  EntradaNumero,
  Erro,
  Pilulas,
  Selecao,
  TituloPagina,
  Vazio,
} from '../../components/ui'
import { faixaPrecos } from '../../lib/compras'
import { custoAmigavel, custoPorUnidadeBase } from '../../lib/custos'
import { lerNumero, moeda, numero, paraCampo } from '../../lib/format'
import { ROTULO_BASE, UNIDADES_COMPRA, unidadeBase, type UnidadeCompra } from '../../lib/unidades'
import {
  CATEGORIAS,
  useHistoricoPrecos,
  useInsumos,
  useRemoverInsumo,
  useRestaurarInsumo,
  useSalvarInsumo,
  type CategoriaInsumo,
  type Insumo,
  type PrecoInsumo,
} from './api'
import { LeitorCodigo, leitorDisponivel } from '../compras/componentes/LeitorCodigo'

// Valor por unidade base pede mais casas (R$ 0,0165 por g).
const moedaFina = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

const NOME_POR: Record<'kg' | 'L' | 'un', string> = { kg: 'kg', L: 'litro', un: 'unidade' }

const ROTULO_CURTO: Record<UnidadeCompra, [string, string]> = {
  g: ['g', 'g'],
  kg: ['kg', 'kg'],
  ml: ['ml', 'ml'],
  l: ['L', 'L'],
  un: ['unidade', 'unidades'],
  dz: ['dúzia', 'dúzias'],
}

function descreverEmbalagem(qtd: number, unidade: UnidadeCompra): string {
  const [um, varios] = ROTULO_CURTO[unidade]
  return `${numero(qtd, 3)} ${qtd === 1 ? um : varios}`
}

function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : 'tente novamente'
}

export default function InsumoFormPage() {
  const { id } = useParams()
  const editando = !!id && id !== 'novo'
  const { data: insumos, isLoading, isError, error, refetch } = useInsumos()

  if (!editando) return <Formulario />

  if (isLoading) return <Carregando />
  if (isError) return <Erro mensagem={mensagemDe(error)} tentarDeNovo={() => refetch()} />

  const insumo = insumos?.find((i) => i.id === id)
  if (!insumo) {
    return (
      <>
        <Voltar />
        <Vazio
          titulo="Insumo não encontrado"
          texto="Ele pode ter sido apagado."
          acao={
            <Link to="/insumos" className="inline-flex min-h-12 items-center rounded-2xl px-5 font-semibold text-marca active:bg-marca-clara">
              Ver todos os insumos
            </Link>
          }
        />
      </>
    )
  }

  // key: recomeça o formulário se trocar de insumo.
  return <Formulario key={insumo.id} original={insumo} />
}

function Voltar() {
  return (
    <Link
      to="/insumos"
      className="-ml-2 mb-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-suave active:bg-marca-clara"
    >
      <ArrowLeft className="size-5" aria-hidden />
      Voltar
    </Link>
  )
}

interface Erros {
  nome?: string
  qtd?: string
  preco?: string
  estoque?: string
  codigo?: string
}

function Formulario({ original }: { original?: Insumo }) {
  const navegar = useNavigate()
  const avisar = useAviso()
  const salvar = useSalvarInsumo()
  const remover = useRemoverInsumo()
  const restaurar = useRestaurarInsumo()
  const idObs = useId()
  const { data: insumos } = useInsumos()

  const [nome, setNome] = useState(original?.nome ?? '')
  const [categoria, setCategoria] = useState<CategoriaInsumo>(original?.categoria ?? 'ingrediente')
  const [qtd, setQtd] = useState(paraCampo(original?.qtd_compra))
  const [unidade, setUnidade] = useState<UnidadeCompra>(original?.unidade_compra ?? 'g')
  const [preco, setPreco] = useState(paraCampo(original?.preco_compra))
  const [marca, setMarca] = useState(original?.marca ?? '')
  const [fornecedor, setFornecedor] = useState(original?.fornecedor ?? '')
  const [estoque, setEstoque] = useState(paraCampo(original?.estoque_minimo))
  const [observacao, setObservacao] = useState(original?.observacao ?? '')
  const [codigo, setCodigo] = useState(original?.codigo_barras ?? '')
  const [lendo, setLendo] = useState(false)
  const podeLer = leitorDisponivel()
  // Abre "Mais opções" se já houver algo preenchido nelas.
  const [maisAberto, setMaisAberto] = useState(
    !!(original?.marca || original?.fornecedor || original?.estoque_minimo != null || original?.observacao || original?.codigo_barras),
  )
  // Mensagens de erro só aparecem depois da primeira tentativa de salvar.
  const [tentou, setTentou] = useState(false)

  const qtdNum = lerNumero(qtd)
  const precoNum = lerNumero(preco)
  const estoqueNum = lerNumero(estoque)
  const base = ROTULO_BASE[unidadeBase(unidade)]

  const erros: Erros = {}
  if (!nome.trim()) erros.nome = 'Escreva o nome do insumo'
  if (!(qtdNum > 0)) erros.qtd = 'Informe quanto vem na embalagem'
  if (!(precoNum >= 0)) erros.preco = 'Informe o preço pago'
  if (estoque.trim() && !(estoqueNum >= 0)) erros.estoque = 'Número inválido'
  if (codigo && !/^[0-9]{6,14}$/.test(codigo)) erros.codigo = 'O código tem de 6 a 14 números'
  const dono = codigo ? insumos?.find((i) => i.id !== original?.id && i.codigo_barras === codigo) : undefined
  if (!erros.codigo && dono) erros.codigo = `Esse código já está no insumo ${dono.nome}`
  const temErro = Object.keys(erros).length > 0
  // Código repetido aparece na hora (ex.: logo depois de escanear).
  const mostrar: Erros = tentou ? erros : dono ? { codigo: erros.codigo } : {}

  const compraValida = qtdNum > 0 && precoNum >= 0
  const compra = { qtdCompra: qtdNum, unidadeCompra: unidade, precoCompra: precoNum }
  const amigavel = compraValida ? custoAmigavel(compra) : null
  const porBase = compraValida ? custoPorUnidadeBase(compra) : 0

  async function aoSalvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (temErro) {
      if (erros.estoque || erros.codigo) setMaisAberto(true)
      return
    }
    try {
      await salvar.mutateAsync({
        id: original?.id,
        nome: nome.trim(),
        categoria,
        unidade_compra: unidade,
        qtd_compra: qtdNum,
        preco_compra: precoNum,
        marca: marca.trim() || null,
        fornecedor: fornecedor.trim() || null,
        estoque_minimo: estoque.trim() ? estoqueNum : null,
        observacao: observacao.trim() || null,
        // Só manda a coluna quando há o que gravar ou apagar (compatível com banco sem a coluna).
        ...(codigo || original?.codigo_barras ? { codigo_barras: codigo || null } : {}),
      })
      avisar({ texto: 'Insumo salvo ✓' })
      navegar('/insumos')
    } catch {
      // O erro aparece na tela pelo estado da mutação.
    }
  }

  function aoApagar() {
    if (!original) return
    const copia = original
    remover.mutate(copia, {
      onSuccess: () => {
        navegar('/insumos')
        avisar({ texto: 'Insumo apagado', desfazer: () => restaurar.mutate(copia) })
      },
    })
  }

  return (
    <form onSubmit={aoSalvar} noValidate>
      <Voltar />
      <TituloPagina titulo={original ? original.nome : 'Novo insumo'} />

      <div className="flex flex-col gap-6">
        <Entrada
          rotulo="Nome"
          placeholder="Ex.: Leite condensado"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          erro={mostrar.nome}
          autoFocus={!original}
          autoCapitalize="sentences"
        />

        <div className="flex flex-col gap-1.5">
          <p className="font-semibold">Tipo</p>
          <Pilulas
            rotulo="Tipo"
            valor={categoria}
            aoMudar={setCategoria}
            opcoes={CATEGORIAS.map((c) => ({ valor: c.valor, rotulo: `${c.emoji} ${c.rotulo}` }))}
          />
        </div>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 text-lg font-bold">Como você compra?</legend>
          <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start gap-3">
            <EntradaNumero
              rotulo="Quantidade na embalagem"
              placeholder="Ex.: 395"
              value={qtd}
              onChange={(e) => setQtd(e.target.value)}
              erro={mostrar.qtd}
            />
            <Selecao
              rotulo="Unidade"
              valor={unidade}
              aoMudar={(v) => setUnidade(v as UnidadeCompra)}
              opcoes={UNIDADES_COMPRA.map((u) => ({ valor: u.valor, rotulo: u.rotulo }))}
            />
          </div>
          <EntradaNumero
            rotulo="Preço pago"
            prefixo="R$"
            placeholder="Ex.: 6,50"
            value={preco}
            onChange={(e) => setPreco(e.target.value)}
            erro={mostrar.preco}
          />
        </fieldset>

        {amigavel && (
          <Cartao className="border-marca/20 bg-marca-clara">
            <p aria-live="polite" className="text-xl font-bold text-marca-escura">
              Custa {moeda(amigavel.valor)} por {NOME_POR[amigavel.por]}
            </p>
            {amigavel.por !== 'un' && (
              <p className="mt-1 text-sm text-suave">
                {moedaFina.format(porBase)} por {base}
              </p>
            )}
          </Cartao>
        )}

        <details
          open={maisAberto}
          onToggle={(e) => setMaisAberto(e.currentTarget.open)}
          className="rounded-2xl border border-borda bg-superficie"
        >
          <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold text-marca">Mais opções</summary>
          <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
            <Entrada rotulo="Marca" value={marca} onChange={(e) => setMarca(e.target.value)} />
            <Entrada rotulo="Fornecedor" placeholder="Onde você compra" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} />
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Entrada
                  rotulo="Código de barras"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Só os números"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 14))}
                  ajuda="Para achar o insumo escaneando no mercado"
                  erro={mostrar.codigo}
                />
              </div>
              {podeLer && (
                <Botao
                  variante="secundario"
                  className="mt-[1.875rem] shrink-0 px-4"
                  onClick={() => setLendo(true)}
                  aria-label="Ler código de barras com a câmera"
                >
                  <ScanBarcode className="size-5" aria-hidden />
                  Ler
                </Botao>
              )}
            </div>
            <EntradaNumero
              rotulo="Estoque mínimo"
              sufixo={base}
              value={estoque}
              onChange={(e) => setEstoque(e.target.value)}
              ajuda="Avisaremos quando o estoque ficar abaixo disso"
              erro={mostrar.estoque}
            />
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

        {original && <Historico insumoId={original.id} embalagem={{ qtd: qtdNum > 0 ? qtdNum : original.qtd_compra, unidade }} />}

        {original && (
          <div className="flex flex-col gap-3 pt-4">
            {remover.isError && <Erro mensagem={mensagemDe(remover.error)} />}
            <Botao variante="perigo" onClick={aoApagar} disabled={remover.isPending}>
              {remover.isPending ? 'Apagando…' : 'Apagar insumo'}
            </Botao>
          </div>
        )}
      </div>

      <LeitorCodigo
        aberto={lendo}
        aoFechar={() => setLendo(false)}
        aoLer={(lido) => {
          setLendo(false)
          setCodigo(lido.slice(0, 14))
          setMaisAberto(true)
        }}
      />

      <BarraAcao>
        <Botao type="submit" className="flex-1" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </Botao>
      </BarraAcao>
    </form>
  )
}

function custoBase(p: PrecoInsumo): number {
  return custoPorUnidadeBase({ qtdCompra: p.qtd_compra, unidadeCompra: p.unidade_compra, precoCompra: p.preco_compra })
}

function Historico({ insumoId, embalagem }: { insumoId: string; embalagem: { qtd: number; unidade: UnidadeCompra } }) {
  const { data: precos } = useHistoricoPrecos(insumoId)
  if (!precos || precos.length < 2) return null
  const faixa = faixaPrecos(precos, embalagem)

  // A lista vem da mais recente para a mais antiga; "anterior" é o item seguinte.
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-bold">Histórico de preços</h2>
      {faixa && (
        <p className="text-sm text-suave">
          Para {descreverEmbalagem(embalagem.qtd, embalagem.unidade)}:{' '}
          <span className="font-semibold text-tinta">Último {moeda(faixa.ultimo)}</span> · Menor {moeda(faixa.menor)} · Maior{' '}
          {moeda(faixa.maior)} (em {faixa.vezes} {faixa.vezes === 1 ? 'compra' : 'compras'})
        </p>
      )}
      <ul className="divide-y divide-borda rounded-2xl border border-borda bg-superficie">
        {precos.map((p, i) => {
          const anterior = precos[i + 1]
          const atual = custoBase(p)
          const antes = anterior ? custoBase(anterior) : 0
          const variacao = antes > 0 ? Math.round((atual / antes - 1) * 100) : 0
          return (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{moeda(p.preco_compra)}</p>
                <p className="text-sm text-suave">
                  {new Date(p.registrado_em).toLocaleDateString('pt-BR')} · {descreverEmbalagem(p.qtd_compra, p.unidade_compra)}
                  {p.local && <> · {p.local}</>}
                </p>
                {p.compra_id && (
                  <span className="mt-1 inline-block rounded-full bg-marca-clara px-2 py-0.5 text-xs font-semibold text-marca-escura">
                    da compra
                  </span>
                )}
              </div>
              {variacao > 0 && (
                <span className="rounded-full bg-alerta-claro px-2.5 py-1 text-sm font-semibold text-alerta" title="Mais caro que a compra anterior">
                  ▲ {variacao}%
                </span>
              )}
              {variacao < 0 && (
                <span className="rounded-full bg-ok-claro px-2.5 py-1 text-sm font-semibold text-ok" title="Mais barato que a compra anterior">
                  ▼ {Math.abs(variacao)}%
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
