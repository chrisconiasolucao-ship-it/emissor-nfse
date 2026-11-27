import { describe, expect, it } from "vitest";
import { ErroCadastroDps } from "@/lib/nfse/dps-builder";
import { resolverIbsCbs, sugerirIbsCbs, type EntradaIbsCbs } from "@/lib/nfse/ibscbs";

const base: EntradaIbsCbs = {
  opSimpNac: 3,
  regimeIbsCbsSn: 1,
  cAtvSnEmpresa: "08",
  servico: null,
  correlacao: [{ indOp: "100301", cClassTrib: "200052" }],
  cstDoCclasstrib: { "200052": "200", "000001": "000" },
};

describe("IBS/CBS do Simples (NT 009)", () => {
  it("desligado não manda nada, nem lê o cadastro", () => {
    expect(resolverIbsCbs("desligado", null)).toBeNull();
  });

  it("modo grupo: usa a correlação oficial quando ela tem uma opção só, sem os campos do Release 4", () => {
    expect(resolverIbsCbs("grupo", base)).toEqual({ cIndOp: "100301", cst: "200", cClassTrib: "200052", regApIBSCBSSN: null, cAtvSN: null });
  });

  it("modo completo: regApIBSCBSSN da empresa e cAtvSN do serviço (ou o padrão da empresa)", () => {
    expect(resolverIbsCbs("completo", base)).toMatchObject({ regApIBSCBSSN: "1", cAtvSN: "08" });
    expect(resolverIbsCbs("completo", { ...base, regimeIbsCbsSn: 2, servico: { cAtvSN: "09" } })).toMatchObject({ regApIBSCBSSN: "2", cAtvSN: "09" });
  });

  it("o que está no serviço vale mais que a correlação", () => {
    const r = resolverIbsCbs("grupo", { ...base, servico: { cClassTrib: "000001", cIndOp: "100301" } });
    expect(r).toMatchObject({ cst: "000", cClassTrib: "000001", cIndOp: "100301" });
  });

  it("recusa sem usar o certificado quando falta escolha no cadastro", () => {
    const duas = { ...base, correlacao: [{ indOp: "100301", cClassTrib: "200052" }, { indOp: "100301", cClassTrib: "000001" }] };
    expect(() => resolverIbsCbs("grupo", duas)).toThrow(/mais de uma classificação/);
    expect(() => resolverIbsCbs("grupo", { ...base, correlacao: [] })).toThrow(ErroCadastroDps);
    expect(() => resolverIbsCbs("grupo", { ...base, servico: { cClassTrib: "999999" } })).toThrow(/não vale para NFS-e/);
    expect(() => resolverIbsCbs("completo", { ...base, cAtvSnEmpresa: null })).toThrow(/cAtvSN/);
  });

  it("MEI não leva regApIBSCBSSN e não é barrado sem cAtvSN", () => {
    expect(resolverIbsCbs("completo", { ...base, opSimpNac: 2, cAtvSnEmpresa: null })).toMatchObject({ regApIBSCBSSN: null, cAtvSN: null });
  });

  it("sugestão da tela só preenche quando é única", () => {
    expect(sugerirIbsCbs(base.correlacao)).toEqual({ cClassTrib: "200052", cIndOp: "100301" });
    expect(sugerirIbsCbs([...base.correlacao, { indOp: "050101", cClassTrib: "000001" }])).toEqual({ cClassTrib: null, cIndOp: null });
  });
});
