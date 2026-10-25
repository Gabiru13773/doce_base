import { AlertTriangle, ArrowLeftRight, CheckCircle2, ChevronDown, Copy, Store, Tag } from 'lucide-react'
import { memo, useId } from 'react'
import { Botao, Pilulas } from '../../../components/ui'
import { folgaPdv, type Confianca, type FormaPdv, type LinhaImportacao, type SugestaoPdv } from '../../../lib/conciliacao'
import { moeda } from '../../../lib/format'
import type { CategoriaFin, ContaFin, Lancamento } from '../api'
import { SeletorCategoria, SeletorConta, nomeCategoria } from '../componentes/Seletores'

/** 'repasse': a linha baixa várias contas do PDV de uma vez (repasse do iFood). */
export type Modo = 'categoria' | 'titulo' | 'transferencia' | 'repasse'

/** O que a pessoa decidiu para uma linha (o que não mudou vem da sugestão). */
export interface Escolha {
  incluir: boolean
  modo: Modo
  categoriaId: string | null
  tituloId: string | null
  contaId: string | null
  /** A categoria foi escolhida à mão (não mostra mais o "certeza"). */
  manual?: boolean
}

export interface TituloAberto {
  id: string
  tipo: 'pagar' | 'receber'
  descricao: string
  pessoa: string | null
  categoria_id: string | null
  vencimento: string
  falta: number
  /** Conta a receber do fechamento do caixa (PDV): a forma. */
  forma_pdv?: FormaPdv | null
}

export function escolhaPadrao(l: LinhaImportacao): Escolha {
  return {
    incluir: !l.jaImportada && !l.possivelDuplicata,
    modo: l.titulo ? 'titulo' : repasseSugerido(l) ? 'repasse' : 'categoria',
    categoriaId: l.categoriaId,
    tituloId: l.titulo?.tituloId ?? null,
    contaId: l.contaTransferenciaId,
  }
}

/** Repasse do iFood com certeza razoável: já vem escolhido. */
function repasseSugerido(l: LinhaImportacao) {
  return l.pdv?.tipo === 'soma' && l.pdv.confianca !== 'baixa'
}

/** Contas do PDV que a linha baixa no modo repasse (vazio se não é repasse). */
export function partesRepasse(l: LinhaImportacao): SugestaoPdv['titulos'] {
  return l.pdv?.tipo === 'soma' ? l.pdv.titulos : []
}

const NOME_FORMA: Record<FormaPdv, string> = { pix: 'Pix', debito: 'Cartão de débito', credito: 'Cartão de crédito', ifood: 'iFood' }

/** "Pix de 21/10", "Cartão de débito de 21/10". */
const vendasDe = (pdv: SugestaoPdv) => `${NOME_FORMA[pdv.forma]} de ${diaMes(pdv.titulos[0].dia)}`

/** "4 dias de vendas (13/10 a 16/10)". */
function diasDoRepasse(pdv: SugestaoPdv) {
  const n = pdv.titulos.length
  return `${n} ${n === 1 ? 'dia' : 'dias'} de vendas (${diaMes(pdv.titulos[0].dia)} a ${diaMes(pdv.titulos[n - 1].dia)})`
}

export function escolhaFinal(l: LinhaImportacao, mudou: Partial<Escolha> | undefined): Escolha {
  const e = { ...escolhaPadrao(l), ...mudou }
  if (l.jaImportada) e.incluir = false
  return e
}

export const diaMes = (data: string) => `${data.slice(8, 10)}/${data.slice(5, 7)}`

const ROTULO_CONFIANCA: Record<Confianca, string> = { alta: 'certeza alta', media: 'certeza média', baixa: 'pouca certeza' }
const COR_CONFIANCA: Record<Confianca, string> = { alta: 'bg-ok', media: 'bg-amarelo', baixa: 'bg-borda' }

function Certeza({ nivel }: { nivel: Confianca }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm whitespace-nowrap text-suave">
      <span className={`size-2 rounded-full ${COR_CONFIANCA[nivel]}`} aria-hidden />
      {ROTULO_CONFIANCA[nivel]}
    </span>
  )
}

