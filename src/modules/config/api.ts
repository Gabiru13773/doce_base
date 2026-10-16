import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from '../../lib/db'
import { CONFIG_PADRAO, type Arredondamento, type ConfigPrecificacao } from '../../lib/precificacao'

interface LinhaConfig {
  id: string
  valor_hora: number
  pct_custos_fixos: number
  pct_taxas: number
  pct_margem: number
  arredondamento: Arredondamento
  atualizado_em: string
}

const ID = 'padrao'
const CHAVE = ['config_precificacao']

function deLinha(l: LinhaConfig | null): ConfigPrecificacao {
  if (!l) return CONFIG_PADRAO
  return {
    valorHora: Number(l.valor_hora),
    pctCustosFixos: Number(l.pct_custos_fixos),
    pctTaxas: Number(l.pct_taxas),
    pctMargem: Number(l.pct_margem),
    arredondamento: l.arredondamento,
  }
}

/** Configurações de precificação (valor da hora, % fixos, % taxas, margem, arredondamento). */
export function useConfigPrecificacao() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: async () => deLinha(await db.buscar<LinhaConfig>('config_precificacao', ID)),
  })
}

export function useSalvarConfigPrecificacao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (c: ConfigPrecificacao) =>
      db.salvar<LinhaConfig>('config_precificacao', {
        id: ID,
        valor_hora: c.valorHora,
        pct_custos_fixos: c.pctCustosFixos,
        pct_taxas: c.pctTaxas,
        pct_margem: c.pctMargem,
        arredondamento: c.arredondamento,
        atualizado_em: new Date().toISOString(),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  })
}
