import { ChevronRight, Phone, UserPlus, UserRound } from 'lucide-react'
import { useId, useMemo, useState, type FormEvent } from 'react'
import { Botao, Busca, Campo, Carregando, Entrada, Erro, Vazio, classeEntrada } from '../../../components/ui'
import { Folha } from '../../compras/componentes/Folha'
import { simplificar } from '../../compras/componentes/formato'
import { useClientes, useSalvarCliente, type Cliente } from '../api'

// Escolher o cliente do pedido: busca por nome, telefone ou Instagram, ou cadastra na hora.

const digitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

/** Busca parece um telefone (só números, espaços, traços, parênteses)? */
const pareceTelefone = (s: string) => /^[\d\s()+-]+$/.test(s.trim()) && digitos(s).length >= 4

export function SeletorCliente({ cliente, aoEscolher }: { cliente: Cliente | null; aoEscolher: (c: Cliente) => void }) {
  const [aberto, setAberto] = useState(false)

  return (
    <>
      {cliente ? (
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-borda bg-superficie px-4 py-3 text-left active:bg-marca-clara"
          aria-label={`Cliente: ${cliente.nome}. Tocar para trocar`}
        >
          <UserRound className="size-6 shrink-0 text-marca" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-semibold break-words">{cliente.nome}</span>
            {(cliente.telefone || cliente.instagram) && (
              <span className="block truncate text-sm text-suave">
                {[cliente.telefone, cliente.instagram && `@${cliente.instagram}`].filter(Boolean).join(' · ')}
              </span>
            )}
          </span>
          <span className="shrink-0 text-sm font-semibold text-marca">Trocar</span>
        </button>
      ) : (
        <Botao variante="secundario" className="w-full" onClick={() => setAberto(true)}>
          <UserRound className="size-5" aria-hidden />
          Escolher cliente
        </Botao>
      )}
      {aberto && (
        <FolhaClientes
          aoEscolher={(c) => {
            setAberto(false)
            aoEscolher(c)
          }}
          aoFechar={() => setAberto(false)}
        />
      )}
    </>
  )
}

