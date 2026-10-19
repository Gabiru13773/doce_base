import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Limpa espaços, quebras de linha e aspas que podem vir junto ao colar as chaves na Vercel.
const limpar = (v: string | undefined) => v?.replace(/\s+/g, '').replace(/^["']|["']$/g, '') || undefined

// Só caracteres visíveis do ASCII: some com espaços invisíveis, "…" e afins que o navegador recusa.
const url = limpar(import.meta.env.VITE_SUPABASE_URL as string | undefined)
  ?.replace(/[^\x21-\x7e]/g, '')
  .replace(/\/+$/, '')
// A chave (JWT ou sb_publishable_…) só tem letras, números, ponto, hífen e sublinhado.
const chave = limpar(import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.replace(/[^A-Za-z0-9._-]/g, '')

/** Supabase só é usado quando as chaves estão configuradas; senão o app roda em "modo local". */
export const supabase: SupabaseClient | null =
  url && chave && !url.includes('SEU-PROJETO') ? createClient(url, chave) : null

export const modoLocal = supabase === null

/** Endereço do Supabase em uso (para mostrar em mensagens de erro de configuração). */
export const enderecoSupabase = url ?? ''
