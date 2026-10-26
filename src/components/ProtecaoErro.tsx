import { Component, type ErrorInfo, type ReactNode } from 'react'
import { log } from '../lib/log'

// Se uma tela quebrar ao desenhar, em vez da tela em branco mostra um aviso, registra o erro
// (console e tela Diagnóstico) e deixa tentar de novo. `chave` muda a cada tela: ao navegar, limpa o erro.

interface Props {
  chave: string
  children: ReactNode
}

interface Estado {
  erro: Error | null
  chave: string
}

export class ProtecaoErro extends Component<Props, Estado> {
  state: Estado = { erro: null, chave: this.props.chave }

  static getDerivedStateFromError(erro: Error): Partial<Estado> {
    return { erro }
  }

  static getDerivedStateFromProps(props: Props, estado: Estado): Partial<Estado> | null {
    return props.chave !== estado.chave ? { erro: null, chave: props.chave } : null
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    log.error('tela', `A tela ${this.props.chave} quebrou: ${erro.message}`, {
      erro: `${erro.name}: ${erro.message}`,
      pilha: erro.stack?.split('\n').slice(0, 5).join('\n'),
      componentes: info.componentStack?.split('\n').slice(0, 6).join('\n'),
    })
  }

  render() {
    if (!this.state.erro) return this.props.children
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl bg-perigo-claro p-4 text-perigo">
        <p className="font-semibold">Esta tela deu um erro e não pôde ser mostrada.</p>
        <p className="text-sm">{this.state.erro.message}</p>
        <p className="text-sm">O erro ficou registrado em Mais → Diagnóstico.</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-borda bg-superficie px-5 font-semibold text-perigo"
            onClick={() => this.setState({ erro: null })}
          >
            Tentar de novo
          </button>
          <a
            href="/diagnostico"
            className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-borda bg-superficie px-5 font-semibold text-perigo"
          >
            Ver diagnóstico
          </a>
        </div>
      </div>
    )
  }
}
