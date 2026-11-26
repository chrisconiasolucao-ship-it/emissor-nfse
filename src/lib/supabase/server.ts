import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { configPublica } from "@/lib/config";

/** Cliente com a sessão do usuário: tudo passa pela RLS do banco. */
export async function supabaseServidor() {
  const jar = await cookies();
  return createServerClient(configPublica.supabaseUrl, configPublica.supabaseAnonKey, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (lista) => {
        try {
          for (const c of lista) jar.set(c.name, c.value, c.options);
        } catch {
          // Server Component não grava cookie; o middleware renova a sessão.
        }
      },
    },
  });
}
