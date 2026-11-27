import { TelaCadastros, type Busca } from "../cadastros/tela";

/** Serviços da empresa aberta. */
export default async function Servicos({ searchParams }: { searchParams: Promise<Busca> }) {
  return <TelaCadastros aba="servicos" p={await searchParams} />;
}
