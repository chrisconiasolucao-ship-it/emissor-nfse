"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Cliente do navegador: só a chave pública; a RLS decide o que aparece. */
export function supabaseNavegador() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "");
}
