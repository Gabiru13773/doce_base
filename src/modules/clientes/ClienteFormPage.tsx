import { ArrowLeft } from 'lucide-react'
import { useId, useMemo, useState, type FormEvent, type MouseEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAviso } from '../../components/Aviso'
import { BarraAcao, Botao, Campo, Carregando, Entrada, Erro, TituloPagina, Vazio } from '../../components/ui'
import { usuarioInstagram } from '../../lib/clientes'
import { novoId } from '../../lib/db'
import { mensagemDe } from '../financeiro/util'
import { useClientes, useRemoverCliente, useRestaurarCliente, useSalvarCliente, type Cliente } from '../pedidos/api'

// Cadastro e edição de cliente: nome, WhatsApp, Instagram, endereço e observações
// (alergias, preferências) que aparecem na hora de fazer o pedido.

const classeTexto =
  'w-full rounded-xl border border-borda bg-superficie px-4 py-3 text-base outline-none focus:border-marca focus:ring-2 focus:ring-marca/20'

export default function ClienteFormPage() {
  const { id } = useParams()
  const local = useLocation()
  const editando = !!id && id !== 'novo'
  const clientes = useClientes()

  if (clientes.error) return <Erro mensagem={mensagemDe(clientes.error)} tentarDeNovo={() => clientes.refetch()} />
  // Na edição, espera a versão atual do cliente (o cache pode ter vindo de outro dia).
  const atualizando = !clientes.isFetchedAfterMount && clientes.fetchStatus === 'fetching'
  if (clientes.isPending || (editando && atualizando)) return <Carregando />

  // key: recomeça o formulário (e o id novo) ao abrir "Novo cliente" de novo.
  if (!editando) return <Formulario key={local.key} />

  const cliente = (clientes.data ?? []).find((c) => c.id === id)
  if (!cliente) {
    return (
      <>
        <Voltar para="/vendas/clientes" />
        <Vazio
          titulo="Cliente não encontrado"
          texto="Ele pode ter sido apagado."
          acao={
            <Link to="/vendas/clientes" className="inline-flex min-h-12 items-center rounded-2xl px-5 font-semibold text-marca active:bg-marca-clara">
              Ver todos os clientes
            </Link>
          }
        />
      </>
    )
  }
  return <Formulario key={cliente.id} original={cliente} />
}

function Voltar({ para, sujo = false }: { para: string; sujo?: boolean }) {
  return (
    <Link
      to={para}
      onClick={(e) => confirmarSaida(e, sujo)}
      className="-ml-2 mb-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-suave active:bg-marca-clara"
    >
      <ArrowLeft className="size-5" aria-hidden />
      Voltar
    </Link>
  )
}

function confirmarSaida(e: MouseEvent, sujo: boolean) {
  if (sujo && !window.confirm('Sair sem salvar?')) e.preventDefault()
}

interface Campos {
  nome: string
  telefone: string
  instagram: string
  endereco: string
  observacao: string
}

function camposDe(c?: Cliente): Campos {
  return {
    nome: c?.nome ?? '',
    telefone: c?.telefone ?? '',
    instagram: c?.instagram ?? '',
    endereco: c?.endereco ?? '',
    observacao: c?.observacao ?? '',
  }
}

