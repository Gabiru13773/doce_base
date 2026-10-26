import './styles/theme.css'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { MutationCache, QueryCache, QueryClient, type Query } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { ProvedorAuth } from './auth/Autenticacao'
import { ProvedorAviso } from './components/Aviso'
import { instalarLogsGlobais, log } from './lib/log'
import { modoLocal } from './lib/supabase'

const UM_DIA = 1000 * 60 * 60 * 24

instalarLogsGlobais({ modo: modoLocal ? 'local (só neste aparelho)' : 'nuvem (Supabase)', versao: __VERSAO__, internet: navigator.onLine })

const chave = (k: readonly unknown[]) => k.map((x) => (typeof x === 'string' && x.length > 60 ? `${x.slice(0, 60)}…` : x)).join('/')

const queryClient = new QueryClient({
  // Erros de qualquer consulta ou gravação vão para o registro (console e tela Diagnóstico).
  queryCache: new QueryCache({
    onError: (e, q) => log.error('consulta', `Falhou ao carregar ${chave(q.queryKey)}: ${e.message}`),
  }),
  mutationCache: new MutationCache({
    onError: (e, _v, _c, m) => log.error('salvar', `Falhou${m.options.mutationKey ? ` (${chave(m.options.mutationKey)})` : ''}: ${e.message}`, e),
  }),
  defaultOptions: {
    // Mostra na hora o que está guardado e sempre busca de novo ao abrir uma tela
    // (staleTime 0): o cache salvo no aparelho pode estar alguns segundos atrasado.
    // offlineFirst: sem internet, continua mostrando o que está guardado.
    queries: { staleTime: 0, gcTime: UM_DIA, retry: 1, networkMode: 'offlineFirst' },
    // always: salvar nunca fica "pendurado" sem internet; mostra o erro na hora.
    mutations: { networkMode: 'always' },
  },
})

// Guarda o cache no aparelho: o app abre com os dados da última visita, mesmo sem internet.
const persister = createSyncStoragePersister({ storage: window.localStorage, key: 'euforia-cache' })

// Links temporários das fotos dos pedidos não vão para o aparelho (venceriam antes de serem usados).
// No modo local os pedidos (com as fotos dentro) já estão no aparelho: guardar de novo lotaria o espaço.
function guardarNoAparelho(q: Query): boolean {
  if (q.state.status !== 'success') return false
  if (q.queryKey[0] === 'pedidos' && (q.queryKey[1] === 'foto' || modoLocal)) return false
  return true
}

// Atualiza o app sozinho quando sai versão nova.
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: UM_DIA, dehydrateOptions: { shouldDehydrateQuery: guardarNoAparelho } }}>
      <ProvedorAuth>
        <ProvedorAviso>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ProvedorAviso>
      </ProvedorAuth>
    </PersistQueryClientProvider>
  </StrictMode>,
)