function FolhaClientes({ aoEscolher, aoFechar }: { aoEscolher: (c: Cliente) => void; aoFechar: () => void }) {
  const clientes = useClientes()
  const [busca, setBusca] = useState('')
  // null = só a lista; objeto = folha de cadastro aberta (com o que já foi digitado na busca)
  const [novo, setNovo] = useState<{ nome: string; telefone: string } | null>(null)

  const achados = useMemo(() => {
    const lista = clientes.data ?? []
    const termo = simplificar(busca).replace(/^@+/, '')
    if (!termo) return lista
    const num = digitos(busca)
    return lista.filter(
      (c) =>
        simplificar(c.nome).includes(termo) ||
        simplificar(c.instagram).includes(termo) ||
        (num.length >= 3 && digitos(c.telefone).includes(num)),
    )
  }, [clientes.data, busca])

  function abrirNovo() {
    const t = busca.trim()
    setNovo(pareceTelefone(t) ? { nome: '', telefone: t } : { nome: t.replace(/^@+/, ''), telefone: '' })
  }

  let conteudo
  if (clientes.isPending) conteudo = <Carregando />
  else if (clientes.error) conteudo = <Erro mensagem={clientes.error.message} tentarDeNovo={() => clientes.refetch()} />
  else if (achados.length === 0)
    conteudo = busca.trim() ? (
      <Vazio
        titulo="Ninguém com esse nome"
        texto="Confira o que digitou ou cadastre agora."
        acao={
          <Botao onClick={abrirNovo}>
            <UserPlus className="size-5" aria-hidden />
            <span className="break-all">Cadastrar “{busca.trim()}”</span>
          </Botao>
        }
      />
    ) : (
      <Vazio titulo="Nenhum cliente ainda" texto="Cadastre o primeiro no botão acima." />
    )
  else
    conteudo = (
      <ul className="flex flex-col gap-2">
        {achados.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => aoEscolher(c)}
              className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-borda bg-superficie px-4 py-3 text-left active:bg-marca-clara"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-semibold break-words">{c.nome}</span>
                {(c.telefone || c.instagram) && (
                  <span className="block truncate text-sm text-suave">
                    {[c.telefone, c.instagram && `@${c.instagram}`].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              <ChevronRight className="size-5 shrink-0 text-suave" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    )

  return (
    <>
      <Folha
        titulo="Escolher cliente"
        aoFechar={aoFechar}
        telaCheia
        cabecalhoExtra={
          <div className="flex flex-col gap-3">
            <Busca valor={busca} aoMudar={setBusca} placeholder="Nome, telefone ou Instagram" />
            <Botao variante="secundario" onClick={abrirNovo}>
              <UserPlus className="size-5" aria-hidden />
              Novo cliente
            </Botao>
          </div>
        }
      >
        {conteudo}
      </Folha>
      {/* por cima da lista: fechar o cadastro volta para a busca */}
      {novo && <FolhaNovoCliente inicial={novo} aoSalvar={aoEscolher} aoFechar={() => setNovo(null)} />}
    </>
  )
}

function FolhaNovoCliente({
  inicial,
  aoSalvar,
  aoFechar,
}: {
  inicial: { nome: string; telefone: string }
  aoSalvar: (c: Cliente) => void
  aoFechar: () => void
}) {
  const salvar = useSalvarCliente()
  const idForm = useId()
  const idEndereco = useId()
  const [nome, setNome] = useState(inicial.nome)
  const [telefone, setTelefone] = useState(inicial.telefone)
  const [instagram, setInstagram] = useState('')
  const [endereco, setEndereco] = useState('')
  const [tentou, setTentou] = useState(false)
  const erroNome = tentou && !nome.trim() ? 'Escreva o nome do cliente' : undefined

  function enviar(e: FormEvent) {
    e.preventDefault()
    e.stopPropagation() // o formulário do pedido fica por baixo
    setTentou(true)
    if (!nome.trim() || salvar.isPending) return
    salvar.mutate(
      { nome, telefone, instagram, endereco, observacao: null },
      { onSuccess: (c) => aoSalvar(c) },
    )
  }

  return (
    <Folha
      titulo="Novo cliente"
      aoFechar={aoFechar}
      rodape={
        <>
          <Botao variante="secundario" className="flex-1" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao type="submit" form={idForm} className="flex-[2]" disabled={salvar.isPending}>
            {salvar.isPending ? 'Salvando…' : 'Salvar e escolher'}
          </Botao>
        </>
      }
    >
      <form id={idForm} onSubmit={enviar} noValidate className="flex flex-col gap-4">
        <Entrada
          rotulo="Nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          erro={erroNome}
          autoCapitalize="words"
          autoComplete="off"
          placeholder="Ex.: Maria Souza"
          data-foco-inicial={inicial.nome ? undefined : true}
        />
        <Entrada
          rotulo="Telefone (WhatsApp)"
          type="tel"
          inputMode="tel"
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
          autoComplete="off"
          placeholder="(11) 91234-5678"
          data-foco-inicial={inicial.nome ? true : undefined}
        />
        <Entrada
          rotulo="Instagram (opcional)"
          prefixo="@"
          value={instagram}
          onChange={(e) => setInstagram(e.target.value.replace(/^@+/, ''))}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          placeholder="usuario"
        />
        <Campo rotulo="Endereço (opcional)" id={idEndereco} ajuda="Para entregas: rua, número, bairro">
          <textarea
            id={idEndereco}
            rows={2}
            maxLength={300}
            value={endereco}
            onChange={(e) => setEndereco(e.target.value)}
            className={`${classeEntrada} py-3`}
          />
        </Campo>
        {salvar.isError && <Erro mensagem={salvar.error.message} />}
        {!telefone.trim() && (
          <p className="flex items-center gap-2 text-sm text-suave">
            <Phone className="size-4 shrink-0" aria-hidden />
            Com o telefone dá para mandar o pedido pelo WhatsApp.
          </p>
        )}
      </form>
    </Folha>
  )
}