function Formulario({ original }: { original?: Cliente }) {
  const navegar = useNavigate()
  const avisar = useAviso()
  const salvar = useSalvarCliente()
  const remover = useRemoverCliente()
  const restaurar = useRestaurarCliente()
  // Id gerado uma vez: "tentar de novo" depois de um erro de rede não cria o cliente duas vezes.
  const [idCliente] = useState(() => original?.id ?? novoId())
  const [inicial] = useState(() => camposDe(original))
  const [c, setC] = useState<Campos>(inicial)
  const [tentou, setTentou] = useState(false)
  const idEndereco = useId()
  const idObs = useId()

  const sujo = useMemo(() => JSON.stringify(c) !== JSON.stringify(inicial), [c, inicial])
  const erroNome = tentou && !c.nome.trim() ? 'Escreva o nome do cliente' : undefined
  const digitos = c.telefone.replace(/\D/g, '')
  const avisoTelefone = digitos.length > 0 && digitos.length < 10 ? 'Coloque o DDD (ex.: 11 98765-4321) para o WhatsApp funcionar' : undefined
  const voltarPara = original ? `/vendas/clientes/${original.id}` : '/vendas/clientes'

  function mudar<K extends keyof Campos>(campo: K, valor: Campos[K]) {
    setC((a) => ({ ...a, [campo]: valor }))
  }

  async function aoSalvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (!c.nome.trim()) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    try {
      await salvar.mutateAsync({
        id: idCliente,
        nome: c.nome,
        telefone: c.telefone,
        instagram: usuarioInstagram(c.instagram) || null,
        endereco: c.endereco,
        observacao: c.observacao,
        // com o id já preenchido, useSalvarCliente acha que é edição e não grava criado_em
        // (no Supabase o banco preenche; no modo local ficaria sem)
        ...(original ? {} : { criado_em: new Date().toISOString() }),
      })
      avisar({ texto: 'Cliente salvo ✓' })
      navegar(`/vendas/clientes/${idCliente}`, { replace: !original })
    } catch {
      // O erro aparece na tela pelo estado da mutação.
    }
  }

  function aoApagar() {
    if (!original) return
    const salvo = original
    remover.mutate(salvo, {
      onSuccess: () => {
        navegar('/vendas/clientes')
        avisar({ texto: `${salvo.nome} apagado`, desfazer: () => restaurar.mutate(salvo) })
      },
    })
  }

  return (
    <form onSubmit={aoSalvar} noValidate className="pb-24">
      <Voltar para={voltarPara} sujo={sujo} />
      <TituloPagina titulo={original ? 'Editar cliente' : 'Novo cliente'} subtitulo={original?.nome} />

      <div className="flex flex-col gap-5">
        <Entrada
          rotulo="Nome"
          placeholder="Ex.: Maria Souza"
          value={c.nome}
          onChange={(e) => mudar('nome', e.target.value)}
          erro={erroNome}
          autoFocus={!original}
          autoCapitalize="words"
          autoComplete="off"
        />
        <Entrada
          rotulo="Telefone (WhatsApp)"
          type="tel"
          inputMode="tel"
          placeholder="Ex.: 11 98765-4321"
          value={c.telefone}
          onChange={(e) => mudar('telefone', e.target.value)}
          ajuda={avisoTelefone ?? 'Com DDD. Opcional.'}
          autoComplete="off"
        />
        <Entrada
          rotulo="Instagram (opcional)"
          prefixo="@"
          placeholder="usuario"
          value={c.instagram}
          onChange={(e) => mudar('instagram', e.target.value.replace(/^@+/, ''))}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
        />
        <Campo rotulo="Endereço (opcional)" id={idEndereco} ajuda="Para as entregas: rua, número, bairro, ponto de referência">
          <textarea
            id={idEndereco}
            rows={2}
            maxLength={300}
            placeholder="Ex.: Rua das Flores, 120 — apto 31, Centro"
            value={c.endereco}
            onChange={(e) => mudar('endereco', e.target.value)}
            className={classeTexto}
          />
        </Campo>
        <Campo rotulo="Observação (opcional)" id={idObs} ajuda="Ex.: alergia a amendoim, gosta de pouco açúcar, prefere retirar">
          <textarea
            id={idObs}
            rows={3}
            maxLength={500}
            value={c.observacao}
            onChange={(e) => mudar('observacao', e.target.value)}
            className={classeTexto}
          />
        </Campo>

        {salvar.isError && <Erro mensagem={mensagemDe(salvar.error)} />}

        {original && (
          <div className="flex flex-col gap-3 pt-4">
            {remover.isError && <Erro mensagem={mensagemDe(remover.error)} />}
            <Botao variante="perigo" onClick={aoApagar} disabled={remover.isPending}>
              {remover.isPending ? 'Apagando…' : 'Apagar cliente'}
            </Botao>
          </div>
        )}
      </div>

      <BarraAcao>
        <Botao type="submit" className="flex-1" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </Botao>
      </BarraAcao>
    </form>
  )
}
