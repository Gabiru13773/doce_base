import { ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BarraAcao, Botao, Busca, Carregando, Erro, Pilulas, TituloPagina, Vazio } from '../../components/ui'
import { custoAmigavel } from '../../lib/custos'
import { precisaComprar } from '../../lib/estoque'
import { moeda, numero } from '../../lib/format'
import { textoQuantidade } from '../../lib/receitas'
import { unidadeBase } from '../../lib/unidades'
import { useSaldos } from '../estoque/api'
import { CATEGORIAS, useInsumos, type CategoriaInsumo, type Insumo } from './api'

type Filtro = 'todos' | CategoriaInsumo

const OPCOES_FILTRO: { valor: Filtro; rotulo: string }[] = [
  { valor: 'todos', rotulo: 'Todos' },
  ...CATEGORIAS.map((c) => ({ valor: c.valor, rotulo: c.rotulo })),
]

/** Minúsculas e sem acentos, para a busca achar "acucar" em "Açúcar". */
function simplificar(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** Rótulo curto da unidade de compra para a linha "395 g por R$ 6,50". */
const ROTULO_CURTO: Record<Insumo['unidade_compra'], [string, string]> = {
  g: ['g', 'g'],
  kg: ['kg', 'kg'],
  ml: ['ml', 'ml'],
  l: ['L', 'L'],
  un: ['unidade', 'unidades'],
  dz: ['dúzia', 'dúzias'],
}

function descreverEmbalagem(qtd: number, unidade: Insumo['unidade_compra']): string {
  const [um, varios] = ROTULO_CURTO[unidade]
  return `${numero(qtd, 3)} ${qtd === 1 ? um : varios}`
}

export default function InsumosPage() {
  const navegar = useNavigate()
  const { data: insumos, isLoading, isError, error, refetch } = useInsumos()
  // Saldo é um extra: a lista aparece mesmo se o estoque ainda não carregou.
  const { data: saldos } = useSaldos()
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')

  const filtrados = useMemo(() => {
    const termo = simplificar(busca)
    return (insumos ?? []).filter((i) => {
      if (filtro !== 'todos' && i.categoria !== filtro) return false
      if (!termo) return true
      // Código de barras: compara só os números (o leitor e a digitação podem vir com espaços).
      const digitos = termo.replace(/\D/g, '')
      if (digitos.length >= 3 && digitos === termo.replace(/\s/g, '') && i.codigo_barras?.includes(digitos)) return true
      return [i.nome, i.marca, i.fornecedor].some((campo) => simplificar(campo).includes(termo))
    })
  }, [insumos, busca, filtro])

  const semCadastro = !isLoading && !isError && (insumos ?? []).length === 0

  return (
    <>
      <TituloPagina titulo="Insumos" subtitulo="Ingredientes, embalagens e materiais" />

      {isLoading ? (
        <Carregando />
      ) : isError ? (
        <Erro mensagem={error instanceof Error ? error.message : 'erro ao carregar'} tentarDeNovo={() => refetch()} />
      ) : semCadastro ? (
        <Vazio
          titulo="Nenhum insumo ainda"
          texto="Cadastre o que você compra (leite condensado, caixinhas, fitas…) para o app calcular o custo das receitas."
          acao={<Botao onClick={() => navegar('/insumos/novo')}>Cadastrar o primeiro</Botao>}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Busca valor={busca} aoMudar={setBusca} placeholder="Buscar por nome, marca ou código" />
          <div className="-mx-4 overflow-x-auto px-4 pb-1">
            <Pilulas rotulo="Filtrar por tipo" valor={filtro} aoMudar={setFiltro} opcoes={OPCOES_FILTRO} />
          </div>

          {filtrados.length === 0 ? (
            <Vazio
              titulo="Nada encontrado"
              texto="Tente outra palavra ou escolha “Todos”."
              acao={
                <Botao
                  variante="secundario"
                  onClick={() => {
                    setBusca('')
                    setFiltro('todos')
                  }}
                >
                  Limpar busca
                </Botao>
              }
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {filtrados.map((i) => (
                <li key={i.id}>
                  <CartaoInsumo insumo={i} saldo={saldos ? (saldos.insumos[i.id] ?? (i.estoque_minimo ? 0 : undefined)) : undefined} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <BarraAcao>
        <Botao className="flex-1" onClick={() => navegar('/insumos/novo')}>
          + Novo insumo
        </Botao>
      </BarraAcao>
    </>
  )
}

/** saldo: quanto tem em estoque (unidade base); undefined = sem movimentos (não mostra). */
function CartaoInsumo({ insumo: i, saldo }: { insumo: Insumo; saldo?: number }) {
  const base = unidadeBase(i.unidade_compra)
  const acabando = saldo !== undefined && precisaComprar(saldo, i.estoque_minimo)
  const categoria = CATEGORIAS.find((c) => c.valor === i.categoria)
  const custo = custoAmigavel({ qtdCompra: i.qtd_compra, unidadeCompra: i.unidade_compra, precoCompra: i.preco_compra })

  return (
    <Link
      to={`/insumos/${i.id}`}
      className="flex min-h-16 items-center gap-3 rounded-2xl border border-borda bg-superficie px-4 py-3 active:bg-marca-clara"
    >
      <span className="text-xl opacity-70" aria-hidden title={categoria?.rotulo}>
        {categoria?.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{i.nome}</p>
        <p className="truncate text-sm text-suave">
          {descreverEmbalagem(i.qtd_compra, i.unidade_compra)} por {moeda(i.preco_compra)}
        </p>
        {saldo !== undefined && (
          <p className={`truncate text-sm ${acabando ? 'font-semibold text-perigo' : 'text-suave'}`}>
            Em estoque: {saldo < 0 ? '−' : ''}
            {textoQuantidade(Math.abs(saldo), base)}
            {acabando && ' · acabando'}
          </p>
        )}
      </div>
      <p className="shrink-0 text-right font-bold text-marca">
        {moeda(custo.valor)}
        <span className="text-sm font-semibold">/{custo.por}</span>
      </p>
      <ChevronRight className="size-5 shrink-0 text-suave" aria-hidden />
    </Link>
  )
}
