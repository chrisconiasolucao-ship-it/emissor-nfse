import { CampoCnpj } from "@/components/campo-cnpj";
import { CampoMunicipio } from "@/components/campo-municipio";

type Linha = Record<string, string | number | boolean | null | undefined>;
const s = (v: unknown) => (v == null ? "" : String(v));

/** Campos do cadastro de tomador (janela de Tomadores e da Nova nota). Com CNPJ, os dados vêm da consulta pública. */
export function CamposTomador({ e, buscarAoAbrir }: { e: Linha; buscarAoAbrir?: boolean }) {
  return (
    <>
      <label>Tipo
        <select name="tipo_documento" defaultValue={s(e.tipo_documento) || "CPF"}><option value="CPF">CPF</option><option value="CNPJ">CNPJ</option></select>
      </label>
      <label>CPF/CNPJ<CampoCnpj name="documento" defaultValue={s(e.documento)} required buscarAoAbrir={buscarAoAbrir} tipo="tipo_documento" municipio="cod_municipio"
        campos={{ razao_social: "nome", email: "email", telefone: "telefone", cep: "cep", cod_municipio: "cod_municipio", logradouro: "logradouro", numero: "numero", complemento: "complemento", bairro: "bairro" }} /></label>
      <label className="largo">Nome<input name="nome" defaultValue={s(e.nome)} required /></label>
      <label>E-mail<input name="email" type="email" defaultValue={s(e.email)} /></label>
      <label>Telefone<input name="telefone" defaultValue={s(e.telefone)} /></label>
      <label>CEP<input name="cep" defaultValue={s(e.cep)} /></label>
      <label>Município<CampoMunicipio name="cod_municipio" codigo={s(e.cod_municipio)} /></label>
      <label className="largo">Logradouro<input name="logradouro" defaultValue={s(e.logradouro)} /></label>
      <label>Número<input name="numero" defaultValue={s(e.numero)} /></label>
      <label>Complemento<input name="complemento" defaultValue={s(e.complemento)} /></label>
      <label>Bairro<input name="bairro" defaultValue={s(e.bairro)} /></label>
    </>
  );
}
