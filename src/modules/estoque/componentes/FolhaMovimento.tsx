import { useId, useState, type FormEvent } from 'react'
import { useAviso } from '../../../components/Aviso'
import { Botao, Entrada, EntradaNumero, Pilulas } from '../../../components/ui'
import { ajusteContagem, milesimos, type OrigemMovimento } from '../../../lib/estoque'
import { lerNumero } from '../../../lib/format'
import { novoId } from '../../../lib/db'
import { lerMeuNome } from '../../compras/api'
import { Folha } from '../../compras/componentes/Folha'
import { mensagemDe } from '../../financeiro/util'
import { useRemoverMovimento, useSalvarContagem, useSalvarMovimentos, type DadosMovimento, type Movimento } from '../api'
import { hojeLocal, saldoSem, textoQtdItem, textoSaldo, textoVariacao, unidadesDoItem, type ItemEstoque } from './itens'

// Folhas da tela do item: Contar (quanto tem agora), Saída (perda/uso/venda) e Entrada manual.

export type ModoFolha = 'contar' | 'saida' | 'entrada'

type Motivo = Extract<OrigemMovimento, 'perda' | 'uso' | 'venda'>

const MOTIVOS: { valor: Motivo; rotulo: string }[] = [
  { valor: 'uso', rotulo: 'Uso' },
  { valor: 'perda', rotulo: 'Perda' },
  { valor: 'venda', rotulo: 'Venda' },
]

const AJUDA_MOTIVO: Record<Motivo, string> = {
  uso: 'Usou fora de uma produção registrada (ex.: provou, testou receita).',
  perda: 'Estragou, venceu, caiu ou queimou.',
  venda: 'Vendeu direto do estoque.',
}

const TITULO: Record<ModoFolha, string> = { contar: 'Contar', saida: 'Registrar saída', entrada: 'Registrar entrada' }

