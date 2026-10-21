import { Search, X } from 'lucide-react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { createContext, useContext, useId } from 'react'

// Componentes base do app. Tudo pensado para o dedo: alvos de toque grandes,
// texto legível e poucos elementos por tela.

type Variante = 'principal' | 'secundario' | 'perigo' | 'texto'

const estilos: Record<Variante, string> = {
  principal: 'bg-marca text-white shadow-sm active:bg-marca-escura disabled:opacity-50',
  secundario: 'bg-superficie text-marca border border-borda active:bg-marca-clara disabled:opacity-50',
  perigo: 'bg-superficie text-perigo border border-borda active:bg-perigo-claro disabled:opacity-50',
  texto: 'text-marca active:bg-marca-clara disabled:opacity-50',
}

export function Botao({
  variante = 'principal',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 font-semibold transition-colors ${estilos[variante]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

/** Verdadeiro quando o menu de baixo do celular está escondido (modo mercado das Compras). */
export const MenuOculto = createContext(false)

/** Barra fixa no rodapé com a ação principal da tela (no celular fica acima do menu). */
export function BarraAcao({ children }: { children: ReactNode }) {
  const semMenu = useContext(MenuOculto)
  return (
    <div
      className={`no-print fixed inset-x-0 z-20 border-t border-borda bg-creme/95 px-4 py-3 backdrop-blur md:bottom-0 md:left-60 ${
        semMenu ? 'bottom-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]' : 'bottom-[calc(4.5rem+env(safe-area-inset-bottom))]'
      }`}
    >
      <div className="mx-auto flex max-w-2xl gap-3">{children}</div>
    </div>
  )
}

export function Campo({
  rotulo,
  ajuda,
  erro,
  children,
  id,
}: {
  rotulo: string
  ajuda?: ReactNode
  erro?: string
  children: ReactNode
  id: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-semibold">
        {rotulo}
      </label>
      {children}
      {erro ? (
        <p className="text-sm font-medium text-perigo">{erro}</p>
      ) : ajuda ? (
        <p className="text-sm text-suave">{ajuda}</p>
      ) : null}
    </div>
  )
}

export const classeEntrada =
  'min-h-12 w-full rounded-xl border border-borda bg-superficie px-4 text-base outline-none focus:border-marca focus:ring-2 focus:ring-marca/20'

export function Entrada({
  rotulo,
  ajuda,
  erro,
  prefixo,
  sufixo,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { rotulo: string; ajuda?: ReactNode; erro?: string; prefixo?: string; sufixo?: string }) {
  const id = useId()
  return (
    <Campo rotulo={rotulo} ajuda={ajuda} erro={erro} id={id}>
      <div className="relative flex items-center">
        {prefixo && <span className="pointer-events-none absolute left-4 text-suave">{prefixo}</span>}
        <input
          id={id}
          className={`${classeEntrada} ${prefixo ? 'pl-11' : ''} ${sufixo ? 'pr-14' : ''} ${erro ? 'border-perigo' : ''}`}
          aria-invalid={erro ? true : undefined}
          {...props}
        />
        {sufixo && <span className="pointer-events-none absolute right-4 text-suave">{sufixo}</span>}
      </div>
    </Campo>
  )
}

/** Campo numérico: abre o teclado numérico e aceita vírgula (6,50). */
export function EntradaNumero(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { rotulo: string; ajuda?: ReactNode; erro?: string; prefixo?: string; sufixo?: string }) {
  return <Entrada type="text" inputMode="decimal" autoComplete="off" {...props} />
}

export function Selecao({
  rotulo,
  ajuda,
  valor,
  aoMudar,
  opcoes,
}: {
  rotulo: string
  ajuda?: ReactNode
  valor: string
  aoMudar: (v: string) => void
  opcoes: { valor: string; rotulo: string }[]
}) {
  const id = useId()
  return (
    <Campo rotulo={rotulo} ajuda={ajuda} id={id}>
      <select id={id} className={classeEntrada} value={valor} onChange={(e) => aoMudar(e.target.value)}>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </Campo>
  )
}

/** Botões de escolha única em "pílulas" (mais rápido que uma lista suspensa). */
export function Pilulas<T extends string>({
  valor,
  aoMudar,
  opcoes,
  rotulo,
}: {
  valor: T
  aoMudar: (v: T) => void
  opcoes: { valor: T; rotulo: string }[]
  rotulo?: string
}) {
  return (
    <div role="radiogroup" aria-label={rotulo} className="flex flex-wrap gap-2">
      {opcoes.map((o) => {
        const ativo = o.valor === valor
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => aoMudar(o.valor)}
            className={`min-h-11 rounded-full border px-4 text-[15px] font-medium transition-colors ${
              ativo ? 'border-marca bg-marca text-white' : 'border-borda bg-superficie text-tinta active:bg-marca-clara'
            }`}
          >
            {o.rotulo}
          </button>
        )
      })}
    </div>
  )
}

export function Busca({ valor, aoMudar, placeholder }: { valor: string; aoMudar: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-suave" aria-hidden />
      <input
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        className={`${classeEntrada} pl-12 pr-12`}
      />
      {valor && (
        <button
          type="button"
          aria-label="Limpar busca"
          onClick={() => aoMudar('')}
          className="absolute top-1/2 right-2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-suave active:bg-marca-clara"
        >
          <X className="size-5" />
        </button>
      )}
    </div>
  )
}

export function Cartao({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-borda bg-superficie p-4 ${className}`}>{children}</div>
}

export function TituloPagina({ titulo, subtitulo, acao }: { titulo: string; subtitulo?: string; acao?: ReactNode }) {
  return (
    <header className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{titulo}</h1>
        {subtitulo && <p className="text-suave">{subtitulo}</p>}
      </div>
      {acao}
    </header>
  )
}

export function Vazio({ titulo, texto, acao }: { titulo: string; texto?: string; acao?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-borda bg-superficie px-6 py-10 text-center">
      <p className="text-lg font-semibold">{titulo}</p>
      {texto && <p className="max-w-sm text-suave">{texto}</p>}
      {acao}
    </div>
  )
}

export function Carregando() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Carregando">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-2xl bg-borda/60" />
      ))}
    </div>
  )
}

export function Erro({ mensagem, tentarDeNovo }: { mensagem: string; tentarDeNovo?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl bg-perigo-claro p-4 text-perigo">
      <p className="font-semibold">Não deu certo: {mensagem}</p>
      {tentarDeNovo && (
        <Botao variante="perigo" onClick={tentarDeNovo}>
          Tentar de novo
        </Botao>
      )}
    </div>
  )
}
