import type { SupabaseClient } from "@supabase/supabase-js";

export const LOGO_TAMANHO_MAX = 500 * 1024;

/** PNG ou JPEG pela assinatura do arquivo (não confia no nome nem no tipo que o navegador manda). */
export function tipoDaImagem(b: Uint8Array): "png" | "jpg" | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  return null;
}

/** Bytes da logo da empresa para o DANFSe; sem logo ou com falha no Storage devolve null (o PDF sai com a da NFS-e). */
export async function logoDaEmpresa(db: SupabaseClient, empresaId: string): Promise<Uint8Array | null> {
  try {
    const { data } = await db.from("empresa").select("logo_path").eq("id", empresaId).maybeSingle();
    const caminho = data?.logo_path ? String(data.logo_path) : null;
    if (!caminho) return null;
    const arq = await db.storage.from("documentos").download(caminho);
    return arq.data ? new Uint8Array(await arq.data.arrayBuffer()) : null;
  } catch {
    return null;
  }
}