export function FolhaMovimento({
  modo,
  item,
  movimentos,
  aoFechar,
}: {
  modo: ModoFolha
  item: ItemEstoque
  movimentos: Movimento[] | undefined
  aoFechar: () => void
}) {
  const avisar = useAviso()
  const salvar = useSalvarMovimentos()
  const contar = useSalvarContagem()
  const remover = useRemoverMovimento()
  const idForm = useId()
  // Um id por folha aberta: tocar em Salvar de novo depois de uma falha não duplica.
  const [id] = useState(novoId)
  const unidades = unidadesDoItem(item)
  const [unidade, setUnidade] = useState(
    unidades.some((u) => u.valor === item.unidadePadrao) ? item.unidadePadrao : (unidades[0]?.valor ?? item.unidadePadrao),
  )
  const [texto, setTexto] = useState('')
  const [motivo, setMotivo] = useState<Motivo>(item.tipo === 'receita' ? 'venda' : 'uso')
  const [observacao, setObservacao] = useState('')
  const [tentou, setTentou] = useState(false)

  const fator = unidades.find((u) => u.valor === unidade)?.fator ?? 1
  const valor = lerNumero(texto)
  const valido = modo === 'contar' ? valor >= 0 : valor > 0
  const qtdBase = valido ? milesimos(valor * fator) : NaN
  const saldoAntes = saldoSem(item.saldo, id, movimentos)
  const ajuste = modo === 'contar' && valido ? ajusteContagem(saldoAntes, qtdBase) : 0

  const erro = !tentou || valido ? undefined : texto.trim() === '' ? 'Informe a quantidade' : 'Número inválido'

  async function enviar(e?: FormEvent) {
    e?.preventDefault()
    setTentou(true)
    if (!valido) return
    const quantidade = modo === 'contar' ? ajuste : modo === 'saida' ? -qtdBase : qtdBase
    if (quantidade === 0) {
      aoFechar()
      avisar({ texto: 'Nada mudou: confere com o que o app tinha' })
      return
    }
    const origem: OrigemMovimento = modo === 'contar' ? 'contagem' : modo === 'saida' ? motivo : 'entrada'
    const movimento: DadosMovimento = {
      id,
      data: hojeLocal(),
      item_tipo: item.tipo,
      insumo_id: item.tipo === 'insumo' ? item.id : null,
      receita_id: item.tipo === 'receita' ? item.id : null,
      quantidade,
      origem,
      producao_id: null,
      compra_id: null,
      observacao: modo === 'contar' ? null : observacao.trim() || null,
      feito_por: lerMeuNome() || null,
    }
    try {
      if (modo === 'contar') {
        // A diferença é refeita com os dados mais novos da nuvem (ver useSalvarContagem).
        const { quantidade: _q, origem: _o, ...resto } = movimento
        const ajustes = await contar.mutateAsync([{ ...resto, contado: qtdBase }])
        aoFechar()
        const depois = { ...item, saldo: qtdBase }
        avisar(
          ajustes[id] === 0
            ? { texto: 'Nada mudou: confere com o que o app tinha' }
            : { texto: `Contagem salva: agora tem ${textoSaldo(depois)}`, desfazer: () => remover.mutate(id) },
        )
        return
      }
      await salvar.mutateAsync([movimento])
      aoFechar()
      avisar({
        texto: `${modo === 'saida' ? 'Saída' : 'Entrada'} registrada: ${textoVariacao(quantidade, item)}`,
        desfazer: () => remover.mutate(id),
      })
    } catch {
      // o erro aparece na folha
    }
  }

  return (
    <Folha
      titulo={TITULO[modo]}
      subtitulo={item.nome}
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao variante="secundario" className="flex-1" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao type="submit" form={idForm} className="flex-1" disabled={salvar.isPending || contar.isPending}>
            {salvar.isPending || contar.isPending ? 'Salvando…' : 'Salvar'}
          </Botao>
        </>
      }
    >
      <form id={idForm} onSubmit={enviar} className="flex flex-col gap-5">
        {modo === 'saida' && (
          <div className="flex flex-col gap-2">
            <p className="font-semibold">Por que saiu?</p>
            <Pilulas rotulo="Por que saiu?" valor={motivo} aoMudar={setMotivo} opcoes={MOTIVOS} />
            <p className="text-sm text-suave">{AJUDA_MOTIVO[motivo]}</p>
          </div>
        )}

        <EntradaNumero
          rotulo={modo === 'contar' ? 'Quanto tem agora?' : modo === 'saida' ? 'Quanto saiu?' : 'Quanto entrou?'}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          sufixo={unidades.find((u) => u.valor === unidade)?.rotulo}
          placeholder="0"
          erro={erro}
          ajuda={
            modo === 'contar'
              ? `O app diz que tem ${textoSaldo({ ...item, saldo: saldoAntes })}.`
              : `Agora tem ${textoSaldo({ ...item, saldo: saldoAntes })}.`
          }
        />

        {unidades.length > 1 && (
          <div className="flex flex-col gap-2">
            <p className="font-semibold">{modo === 'contar' ? 'Contado em' : 'Unidade'}</p>
            <Pilulas
              rotulo="Unidade"
              valor={unidade}
              aoMudar={setUnidade}
              opcoes={unidades.map((u) => ({ valor: u.valor, rotulo: u.rotulo }))}
            />
          </div>
        )}

        {modo === 'contar' && valido && (
          <p className="rounded-xl bg-marca-clara px-4 py-3">
            {ajuste === 0 ? (
              'Confere com o app: nada vai mudar.'
            ) : (
              <>
                Vai {ajuste > 0 ? 'acrescentar' : 'tirar'} <strong>{textoQtdItem(ajuste, item)}</strong> para ficar certo.
              </>
            )}
          </p>
        )}

        {modo === 'saida' && valido && qtdBase > saldoAntes && (
          <p className="rounded-xl bg-alerta-claro px-4 py-3 text-alerta">É mais do que o app acha que tem. Pode salvar assim mesmo.</p>
        )}

        {modo !== 'contar' && (
          <Entrada
            rotulo="Observação (opcional)"
            value={observacao}
            maxLength={200}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder={modo === 'entrada' ? 'Ex.: trouxe de casa, ganhou' : 'Ex.: venceu, caiu no chão'}
          />
        )}

        {(salvar.isError || contar.isError) && <p className="font-medium text-perigo">Não deu certo: {mensagemDe(salvar.error ?? contar.error)}. Toque em Salvar de novo.</p>}
      </form>
    </Folha>
  )
}
