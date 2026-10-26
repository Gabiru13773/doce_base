import { ChevronRight, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Busca, Carregando, Erro, Pilulas, TituloPagina, Vazio } from '../../components/ui'
import { RESUMO_VAZIO, ordenarClientes, resumosPorCliente, type OrdemClientes, type ResumoCliente } from '../../lib/clientes'
import { moeda } from '../../lib/format'
import { dataCurta } from '../../lib/pedidos'
import { simplificar } from '../compras/componentes/formato'
import { mensagemDe } from '../financeiro/util'
import { useClientes, usePedidos, type Cliente } from '../pedidos/api'

// Lista de clientes com quantos pedidos fizeram e quanto já gastaram (só pedidos entregues).

const ORDENS: { valor: OrdemClientes; rotulo: string }[] = [
  { valor: 'nome', rotulo: 'A–Z' },
  { valor: 'pedidos', rotulo: 'Mais pedidos' },
  { valor: 'recentes', rotulo: 'Recentes' },
]

const classeNovo =
  'inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-2xl bg-marca px-4 font-semibold text-white shadow-sm active:bg-marca-escura'

/** Acha pelo nome, instagram ou telefone (digitado com ou sem traços e parênteses). */
function combina(c: Cliente, termo: string): boolean {
  const t = simplificar(termo)
  if (!t) return true
  if (simplificar(c.nome).includes(t) || simplificar(c.instagram).includes(t.replace(/^@+/, ''))) return true
  const digitos = termo.replace(/\D/g, '')
  return digitos.length >= 3 && (c.telefone ?? '').replace(/\D/g, '').includes(digitos)
}

export default function ClientesPage() {
  const clientes = useClientes()
  const pedidos = usePedidos()
  const [busca, setBusca] = useState('')
  const [ordem, setOrdem] = useState<OrdemClientes>('nome')

  const resumos = useMemo(() => resumosPorCliente(pedidos.data ?? []), [pedidos.data])
  const lista = useMemo(
    () => ordenarClientes((clientes.data ?? []).filter((c) => combina(c, busca)), resumos, ordem),
    [clientes.data, busca, resumos, ordem],
  )

  const consultas = [clientes, pedidos]
  const comErro = consultas.find((c) => c.isError)
  const total = clientes.data?.length ?? 0

  return (
    <>
      <TituloPagina
        titulo="Clientes"
        subtitulo={total > 0 ? (total === 1 ? '1 cliente' : `${total} clientes`) : undefined}
        acao={
          <Link to="/vendas/clientes/novo" className={classeNovo}>
            <Plus className="size-5" aria-hidden />
            Novo cliente
          </Link>
        }
      />

      {comErro ? (
        <Erro mensagem={mensagemDe(comErro.error)} tentarDeNovo={() => consultas.forEach((c) => void c.refetch())} />
      ) : consultas.some((c) => c.isPending) ? (
        <Carregando />
      ) : total === 0 ? (
        <Vazio
          titulo="Nenhum cliente ainda"
          texto="Cadastre quem faz encomendas para guardar o WhatsApp, o endereço e ver o histórico de pedidos."
          acao={
            <Link to="/vendas/clientes/novo" className={classeNovo}>
              <Plus className="size-5" aria-hidden />
              Cadastrar o primeiro
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Busca valor={busca} aoMudar={setBusca} placeholder="Buscar por nome, telefone ou Instagram" />
          <Pilulas rotulo="Ordenar" valor={ordem} aoMudar={setOrdem} opcoes={ORDENS} />

          {lista.length === 0 ? (
            <Vazio titulo="Ninguém encontrado" texto={`Nenhum cliente combina com "${busca.trim()}".`} />
          ) : (
            <ul className="divide-y divide-borda overflow-hidden rounded-2xl border border-borda bg-superficie">
              {lista.map((c) => (
                <li key={c.id}>
                  <LinhaCliente cliente={c} resumo={resumos[c.id] ?? RESUMO_VAZIO} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  )
}

function LinhaCliente({ cliente: c, resumo: r }: { cliente: Cliente; resumo: ResumoCliente }) {
  const contato = c.telefone ?? (c.instagram ? `@${c.instagram}` : null)
  return (
    <Link to={`/vendas/clientes/${c.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-marca-clara">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{c.nome}</span>
        <span className="block truncate text-sm text-suave">
          {[contato, r.ultimoPedido ? `último pedido ${dataCurta(r.ultimoPedido)}` : null].filter(Boolean).join(' · ') || 'Sem pedidos'}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-bold text-marca tabular-nums">{r.totalGasto > 0 ? moeda(r.totalGasto) : '—'}</span>
        <span className="block text-sm text-suave">{r.pedidos === 1 ? '1 pedido' : `${r.pedidos} pedidos`}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-suave" aria-hidden />
    </Link>
  )
}
