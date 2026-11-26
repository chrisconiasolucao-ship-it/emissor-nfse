import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { montarPedidoCancelamento } from "@/lib/nfse/evento-builder";

// esquema oficial da produção restrita (esquemas-xsd-producao-restrita-20261124.zip, gov.br/nfse)
const XSD = resolve(__dirname, "../fixtures/xsd-v1.01/pedRegEvento_v1.01.xsd");

describe("pedido de cancelamento", () => {
  it("é válido no esquema v1.01 da produção restrita", () => {
    const { xml, id } = montarPedidoCancelamento({
      ambiente: "restrita", cnpjAutor: "11222333000181", chaveAcesso: "43028082150581610001030000000000000126110000000013", codigoMotivo: "1",
      motivo: "Erro na emissão: valor do serviço informado errado", em: new Date("2026-11-26T15:00:00Z"),
    });
    expect(id).toHaveLength(59);
    const dir = mkdtempSync(join(tmpdir(), "evt-"));
    writeFileSync(join(dir, "e.xml"), xml);
    let saida = "";
    try { execFileSync("xmllint", ["--noout", "--schema", XSD, join(dir, "e.xml")], { stdio: "pipe" }); }
    catch (e) { saida = (e as { stderr?: Buffer }).stderr?.toString() ?? String(e); }
    expect(saida).toBe("");
  });
});
