import { numero } from '../../../lib/format'
import type { UnidadeCompra } from '../../../lib/unidades'

// Textos curtos de embalagem e quantidade usados na compra.

const ROTULO: Record<UnidadeCompra, string> = { g: 'g', kg: 'kg', ml: 'ml', l: 'L', un: 'un', dz: 'dz' }

/** 1 kg, 500 g, 1 L, 12 un */
export function textoEmbalagem(qtd: number, unidade: UnidadeCompra): string {
  return `${numero(qtd, 3)} ${ROTULO[unidade]}`
}

/** "3 × 1 kg"; para embalagem de 1 unidade fica só "3 un". */
export function textoQtd(qtd: number, emb: { embalagem_qtd: number; embalagem_unidade: UnidadeCompra }): string {
  if (emb.embalagem_unidade === 'un' && emb.embalagem_qtd === 1) return `${numero(qtd, 3)} un`
  return `${numero(qtd, 3)} × ${textoEmbalagem(emb.embalagem_qtd, emb.embalagem_unidade)}`
}

/** Minúsculas e sem acentos, para a busca achar "acucar" em "Açúcar". */
export function simplificar(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** "gabs.miranda99@hotmail.com" → "Gabs" (sugestão de nome para as marcações). */
export function nomeDoEmail(email: string | null | undefined): string {
  if (!email || email === 'modo local') return ''
  const parte = email.split('@')[0].split(/[._\-+\d]/).find((p) => p.length > 0) ?? ''
  return parte ? parte[0].toUpperCase() + parte.slice(1).toLowerCase() : ''
}
