import { useState, type FormEvent } from 'react'
import { Botao, Entrada } from '../components/ui'
import { supabase } from '../lib/supabase'

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
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha })
    setEnviando(false)
    if (error) {
      setErro(/Invalid login/i.test(error.message) ? 'E-mail ou senha incorretos.' : 'Não foi possível entrar. Verifique a internet.')
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={entrar} className="flex w-full max-w-sm flex-col gap-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <img src="/logo.svg" alt="" className="size-24" />
          <h1 className="font-marca text-3xl italic text-marca">Euforia</h1>
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
