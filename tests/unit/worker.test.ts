import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { abrirPfx, CertificadoVencido, SenhaCertificadoInvalida } from "@/lib/crypto/pfx";
import { montarIdDps } from "@/lib/nfse/dps-id";
import { ErroTecnicoSefin } from "@/lib/nfse/erros-sefin";
import { rodarFila, type ClienteSefin, type NotaNaFila, type Portas } from "@/lib/fila/worker";

const pfx = readFileSync(resolve(__dirname, "../fixtures/cert-teste.pfx"));
const aberto = abrirPfx(pfx, "senha-de-teste");
const nfse170 = readFileSync(resolve(__dirname, "../fixtures/nfse-170.xml"), "utf8");
const CHAVE = "43016022112223330001810000000000000170260000000001";

function nota(i: number, tentativas = 0, empresaId = "A"): NotaNaFila {
  return { empresaId, id: `n${i}`, serieDps: "90001", numeroDps: BigInt(i), idDps: montarIdDps("4301602", "11222333000181", "90001", i), tentativas };
}

function montar(opts: { fila: NotaNaFila[]; sefin?: Partial<ClienteSefin>; abrir?: () => never; municipioAtivo?: boolean }) {
  const log: string[] = [];
  let relogio = new Date("2026-11-26T12:00:00Z").getTime();
  const fila = [...opts.fila];
  const pausadas = new Set<string>();
  const sefin: ClienteSefin = {
    consultarDps: async () => null,
    emitir: async () => ({ tipo: "autorizada", chaveAcesso: CHAVE, nfseXml: nfse170, alertas: [] }),
    baixarNfse: async () => nfse170,
    baixarDanfse: async () => Buffer.from("%PDF-1.4"),
    ...opts.sefin,
  };
  const p: Portas = {
    agora: () => new Date((relogio += 1000)),
    ambiente: "restrita",
    retryMinutos: [5, 15, 60],
    pegarProximaNota: async () => {
      const i = fila.findIndex((n) => !pausadas.has(n.empresaId));
      return i < 0 ? null : fila.splice(i, 1)[0]!;
    },
    carregarContexto: async () => ({
      empresa: { cnpj: "11222333000181", codMunicipio: "4301602", opSimpNac: 3 },
      municipio: { codIbge: "4301602", nome: "Bagé", uf: "RS", ativoOperacional: opts.municipioAtivo ?? true, emissorNacional: true },
      competencia: "2026-11-01",
      dados: {
        tomador: { tipoDocumento: "CPF", documento: "52998224725", nome: "MARIA DE TESTE" },
        servico: { codMunicipioPrestacao: "4301602", codigoTributacaoNacional: "010601", descricao: "Assessoria" },
        valores: { valorServico: "1350.00", issRetido: false },
      },
    }),
    abrirCertificado: async () => {
      if (opts.abrir) opts.abrir();
      return { pfx, senha: "senha-de-teste", aberto };
    },
    sefin: () => sefin,
    guardarDocumento: async (n, tipo) => {
      log.push(`doc:${n.id}:${tipo}`);
      return `${tipo}-${n.id}`;
    },
    reagendar: async (n, erro) => {
      log.push(`reagendar:${n.id}:${erro}`);
      return "na_fila";
    },
    marcarRejeitada: async (n, codigo) => void log.push(`rejeitada:${n.id}:${codigo}`),
    marcarAutorizada: async (n, a) => void log.push(`autorizada:${n.id}:${a.numeroNfse}:${a.danfseDocumentoId}`),
    pausarEmpresa: async (e, motivo) => {
      pausadas.add(e);
      log.push(`pausar:${e}:${motivo}`);
    },
    devolverParaFila: async (n) => void log.push(`devolver:${n.id}`),
    registrarUsoCertificado: async (n) => void log.push(`uso_cert:${n.id}`),
    auditar: async (n, acao) => void log.push(`auditar:${n.id}:${acao}`),
    registrarSubstituicao: async (n, sub) => void log.push(`substituiu:${sub.notaId}->${n.id}`),
  };
  return { p, log };
}

