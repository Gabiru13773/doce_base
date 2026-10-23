import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAviso } from '../../components/Aviso'
import { BarraAcao, Botao, Busca, Carregando, classeEntrada, Erro, Pilulas, TituloPagina } from '../../components/ui'
import { ajusteContagem, milesimos } from '../../lib/estoque'
import { lerNumero } from '../../lib/format'
import { novoId } from '../../lib/db'
import { paraBase } from '../../lib/unidades'
import { lerMeuNome } from '../compras/api'
import { simplificar } from '../compras/componentes/formato'
import { Interruptor, Voltar } from '../financeiro/componentes/Comum'
import { mensagemDe } from '../financeiro/util'
import { CATEGORIAS, useInsumos, type CategoriaInsumo } from '../insumos/api'
import { useReceitas } from '../receitas/api'
import { useSalvarContagem, useSaldos, type DadosContagem } from './api'
import { hojeLocal, itemDeInsumo, itemDeReceita, rotuloUnidade, textoSaldo, textoQtdItem, type ItemEstoque } from './componentes/itens'

// Contagem rápida do estoque inteiro: anota quanto tem de cada item e salva tudo de uma vez.
// O app lança a diferença entre o contado e o que ele tinha (movimento "contagem").

type Filtro = 'todas' | CategoriaInsumo | 'preparados'

const chave = (i: Pick<ItemEstoque, 'tipo' | 'id'>) => `${i.tipo}:${i.id}`

export default function ContagemPage() {
  const navegar = useNavigate()
  const avisar = useAviso()
  const insumos = useInsumos()
  const receitas = useReceitas()
  const saldos = useSaldos()
  const salvar = useSalvarContagem()

  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [comPreparados, setComPreparados] = useState(false)
  const [contado, setContado] = useState<Record<string, string>>({})
  // Um id por item, guardado para a página toda: salvar de novo depois de uma falha não duplica.
  const ids = useRef<Record<string, string>>({})

  const itensInsumos = useMemo(
    () => (insumos.data ?? []).map((i) => itemDeInsumo(i, saldos.data?.insumos[i.id])),
    [insumos.data, saldos.data],
  )
  // Preparados: primeiro os que já têm estoque ou mínimo, depois os outros (para a contagem inicial).
  const itensPreparados = useMemo(() => {
    const todos = (receitas.data ?? []).map((r) => ({
      item: itemDeReceita(r, saldos.data?.receitas[r.id]),
      usado: saldos.data?.receitas[r.id] !== undefined || (r.estoque_minimo ?? 0) > 0,
    }))
    return [...todos.filter((t) => t.usado), ...todos.filter((t) => !t.usado)].map((t) => t.item)
  }, [receitas.data, saldos.data])

  const todos = useMemo(() => [...itensInsumos, ...(comPreparados ? itensPreparados : [])], [itensInsumos, itensPreparados, comPreparados])

  // Itens preenchidos com um número válido → quantidade contada na unidade base.
  const preenchidos = useMemo(() => {
    const lista: { item: ItemEstoque; qtdBase: number }[] = []
    for (const item of todos) {
      const v = lerNumero(contado[chave(item)] ?? '')
      if (v >= 0) lista.push({ item, qtdBase: milesimos(paraBase(v, item.unidadePadrao)) })
    }
    return lista
  }, [todos, contado])
  const invalidos = todos.filter((i) => {
    const t = (contado[chave(i)] ?? '').trim()
    return t !== '' && !(lerNumero(t) >= 0)
  }).length

  const termo = simplificar(busca)
  const passa = (i: ItemEstoque) => !termo || simplificar(i.nome).includes(termo)
  const insumosVisiveis = itensInsumos.filter((i) => (filtro === 'todas' || i.categoria === filtro) && passa(i))
  const preparadosVisiveis = comPreparados && (filtro === 'todas' || filtro === 'preparados') ? itensPreparados.filter(passa) : []

  async function salvarContagem() {
    if (invalidos > 0 || preenchidos.length === 0) return
    const data = hojeLocal()
    const feitoPor = lerMeuNome() || null
    const lista: DadosContagem[] = preenchidos.map(({ item, qtdBase }) => ({
      id: (ids.current[chave(item)] ??= novoId()),
      data,
      item_tipo: item.tipo,
      insumo_id: item.tipo === 'insumo' ? item.id : null,
      receita_id: item.tipo === 'receita' ? item.id : null,
      contado: qtdBase,
      producao_id: null,
      compra_id: null,
      observacao: null,
      feito_por: feitoPor,
    }))
    try {
      const ajustes = await salvar.mutateAsync(lista)
      const n = Object.values(ajustes).filter((q) => q !== 0).length
      if (n === 0) {
        avisar({ texto: 'Tudo confere com o app: nada mudou' })
        navegar('/estoque')
        return
      }
      avisar({ texto: `Contagem salva: ${n} ${n === 1 ? 'item ajustado' : 'itens ajustados'}` })
      navegar('/estoque')
    } catch {
      // o erro aparece acima da barra
    }
  }

  if (insumos.isLoading || saldos.isLoading || (comPreparados && receitas.isLoading)) return <Carregando />
  const erro = insumos.error ?? saldos.error
  if (erro)
    return (
      <Erro
        mensagem={mensagemDe(erro)}
        tentarDeNovo={() => {
          insumos.refetch()
          saldos.refetch()
        }}
      />
    )

  const n = preenchidos.length
  const opcoesFiltro: { valor: Filtro; rotulo: string }[] = [
    { valor: 'todas', rotulo: 'Todos' },
    ...CATEGORIAS.map((c) => ({ valor: c.valor as Filtro, rotulo: c.rotulo })),
    ...(comPreparados ? [{ valor: 'preparados' as Filtro, rotulo: 'Preparados' }] : []),
  ]

  return (
    <>
      <Voltar padrao="/estoque" />
      <TituloPagina titulo="Contagem" subtitulo="Anote quanto tem de cada item agora. O que ficar em branco não muda." />

      <div className="mb-3">
        <Interruptor
          ligado={comPreparados}
          aoMudar={(v) => {
            setComPreparados(v)
            if (!v && filtro === 'preparados') setFiltro('todas')
          }}
          rotulo="Contar também os preparados"
          texto="Recheios, massas, bolos e fatias que estão prontos"
        />
      </div>

      <div className="sticky top-[3.6rem] z-10 -mx-4 mb-3 flex flex-col gap-3 bg-creme/95 px-4 pt-1 pb-2 backdrop-blur md:top-0">
        <Busca valor={busca} aoMudar={setBusca} placeholder="Buscar item" />
        <div className="-mx-4 overflow-x-auto px-4 [&>div]:flex-nowrap">
          <Pilulas rotulo="Tipo" valor={filtro} aoMudar={setFiltro} opcoes={opcoesFiltro} />
        </div>
      </div>

      {insumosVisiveis.length === 0 && preparadosVisiveis.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-borda bg-superficie px-4 py-8 text-center text-suave">Nada encontrado.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {insumosVisiveis.length > 0 && (
            <Secao titulo={comPreparados ? 'Insumos' : null}>
              {insumosVisiveis.map((i) => (
                <LinhaContagem key={i.id} item={i} valor={contado[chave(i)] ?? ''} aoMudar={(v) => setContado((c) => ({ ...c, [chave(i)]: v }))} />
              ))}
            </Secao>
          )}
          {preparadosVisiveis.length > 0 && (
            <Secao titulo="Preparados">
              {preparadosVisiveis.map((i) => (
                <LinhaContagem key={i.id} item={i} valor={contado[chave(i)] ?? ''} aoMudar={(v) => setContado((c) => ({ ...c, [chave(i)]: v }))} />
              ))}
            </Secao>
          )}
        </div>
      )}

      {salvar.isError && (
        <p className="mt-4 rounded-xl bg-perigo-claro px-4 py-3 font-medium text-perigo">
          Não deu certo: {mensagemDe(salvar.error)}. Toque em salvar de novo.
        </p>
      )}

      <BarraAcao>
        <Botao className="flex-1" disabled={n === 0 || invalidos > 0 || salvar.isPending} onClick={salvarContagem}>
          {salvar.isPending
            ? 'Salvando…'
            : invalidos > 0
              ? `Corrija ${invalidos} ${invalidos === 1 ? 'número' : 'números'}`
              : n === 0
                ? 'Salvar contagem'
                : `Salvar contagem (${n} ${n === 1 ? 'item' : 'itens'})`}
        </Botao>
      </BarraAcao>
    </>
  )
}

