import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "@/lib/config";

let cliente: SupabaseClient | undefined;

/**
 * Cliente service role. Só no servidor (worker, rotas internas). Ignora a RLS: toda chamada
 * daqui precisa ter conferido antes quem pede e de qual empresa.
 */
export function supabaseAdmin(): SupabaseClient {
  if (!cliente) {
    const c = config();
    cliente = createClient(c.NEXT_PUBLIC_SUPABASE_URL, c.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cliente;
}