describe("worker de emissão", () => {
  it("AT-008: processa uma nota por vez, em ordem, registrando o uso do certificado (AT-012)", async () => {
    const { p, log } = montar({ fila: [nota(1), nota(2)] });
    const r = await rodarFila(p, 50_000);
    expect(r.map((x) => x.resultado)).toEqual(["autorizada", "autorizada"]);
    expect(log.filter((l) => l.startsWith("uso_cert"))).toEqual(["uso_cert:n1", "uso_cert:n2"]);
    expect(log).toContain("autorizada:n1:170:danfse-n1");
    expect(log.indexOf("uso_cert:n1")).toBeLessThan(log.indexOf("uso_cert:n2"));
  });
  it("respeita o orçamento de tempo", async () => {
    const { p } = montar({ fila: [nota(1), nota(2), nota(3)] });
    const r = await rodarFila(p, 9_500, 8_000);
    expect(r).toHaveLength(1);
  });
  it.each([
    ["vencido", () => { throw new CertificadoVencido(new Date("2026-01-01")); }],
    ["senha errada", () => { throw new SenhaCertificadoInvalida(); }],
  ])("AT-007: certificado %s pausa a empresa, devolve a nota e não envia", async (_n, abrir) => {
    let enviou = false;
    const { p, log } = montar({ fila: [nota(1), nota(2)], abrir: abrir as () => never, sefin: { emitir: async () => { enviou = true; throw new Error("não devia"); } } });
    const r = await rodarFila(p, 50_000);
    expect(r).toHaveLength(1); // a 2ª nota da empresa pausada não é pega
    expect(r[0]!.resultado).toBe("empresa_pausada");
    expect(log.some((l) => l.startsWith("pausar:A"))).toBe(true);
    expect(log).toContain("devolver:n1");
    expect(enviou).toBe(false);
  });
  it("consulta a DPS antes de reenviar e reaproveita a NFS-e já autorizada (sem nota em dobro)", async () => {
    let emitiu = 0;
    const { p } = montar({ fila: [nota(5, 1)], sefin: { consultarDps: async () => CHAVE, emitir: async () => { emitiu++; throw new Error("x"); } } });
    const r = await rodarFila(p, 50_000);
    expect(r[0]).toMatchObject({ resultado: "autorizada", chave: CHAVE, reaproveitada: true });
    expect(emitiu).toBe(0);
  });
  it("AT-005: falha técnica reagenda; após a 3ª desiste", async () => {
    const falha = { emitir: async () => { throw new ErroTecnicoSefin("HTTP 503"); } };
    const a = montar({ fila: [nota(1, 0)], sefin: falha });
    expect((await rodarFila(a.p, 50_000))[0]).toMatchObject({ resultado: "nova_tentativa" });
    expect(a.log).toContain("reagendar:n1:HTTP 503");
    const b = montar({ fila: [nota(1, 3)], sefin: falha });
    expect((await rodarFila(b.p, 50_000))[0]).toMatchObject({ resultado: "desistiu" });
  });
  it("AT-006: rejeição por dado marca Rejeitada e não reagenda", async () => {
    const { p, log } = montar({ fila: [nota(1)], sefin: { emitir: async () => ({ tipo: "rejeitada", codigo: "E0312", mensagem: "CPF inválido" }) } });
    const r = await rodarFila(p, 50_000);
    expect(r[0]).toMatchObject({ resultado: "rejeitada", codigo: "E0312" });
    expect(log.some((l) => l.startsWith("reagendar"))).toBe(false);
  });
  it("município inativo rejeita sem abrir o certificado", async () => {
    const { p, log } = montar({ fila: [nota(1)], municipioAtivo: false });
    const r = await rodarFila(p, 50_000);
    expect(r[0]).toMatchObject({ resultado: "rejeitada", codigo: "MUNICIPIO_INATIVO" });
    expect(log.some((l) => l.startsWith("uso_cert"))).toBe(false);
  });
  it("substituição: DPS leva subst e, autorizada, registra o evento na nota antiga", async () => {
    let enviada = "";
    const { p, log } = montar({ fila: [nota(9)], sefin: { emitir: async (x) => { enviada = x; return { tipo: "autorizada", chaveAcesso: CHAVE, nfseXml: nfse170, alertas: [] }; } } });
    const ctx = p.carregarContexto;
    p.carregarContexto = async (n) => ({ ...(await ctx(n)), substitui: { notaId: "velha", chave: "4".repeat(50), codigoMotivo: "99", motivo: "Valor informado errado", pedidoPor: "u1" } });
    await rodarFila(p, 50_000);
    expect(enviada).toContain("<subst><chSubstda>" + "4".repeat(50));
    expect(log).toContain("substituiu:velha->n9");
  });
  it("erro interno devolve a nota para a fila sem gastar tentativa e para o lote", async () => {
    const { p, log } = montar({ fila: [nota(1), nota(2)] });
    p.guardarDocumento = async () => { throw new Error("Storage fora"); };
    const r = await rodarFila(p, 50_000);
    expect(r).toEqual([{ nota: "n1", resultado: "erro_interno", detalhe: "Storage fora" }]);
    expect(log).toContain("devolver:n1");
  });
});
