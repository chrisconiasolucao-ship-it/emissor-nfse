import { redirect } from "next/navigation";

/** Endereço antigo: tomadores e serviços agora têm cada um a sua tela no menu. */
export default async function Cadastros({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  redirect((await searchParams).aba === "servicos" ? "/servicos" : "/tomadores");
}
