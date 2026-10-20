import { ChevronRight } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useAviso } from '../../components/Aviso'
import { BarraAcao, Botao, Carregando, Cartao, Entrada, Erro, Pilulas, Selecao, TituloPagina } from '../../components/ui'
import { LINHAS_DRE, useCategoriasFin, useSalvarCategoriaFin, type CategoriaFin, type LinhaDre, type TipoCategoria } from './api'
import { Interruptor } from './componentes/Comum'
import { mensagemDe, simplificar } from './util'

const ABAS: { valor: TipoCategoria; rotulo: string }[] = [
  { valor: 'entrada', rotulo: 'Entradas' },
  { valor: 'saida', rotulo: 'Saídas' },
]

/** Agrupa mantendo a ordem do plano: Grupo → Subgrupo → categorias. */
function agrupar(categorias: CategoriaFin[]) {
  const grupos = new Map<string, Map<string, CategoriaFin[]>>()
  for (const c of [...categorias].sort((a, b) => a.ordem - b.ordem)) {
    const subs = grupos.get(c.grupo) ?? new Map<string, CategoriaFin[]>()
    subs.set(c.subgrupo, [...(subs.get(c.subgrupo) ?? []), c])
    grupos.set(c.grupo, subs)
  }
  return [...grupos].map(([grupo, subs]) => ({ grupo, subgrupos: [...subs] }))
}

