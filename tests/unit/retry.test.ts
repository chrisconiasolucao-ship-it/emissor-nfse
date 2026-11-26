import { describe, expect, it } from "vitest";
import { decidir, validarPolitica } from "@/lib/fila/retry";

const agora = new Date("2026-11-26T12:00:00Z");
const pol = [5, 15, 60];

describe("novas tentativas (AT-005)", () => {
  it("reagenda após 5, 15 e 60 minutos", () => {
    expect(decidir(0, pol, agora, "timeout")).toEqual({ acao: "reagendar", tentativa: 1, minutos: 5, em: new Date("2026-11-26T12:05:00Z") });
    expect(decidir(1, pol, agora, "timeout")).toMatchObject({ acao: "reagendar", minutos: 15 });
    expect(decidir(2, pol, agora, "timeout")).toMatchObject({ acao: "reagendar", minutos: 60, em: new Date("2026-11-26T13:00:00Z") });
  });
  it("depois da 3ª nova tentativa desiste com 'Receita indisponível'", () => {
    const d = decidir(3, pol, agora, "HTTP 503");
    expect(d).toEqual({ acao: "desistir", tentativa: 4, motivo: "Receita indisponível: HTTP 503" });
  });
  it("política inválida é recusada", () => {
    expect(() => validarPolitica([])).toThrow();
    expect(() => validarPolitica([5, 0])).toThrow();
    expect(validarPolitica(pol)).toEqual(pol);
  });
});
