import './styles/theme.css'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { ProvedorAuth } from './auth/Autenticacao'
import { ProvedorAviso } from './components/Aviso'

const UM_DIA = 1000 * 60 * 60 * 24

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: UM_DIA, retry: 1 },
  },
})

// Guarda o cache no aparelho: o app abre com os dados da última visita, mesmo sem internet.
const persister = createSyncStoragePersister({ storage: window.localStorage, key: 'euforia-cache' })

// Atualiza o app sozinho quando sai versão nova.
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: UM_DIA }}>
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