interface Props {
  linha: LinhaImportacao
  mudou: Partial<Escolha> | undefined
  aberta: boolean
  categorias: CategoriaFin[]
  contas: ContaFin[]
  contaId: string
  titulosAbertos: TituloAberto[]
  tituloPorId: Map<string, TituloAberto>
  /** Conta a pagar/receber → linha (fitid) que já a escolheu; as outras linhas não a oferecem. */
  tituloEscolhidoEm: Map<string, string>
  duplicata: Lancamento | undefined
  alterar: (fitid: string, mudanca: Partial<Escolha>) => void
  abrir: (fitid: string | null) => void
}

export const LinhaRevisao = memo(function LinhaRevisao({
  linha,
  mudou,
  aberta,
  categorias,
  contas,
  contaId,
  titulosAbertos,
  tituloPorId,
  tituloEscolhidoEm,
  duplicata,
  alterar,
  abrir,
}: Props) {
  const idPainel = useId()
  const t = linha.transacao
  const e = escolhaFinal(linha, mudou)
  const entrada = linha.direcao === 'entrada'
  const titulo = e.tituloId ? tituloPorId.get(e.tituloId) : undefined
  const outraConta = e.contaId ? contas.find((c) => c.id === e.contaId) : undefined
  const temOutrasContas = contas.some((c) => c.ativo && c.id !== contaId)
  // Conta já escolhida em outra linha não aparece aqui (senão a mesma conta seria baixada duas vezes).
  // A conta do Pix do PDV é recebida aos poucos (um Pix por cliente): pode estar em várias linhas.
  const livre = (id: string) => {
    const dono = tituloEscolhidoEm.get(id)
    return id === e.tituloId || !dono || dono === t.fitid || tituloPorId.get(id)?.forma_pdv === 'pix'
  }
  const pdv = linha.pdv
  // A sugestão do PDV vale enquanto a pessoa não trocou a conta.
  const pdvDoTitulo = pdv && pdv.tipo !== 'soma' && e.modo === 'titulo' && titulo && pdv.titulos[0].tituloId === titulo.id ? pdv : null
  const repasse = e.modo === 'repasse' && pdv?.tipo === 'soma' ? pdv : null
  const titulosDoSentido = titulosAbertos.filter((x) => x.tipo === (entrada ? 'receber' : 'pagar') && livre(x.id))

  let resumo
  if (linha.jaImportada) {
    resumo = (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-creme px-2.5 py-0.5 text-sm font-medium text-suave">
        <CheckCircle2 className="size-4" aria-hidden /> Já importada
      </span>
    )
  } else if (repasse) {
    resumo = (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-ok">
          <Store className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">Repasse iFood: {diasDoRepasse(repasse)}</span>
        </span>
        <Certeza nivel={repasse.confianca} />
      </span>
    )
  } else if (pdvDoTitulo && titulo) {
    resumo = (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-ok">
          <Store className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">
            Recebimento das vendas do PDV: {vendasDe(pdvDoTitulo)} — falta {moeda(pdvDoTitulo.titulos[0].falta)}
          </span>
        </span>
        {!e.manual && <Certeza nivel={pdvDoTitulo.confianca} />}
      </span>
    )
  } else if (e.modo === 'titulo' && titulo) {
    resumo = (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-ok">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">
            Baixa de: {titulo.descricao} (venc. {diaMes(titulo.vencimento)})
          </span>
        </span>
        {!e.manual && linha.titulo?.tituloId === titulo.id && <Certeza nivel={linha.titulo.confianca} />}
      </span>
    )
  } else if (e.modo === 'transferencia') {
    resumo = (
      <span className={`inline-flex items-center gap-1.5 font-medium ${outraConta ? 'text-tinta' : 'text-alerta'}`}>
        <ArrowLeftRight className="size-4 shrink-0" aria-hidden />
        {outraConta ? `Transferência ${entrada ? 'de' : 'para'} ${outraConta.nome}` : 'Transferência: escolha a outra conta'}
      </span>
    )
  } else if (e.categoriaId) {
    resumo = (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
          <Tag className="size-4 shrink-0 text-marca" aria-hidden />
          <span className="min-w-0 break-words">Categoria: {nomeCategoria(categorias, e.categoriaId)}</span>
        </span>
        {!e.manual && e.categoriaId === linha.categoriaId && linha.confiancaCategoria && <Certeza nivel={linha.confiancaCategoria} />}
      </span>
    )
  } else {
    resumo = (
      <span className="inline-flex items-center gap-1.5 font-medium text-alerta">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {linha.talvezTransferencia ? 'Parece transferência entre suas contas' : 'Sem categoria'}
      </span>
    )
  }

  const opcoesModo: { valor: Modo; rotulo: string }[] = [{ valor: 'categoria', rotulo: 'Categoria' }]
  if (titulosDoSentido.length > 0) opcoesModo.push({ valor: 'titulo', rotulo: entrada ? 'Conta a receber' : 'Conta a pagar' })
  if (pdv?.tipo === 'soma') opcoesModo.push({ valor: 'repasse', rotulo: 'Repasse iFood' })
  if (temOutrasContas) opcoesModo.push({ valor: 'transferencia', rotulo: 'Transferência' })

  const sugeridos = [linha.titulo, ...linha.alternativas].filter(
    (s): s is NonNullable<typeof s> => !!s && tituloPorId.has(s.tituloId) && livre(s.tituloId),
  )
  const alternativaLivre = linha.alternativas.find((a) => tituloPorId.has(a.tituloId) && livre(a.tituloId))
  const valorAbs = Math.abs(t.valor)
  // Cartão/iFood: o banco pode pagar centavos a mais que a conta do PDV (a baixa usa o valor do banco).
  const folga = titulo ? folgaPdv(titulo.forma_pdv, titulo.falta) : 0
  const ignorarPdv = (
    <Botao variante="texto" className="self-start px-0" onClick={() => alterar(t.fitid, { modo: 'categoria', tituloId: null, manual: true, incluir: true })}>
      Não é das vendas do PDV: lançar como entrada comum
    </Botao>
  )

  return (
    <li className={`border-b border-borda last:border-b-0 ${linha.jaImportada ? 'opacity-60' : ''}`}>
      <div className="flex items-stretch gap-1">
        <label className="flex w-12 shrink-0 cursor-pointer items-start justify-center pt-4">
          <input
            type="checkbox"
            className="size-6 accent-marca"
            checked={e.incluir}
            disabled={linha.jaImportada}
            onChange={(ev) => alterar(t.fitid, { incluir: ev.target.checked })}
            aria-label={`Importar ${linha.descricao}, ${moeda(t.valor)}`}
          />
        </label>
        <button
          type="button"
          className="flex min-w-0 flex-1 flex-col gap-1 py-3 pr-3 text-left active:bg-creme disabled:cursor-default"
          onClick={() => abrir(aberta ? null : t.fitid)}
          aria-expanded={aberta}
          aria-controls={idPainel}
          disabled={linha.jaImportada}
        >
          <span className="flex items-start gap-3">
            <span className="line-clamp-2 min-w-0 flex-1 font-medium break-words">{linha.descricao}</span>
            <span className={`shrink-0 font-semibold whitespace-nowrap tabular-nums ${entrada ? 'text-ok' : 'text-perigo'}`}>
              {entrada ? '+' : '−'} {moeda(valorAbs)}
            </span>
          </span>
          <span className="flex items-end justify-between gap-2 text-[15px]">
            <span className="min-w-0">{resumo}</span>
            {!linha.jaImportada && <ChevronDown className={`size-5 shrink-0 text-suave transition-transform ${aberta ? 'rotate-180' : ''}`} aria-hidden />}
          </span>
          {linha.possivelDuplicata && !linha.jaImportada && (
            <span className="flex items-start gap-1.5 rounded-xl bg-alerta-claro px-3 py-2 text-sm text-alerta">
              <Copy className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Parece repetida: você já anotou {moeda(valorAbs)}
                {duplicata ? ` ("${duplicata.descricao}", ${diaMes(duplicata.data)})` : ''}. Por isso ficou desmarcada; marque se for outra.
              </span>
            </span>
          )}
          {!linha.jaImportada && pdv?.tipo === 'soma' && e.modo !== 'repasse' && (
            <span className="text-sm text-suave">Pode ser o repasse do iFood de {diasDoRepasse(pdv)}? Toque para ver.</span>
          )}
          {!linha.jaImportada && pdv && pdv.tipo !== 'soma' && e.modo !== 'titulo' && (
            <span className="text-sm text-suave">Pode ser o recebimento das vendas do PDV ({vendasDe(pdv)})? Toque para ver.</span>
          )}
          {!linha.jaImportada && e.modo !== 'titulo' && !linha.titulo && !pdv && alternativaLivre && (
            <span className="text-sm text-suave">
              Pode ser a conta “{tituloPorId.get(alternativaLivre.tituloId)?.descricao}”? Toque para ver.
            </span>
          )}
        </button>
      </div>

      {aberta && !linha.jaImportada && (
        <div id={idPainel} className="flex flex-col gap-4 border-t border-dashed border-borda bg-creme/60 px-4 py-4">
          {opcoesModo.length > 1 && (
            <Pilulas<Modo>
              rotulo="O que é esta transação?"
              valor={e.modo}
              aoMudar={(modo) => alterar(t.fitid, { modo, incluir: true })}
              opcoes={opcoesModo}
            />
          )}

          {e.modo === 'categoria' && (
            <SeletorCategoria
              tipo={linha.direcao}
              categorias={categorias}
              valor={e.categoriaId}
              aoMudar={(id) => alterar(t.fitid, { categoriaId: id, manual: true, incluir: true })}
              ajuda={linha.talvezTransferencia && temOutrasContas ? 'Se foi dinheiro passando entre suas contas, escolha “Transferência” acima.' : undefined}
            />
          )}

          {e.modo === 'titulo' && (
            <div className="flex flex-col gap-3">
              {sugeridos.length > 0 && (
                <div role="radiogroup" aria-label="Contas com esse valor" className="flex flex-col gap-2">
                  <p className="font-semibold">{pdvDoTitulo ? 'Conta sugerida' : 'Contas com esse valor'}</p>
                  {sugeridos.map((s) => {
                    const x = tituloPorId.get(s.tituloId)!
                    const ativo = e.tituloId === x.id
                    return (
                      <button
                        key={x.id}
                        type="button"
                        role="radio"
                        aria-checked={ativo}
                        onClick={() => alterar(t.fitid, { tituloId: x.id, manual: true, incluir: true })}
                        className={`flex min-h-12 flex-col items-start rounded-xl border px-4 py-2 text-left ${
                          ativo ? 'border-marca bg-marca-clara' : 'border-borda bg-superficie active:bg-marca-clara'
                        }`}
                      >
                        <span className="font-medium break-words">
                          {x.descricao}
                          {x.pessoa ? ` · ${x.pessoa}` : ''}
                        </span>
                        <span className="text-sm text-suave">
                          venc. {diaMes(x.vencimento)} · falta {moeda(x.falta)} · {ROTULO_CONFIANCA[s.confianca]}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
              <EscolhaTitulo
                titulos={titulosDoSentido}
                valor={e.tituloId}
                rotulo={sugeridos.length > 0 ? 'Ou escolha outra' : entrada ? 'Qual conta a receber?' : 'Qual conta a pagar?'}
                aoMudar={(id) => alterar(t.fitid, { tituloId: id, manual: true, incluir: true })}
              />
              {pdvDoTitulo ? (
                <NotaPdv pdv={pdvDoTitulo} valor={valorAbs} />
              ) : (
                titulo &&
                Math.abs(titulo.falta - valorAbs) >= 0.01 && (
                  <p className="rounded-xl bg-alerta-claro px-3 py-2 text-sm text-alerta">
                    {valorAbs < titulo.falta
                      ? `Faltam ${moeda(titulo.falta)} nessa conta: ela vai ficar paga só em parte.`
                      : valorAbs <= titulo.falta + folga + 0.005
                        ? `O banco pagou ${moeda(valorAbs - titulo.falta)} a mais que essa conta (diferença da maquininha): a baixa fica com o valor do banco.`
                        : `Essa conta só tem ${moeda(titulo.falta)} em aberto e o valor do extrato é maior: assim não dá para importar. Ligue a outra conta ou escolha uma categoria.`}
                  </p>
                )
              )}
              {pdvDoTitulo && ignorarPdv}
            </div>
          )}

          {e.modo === 'repasse' && pdv?.tipo === 'soma' && (
            <div className="flex flex-col gap-2">
              <p className="font-semibold">Repasse iFood: {diasDoRepasse(pdv)}</p>
              <ul className="flex flex-col gap-1 rounded-xl border border-borda bg-superficie px-4 py-2">
                {pdv.titulos.map((x) => (
                  <li key={x.tituloId} className="flex items-baseline justify-between gap-3 text-[15px]">
                    <span className="min-w-0 break-words">
                      {tituloPorId.get(x.tituloId)?.descricao ?? `Vendas de ${diaMes(x.dia)}`}
                    </span>
                    <span className="shrink-0 tabular-nums">{moeda(x.valor)}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-suave">
                Cada dia de vendas recebe a sua parte (um lançamento para cada), sem contar a venda duas vezes.
                {Math.abs(pdv.diferenca) >= 0.01 &&
                  ` O banco pagou ${moeda(Math.abs(pdv.diferenca))} a ${pdv.diferenca > 0 ? 'mais' : 'menos'} que a soma: a diferença fica no último dia.`}
              </p>
              {ignorarPdv}
            </div>
          )}

          {e.modo === 'transferencia' && (
            <SeletorConta
              rotulo={entrada ? 'De qual conta veio o dinheiro?' : 'Para qual conta foi o dinheiro?'}
              contas={contas}
              valor={e.contaId}
              excluir={contaId}
              aoMudar={(id) => alterar(t.fitid, { contaId: id, incluir: true })}
              ajuda="Transferência não é gasto nem venda: só muda o dinheiro de lugar."
            />
          )}

          <Botao variante="secundario" onClick={() => abrir(null)}>
            Pronto
          </Botao>
        </div>
      )}
    </li>
  )
})

/** O que acontece com a conta do PDV ao importar esta linha. */
function NotaPdv({ pdv, valor }: { pdv: SugestaoPdv; valor: number }) {
  const falta = pdv.titulos[0].falta
  let texto: string
  if (pdv.tipo === 'parcial') {
    texto =
      pdv.restante >= 0.01
        ? `É um dos Pix das vendas de ${diaMes(pdv.titulos[0].dia)}: baixa ${moeda(valor)} dos ${moeda(falta)} que faltam. Ainda ficam ${moeda(pdv.restante)} a receber dos outros Pix desse dia.`
        : `Com este Pix, as vendas em Pix de ${diaMes(pdv.titulos[0].dia)} ficam todas recebidas.`
  } else if (Math.abs(pdv.diferenca) < 0.01) {
    texto = 'O valor do banco bate com a conta do PDV.'
  } else if (pdv.diferenca < 0) {
    texto = `O banco pagou ${moeda(-pdv.diferenca)} a menos que a conta do PDV (${moeda(falta)}), provavelmente diferença de taxa. A baixa fica com o valor do banco e os ${moeda(-pdv.diferenca)} continuam em aberto: dá para ignorar ou dar baixa depois em Contas a receber.`
  } else {
    texto = `O banco pagou ${moeda(pdv.diferenca)} a mais que a conta do PDV (${moeda(falta)}). A baixa fica com o valor do banco e a conta fica paga.`
  }
  return <p className="rounded-xl bg-marca-clara/60 px-3 py-2 text-sm">{texto}</p>
}

function EscolhaTitulo({
  titulos,
  valor,
  rotulo,
  aoMudar,
}: {
  titulos: TituloAberto[]
  valor: string | null
  rotulo: string
  aoMudar: (id: string | null) => void
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-semibold">
        {rotulo}
      </label>
      <select
        id={id}
        className="min-h-12 w-full rounded-xl border border-borda bg-superficie px-4 text-base outline-none focus:border-marca focus:ring-2 focus:ring-marca/20"
        value={valor ?? ''}
        onChange={(ev) => aoMudar(ev.target.value || null)}
      >
        <option value="">Escolha…</option>
        {titulos.map((x) => (
          <option key={x.id} value={x.id}>
            {x.descricao}
            {x.pessoa ? ` · ${x.pessoa}` : ''} · venc. {diaMes(x.vencimento)} · {moeda(x.falta)}
          </option>
        ))}
      </select>
    </div>
  )
}