function Secao({ titulo, children }: { titulo: string | null; children: ReactNode }) {
  return (
    <section>
      {titulo && <h2 className="mb-2 text-lg font-bold">{titulo}</h2>}
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  )
}

function LinhaContagem({ item, valor, aoMudar }: { item: ItemEstoque; valor: string; aoMudar: (v: string) => void }) {
  const texto = valor.trim()
  const v = lerNumero(texto)
  const preenchido = texto !== ''
  const valido = v >= 0
  const ajuste = preenchido && valido ? ajusteContagem(item.saldo, milesimos(paraBase(v, item.unidadePadrao))) : 0
  const unidade = rotuloUnidade(item.unidadePadrao, item)

  return (
    <li
      className={`flex items-center gap-3 rounded-2xl border bg-superficie px-4 py-3 ${
        preenchido ? (valido ? 'border-marca' : 'border-perigo') : 'border-borda'
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold break-words">{item.nome}</p>
        <p className="text-sm text-suave">No app: {textoSaldo(item)}</p>
        {preenchido && (
          <p className={`text-sm font-medium ${!valido ? 'text-perigo' : ajuste === 0 ? 'text-ok' : 'text-marca'}`}>
            {!valido ? 'Número inválido' : ajuste === 0 ? 'Confere' : `${ajuste > 0 ? 'Vai acrescentar' : 'Vai tirar'} ${textoQtdItem(ajuste, item)}`}
          </p>
        )}
      </div>
      <label className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-xs font-medium text-suave">Contei</span>
        <span className="relative flex items-center">
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="next"
            aria-label={`Quanto contou de ${item.nome}, em ${unidade}`}
            placeholder="—"
            value={valor}
            onChange={(e) => aoMudar(e.target.value)}
            className={`${classeEntrada} w-32 pr-14 text-right`}
          />
          <span className="pointer-events-none absolute right-3 max-w-12 truncate text-sm text-suave">{unidade}</span>
        </span>
      </label>
    </li>
  )
}
