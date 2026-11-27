import { redirect } from "next/navigation";

export default function Inicio() {
  redirect("/painel"); // escritório sem empresa aberta vai para Empresas
}
