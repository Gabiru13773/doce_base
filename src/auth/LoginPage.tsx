import { useState, type FormEvent } from 'react'
import { log } from '../lib/log'
import { Botao, Entrada } from '../components/ui'
import { enderecoSupabase, supabase } from '../lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function entrar(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setErro('')
    setEnviando(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha })
      if (error) {
        // sem e-mail nem senha no registro
        log.warn('auth', `Login recusado: ${error.message}`)
        setErro(mensagemErro(error.message))
      }
    } catch (e) {
      log.error('auth', 'Erro ao entrar', e)
      setErro(mensagemErro(e instanceof Error ? e.message : String(e)))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={entrar} className="flex w-full max-w-sm flex-col gap-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <h1>
            <img src="/logo-completa.webp" alt="Euforia Confeitaria" width="600" height="444" className="mx-auto h-auto w-64" />
          </h1>
          <p className="text-suave">Entre para ver suas receitas, produção e estoque.</p>
        </div>
        <Entrada rotulo="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Entrada
          rotulo="Senha"
          type="password"
          autoComplete="current-password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          erro={erro || undefined}
        />
        <Botao type="submit" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </Botao>
      </form>
    </main>
  )
}

function mensagemErro(msg: string) {
  if (/Invalid login/i.test(msg)) return 'E-mail ou senha incorretos.'
  if (/Email not confirmed/i.test(msg)) return 'E-mail ainda não confirmado.'
  if (/Invalid API key|No API key/i.test(msg)) return 'Chave do Supabase inválida na configuração do app (VITE_SUPABASE_ANON_KEY).'
  if (!navigator.onLine) return 'Sem internet. Verifique a conexão e tente de novo.'
  // Conexão falhou com internet funcionando: quase sempre é o endereço do Supabase errado.
  return `Não foi possível falar com o servidor (${enderecoSupabase || 'endereço vazio'}). Detalhe: ${msg}`
}
