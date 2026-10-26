import { Copy, Download, Trash2 } from 'lucide-react'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { useAviso } from '../../components/Aviso'
import { Botao, Cartao, Pilulas, TituloPagina, Vazio } from '../../components/ui'
import { lerLogs, limparLogs, ouvirLogs, textoLogs, type EntradaLog, type NivelLog } from '../../lib/log'
import { modoLocal } from '../../lib/supabase'

// O que aconteceu no app (telas abertas, envios, erros), para mandar a quem for investigar um
// problema. O mesmo registro sai no console do navegador com o prefixo [Euforia].

type Filtro = 'erros' | 'tudo' | 'detalhado'

const ESTILO: Record<NivelLog, string> = {
  debug: 'text-suave',
  info: 'text-tinta',
  warn: 'text-alerta',
  error: 'text-perigo',
}

const ROTULO: Record<NivelLog, string> = { debug: 'detalhe', info: 'info', warn: 'aviso', error: 'erro' }

export default function DiagnosticoPage() {
  const entradas = useSyncExternalStore(ouvirLogs, lerLogs)
  const [filtro, setFiltro] = useState<Filtro>('tudo')
  const avisar = useAviso()

  const visiveis = useMemo(() => {
    const lista = entradas.filter((e) =>
      filtro === 'erros' ? e.nivel === 'error' || e.nivel === 'warn' : filtro === 'tudo' ? e.nivel !== 'debug' : true,
    )
    return [...lista].reverse()
  }, [entradas, filtro])
  const erros = entradas.filter((e) => e.nivel === 'error').length

  async function copiar() {
    try {
      await navigator.clipboard.writeText(textoLogs())
      avisar({ texto: 'Diagnóstico copiado. Cole na conversa ✓' })
    } catch {
      avisar({ texto: 'Não deu para copiar. Use "Baixar arquivo".' })
    }
  }

  function baixar() {
    const url = URL.createObjectURL(new Blob([textoLogs()], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `euforia-diagnostico-${new Date().toISOString().slice(0, 16).replace(':', 'h')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  function limpar() {
    limparLogs()
    avisar({ texto: 'Registro limpo' })
  }

  return (
    <div className="flex flex-col gap-4">
      <TituloPagina titulo="Diagnóstico" subtitulo="O que aconteceu no app, para achar problemas" />

      <Cartao className="flex flex-col gap-2 text-sm">
        <p>
          Versão <strong>{__VERSAO__}</strong> · {modoLocal ? 'dados só neste aparelho' : 'dados na nuvem'} ·{' '}
          {navigator.onLine ? 'com internet' : 'sem internet'}
        </p>
        <p className="text-suave">
          Achou algo estranho? Toque em <strong>Copiar</strong> e cole na conversa com quem cuida do app. No computador, o mesmo
          registro aparece no console do navegador (F12) com o prefixo [Euforia].
        </p>
      </Cartao>

      <div className="grid grid-cols-3 gap-2">
        <Botao variante="secundario" className="px-2" onClick={() => void copiar()}>
          <Copy className="size-4" aria-hidden /> Copiar
        </Botao>
        <Botao variante="secundario" className="px-2" onClick={baixar}>
          <Download className="size-4" aria-hidden /> Baixar
        </Botao>
        <Botao variante="perigo" className="px-2" onClick={limpar}>
          <Trash2 className="size-4" aria-hidden /> Limpar
        </Botao>
      </div>

      <Pilulas<Filtro>
        rotulo="Mostrar"
        valor={filtro}
        aoMudar={setFiltro}
        opcoes={[
          { valor: 'tudo', rotulo: 'Tudo' },
          { valor: 'erros', rotulo: erros > 0 ? `Erros (${erros})` : 'Erros' },
          { valor: 'detalhado', rotulo: 'Detalhado' },
        ]}
      />

      {visiveis.length === 0 ? (
        <Vazio titulo={filtro === 'erros' ? 'Nenhum erro registrado' : 'Nada registrado ainda'} />
      ) : (
        <ol className="flex flex-col gap-2">
          {visiveis.map((e, i) => (
            <Linha key={`${e.t}-${i}`} e={e} />
          ))}
        </ol>
      )}
    </div>
  )
}

function Linha({ e }: { e: EntradaLog }) {
  return (
    <li className="rounded-xl border border-borda bg-superficie px-3 py-2 text-sm">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs text-suave tabular-nums">{new Date(e.t).toLocaleString('pt-BR')}</span>
        <span className={`text-xs font-semibold uppercase ${ESTILO[e.nivel]}`}>{ROTULO[e.nivel]}</span>
        <span className="text-xs text-suave">{e.area}</span>
      </p>
      <p className={`break-words ${ESTILO[e.nivel]}`}>{e.msg}</p>
      {e.dados && <pre className="mt-1 overflow-x-auto text-xs whitespace-pre-wrap break-all text-suave">{e.dados}</pre>}
    </li>
  )
}