export default function CategoriasPage() {
  const { data, isLoading, isError, error, refetch } = useCategoriasFin()
  const [aba, setAba] = useState<TipoCategoria>('saida')
  // id da categoria aberta para editar, 'nova' para o formulário de nova, ou null.
  const [aberta, setAberta] = useState<string | null>(null)

  const todas = data ?? []
  const daAba = todas.filter((c) => c.tipo === aba)

  return (
    <>
      <TituloPagina titulo="Plano de contas" subtitulo="As categorias para separar o que entra e o que sai" />

      {isLoading ? (
        <Carregando />
      ) : isError ? (
        <Erro mensagem={mensagemDe(error)} tentarDeNovo={() => void refetch()} />
      ) : (
        <div className="flex flex-col gap-5">
          <Pilulas
            rotulo="Tipo de categoria"
            valor={aba}
            aoMudar={(v) => {
              setAba(v)
              setAberta(null)
            }}
            opcoes={ABAS}
          />

          {aberta === 'nova' && (
            <FormCategoria tipo={aba} todas={todas} aoFechar={() => setAberta(null)} />
          )}

          {agrupar(daAba).map(({ grupo, subgrupos }) => (
            <section key={grupo} className="flex flex-col gap-3">
              <h2 className="text-lg font-bold">{grupo}</h2>
              {subgrupos.map(([subgrupo, lista]) => (
                <div key={subgrupo} className="flex flex-col gap-1.5">
                  {subgrupo !== grupo && <h3 className="px-1 text-sm font-semibold tracking-wide text-suave uppercase">{subgrupo}</h3>}
                  <ul className="divide-y divide-borda overflow-hidden rounded-2xl border border-borda bg-superficie">
                    {lista.map((c) =>
                      aberta === c.id ? (
                        <li key={c.id} className="p-2">
                          <FormCategoria original={c} tipo={aba} todas={todas} aoFechar={() => setAberta(null)} />
                        </li>
                      ) : (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => setAberta(c.id)}
                            className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left active:bg-marca-clara"
                          >
                            <span className="min-w-0 flex-1">
                              <span className={`block ${c.ativo ? 'font-medium' : 'text-suave line-through'}`}>{c.nome}</span>
                              <span className="block text-sm text-suave">
                                {c.ativo ? LINHAS_DRE.find((l) => l.valor === c.linha_dre)?.rotulo : 'Desativada'}
                              </span>
                            </span>
                            <ChevronRight className="size-5 shrink-0 text-suave" aria-hidden />
                          </button>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      <BarraAcao>
        <Botao
          className="flex-1"
          onClick={() => {
            setAberta('nova')
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        >
          + Nova categoria
        </Botao>
      </BarraAcao>
    </>
  )
}

interface Erros {
  nome?: string
  grupo?: string
  subgrupo?: string
}

function FormCategoria({
  original,
  tipo,
  todas,
  aoFechar,
}: {
  original?: CategoriaFin
  tipo: TipoCategoria
  todas: CategoriaFin[]
  aoFechar: () => void
}) {
  const avisar = useAviso()
  const salvar = useSalvarCategoriaFin()
  const idGrupos = useId()
  const idSubs = useId()
  const ref = useRef<HTMLFormElement>(null)

  const [nome, setNome] = useState(original?.nome ?? '')
  const [grupo, setGrupo] = useState(original?.grupo ?? '')
  const [subgrupo, setSubgrupo] = useState(original?.subgrupo ?? '')
  const [linha, setLinha] = useState<LinhaDre>(original?.linha_dre ?? (tipo === 'entrada' ? 'receita_bruta' : 'despesas_operacionais'))
  const [ativo, setAtivo] = useState(original?.ativo ?? true)
  const [tentou, setTentou] = useState(false)

  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])

  const doTipo = todas.filter((c) => c.tipo === tipo)
  const grupos = [...new Set(doTipo.map((c) => c.grupo))]
  const subgrupos = [...new Set(doTipo.filter((c) => simplificar(c.grupo) === simplificar(grupo)).map((c) => c.subgrupo))]

  function mudarGrupo(g: string) {
    setGrupo(g)
    // Numa categoria nova, puxa a linha da DRE que o grupo já usa.
    if (!original) {
      const irma = doTipo.find((c) => simplificar(c.grupo) === simplificar(g))
      if (irma) setLinha(irma.linha_dre)
    }
  }

  const erros: Erros = {}
  if (!nome.trim()) erros.nome = 'Escreva o nome da categoria'
  if (!grupo.trim()) erros.grupo = 'Escolha ou escreva o grupo'
  if (!subgrupo.trim()) erros.subgrupo = 'Escolha ou escreva o subgrupo'
  if (
    nome.trim() &&
    todas.some(
      (c) =>
        c.id !== original?.id &&
        c.tipo === tipo &&
        simplificar(c.grupo) === simplificar(grupo) &&
        simplificar(c.subgrupo) === simplificar(subgrupo) &&
        simplificar(c.nome) === simplificar(nome),
    )
  )
    erros.nome = 'Já existe uma categoria com esse nome neste grupo'
  const temErro = Object.keys(erros).length > 0
  const mostrar: Erros = tentou ? erros : {}

  function proximaOrdem(): number {
    const mesmoGrupo = doTipo.filter((c) => simplificar(c.grupo) === simplificar(grupo))
    if (mesmoGrupo.length) return Math.max(...mesmoGrupo.map((c) => c.ordem)) + 1
    return Math.max(0, ...todas.map((c) => c.ordem)) + 10
  }

  async function aoSalvar(e: FormEvent) {
    e.preventDefault()
    e.stopPropagation()
    setTentou(true)
    if (temErro) return
    // Usa a grafia já existente do grupo/subgrupo (evita "vendas" e "Vendas" separados).
    const grupoFinal = grupos.find((g) => simplificar(g) === simplificar(grupo)) ?? grupo
    const subFinal = subgrupos.find((s) => simplificar(s) === simplificar(subgrupo)) ?? subgrupo
    try {
      await salvar.mutateAsync({
        id: original?.id,
        tipo,
        nome,
        grupo: grupoFinal,
        subgrupo: subFinal,
        linha_dre: linha,
        ordem: original && simplificar(original.grupo) === simplificar(grupoFinal) ? original.ordem : proximaOrdem(),
        ativo,
      })
      avisar({ texto: 'Categoria salva ✓' })
      aoFechar()
    } catch {
      // O erro aparece abaixo.
    }
  }

  return (
    <form ref={ref} onSubmit={aoSalvar} noValidate>
      <Cartao className="flex flex-col gap-4 border-marca/30">
        <p className="text-lg font-bold">{original ? 'Editar categoria' : `Nova categoria de ${tipo === 'entrada' ? 'entrada' : 'saída'}`}</p>
        <Entrada
          rotulo="Nome"
          placeholder={tipo === 'entrada' ? 'Ex.: Vendas na feira' : 'Ex.: Material de limpeza'}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          erro={mostrar.nome}
          autoFocus
          autoCapitalize="sentences"
        />
        <Entrada
          rotulo="Grupo"
          value={grupo}
          onChange={(e) => mudarGrupo(e.target.value)}
          list={idGrupos}
          erro={mostrar.grupo}
          ajuda="Escolha um da lista ou escreva um novo"
        />
        <datalist id={idGrupos}>
          {grupos.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <Entrada rotulo="Subgrupo" value={subgrupo} onChange={(e) => setSubgrupo(e.target.value)} list={idSubs} erro={mostrar.subgrupo} />
        <datalist id={idSubs}>
          {subgrupos.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <Selecao
          rotulo="Onde entra no resultado do mês (DRE)"
          valor={linha}
          aoMudar={(v) => setLinha(v as LinhaDre)}
          opcoes={LINHAS_DRE}
        />
        {original && (
          <Interruptor
            ligado={ativo}
            aoMudar={setAtivo}
            rotulo={ativo ? 'Categoria em uso' : 'Categoria desativada'}
            texto="Desativada não aparece para novos lançamentos; os antigos continuam com ela."
          />
        )}
        {salvar.isError && <Erro mensagem={mensagemDe(salvar.error)} />}
        <div className="flex gap-3">
          <Botao variante="secundario" className="flex-1" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao type="submit" className="flex-1" disabled={salvar.isPending}>
            {salvar.isPending ? 'Salvando…' : 'Salvar'}
          </Botao>
        </div>
      </Cartao>
    </form>
  )
}
