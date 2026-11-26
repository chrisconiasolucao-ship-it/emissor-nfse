import { describe, expect, it } from "vitest";
import { comDeclaracao, gunzipB64, gzipB64 } from "@/lib/nfse/xml";

describe("envio do XML à Sefin (E1229)", () => {
  it("o XML compactado começa com a declaração UTF-8", () => {
    const xml = '<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="DPS1">Caçapava</infDPS></DPS>';
    const enviado = gunzipB64(gzipB64(xml));
    expect(enviado.startsWith('<?xml version="1.0" encoding="UTF-8"?><DPS')).toBe(true);
    expect(enviado).toContain("Caçapava");
  });
  it("não duplica a declaração nem deixa BOM", () => {
    expect(comDeclaracao('<?xml version="1.0" encoding="UTF-8"?><a/>')).toBe('<?xml version="1.0" encoding="UTF-8"?><a/>');
    expect(comDeclaracao("﻿<a/>")).toBe('<?xml version="1.0" encoding="UTF-8"?><a/>');
  });
});
