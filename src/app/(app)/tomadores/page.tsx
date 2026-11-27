import { TelaCadastros, type Busca } from "../cadastros/tela";

/** Tomadores (clientes) da empresa aberta. */
export default async function Tomadores({ searchParams }: { searchParams: Promise<Busca> }) {
  return <TelaCadastros aba="tomadores" p={await searchParams} />;
}
