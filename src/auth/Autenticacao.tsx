import type { Session } from '@supabase/supabase-js'
import { log } from '../lib/log'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'

interface EstadoAuth {
  carregando: boolean
  /** E-mail de quem está usando; "modo local" quando o Supabase não está configurado. */
  usuario: string | null
  sair: () => Promise<void>
}

const Contexto = createContext<EstadoAuth>({ carregando: true, usuario: null, sair: async () => {} })

export function useAuth() {
  return useContext(Contexto)
}

export function ProvedorAuth({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Session | null>(null)
  const [carregando, setCarregando] = useState(!!supabase)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) log.error('auth', `Não deu para ler a sessão: ${error.message}`)
      else log.info('auth', data.session ? 'Sessão ativa' : 'Sem sessão (tela de entrar)')
      setSessao(data.session)
      setCarregando(false)
    })
    const { data } = supabase.auth.onAuthStateChange((evento, s) => {
      // TOKEN_REFRESHED acontece toda hora: só em debug
      log[evento === 'TOKEN_REFRESHED' ? 'debug' : 'info']('auth', `Evento de login: ${evento}`)
      setSessao(s)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const valor: EstadoAuth = supabase
    ? { carregando, usuario: sessao?.user.email ?? null, sair: async () => void (await supabase!.auth.signOut()) }
    : { carregando: false, usuario: 'modo local', sair: async () => {} }

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}
