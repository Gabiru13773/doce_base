import { lazy, Suspense } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/Autenticacao'
import Layout from './components/Layout'

// Cada página é carregada só quando é aberta (deixa o app mais leve no celular).
const LoginPage = lazy(() => import('./auth/LoginPage'))
const InicioPage = lazy(() => import('./modules/inicio/InicioPage'))
const InsumosPage = lazy(() => import('./modules/insumos/InsumosPage'))
const InsumoFormPage = lazy(() => import('./modules/insumos/InsumoFormPage'))
const ConfigPage = lazy(() => import('./modules/config/ConfigPage'))
const MaisPage = lazy(() => import('./modules/mais/MaisPage'))
const ReceitasPage = lazy(() => import('./modules/receitas/ReceitasPage'))
const ReceitaFormPage = lazy(() => import('./modules/receitas/ReceitaFormPage'))
const FichaTecnicaPage = lazy(() => import('./modules/receitas/FichaTecnicaPage'))
const ProdutosPage = lazy(() => import('./modules/produtos/ProdutosPage'))
const ProdutoFormPage = lazy(() => import('./modules/produtos/ProdutoFormPage'))
const EmBrevePage = lazy(() => import('./modules/embreve/EmBrevePage'))
const ResumoPage = lazy(() => import('./modules/financeiro/ResumoPage'))
const LancamentoFormPage = lazy(() => import('./modules/financeiro/LancamentoFormPage'))
const LancamentosPage = lazy(() => import('./modules/financeiro/LancamentosPage'))
const ContasBancariasPage = lazy(() => import('./modules/financeiro/ContasBancariasPage'))
const ContaBancariaFormPage = lazy(() => import('./modules/financeiro/ContaBancariaFormPage'))
const CategoriasPage = lazy(() => import('./modules/financeiro/CategoriasPage'))
const FinMaisPage = lazy(() => import('./modules/financeiro/FinMaisPage'))
const TitulosPage = lazy(() => import('./modules/financeiro/titulos/TitulosPage'))
const TituloFormPage = lazy(() => import('./modules/financeiro/titulos/TituloFormPage'))
const ImportarOfxPage = lazy(() => import('./modules/financeiro/importar/ImportarOfxPage'))
const ComprasPage = lazy(() => import('./modules/compras/ComprasPage'))
const MontarCompraPage = lazy(() => import('./modules/compras/MontarCompraPage'))
const FazerCompraPage = lazy(() => import('./modules/compras/FazerCompraPage'))
const FinalizarCompraPage = lazy(() => import('./modules/compras/FinalizarCompraPage'))

export default function App() {
  const { carregando, usuario } = useAuth()

  if (carregando) return <TelaCarregando />

  if (usuario === null) {
    return (
      <Suspense fallback={<TelaCarregando />}>
        <LoginPage />
      </Suspense>
    )
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<InicioPage />} />
        <Route path="insumos" element={<InsumosPage />} />
        <Route path="insumos/novo" element={<InsumoFormPage />} />
        <Route path="insumos/:id" element={<InsumoFormPage />} />
        <Route path="config/precos" element={<ConfigPage />} />
        <Route path="mais" element={<MaisPage />} />
        <Route
          path="producao"
          element={
            <EmBrevePage
              titulo="Produzir"
              itens={[
                'Registrar o que você produziu: o estoque recebe o rendimento (ex.: 1 bolo = 10 fatias) e os insumos saem sozinhos',
              ]}
            />
          }
        />
        <Route path="receitas" element={<ReceitasPage />} />
        <Route path="receitas/nova" element={<ReceitaFormPage />} />
        <Route path="receitas/:id" element={<ReceitaFormPage />} />
        <Route path="receitas/:id/ficha" element={<FichaTecnicaPage />} />
        <Route path="produtos" element={<ProdutosPage />} />
        <Route path="produtos/novo" element={<ProdutoFormPage />} />
        <Route path="produtos/:id" element={<ProdutoFormPage />} />
        <Route path="compras" element={<ComprasPage />} />
        <Route path="compras/nova" element={<MontarCompraPage />} />
        <Route path="compras/:id" element={<FazerCompraPage />} />
        <Route path="compras/:id/lista" element={<MontarCompraPage />} />
        <Route path="compras/:id/finalizar" element={<FinalizarCompraPage />} />
        <Route
          path="estoque"
          element={
            <EmBrevePage
              titulo="Estoque"
              itens={['Ver o que tem de insumos e de preparados prontos, com alerta do que está acabando']}
            >
              <Link
                to="/insumos"
                className="flex min-h-12 items-center justify-center rounded-2xl bg-marca px-5 font-semibold text-white shadow-sm active:bg-marca-escura"
              >
                Ver meus insumos
              </Link>
            </EmBrevePage>
          }
        />
        <Route path="financeiro" element={<ResumoPage />} />
        <Route path="financeiro/lancar" element={<LancamentoFormPage />} />
        <Route path="financeiro/lancamentos/:id" element={<LancamentoFormPage />} />
        <Route path="financeiro/extrato" element={<LancamentosPage />} />
        <Route path="financeiro/contas" element={<TitulosPage />} />
        <Route path="financeiro/contas/nova" element={<TituloFormPage />} />
        <Route path="financeiro/contas/:id" element={<TituloFormPage />} />
        <Route path="financeiro/importar" element={<ImportarOfxPage />} />
        <Route path="financeiro/bancos" element={<ContasBancariasPage />} />
        <Route path="financeiro/bancos/nova" element={<ContaBancariaFormPage />} />
        <Route path="financeiro/bancos/:id" element={<ContaBancariaFormPage />} />
        <Route path="financeiro/categorias" element={<CategoriasPage />} />
        <Route path="financeiro/mais" element={<FinMaisPage />} />
        <Route
          path="financeiro/relatorios"
          element={<EmBrevePage titulo="Relatórios" itens={['Fluxo de caixa e DRE do mês — em breve']} />}
        />
        <Route
          path="financeiro/*"
          element={
            <EmBrevePage
              titulo="Financeiro"
              itens={['Esta parte do financeiro ainda está sendo preparada. Por enquanto, veja o Resumo.']}
            />
          }
        />
        <Route path="*" element={<NaoEncontrada />} />
      </Route>
    </Routes>
  )
}

function TelaCarregando() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3" aria-busy="true">
      <img src="/logo-simbolo.png" alt="" width="96" height="72" className="h-20 w-auto animate-pulse" />
      <p className="text-suave">Carregando…</p>
    </div>
  )
}

function NaoEncontrada() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-borda bg-superficie px-6 py-10 text-center">
      <p className="text-lg font-semibold">Página não encontrada</p>
      <p className="text-suave">Esse endereço não existe no app.</p>
      <Link
        to="/"
        className="flex min-h-12 items-center justify-center rounded-2xl bg-marca px-5 font-semibold text-white shadow-sm active:bg-marca-escura"
      >
        Voltar para o início
      </Link>
    </div>
  )
}
