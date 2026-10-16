import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const chave = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Supabase só é usado quando as chaves estão configuradas; senão o app roda em "modo local". */
export const supabase: SupabaseClient | null =
  url && chave && !url.includes('SEU-PROJETO') ? createClient(url, chave) : null

export const modoLocal = supabase === null
