import { deflateRawSync } from "node:zlib";

/**
 * Escritor de ZIP simples (PKZIP 2.0, deflate), sem dependência: cada arquivo vira um pedaço pronto para
 * ir direto na resposta (streaming), e o diretório central sai no fim. Nomes em UTF-8 (bit 11), para
 * acentos de razão social aparecerem certos no Windows 10+ e no 7-Zip. Limite: 65 535 arquivos e 4 GB
 * (sem ZIP64), muito acima de um lote de notas.
 */

const TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(dados: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < dados.length; i++) c = TABELA[(c ^ dados[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Data e hora no formato do MS-DOS (hora local do relógio dado). */
function dataDos(d: Date): { hora: number; data: number } {
  const ano = Math.max(1980, d.getFullYear());
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    data: ((ano - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

type Entrada = { nome: Buffer; crc: number; compactado: number; original: number; metodo: number; hora: number; data: number; deslocamento: number };

export class EscritorZip {
  private entradas: Entrada[] = [];
  private posicao = 0;
  private nomes = new Set<string>();

  /** Nome que ainda não está no ZIP: "a.xml" repetido vira "a (2).xml". */
  nomeLivre(nome: string): string {
    if (!this.nomes.has(nome.toLowerCase())) return nome;
    const p = nome.lastIndexOf(".");
    const [base, ext] = p > nome.lastIndexOf("/") ? [nome.slice(0, p), nome.slice(p)] : [nome, ""];
    for (let i = 2; ; i++) {
      const n = `${base} (${i})${ext}`;
      if (!this.nomes.has(n.toLowerCase())) return n;
    }
  }

  /** Acrescenta um arquivo e devolve os bytes do cabeçalho local + conteúdo, já prontos para enviar. */
  adicionar(nomeDesejado: string, conteudo: Uint8Array, quando = new Date()): Uint8Array {
    if (this.entradas.length >= 0xffff) throw new Error("lote grande demais para um ZIP");
    const nomeTexto = this.nomeLivre(nomeDesejado);
    this.nomes.add(nomeTexto.toLowerCase());
    const nome = Buffer.from(nomeTexto, "utf8");
    const comp = deflateRawSync(conteudo, { level: 6 });
    const usaDeflate = comp.length < conteudo.length;
    const dados = usaDeflate ? comp : Buffer.from(conteudo);
    const { hora, data } = dataDos(quando);
    const e: Entrada = { nome, crc: crc32(conteudo), compactado: dados.length, original: conteudo.length, metodo: usaDeflate ? 8 : 0, hora, data, deslocamento: this.posicao };
    if (this.posicao + 30 + nome.length + dados.length > 0xffffffff) throw new Error("lote grande demais para um ZIP");

    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4); // versão necessária
    h.writeUInt16LE(0x0800, 6); // nome em UTF-8
    h.writeUInt16LE(e.metodo, 8);
    h.writeUInt16LE(hora, 10);
    h.writeUInt16LE(data, 12);
    h.writeUInt32LE(e.crc, 14);
    h.writeUInt32LE(e.compactado, 18);
    h.writeUInt32LE(e.original, 22);
    h.writeUInt16LE(nome.length, 26);
    h.writeUInt16LE(0, 28);
    const pedaco = Buffer.concat([h, nome, dados]);
    this.posicao += pedaco.length;
    this.entradas.push(e);
    return pedaco;
  }

  get quantidade(): number {
    return this.entradas.length;
  }

  /** Diretório central + fim do arquivo. Depois disto o ZIP está completo. */
  finalizar(): Uint8Array {
    const partes: Buffer[] = [];
    let tamanho = 0;
    for (const e of this.entradas) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(20, 4); // feito por
      c.writeUInt16LE(20, 6); // versão necessária
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(e.metodo, 10);
      c.writeUInt16LE(e.hora, 12);
      c.writeUInt16LE(e.data, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.compactado, 20);
      c.writeUInt32LE(e.original, 24);
      c.writeUInt16LE(e.nome.length, 28);
      // extra, comentário, disco, atributos internos = 0
      c.writeUInt32LE(0, 38); // atributos externos
      c.writeUInt32LE(e.deslocamento, 42);
      partes.push(c, e.nome);
      tamanho += 46 + e.nome.length;
    }
    const fim = Buffer.alloc(22);
    fim.writeUInt32LE(0x06054b50, 0);
    fim.writeUInt16LE(this.entradas.length, 8);
    fim.writeUInt16LE(this.entradas.length, 10);
    fim.writeUInt32LE(tamanho, 12);
    fim.writeUInt32LE(this.posicao, 16);
    return Buffer.concat([...partes, fim]);
  }
}
