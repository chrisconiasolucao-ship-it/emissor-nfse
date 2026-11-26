import { z } from "zod";

const csvInts = (padrao: string) =>
  z
    .string()
    .default(padrao)
    .transform((s) => s.split(",").map((x) => Number.parseInt(x.trim(), 10)))
    .pipe(z.array(z.number().int().positive()).min(1));

const inteiro = (padrao: number) => z.coerce.number().int().positive().default(padrao);

const servidorSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CERT_MASTER_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "CERT_MASTER_KEY precisa ter 32 bytes em base64"),
  CERT_KEY_VERSION: inteiro(1),
  NFSE_AMBIENTE: z.enum(["restrita", "producao"]),
  SEFIN_BASE_URL: z.url(),
  ADN_BASE_URL: z.url(),
  WORKER_SECRET: z.string().min(32, "WORKER_SECRET precisa ter pelo menos 32 caracteres"),
  WORKER_BUDGET_MS: inteiro(50_000),
  RETRY_MINUTOS: csvInts("5,15,60"),
  LOGIN_MAX_FALHAS: inteiro(3),
  LOGIN_BLOQUEIO_MIN: inteiro(15),
  PLANILHA_MAX_LINHAS: inteiro(30),
  CERT_ALERTA_DIAS: csvInts("30,15"),
  MUNICIPIOS_ALERTA_DIAS: inteiro(30),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  BLOB_STORE_ID: z.string().optional(),
});

export type ConfigServidor = z.infer<typeof servidorSchema>;

let cache: ConfigServidor | undefined;

/** Lê e valida as variáveis do servidor uma vez. Falha cedo com a lista do que falta. */
export function config(env: NodeJS.ProcessEnv = process.env): ConfigServidor {
  if (cache && env === process.env) return cache;
  const r = servidorSchema.safeParse(env);
  if (!r.success) {
    const faltando = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuração inválida: ${faltando}`);
  }
  // Teste nunca vira nota real: URLs da produção só com NFSE_AMBIENTE=producao e vice-versa.
  const urlRestrita = /producaorestrita/.test(r.data.SEFIN_BASE_URL) && /producaorestrita/.test(r.data.ADN_BASE_URL);
  if ((r.data.NFSE_AMBIENTE === "restrita") !== urlRestrita) {
    throw new Error("NFSE_AMBIENTE não combina com SEFIN_BASE_URL/ADN_BASE_URL");
  }
  if (env === process.env) cache = r.data;
  return r.data;
}

/** Só o que o navegador pode ver. */
export const configPublica = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
};
